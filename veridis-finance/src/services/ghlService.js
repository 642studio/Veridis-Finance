/**
 * GoHighLevel (GHL / LeadConnector) integration service.
 *
 * - OAuth 2.0 Authorization Code flow with refresh-token rotation (atomic).
 * - Signed webhook ingestion (Ed25519), deduped and processed off-path.
 * - On InvoicePaid: issue a CFDI via cfdiService (idempotent per GHL invoice id).
 *
 * Config (env):
 *   GHL_CLIENT_ID, GHL_CLIENT_SECRET, GHL_REDIRECT_URI
 *   GHL_SCOPES              space-separated scopes for the install URL
 *   GHL_WEBHOOK_PUBLIC_KEY  Ed25519 PEM (defaults to GHL's published key)
 */

const crypto = require('node:crypto');
const pool = require('../db/pool');
const { encrypt, decrypt } = require('../lib/crypto');
const cfdiService = require('./cfdiService');

const API_BASE = 'https://services.leadconnectorhq.com';
const TOKEN_URL = `${API_BASE}/oauth/token`;
const MARKETPLACE_AUTH = 'https://marketplace.gohighlevel.com/oauth/chooselocation';
const API_VERSION = '2021-07-28';

// GHL's published Ed25519 webhook public key (override via env if it rotates).
const DEFAULT_WEBHOOK_PUBKEY =
  '-----BEGIN PUBLIC KEY-----\n' +
  'MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=\n' +
  '-----END PUBLIC KEY-----';

const DEFAULT_SCOPES = [
  'invoices.readonly',
  'contacts.readonly',
  'opportunities.readonly',
  'locations.readonly',
];

// --------------------------------------------------------------------------
// OAuth
// --------------------------------------------------------------------------

function buildInstallUrl(state) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.GHL_CLIENT_ID || '',
    redirect_uri: process.env.GHL_REDIRECT_URI || '',
    scope: process.env.GHL_SCOPES || DEFAULT_SCOPES.join(' '),
  });
  if (state) params.set('state', state);
  return `${MARKETPLACE_AUTH}?${params.toString()}`;
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`GHL token endpoint ${res.status}: ${JSON.stringify(data)}`);
    err.statusCode = res.status >= 500 ? 502 : 400;
    throw err;
  }
  return data;
}

function upsertInstallFromToken(tok, organizationId) {
  const expiresAt = new Date(Date.now() + (Number(tok.expires_in || 86400) - 60) * 1000);
  return pool.query(
    `INSERT INTO finance.ghl_installs
       (organization_id, ghl_user_type, location_id, company_id, access_token,
        refresh_token_enc, scope, token_expires_at, is_active, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true, now())
     ON CONFLICT (location_id) WHERE location_id IS NOT NULL
     DO UPDATE SET access_token = EXCLUDED.access_token,
                   refresh_token_enc = EXCLUDED.refresh_token_enc,
                   scope = EXCLUDED.scope,
                   token_expires_at = EXCLUDED.token_expires_at,
                   is_active = true, updated_at = now()
     RETURNING *`,
    [
      organizationId || null,
      tok.userType || 'Location',
      tok.locationId || null,
      tok.companyId || null,
      tok.access_token,
      encrypt(tok.refresh_token),
      tok.scope || null,
      expiresAt,
    ]
  );
}

/** Exchange an authorization code for tokens and persist the install. */
async function exchangeCode(code, organizationId) {
  const tok = await tokenRequest({
    client_id: process.env.GHL_CLIENT_ID,
    client_secret: process.env.GHL_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.GHL_REDIRECT_URI,
    user_type: 'Location',
  });
  const { rows } = await upsertInstallFromToken(tok, organizationId);
  return rows[0];
}

/**
 * Return a valid access token for an install, refreshing (with rotation) if
 * expired. Uses a transaction + row lock so concurrent serverless invocations
 * don't race on the rotating refresh token.
 */
async function getValidAccessToken(installId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM finance.ghl_installs WHERE id = $1 FOR UPDATE`,
      [installId]
    );
    const install = rows[0];
    if (!install) throw new Error('GHL install not found');

    if (install.token_expires_at && new Date(install.token_expires_at) > new Date()) {
      await client.query('COMMIT');
      return install.access_token;
    }

    const tok = await tokenRequest({
      client_id: process.env.GHL_CLIENT_ID,
      client_secret: process.env.GHL_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: decrypt(install.refresh_token_enc),
      user_type: install.ghl_user_type,
    });
    const expiresAt = new Date(Date.now() + (Number(tok.expires_in || 86400) - 60) * 1000);
    await client.query(
      `UPDATE finance.ghl_installs
         SET access_token = $2, refresh_token_enc = $3, token_expires_at = $4, updated_at = now()
       WHERE id = $1`,
      [installId, tok.access_token, encrypt(tok.refresh_token), expiresAt]
    );
    await client.query('COMMIT');
    return tok.access_token;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Call the GHL API for a given install. */
async function apiFetch(installId, path, options = {}) {
  const token = await getValidAccessToken(installId);
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: API_VERSION,
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`GHL API ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    err.statusCode = res.status;
    throw err;
  }
  return data;
}

