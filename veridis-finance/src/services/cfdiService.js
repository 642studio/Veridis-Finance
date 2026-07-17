/**
 * CFDI service — orchestrates fiscal stamping (via pacService) and persistence
 * in finance.cfdi_documents, plus reading issued/received CFDIs.
 *
 * Per-tenant issuer/credentials come from finance.cfdi_issuers when present;
 * otherwise we fall back to the FACTURAMA_* env vars (single-tenant bootstrap).
 */

const pool = require('../db/pool');
const pac = require('./pacService');
const receiversService = require('./cfdiReceiversService');
const issuersService = require('./cfdiIssuersService');
const { round } = require('../lib/money');

/** Load the active issuer record for a tenant (or null). */
async function getIssuer(organizationId) {
  return issuersService.getActiveIssuer(organizationId);
}

/**
 * Resolve PAC provider + decrypted credentials for a tenant.
 * Prefers the per-tenant issuer record; falls back to env for the bootstrap
 * tenant. Delegated to cfdiIssuersService so encryption lives in one place.
 */
function resolveCreds(issuer) {
  return issuersService.resolveCreds(issuer);
}

function mapRow(r) {
  return {
    id: r.id,
    cfdi_type: r.cfdi_type,
    status: r.status,
    uuid: r.uuid,
    folio: r.folio,
    receiver_rfc: r.receiver_rfc,
    receiver_name: r.receiver_name,
    total: r.total != null ? Number(r.total) : null,
    currency: r.currency,
    metodo_pago: r.metodo_pago,
    pac_document_id: r.pac_document_id,
    source: r.source,
    source_ref: r.source_ref,
    ghl_invoice_id: r.ghl_invoice_id || null,
    ghl_contact_id: r.ghl_contact_id || null,
    payment_status: r.payment_status || 'pending',
    paid_at: r.paid_at || null,
    paid_source: r.paid_source || null,
    error_message: r.error_message,
    created_at: r.created_at,
    stamped_at: r.stamped_at,
  };
}

/**
 * Issue (stamp) a CFDI de Ingreso and persist it. Idempotent per (source, source_ref).
 *
 * @param {object} input
 * @param {string} input.organization_id
 * @param {object} input.receiver  { rfc, name, fiscalRegime, use, zip }
 * @param {Array}  input.items
 * @param {string} [input.paymentForm]  '01' default
 * @param {'PUE'|'PPD'} [input.paymentMethod]  'PUE' default
 * @param {string} [input.source]      'manual' | 'ghl' | 'api'
 * @param {string} [input.source_ref]  external id for idempotency
 * @param {string} [input.invoice_id]  link to finance.invoices
 */
