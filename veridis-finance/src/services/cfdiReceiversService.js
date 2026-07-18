/**
 * CFDI receivers (customer tax profiles) service.
 *
 * A receiver is the fiscal identity we issue a CFDI to. Data comes from a parsed
 * CSF, manual entry, or a GHL contact, and is reused every time we stamp an
 * invoice for that customer.
 */

const pool = require('../db/pool');
const { parseCsf } = require('./csfParserService');

function mapRow(r) {
  return {
    id: r.id,
    rfc: r.rfc,
    name: r.name,
    fiscal_regime: r.fiscal_regime,
    zip_code: r.zip_code,
    cfdi_use: r.cfdi_use,
    email: r.email,
    ghl_contact_id: r.ghl_contact_id,
    source: r.source,
    csf_uploaded: r.csf_uploaded,
    created_at: r.created_at,
  };
}

/** Upsert a receiver (unique per organization + RFC). */
async function upsert(input) {
  const { rows } = await pool.query(
    `INSERT INTO finance.cfdi_receivers
       (organization_id, rfc, name, fiscal_regime, zip_code, cfdi_use, email,
        ghl_contact_id, source, csf_uploaded, raw_csf, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
     ON CONFLICT (organization_id, rfc) DO UPDATE SET
       name = EXCLUDED.name,
       fiscal_regime = EXCLUDED.fiscal_regime,
       zip_code = EXCLUDED.zip_code,
       cfdi_use = COALESCE(EXCLUDED.cfdi_use, finance.cfdi_receivers.cfdi_use),
       email = COALESCE(EXCLUDED.email, finance.cfdi_receivers.email),
       ghl_contact_id = COALESCE(EXCLUDED.ghl_contact_id, finance.cfdi_receivers.ghl_contact_id),
       csf_uploaded = finance.cfdi_receivers.csf_uploaded OR EXCLUDED.csf_uploaded,
       updated_at = now()
     RETURNING *`,
    [
      input.organization_id, input.rfc.toUpperCase(), input.name,
      input.fiscal_regime, input.zip_code, input.cfdi_use || 'G03',
      input.email || null, input.ghl_contact_id || null,
      input.source || 'manual', Boolean(input.csf_uploaded),
      input.raw_csf ? JSON.stringify(input.raw_csf) : null,
    ]
  );
  return mapRow(rows[0]);
}

/**
 * Parse a CSF PDF and return the extracted fiscal data WITHOUT saving, so the
 * caller can let the user confirm the razón social first.
 */
async function previewCsf(buffer) {
  const data = await parseCsf(buffer);
  const missing = ['rfc', 'name', 'fiscal_regime', 'zip_code'].filter((k) => !data[k]);
  return { ...data, missing };
}

async function list({ organization_id, limit = 100, offset = 0 }) {
  const { rows } = await pool.query(
    `SELECT * FROM finance.cfdi_receivers WHERE organization_id = $1
      ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [organization_id, limit, offset]
  );
  const full = rows.map(mapRow);

  // Derived receivers: distinct clients found in the SAT-issued history. They
  // have RFC + name (enough to identify them and link to a CRM contact) but
  // LACK the CSF data (CP, régimen) required to stamp — flagged derived:true so
  // the UI can prompt "sube su CSF para completar".
  const known = new Set(full.map((r) => String(r.rfc || '').toUpperCase()));
  const { rows: derived } = await pool.query(
    `SELECT receiver_rfc AS rfc, MAX(receiver) AS name, COUNT(*)::int AS cfdi_count
       FROM finance.invoices
      WHERE organization_id = $1
        AND COALESCE(direction, 'issued') = 'issued'
        AND source = 'sat_download'
        AND receiver_rfc IS NOT NULL
      GROUP BY receiver_rfc
      ORDER BY cfdi_count DESC
      LIMIT 200`,
    [organization_id]
  );

  // Best-effort CRM link: match by normalized client name against the CRM
  // events already stored (no external API call).
  const { rows: crmContacts } = await pool.query(
    `SELECT DISTINCT
            COALESCE(payload->'data'->'contactDetails'->>'name', payload->'data'->>'name') AS name,
            COALESCE(payload->'data'->>'contactId', payload->'data'->'contactDetails'->>'id') AS contact_id
       FROM finance.ghl_webhook_events e
       JOIN finance.ghl_installs i ON i.location_id = e.location_id
      WHERE i.organization_id = $1`,
    [organization_id]
  ).catch(() => ({ rows: [] }));
  const norm = (s) =>
    String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const crmByName = new Map(crmContacts.filter((c) => c.name).map((c) => [norm(c.name), c.contact_id]));

  for (const d of derived) {
    const rfc = String(d.rfc).toUpperCase();
    if (known.has(rfc)) continue;
    full.push({
      id: `sat:${rfc}`,
      rfc,
      legal_name: d.name || rfc,
      zip_code: null,
      fiscal_regime: null,
      cfdi_count: d.cfdi_count,
      ghl_contact_id: crmByName.get(norm(d.name)) || null,
      derived: true,
    });
  }

  return full;
}

async function getById({ organization_id, id }) {
  const { rows } = await pool.query(
    `SELECT * FROM finance.cfdi_receivers WHERE organization_id = $1 AND id = $2`,
    [organization_id, id]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

/** Resolve a receiver by id, GHL contact id, or email (for the GHL flow). */
async function resolve({ organization_id, id, ghl_contact_id, email }) {
  if (id) return getById({ organization_id, id });
  if (ghl_contact_id) {
    const { rows } = await pool.query(
      `SELECT * FROM finance.cfdi_receivers WHERE organization_id = $1 AND ghl_contact_id = $2 LIMIT 1`,
      [organization_id, ghl_contact_id]
    );
    if (rows[0]) return mapRow(rows[0]);
  }
  if (email) {
    const { rows } = await pool.query(
      `SELECT * FROM finance.cfdi_receivers WHERE organization_id = $1 AND lower(email) = lower($2) LIMIT 1`,
      [organization_id, email]
    );
    if (rows[0]) return mapRow(rows[0]);
  }
  return null;
}

module.exports = { upsert, previewCsf, list, getById, resolve };