// --------------------------------------------------------------------------
// Webhooks
// --------------------------------------------------------------------------

/** Verify the Ed25519 signature GHL sends over the raw request body. */
function verifyWebhookSignature(rawBody, signatureB64) {
  if (!signatureB64) return false;
  const pubkey = process.env.GHL_WEBHOOK_PUBLIC_KEY || DEFAULT_WEBHOOK_PUBKEY;
  try {
    return crypto.verify(
      null,
      Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody),
      pubkey,
      Buffer.from(signatureB64, 'base64')
    );
  } catch {
    return false;
  }
}

/** Record a webhook, deduped on (webhook_id, event_type). Returns {isNew, row}. */
async function recordWebhook(event) {
  const { rows } = await pool.query(
    `INSERT INTO finance.ghl_webhook_events (webhook_id, event_type, location_id, payload)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (webhook_id, event_type) WHERE webhook_id IS NOT NULL
     DO NOTHING
     RETURNING *`,
    [event.webhookId || null, event.type || 'unknown', event.locationId || null, JSON.stringify(event)]
  );
  return { isNew: rows.length > 0, row: rows[0] || null };
}

/** Find which tenant an install/location belongs to. */
async function orgForLocation(locationId) {
  if (!locationId) return null;
  const { rows } = await pool.query(
    `SELECT id, organization_id FROM finance.ghl_installs WHERE location_id = $1 AND is_active = true`,
    [locationId]
  );
  return rows[0] || null;
}

/**
 * Extract CFDI receiver fiscal data from a GHL invoice payload.
 * RFC/régimen/CP typically live in GHL contact custom fields; we look for them
 * in the payload and fall back to the SAT generic receiver when absent.
 */
function extractReceiver(data) {
  const c = data.contactDetails || data.contact || {};
  const cf = c.customFields || data.customFields || {};
  const pick = (...keys) => {
    for (const k of keys) {
      if (cf[k]) return cf[k];
      const hit = Array.isArray(cf) ? cf.find((f) => (f.key || f.name || '').toLowerCase().includes(k)) : null;
      if (hit) return hit.value || hit.fieldValue;
    }
    return undefined;
  };
  const rfc = pick('rfc', 'RFC');
  return {
    rfc,
    name: (c.companyName || c.name || '').toUpperCase(),
    fiscalRegime: pick('regimen', 'regimenfiscal', 'fiscal_regime') || '616',
    use: pick('usocfdi', 'uso', 'cfdi_use') || 'G03',
    zip: pick('cp', 'codigopostal', 'zip', 'postalcode') || c.postalCode,
  };
}

function mapItems(data) {
  const items = data.invoiceItems || data.items || [];
  if (!items.length) {
    return [{ description: data.name || 'Servicio', quantity: 1, unitPrice: Number(data.total || 0), ivaRate: 0.16 }];
  }
  return items.map((it) => ({
    description: it.name || it.description || 'Concepto',
    quantity: Number(it.qty || it.quantity || 1),
    unitPrice: Number(it.amount || it.price || it.unitPrice || 0),
    ivaRate: 0.16,
  }));
}

/**
 * Handle an InvoicePaid event: issue a CFDI for the paid invoice (idempotent on
 * the GHL invoice id). Returns the CFDI result or throws.
 */
async function processInvoicePaid(event) {
  const data = event.data || event;
  const install = await orgForLocation(event.locationId || data.locationId);
  if (!install || !install.organization_id) {
    const err = new Error('No tenant mapped for this GHL location');
    err.statusCode = 422;
    throw err;
  }
  const receiver = extractReceiver(data);
  if (!receiver.rfc || !receiver.zip) {
    const err = new Error('Missing receiver fiscal data (RFC / CP) on GHL invoice/contact');
    err.statusCode = 422;
    throw err;
  }
  return cfdiService.issueIngreso({
    organization_id: install.organization_id,
    receiver,
    items: mapItems(data),
    paymentForm: '03',
    paymentMethod: 'PUE',
    source: 'ghl',
    source_ref: String(data._id || data.id || data.invoiceId || event.webhookId),
  });
}

async function markWebhook(id, status, errorMessage) {
  await pool.query(
    `UPDATE finance.ghl_webhook_events
       SET status = $2, error_message = $3, processed_at = now() WHERE id = $1`,
    [id, status, errorMessage ? String(errorMessage).slice(0, 500) : null]
  );
}

module.exports = {
  buildInstallUrl,
  exchangeCode,
  getValidAccessToken,
  apiFetch,
  verifyWebhookSignature,
  recordWebhook,
  processInvoicePaid,
  markWebhook,
};