async function issueIngreso(input) {
  const organizationId = input.organization_id;

  // Resolve the receiver: either a stored profile (receiver_id) or inline data.
  let receiver = input.receiver;
  let receiverId = input.receiver_id || null;
  let receiverContactId = input.ghl_contact_id || null;
  if (receiverId) {
    const profile = await receiversService.getById({ organization_id: organizationId, id: receiverId });
    if (!profile) {
      const err = new Error('Receiver profile not found');
      err.statusCode = 404;
      throw err;
    }
    receiver = {
      rfc: profile.rfc,
      name: profile.name,
      fiscalRegime: profile.fiscal_regime,
      use: profile.cfdi_use,
      zip: profile.zip_code,
    };
    receiverContactId = receiverContactId || profile.ghl_contact_id || null;
  }
  input = { ...input, receiver };

  // Idempotency: return the existing CFDI for this external document.
  if (input.source_ref) {
    const { rows } = await pool.query(
      `SELECT * FROM finance.cfdi_documents
        WHERE organization_id = $1 AND source = $2 AND source_ref = $3`,
      [organizationId, input.source || 'api', input.source_ref]
    );
    if (rows[0]) return { data: mapRow(rows[0]), idempotent: true };
  }

  const issuer = await getIssuer(organizationId);
  const { provider, creds } = resolveCreds(issuer);

  let stamped;
  try {
    stamped = await pac.stampIngreso({
      provider,
      creds,
      receiver: input.receiver,
      items: input.items,
      expeditionPlace: input.expeditionPlace || issuer?.zip_code,
      paymentForm: input.paymentForm || '01',
      paymentMethod: input.paymentMethod || 'PUE',
      folio: input.folio,
    });
  } catch (err) {
    // Persist the failed attempt for observability.
    await pool.query(
      `INSERT INTO finance.cfdi_documents
        (organization_id, issuer_id, invoice_id, cfdi_type, status, receiver_rfc,
         receiver_name, metodo_pago, forma_pago, source, source_ref, error_message, pac_provider)
       VALUES ($1,$2,$3,'I','error',$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        organizationId, issuer?.id || null, input.invoice_id || null,
        input.receiver.rfc, input.receiver.name,
        input.paymentMethod || 'PUE', input.paymentForm || '01',
        input.source || 'api', input.source_ref || null,
        String(err.message).slice(0, 500), provider,
      ]
    );
    throw err;
  }

  const { rows } = await pool.query(
    `INSERT INTO finance.cfdi_documents
      (organization_id, issuer_id, receiver_id, invoice_id, cfdi_type, status, uuid, folio,
       receiver_rfc, receiver_name, cfdi_use, metodo_pago, forma_pago, currency,
       total, pac_provider, pac_document_id, source, source_ref, ghl_contact_id, raw, stamped_at)
     VALUES ($1,$2,$3,$4,'I','stamped',$5,$6,$7,$8,$9,$10,$11,'MXN',$12,$13,$14,$15,$16,$17,$18, now())
     RETURNING *`,
    [
      organizationId, issuer?.id || null, receiverId, input.invoice_id || null,
      stamped.uuid, String(stamped.folio ?? ''),
      input.receiver.rfc, input.receiver.name, input.receiver.use || 'G03',
      input.paymentMethod || 'PUE', input.paymentForm || '01',
      round(stamped.total ?? 0), provider, stamped.id,
      input.source || 'api', input.source_ref || null, receiverContactId,
      JSON.stringify(stamped.raw || {}),
    ]
  );

  const doc = mapRow(rows[0]);

  // Veridis -> CRM: when a CFDI is issued *inside* Veridis (not from a CRM
  // webhook) for a receiver linked to a CRM contact, mirror it as an invoice in
  // the 642 CRM. Best-effort: never fail the stamping if the CRM call errors.
  if (input.source !== 'ghl' && receiverContactId && input.pushToCrm !== false) {
    try {
      // Lazy require avoids a circular dependency (ghlService requires this).
      const ghl = require('./ghlService');
      const ghlInvoiceId = await ghl.createInvoiceForCfdi(organizationId, {
        contactId: receiverContactId,
        receiver: input.receiver,
        items: input.items,
        currency: 'MXN',
      });
      if (ghlInvoiceId) {
        const linked = await linkGhlInvoice({ organization_id: organizationId, id: doc.id, ghl_invoice_id: ghlInvoiceId });
        if (linked) return { data: linked };
      }
    } catch (err) {
      // swallow: CRM mirroring is best-effort
    }
  }

  return { data: doc };
}

/** Link a Veridis CFDI to the invoice we created in the CRM. */
async function linkGhlInvoice({ organization_id, id, ghl_invoice_id }) {
  const { rows } = await pool.query(
    `UPDATE finance.cfdi_documents
        SET ghl_invoice_id = $3
      WHERE organization_id = $1 AND id = $2
      RETURNING *`,
    [organization_id, id, ghl_invoice_id]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

/**
 * Mark a CFDI as paid (reconciled). `source` is where the payment was
 * confirmed: 'veridis' (marked in-app) or 'crm' (paid in the 642 CRM).
 * Idempotent: an already-paid CFDI is returned unchanged.
 */
async function markPaid({ organization_id, id, source = 'veridis' }) {
  const { rows } = await pool.query(
    `UPDATE finance.cfdi_documents
        SET payment_status = 'paid',
            paid_at = COALESCE(paid_at, now()),
            paid_source = COALESCE(paid_source, $3)
      WHERE organization_id = $1 AND id = $2
      RETURNING *`,
    [organization_id, id, source]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

/** Find a CFDI by the CRM invoice id it was mirrored to (for payment sync). */
async function findByGhlInvoice({ organization_id, ghl_invoice_id }) {
  if (!ghl_invoice_id) return null;
  const { rows } = await pool.query(
    `SELECT * FROM finance.cfdi_documents
      WHERE organization_id = $1 AND ghl_invoice_id = $2
      ORDER BY created_at DESC LIMIT 1`,
    [organization_id, ghl_invoice_id]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

/** List issued CFDIs from our DB. */
async function listIssued({ organization_id, limit = 50, offset = 0 }) {
  const { rows } = await pool.query(
    `SELECT * FROM finance.cfdi_documents
      WHERE organization_id = $1 AND cfdi_type = 'I'
      ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [organization_id, limit, offset]
  );
  return rows.map(mapRow);
}

async function getById({ organization_id, id }) {
  const { rows } = await pool.query(
    `SELECT * FROM finance.cfdi_documents WHERE organization_id = $1 AND id = $2`,
    [organization_id, id]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

async function getPacDocumentId({ organization_id, id }) {
  const { rows } = await pool.query(
    `SELECT pac_document_id FROM finance.cfdi_documents WHERE organization_id = $1 AND id = $2`,
    [organization_id, id]
  );
  return rows[0]?.pac_document_id || null;
}

/** Download the stamped PDF/XML for one of our CFDIs. kind: 'pdf' | 'xml'. */
async function download({ organization_id, id, kind }) {
  const pacId = await getPacDocumentId({ organization_id, id });
  if (!pacId) return null;
  const issuer = await getIssuer(organization_id);
  const { provider, creds } = resolveCreds(issuer);
  return kind === 'xml'
    ? pac.getXml(pacId, { provider, creds })
    : pac.getPdf(pacId, { provider, creds });
}

/**
 * List CFDIs received from suppliers (facturas de proveedores) straight from
 * the PAC — this is the "recibir facturas" side.
 */
async function listReceived({ organization_id }) {
  const issuer = await getIssuer(organization_id);
  const { provider, creds } = resolveCreds(issuer);
  const rows = await pac.list('received', { provider, creds });
  return rows.map((c) => ({
    uuid: c?.Complement?.TaxStamp?.Uuid || c?.Uuid || null,
    issuer_rfc: c?.Issuer?.Rfc || c?.IssuerRfc,
    issuer_name: c?.Issuer?.Name || c?.IssuerName,
    total: c?.Total,
    date: c?.Date,
    pac_document_id: c?.Id,
  }));
}

module.exports = {
  issueIngreso,
  listIssued,
  getById,
  download,
  listReceived,
  getIssuer,
  linkGhlInvoice,
  markPaid,
  findByGhlInvoice,
};
