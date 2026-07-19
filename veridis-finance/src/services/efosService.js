/**
 * EFOS (SAT art. 69-B) monitoring.
 *
 * Mirrors the public SAT blacklist into finance.efos_blacklist and
 * cross-references each tenant's counterparties: contacts with RFC, CFDI
 * receivers, and supplier RFCs from received invoices (uploaded XMLs and the
 * SAT Descarga Masiva ledger). Hits raise in-app notifications.
 *
 * Refresh sources:
 *   - 'sat-csv'        fetched from SAT_EFOS_URL (default: listado completo 69-B)
 *   - 'manual-upload'  a CSV uploaded by the user (fallback when SAT blocks)
 */

const pool = require('../db/pool');
const notifications = require('./notificationsService');

const DEFAULT_URL =
  'https://omawww.sat.gob.mx/cifras_sat/Documents/Listado_Completo_69-B.csv';

const RFC_RE = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;

/** Minimal CSV line parser that honors double quotes. */
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Parse the SAT 69-B CSV (latin1). Rows: No, RFC, Nombre, Situación, ...
 * Junk/header lines are skipped because their second field is not a valid RFC.
 */
function parseEfosCsv(buffer) {
  const text = buffer.toString('latin1');
  const lines = text.split(/\r?\n/);
  const rows = [];
  for (const line of lines) {
    if (!line || line.length < 10) continue;
    const fields = parseCsvLine(line);
    if (fields.length < 4) continue;
    const rfc = String(fields[1] || '').trim().toUpperCase();
    if (!RFC_RE.test(rfc)) continue;
    rows.push({
      rfc,
      name: String(fields[2] || '').trim().slice(0, 300),
      situacion: String(fields[3] || '').trim().slice(0, 80) || 'Desconocido',
    });
  }
  return rows;
}

async function upsertRows(rows) {
  const BATCH = 1000;
  let n = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    // eslint-disable-next-line no-await-in-loop
    await pool.query(
      `INSERT INTO finance.efos_blacklist (rfc, name, situacion, updated_at)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], array_fill(now(), ARRAY[$4::int]))
       ON CONFLICT (rfc) DO UPDATE SET
         name = EXCLUDED.name, situacion = EXCLUDED.situacion, updated_at = now()`,
      [slice.map((r) => r.rfc), slice.map((r) => r.name), slice.map((r) => r.situacion), slice.length]
    );
    n += slice.length;
  }
  return n;
}

async function logRefresh(source, rowCount, errorMessage) {
  await pool.query(
    `INSERT INTO finance.efos_refresh_log (source, row_count, status, error_message)
     VALUES ($1,$2,$3,$4)`,
    [source, rowCount, errorMessage ? 'error' : 'ok', errorMessage || null]
  );
}

/** Refresh the mirror from the SAT public CSV. */
async function refreshFromSat() {
  const url = process.env.SAT_EFOS_URL || DEFAULT_URL;
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (VeridisFinance)' },
      signal: AbortSignal.timeout(45_000),
    });
  } catch (err) {
    await logRefresh('sat-csv', 0, `fetch failed: ${err.message}`);
    const e = new Error('No se pudo descargar la lista del SAT. Sube el CSV manualmente.');
    e.statusCode = 502;
    throw e;
  }
  if (!res.ok) {
    await logRefresh('sat-csv', 0, `HTTP ${res.status}`);
    const e = new Error(`El SAT respondió ${res.status}. Sube el CSV manualmente.`);
    e.statusCode = 502;
    throw e;
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const rows = parseEfosCsv(buffer);
  const n = await upsertRows(rows);
  await logRefresh('sat-csv', n, null);
  return { rows: n };
}

/** Refresh the mirror from a user-uploaded CSV (same 69-B format). */
async function refreshFromUpload(buffer) {
  const rows = parseEfosCsv(buffer);
  if (!rows.length) {
    const e = new Error('El CSV no contiene renglones 69-B reconocibles');
    e.statusCode = 400;
    throw e;
  }
  const n = await upsertRows(rows);
  await logRefresh('manual-upload', n, null);
  return { rows: n };
}

async function status() {
  const { rows: count } = await pool.query(`SELECT count(*)::int AS n FROM finance.efos_blacklist`);
  const { rows: last } = await pool.query(
    `SELECT source, row_count, status, error_message, refreshed_at
       FROM finance.efos_refresh_log ORDER BY refreshed_at DESC LIMIT 1`
  );
  return { total_rfcs: count[0]?.n || 0, last_refresh: last[0] || null };
}

/**
 * Cross-reference a tenant's counterparties against the blacklist.
 * Sources: contacts.rfc, cfdi_receivers.rfc (clientes) and
 * invoices.emitter_rfc for received invoices (proveedores — XML subidos y
 * Descarga Masiva del SAT).
 */
async function hits(organizationId) {
  const { rows } = await pool.query(
    `WITH counterparties AS (
       SELECT DISTINCT rfc, name, source FROM (
         SELECT upper(c.rfc) AS rfc, c.name, 'contacto' AS source
           FROM finance.contacts c
          WHERE c.organization_id = $1 AND c.rfc IS NOT NULL AND length(c.rfc) >= 12
         UNION ALL
         SELECT upper(r.rfc), r.name, 'receptor'
           FROM finance.cfdi_receivers r
          WHERE r.organization_id = $1
         UNION ALL
         SELECT upper(i.emitter_rfc), i.emitter, 'proveedor'
           FROM finance.invoices i
          WHERE i.organization_id = $1 AND i.direction = 'received'
            AND i.emitter_rfc IS NOT NULL AND length(i.emitter_rfc) >= 12
       ) x WHERE rfc IS NOT NULL
     )
     SELECT cp.rfc, cp.name AS counterparty_name, cp.source,
            e.name AS efos_name, e.situacion, e.updated_at
       FROM counterparties cp
       JOIN finance.efos_blacklist e ON e.rfc = cp.rfc
      ORDER BY e.situacion, cp.rfc`,
    [organizationId]
  );
  return rows;
}

/** Run the check and raise notifications for (new) hits. */
async function check(organizationId) {
  const found = await hits(organizationId);
  for (const hit of found) {
    const critical = /definitivo/i.test(hit.situacion);
    // eslint-disable-next-line no-await-in-loop
    await notifications.notify(organizationId, {
      type: 'efos',
      severity: critical ? 'critical' : 'warning',
      title: `EFOS ${hit.situacion}: ${hit.rfc}`,
      body: `${hit.counterparty_name || hit.efos_name || hit.rfc} aparece en la lista 69-B del SAT (${hit.situacion}). Fuente: ${hit.source}.`,
      ref_type: 'efos',
      ref_id: hit.rfc,
      email: critical,
    });
  }
  return { hits: found };
}

module.exports = { refreshFromSat, refreshFromUpload, status, hits, check, parseEfosCsv };
