/**
 * CFDI service — orchestrates fiscal stamping (via pacService) and persistence
 * in finance.cfdi_documents, plus reading issued/received CFDIs.
 *
 * Per-tenant issuer/credentials come from finance.cfdi_issuers when present;
 * otherwise we fall back to the FACTURAMA_* env vars (single-tenant bootstrap).
 */

const pool = require('../db/pool');
const pac = require('./pacService');
const { round } = require('../lib/money');

/** Load the active issuer record for a tenant (or null). */
async function getIssuer(organizationId) {
  const { rows } = await pool.query(
    `SELECT * FROM finance.cfdi_issuers
      WHERE organization_id = $1 AND is_active = true
      ORDER BY created_at ASC LIMIT 1`,
    [organizationId]
  );
  return rows[0] || null;
}

/**
 * Resolve PAC provider + credentials for a tenant.
 * Prefers the issuer record; falls back to env for the bootstrap tenant.
 */
function resolveCreds(issuer) {
  const provider = issuer?.pac_provider || process.env.PAC_PROVIDER || 'facturama';
  if (provider === 'facturama') {
    return {
      provider,
      creds: {
        user: process.env.FACTURAMA_USER,
        password: process.env.FACTURAMA_PASSWORD,
        env: process.env.FACTURAMA_ENV || 'sandbox',
      },
    };
  }
  // facturapi
  return { provider, creds: { apiKey: process.env.FACTURAPI_KEY } };
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
      (organization_id, issuer_id, invoice_id, cfdi_type, status, uuid, folio,
       receiver_rfc, receiver_name, cfdi_use, metodo_pago, forma_pago, currency,
       total, pac_provider, pac_document_id, source, source_ref, raw, stamped_at)
     VALUES ($1,$2,$3,'I','stamped',$4,$5,$6,$7,$8,$9,$10,'MXN',$11,$12,$13,$14,$15,$16, now())
     RETURNING *`,
    [
      organizationId, issuer?.id || null, input.invoice_id || null,
      stamped.uuid, String(stamped.folio ?? ''),
      input.receiver.rfc, input.receiver.name, input.receiver.use || 'G03',
      input.paymentMethod || 'PUE', input.paymentForm || '01',
      round(stamped.total ?? 0), provider, stamped.id,
      input.source || 'api', input.source_ref || null,
      JSON.stringify(stamped.raw || {}),
    ]
  );

  return { data: mapRow(rows[0]) };
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
};
