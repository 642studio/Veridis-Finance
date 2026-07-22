/**
 * Directorio de clientes (S34). Puebla dos tablas que estaban vacías a pesar de
 * tener 100+ facturas emitidas:
 *   - finance.cfdi_receivers : directorio FISCAL (RFC, régimen, CP, CSF) — la
 *     base para emitir CFDIs y para la conciliación por RFC.
 *   - finance.clients        : directorio COMERCIAL (nombre, email, teléfono).
 *
 * Estrategia (elegida por el usuario): CRUZAR CRM + facturas.
 *   1) Siembra receivers y clientes desde los receptores DISTINTOS de las
 *      facturas emitidas (fuente de verdad de a quién le facturamos).
 *   2) Enriquece con los contactos del CRM (GHL) casando por nombre/email:
 *      rellena email, teléfono y ghl_contact_id sin pisar lo ya existente.
 * Idempotente: re-ejecutar no duplica (receivers por (org,rfc); clientes por
 * nombre normalizado).
 */

const pool = require('../db/pool');
const ghl = require('./ghlService');
const receivers = require('./cfdiReceiversService');

function normName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Receptores distintos de las facturas emitidas (con y sin RFC). */
async function invoiceReceivers(organizationId) {
  const { rows } = await pool.query(
    `SELECT receiver_rfc AS rfc, MAX(receiver) AS name,
            COUNT(*)::int AS invoices
       FROM finance.invoices
      WHERE organization_id = $1 AND direction = 'issued'
        AND receiver IS NOT NULL AND length(trim(receiver)) > 0
      GROUP BY receiver_rfc`,
    [organizationId]
  );
  return rows;
}

async function existingClientsByName(organizationId) {
  const { rows } = await pool.query(
    `SELECT id, name, business_name, email, phone FROM finance.clients
      WHERE organization_id = $1`,
    [organizationId]
  );
  const byName = new Map();
  for (const r of rows) {
    byName.set(normName(r.business_name || r.name), r);
  }
  return byName;
}

async function insertClient(organizationId, { name, businessName, email, phone }) {
  const { rows } = await pool.query(
    `INSERT INTO finance.clients (organization_id, name, business_name, email, phone, active)
     VALUES ($1,$2,$3,$4,$5,true) RETURNING id`,
    [organizationId, name, businessName || name, email || null, phone || null]
  );
  return rows[0];
}

/**
 * Sincroniza el directorio. Devuelve conteos: receivers/clients creados y
 * enriquecidos desde el CRM.
 */
async function sync({ organizationId }) {
  const invRx = await invoiceReceivers(organizationId);

  // 1) Receivers fiscales desde facturas con RFC.
  let receiversCreated = 0;
  for (const r of invRx) {
    if (!r.rfc || !String(r.rfc).trim()) continue; // sin RFC no hay receiver fiscal
    // eslint-disable-next-line no-await-in-loop
    await receivers.upsert({
      organization_id: organizationId,
      rfc: r.rfc,
      name: r.name,
      fiscal_regime: null,
      zip_code: null,
      cfdi_use: 'G03',
      source: 'invoice',
      csf_uploaded: false,
    });
    receiversCreated += 1;
  }

  // 2) Clientes comerciales desde TODOS los receptores (con o sin RFC).
  const clientsByName = await existingClientsByName(organizationId);
  const nameToClientId = new Map();
  let clientsCreated = 0;
  for (const r of invRx) {
    const key = normName(r.name);
    if (!key) continue;
    if (clientsByName.has(key)) {
      nameToClientId.set(key, clientsByName.get(key).id);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const created = await insertClient(organizationId, { name: r.name, businessName: r.name });
    nameToClientId.set(key, created.id);
    clientsByName.set(key, { id: created.id, name: r.name });
    clientsCreated += 1;
  }

  // 3) Enriquecer desde el CRM (best-effort): email/teléfono/ghl_contact_id.
  let enriched = 0;
  let crmConnected = false;
  try {
    const { connected, contacts } = await ghl.listContacts(organizationId, { limit: 100 });
    crmConnected = connected;
    for (const c of (contacts || [])) {
      const cname = normName(c.contactName || c.name || `${c.firstName || ''} ${c.lastName || ''}` || c.companyName);
      if (!cname) continue;
      const clientId = nameToClientId.get(cname);
      if (!clientId) continue; // solo enriquece clientes ya facturados
      // eslint-disable-next-line no-await-in-loop
      const res = await pool.query(
        `UPDATE finance.clients
            SET email = COALESCE(email, $1), phone = COALESCE(phone, $2)
          WHERE id = $3 AND organization_id = $4
            AND (email IS NULL OR phone IS NULL)`,
        [c.email || null, c.phone || null, clientId, organizationId]
      );
      if (res.rowCount > 0) enriched += 1;
    }
  } catch {
    // Si el CRM falla, el directorio sembrado desde facturas ya quedó.
  }

  return {
    invoice_receivers: invRx.length,
    receivers_upserted: receiversCreated,
    clients_created: clientsCreated,
    clients_total: clientsByName.size,
    crm_connected: crmConnected,
    crm_enriched: enriched,
  };
}

/** Infiere el tipo de proveedor por palabra clave del nombre. */
function inferVendorType(name) {
  const n = String(name || '').toLowerCase();
  if (/meta|facebook|google ads|tiktok|\bads\b|publicidad/.test(n)) return 'ads';
  if (/amazon|google|microsoft|adobe|software|cloud|vercel|supabase|openai|clickup/.test(n)) return 'software';
  if (/gini|mobilia|inmobil|renta|arrenda/.test(n)) return 'rent';
  if (/telefon|cable|megacable|telmex|cfe|izzi|internet|gasolin|energia|luz|agua/.test(n)) return 'utilities';
  return 'other';
}

/**
 * Siembra el directorio de PROVEEDORES (a quién le pagamos) desde los emisores
 * de los CFDIs recibidos. La tabla vendors no guarda RFC, así que dedup por
 * nombre normalizado. Idempotente.
 */
async function syncVendors({ organizationId }) {
  const { rows: emisores } = await pool.query(
    `SELECT emitter AS name, COUNT(*)::int AS cfdis, SUM(total)::numeric(14,2) AS monto
       FROM finance.invoices
      WHERE organization_id = $1 AND direction = 'received'
        AND emitter IS NOT NULL AND length(trim(emitter)) > 0
      GROUP BY emitter
      ORDER BY monto DESC`,
    [organizationId]
  );
  const { rows: existing } = await pool.query(
    `SELECT name FROM finance.vendors WHERE organization_id = $1`, [organizationId]
  );
  const have = new Set(existing.map((r) => normName(r.name)));
  let created = 0;
  for (const e of emisores) {
    const key = normName(e.name);
    if (!key || have.has(key)) continue;
    // eslint-disable-next-line no-await-in-loop
    await pool.query(
      `INSERT INTO finance.vendors (organization_id, name, type, active)
       VALUES ($1, $2, $3, true)`,
      [organizationId, e.name, inferVendorType(e.name)]
    );
    have.add(key);
    created += 1;
  }
  return { emisores: emisores.length, vendors_created: created, vendors_total: have.size };
}

module.exports = { sync, syncVendors, normName, inferVendorType };
