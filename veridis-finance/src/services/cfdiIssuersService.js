/**
 * CFDI issuers — one fiscal emitter (RFC + régimen + PAC credentials) per tenant.
 *
 * This is what makes multi-company issuing real: each organization stores its
 * own PAC credentials, encrypted at rest, and stamps with its OWN RFC. Secrets
 * (Facturama password / Facturapi API key, and the Facturama username) are
 * encrypted with the app key and NEVER returned to clients.
 */

const pool = require('../db/pool');
const { encrypt, decrypt } = require('../lib/crypto');

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

/** Load the active issuer record for a tenant (or null). */
async function getActiveIssuer(organizationId) {
  const { rows } = await pool.query(
    `SELECT * FROM finance.cfdi_issuers
      WHERE organization_id = $1 AND is_active = true
      ORDER BY created_at ASC LIMIT 1`,
    [organizationId]
  );
  return rows[0] || null;
}

/**
 * Resolve the PAC provider + decrypted credentials for a tenant.
 * Prefers the issuer record's per-tenant credentials; falls back to env vars for
 * the single-tenant bootstrap case.
 */
function resolveCreds(issuer) {
  const provider = issuer?.pac_provider || process.env.PAC_PROVIDER || 'facturama';

  if (provider === 'facturama') {
    const user = issuer?.pac_username_enc
      ? decrypt(issuer.pac_username_enc)
      : process.env.FACTURAMA_USER;
    const password = issuer?.pac_api_key_enc
      ? decrypt(issuer.pac_api_key_enc)
      : process.env.FACTURAMA_PASSWORD;
    const env =
      (issuer?.pac_env || process.env.FACTURAMA_ENV || 'sandbox') === 'production'
        ? 'production'
        : 'sandbox';
    return { provider, creds: { user, password, env } };
  }

  // facturapi
  const apiKey = issuer?.pac_api_key_enc
    ? decrypt(issuer.pac_api_key_enc)
    : process.env.FACTURAPI_KEY;
  return {
    provider,
    creds: { apiKey, organizationId: issuer?.pac_organization_id || null },
  };
}

/** Public-safe view of an issuer — no secrets, just a masked flag. */
function toPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    rfc: row.rfc,
    legal_name: row.legal_name,
    fiscal_regime: row.fiscal_regime,
    zip_code: row.zip_code,
    pac_provider: row.pac_provider,
    pac_env: row.pac_env,
    pac_organization_id: row.pac_organization_id || null,
    has_credentials: Boolean(row.pac_api_key_enc),
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getIssuerPublic(organizationId) {
  return toPublic(await getActiveIssuer(organizationId));
}

/**
 * Create or update the active issuer for a tenant. Secrets are only written when
 * provided (rotation-friendly): omitting pac_password / pac_api_key keeps the
 * stored one.
 *
 * @param {string} organizationId
 * @param {object} input
 */
async function upsertIssuer(organizationId, input) {
  const provider = (input.pac_provider || 'facturama').toLowerCase();
  if (!['facturama', 'facturapi'].includes(provider)) {
    throw badRequest("pac_provider must be 'facturama' or 'facturapi'");
  }
  const env = (input.pac_env || 'sandbox') === 'production' ? 'production' : 'sandbox';

  const existing = await getActiveIssuer(organizationId);

  // Encrypt whatever secret was supplied for this provider.
  let usernameEnc = existing?.pac_username_enc || null;
  let secretEnc = existing?.pac_api_key_enc || null;

  if (provider === 'facturama') {
    if (input.pac_username) usernameEnc = encrypt(String(input.pac_username));
    if (input.pac_password) secretEnc = encrypt(String(input.pac_password));
  } else {
    usernameEnc = null;
    if (input.pac_api_key) secretEnc = encrypt(String(input.pac_api_key));
  }

  if (existing) {
    const { rows } = await pool.query(
      `UPDATE finance.cfdi_issuers
          SET rfc = $2, legal_name = $3, fiscal_regime = $4, zip_code = $5,
              pac_provider = $6, pac_env = $7, pac_organization_id = $8,
              pac_username_enc = $9, pac_api_key_enc = $10, updated_at = now()
        WHERE id = $1
      RETURNING *`,
      [
        existing.id,
        input.rfc,
        input.legal_name,
        input.fiscal_regime,
        input.zip_code,
        provider,
        env,
        input.pac_organization_id || null,
        usernameEnc,
        secretEnc,
      ]
    );
    return toPublic(rows[0]);
  }

  const { rows } = await pool.query(
    `INSERT INTO finance.cfdi_issuers
      (organization_id, rfc, legal_name, fiscal_regime, zip_code, pac_provider,
       pac_env, pac_organization_id, pac_username_enc, pac_api_key_enc)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      organizationId,
      input.rfc,
      input.legal_name,
      input.fiscal_regime,
      input.zip_code,
      provider,
      env,
      input.pac_organization_id || null,
      usernameEnc,
      secretEnc,
    ]
  );
  return toPublic(rows[0]);
}

module.exports = {
  getActiveIssuer,
  getIssuerPublic,
  resolveCreds,
  upsertIssuer,
  toPublic,
};
