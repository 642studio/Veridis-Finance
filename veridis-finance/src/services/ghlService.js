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
const invoicesService = require('./invoicesService');
const issuersService = require('./cfdiIssuersService');

// GHL OAuth access tokens are stored encrypted at rest (like the refresh token).
// Tolerate legacy plaintext rows written before this change: ciphertext always
// starts with the "v1:" version prefix.
function maybeDecrypt(value) {
  if (!value) return null;
  return String(value).startsWith('v1:') ? decrypt(value) : value;
}
const cfdiService = require('./cfdiService');
const receiversService = require('./cfdiReceiversService');

const API_BASE = 'https://services.leadconnectorhq.com';
const TOKEN_URL = `${API_BASE}/oauth/token`;
// v2 chooselocation carries the app version context GHL needs.
const MARKETPLACE_AUTH = 'https://marketplace.leadconnectorhq.com/v2/oauth/chooselocation';
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
  // The app version id (from the app's Install Link). Required so the draft/
  // published app resolves — without it GHL returns noAppVersionIdFound.
  if (process.env.GHL_VERSION_ID) params.set('version_id', process.env.GHL_VERSION_ID);
  if (state) params.set('state', state);
  return `${MARKETPLACE_AUTH}?${params.toString()}`;
}

/** Fetch with a hard timeout so a slow GHL never hangs the serverless fn. */
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error(`GHL no respondió en ${Math.round(timeoutMs / 1000)}s (timeout).`);
      e.statusCode = 504;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function tokenRequest(body) {
  const res = await fetchWithTimeout(TOKEN_URL, {
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
                   -- Rebind the location to the org that initiated THIS install
                   -- (they proved control of the GHL account by authorizing).
                   -- Without this, a location once linked to org A could never
                   -- be re-linked to org B — the connect button "did nothing".
                   organization_id = COALESCE(EXCLUDED.organization_id, finance.ghl_installs.organization_id),
                   is_active = true, updated_at = now()
     RETURNING *`,
    [
      organizationId || null,
      tok.userType || 'Location',
      tok.locationId || null,
      tok.companyId || null,
      encrypt(tok.access_token),
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
      return maybeDecrypt(install.access_token);
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
      [installId, encrypt(tok.access_token), encrypt(tok.refresh_token), expiresAt]
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
  const res = await fetchWithTimeout(`${API_BASE}${path}`, {
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

/** Active install for a tenant (the connected GHL location). */
/**
 * Bind an unclaimed install (OAuth completed without state → organization NULL)
 * to an organization. Never steals an install already bound to another org.
 */
async function claimInstall(organizationId, locationId) {
  const { rows } = await pool.query(
    `UPDATE finance.ghl_installs
        SET organization_id = $1, updated_at = now()
      WHERE location_id = $2
        AND organization_id IS NULL
        AND is_active = true
      RETURNING *`,
    [organizationId, locationId]
  );
  return rows[0] || null;
}

async function getInstallForOrg(organizationId) {
  const { rows } = await pool.query(
    `SELECT * FROM finance.ghl_installs
      WHERE organization_id = $1 AND is_active = true
      ORDER BY installed_at DESC LIMIT 1`,
    [organizationId]
  );
  return rows[0] || null;
}

/** Pull invoices from the connected GHL location. */
async function listInvoices(organizationId, { limit = 20, offset = 0 } = {}) {
  const install = await getInstallForOrg(organizationId);
  if (!install) return { connected: false, invoices: [] };
  const q = new URLSearchParams({
    altId: install.location_id,
    altType: 'location',
    limit: String(limit),
    offset: String(offset),
  });
  const data = await apiFetch(install.id, `/invoices/?${q.toString()}`);
  return { connected: true, invoices: data.invoices || data.data || [] };
}

/** Pull contacts from the connected GHL location (Search Contacts). */
async function listContacts(organizationId, { limit = 20 } = {}) {
  const install = await getInstallForOrg(organizationId);
  if (!install) return { connected: false, contacts: [] };
  const data = await apiFetch(install.id, '/contacts/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locationId: install.location_id, pageLimit: limit }),
  });
  return { connected: true, contacts: data.contacts || [] };
}

/** Read a single GHL contact. */
async function getContact(organizationId, contactId) {
  const install = await getInstallForOrg(organizationId);
  if (!install) return null;
  const data = await apiFetch(install.id, `/contacts/${contactId}`);
  return data.contact || data;
}

/**
 * Write-back: add a note to a GHL contact (e.g. the stamped CFDI UUID + links).
 * Makes the CRM aware that the invoice was fiscally stamped.
 */
async function addContactNote(organizationId, contactId, body) {
  const install = await getInstallForOrg(organizationId);
  if (!install || !contactId) return null;
  return apiFetch(install.id, `/contacts/${contactId}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, userId: install.location_id }),
  });
}

/**
 * Veridis -> GHL: create an invoice in the CRM from a Veridis-issued document.
 * Kept minimal; the caller passes GHL-shaped items and contact details.
 */
async function createInvoiceInGhl(organizationId, invoice) {
  const install = await getInstallForOrg(organizationId);
  if (!install) {
    const err = new Error('CRM not connected');
    err.statusCode = 409;
    throw err;
  }
  return apiFetch(install.id, '/invoices/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      altId: install.location_id,
      altType: 'location',
      ...invoice,
    }),
  });
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Build a CRM invoice payload from a Veridis CFDI's receiver + items and create
 * it in the connected location. Returns the CRM invoice id (or null on failure).
 */
async function createInvoiceForCfdi(organizationId, { contactId, receiver, items, currency = 'MXN' }) {
  const install = await getInstallForOrg(organizationId);
  if (!install || !contactId) return null;

  const now = new Date();
  const due = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
  const invItems = (items || []).map((it) => ({
    name: it.description || 'Concepto',
    currency,
    amount: Number(it.unitPrice || 0),
    qty: Number(it.quantity || 1),
    taxes:
      it.ivaRate && Number(it.ivaRate) > 0
        ? [{ name: 'IVA', rate: Number(it.ivaRate) * 100, calculation: 'exclusive' }]
        : [],
  }));

  const created = await createInvoiceInGhl(organizationId, {
    name: `Factura ${receiver?.name || ''}`.trim(),
    currency,
    items: invItems,
    contactDetails: {
      id: contactId,
      name: receiver?.name || undefined,
    },
    issueDate: ymd(now),
    dueDate: ymd(due),
    liveMode: true,
  });

  return created?._id || created?.id || created?.invoice?._id || null;
}

/**
 * Veridis -> GHL: record a payment against a CRM invoice so the CRM reflects the
 * reconciliation done in Veridis. Best-effort; returns null if not connected.
 */
async function recordInvoicePayment(organizationId, ghlInvoiceId, { amount, mode = 'cash', notes } = {}) {
  const install = await getInstallForOrg(organizationId);
  if (!install || !ghlInvoiceId) return null;
  return apiFetch(install.id, `/invoices/${ghlInvoiceId}/record-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      altId: install.location_id,
      altType: 'location',
      mode,
      amount: Number(amount || 0),
      notes: notes || 'Conciliado en Veridis Finance',
    }),
  });
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
  const organizationId = install.organization_id;
  const contact = data.contactDetails || data.contact || {};
  const ghlInvoiceId = String(data._id || data.id || data.invoiceId || '');

  // Payment sync: if this CRM invoice was originally created in Veridis (we
  // mirrored it and stored ghl_invoice_id), don't re-stamp — just reconcile it
  // as paid from the CRM side.
  const existingLinked = await cfdiService.findByGhlInvoice({
    organization_id: organizationId,
    ghl_invoice_id: ghlInvoiceId,
  });
  if (existingLinked) {
    const paid = await cfdiService.markPaid({
      organization_id: organizationId,
      id: existingLinked.id,
      source: 'crm',
    });
    return { data: paid || existingLinked, reconciled: true };
  }

  // Resolve the receiver's fiscal profile (from an uploaded CSF) by GHL contact
  // id or email. If none exists, we can't legally stamp — surface a clear error.
  let receiverProfile = await receiversService.resolve({
    organization_id: organizationId,
    ghl_contact_id: data.contactId || contact.id,
    email: contact.email,
  });

  // Fallback: fiscal data embedded in GHL custom fields (RFC/CP present).
  if (!receiverProfile) {
    const embedded = extractReceiver(data);
    if (embedded.rfc && embedded.zip) {
      receiverProfile = await receiversService.upsert({
        organization_id: organizationId,
        rfc: embedded.rfc,
        name: embedded.name,
        fiscal_regime: embedded.fiscalRegime,
        zip_code: embedded.zip,
        cfdi_use: embedded.use,
        email: contact.email,
        ghl_contact_id: data.contactId || contact.id,
        source: 'ghl',
      });
    }
  }

  if (!receiverProfile) {
    // Not a failure — the client just hasn't given us their CSF yet. Flag it so
    // the invoice shows as "pending CSF" and can be completed (in-app upload or
    // the client's self-service link) then retried.
    const err = new Error(
      'Falta la Constancia (CSF) de este cliente para poder timbrar'
    );
    err.pendingCsf = true;
    err.contactId = data.contactId || contact.id || null;
    err.statusCode = 422;
    throw err;
  }

  const result = await cfdiService.issueIngreso({
    organization_id: organizationId,
    receiver_id: receiverProfile.id,
    items: mapItems(data),
    paymentForm: '03',
    paymentMethod: 'PUE',
    source: 'ghl',
    source_ref: String(data._id || data.id || data.invoiceId || event.webhookId),
  });

  // The invoice was paid in the CRM (that's what triggered this event), so
  // reconcile the freshly-stamped CFDI as paid from the CRM side.
  if (result?.data?.id) {
    try {
      await cfdiService.markPaid({
        organization_id: organizationId,
        id: result.data.id,
        source: 'crm',
      });
    } catch {
      // best-effort
    }
    // Remove the pre-fiscal CRM placeholder now that a real CFDI mirror exists.
    try {
      await pool.query(
        `DELETE FROM finance.invoices WHERE organization_id = $1 AND uuid_sat = $2`,
        [organizationId, `crm:${ghlInvoiceId}`]
      );
    } catch {
      // best-effort
    }
  }

  // Write-back to the CRM: note the stamped CFDI on the contact (two-way).
  const contactId = data.contactId || contact.id;
  if (contactId && result?.data?.uuid) {
    try {
      const base = process.env.APP_PUBLIC_URL || 'https://veridis-finance-api.vercel.app';
      await addContactNote(
        organizationId,
        contactId,
        `✅ CFDI timbrado por Veridis\nUUID: ${result.data.uuid}\nTotal: $${result.data.total} MXN\nPDF: ${base}/api/finance/cfdi/${result.data.id}/pdf`
      );
    } catch {
      // Write-back is best-effort; never fail the stamping because of it.
    }
  }

  return result;
}

/** Invoices paid in the CRM that couldn't be stamped yet (missing CSF). */
async function listPending(organizationId) {
  const install = await getInstallForOrg(organizationId);
  if (!install) return [];
  const { rows } = await pool.query(
    `SELECT id,
            payload->'data'->>'name' AS invoice_name,
            payload->'data'->>'total' AS total,
            payload->'data'->'contactDetails'->>'name' AS contact_name,
            payload->'data'->'contactDetails'->>'email' AS contact_email,
            COALESCE(payload->'data'->>'contactId', payload->'data'->'contactDetails'->>'id') AS contact_id,
            error_message, received_at
       FROM finance.ghl_webhook_events
      WHERE status = 'pending_csf' AND location_id = $1
        -- Skip malformed/test events with no amount and no client — they render
        -- as useless "—" rows with a Timbrar button that can't work.
        AND payload->'data'->>'total' IS NOT NULL
        AND COALESCE(
              payload->'data'->'contactDetails'->>'name',
              payload->'data'->>'name'
            ) IS NOT NULL
      ORDER BY received_at DESC LIMIT 100`,
    [install.location_id]
  );
  return rows;
}

/**
 * Import the connected location's EXISTING (historical) CRM invoices.
 *
 * Forward-looking invoices arrive via webhook; this backfills the past: paid
 * invoices not yet linked to a CFDI get stamped right away when the client's
 * fiscal profile (CSF) exists, or parked in the pending_csf queue otherwise —
 * reusing the exact same pipeline, dedupe and UI actions as live webhooks.
 */
async function importCrmHistory(organizationId) {
  const install = await getInstallForOrg(organizationId);
  if (!install) {
    const err = new Error('CRM no conectado');
    err.statusCode = 409;
    throw err;
  }

  const pageSize = 100;
  const maxPages = 5; // hasta 500 facturas por corrida
  const all = [];
  for (let page = 0; page < maxPages; page += 1) {
    const q = new URLSearchParams({
      altId: install.location_id,
      altType: 'location',
      limit: String(pageSize),
      offset: String(page * pageSize),
    });
    const data = await apiFetch(install.id, `/invoices/?${q.toString()}`);
    const list = data.invoices || data.data || [];
    all.push(...list);
    if (list.length < pageSize) break;
  }

  const summary = {
    found: all.length,
    stamped: 0,
    pending_csf: 0,
    already_linked: 0,
    already_imported: 0,
    skipped_unpaid: 0,
    errors: 0,
  };

  for (const inv of all) {
    const ghlInvoiceId = String(inv._id || inv.id || '').trim();
    if (!ghlInvoiceId) continue;

    const status = String(inv.status || '').toLowerCase();
    if (!['paid', 'partially_paid'].includes(status)) {
      summary.skipped_unpaid += 1;
      continue;
    }

    const linked = await cfdiService.findByGhlInvoice({
      organization_id: organizationId,
      ghl_invoice_id: ghlInvoiceId,
    });
    if (linked) {
      summary.already_linked += 1;
      continue;
    }

    const payload = {
      type: 'InvoicePaid',
      locationId: install.location_id,
      webhookId: `import:${ghlInvoiceId}`,
      data: inv,
    };
    const { isNew, row } = await recordWebhook(payload);
    if (!isNew) {
      summary.already_imported += 1;
      continue;
    }

    try {
      await markWebhook(row.id, 'processing');
      await processInvoicePaid(payload);
      await markWebhook(row.id, 'processed');
      summary.stamped += 1;
    } catch (err) {
      await markWebhook(row.id, err.pendingCsf ? 'pending_csf' : 'error', err.message);
      if (err.pendingCsf) summary.pending_csf += 1;
      else summary.errors += 1;
    }
  }

  // Bring the paid-but-unstamped invoices into the reconcilable ledger too, so
  // they show in Facturas immediately without a separate sync click.
  try {
    summary.ledger = await syncCrmToLedger(organizationId);
  } catch {
    // best-effort
  }

  return summary;
}

/**
 * Mirror the location's CRM invoices (paid in the CRM, whether stamped yet or
 * not) into finance.invoices as issued receivables, so they're visible in the
 * ledger and reconcilable against bank income BEFORE the fiscal CFDI exists.
 * Pre-fiscal placeholders use a synthetic uuid_sat 'crm:<ghlInvoiceId>'; once a
 * pending invoice is stamped, its placeholder is removed (see processInvoicePaid).
 */
async function syncCrmToLedger(organizationId) {
  const install = await getInstallForOrg(organizationId);
  if (!install) return { found: 0, created: 0, updated: 0 };
  const issuer = await issuersService.getActiveIssuer(organizationId);
  const emitter = `${issuer?.rfc || ''} - ${issuer?.legal_name || 'Mi empresa'}`.trim();

  const { rows } = await pool.query(
    `SELECT id, payload, received_at
       FROM finance.ghl_webhook_events
      WHERE location_id = $1
        AND event_type = 'InvoicePaid'
        AND status IN ('pending_csf', 'processed', 'received')
      ORDER BY received_at DESC
      LIMIT 500`,
    [install.location_id]
  );

  const parseAmount = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (value == null) return 0;
    // GHL sometimes sends amounts as strings like "5,015.00" or "$5,015".
    const n = Number(String(value).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };

  const summary = { found: rows.length, created: 0, updated: 0, skipped: 0 };
  for (const row of rows) {
    const data = row.payload?.data || row.payload || {};
    const ghlInvoiceId = String(data._id || data.id || data.invoiceId || data.invoiceNumber || row.id);
    const total = parseAmount(
      data.total ?? data.amountDue ?? data.amount ?? data.invoiceTotal ?? data.amountPaid ?? data.totalAmount
    );
    if (!(total > 0)) {
      summary.skipped += 1;
      continue;
    }
    const clientName =
      data.contactDetails?.name ||
      data.contact?.name ||
      data.name ||
      data.invoiceName ||
      data.title ||
      'Cliente CRM';

    // Skip if already stamped (a real CFDI mirror exists for this CRM invoice).
    const linked = await pool.query(
      `SELECT 1 FROM finance.cfdi_documents
        WHERE organization_id = $1 AND ghl_invoice_id = $2 AND status = 'stamped' LIMIT 1`,
      [organizationId, ghlInvoiceId]
    );
    if (linked.rows.length > 0) continue;

    const result = await invoicesService.upsertFromCfdi({
      organization_id: organizationId,
      uuid_sat: `crm:${ghlInvoiceId}`,
      emitter,
      receiver: clientName,
      emitter_rfc: issuer?.rfc || null,
      receiver_rfc: null,
      total,
      invoice_date: row.received_at || new Date(),
      status: 'pending', // reconcilable against bank income until settled
      currency: 'MXN',
      direction: 'issued',
      source: 'crm',
    });
    if (result?.inserted) summary.created += 1;
    else summary.updated += 1;
  }
  return summary;
}

/**
 * Dismiss a pending_csf event (e.g. stale test invoices) for the caller's
 * connected location. Scoped so an org can only dismiss its own events.
 */
async function dismissPending(organizationId, eventId) {
  const install = await getInstallForOrg(organizationId);
  if (!install) return null;
  const { rows } = await pool.query(
    `UPDATE finance.ghl_webhook_events
        SET status = 'ignored', error_message = 'dismissed by user'
      WHERE id = $1 AND status = 'pending_csf' AND location_id = $2
      RETURNING id`,
    [eventId, install.location_id]
  );
  return rows[0] || null;
}

/** Re-run stamping for a stored event (after the CSF was uploaded). */
async function retryPending(eventId) {
  const { rows } = await pool.query(
    `SELECT * FROM finance.ghl_webhook_events WHERE id = $1`,
    [eventId]
  );
  const ev = rows[0];
  if (!ev) {
    const err = new Error('Pending event not found');
    err.statusCode = 404;
    throw err;
  }
  const result = await processInvoicePaid(ev.payload);
  await markWebhook(eventId, 'processed');
  return result;
}

async function markWebhook(id, status, errorMessage) {
  await pool.query(
    `UPDATE finance.ghl_webhook_events
       SET status = $2, error_message = $3, processed_at = now() WHERE id = $1`,
    [id, status, errorMessage ? String(errorMessage).slice(0, 500) : null]
  );
}

/**
 * Cross-match CRM sales against REAL fiscal invoices already at the SAT.
 *
 * With Descarga Masiva feeding the ledger, many "pending" CRM sales already
 * have a CFDI (stamped elsewhere, e.g. directly in Facturama or by the
 * accountant). Those must NOT sit in the pending queue nor duplicate the
 * ledger: match by amount (±2%) + date window (90 días) against issued fiscal
 * invoices, mark the event 'already_invoiced' and drop its crm:<id>
 * placeholder — the SAT invoice is the real record.
 */
async function matchPendingToExistingCfdi(organizationId) {
  const install = await getInstallForOrg(organizationId);
  if (!install) return { checked: 0, matched: 0 };

  const parseAmount = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (value == null) return 0;
    const n = Number(String(value).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };

  const { rows: events } = await pool.query(
    `SELECT id, payload, received_at
       FROM finance.ghl_webhook_events
      WHERE location_id = $1 AND status = 'pending_csf'
      ORDER BY received_at DESC
      LIMIT 200`,
    [install.location_id]
  );
  if (!events.length) return { checked: 0, matched: 0 };

  // Real fiscal invoices we issued (any status — a paid CFDI still proves the
  // sale was invoiced). Synthetic refs are excluded.
  const { rows: fiscal } = await pool.query(
    `SELECT id, uuid_sat, total, invoice_date
       FROM finance.invoices
      WHERE organization_id = $1
        AND COALESCE(direction, 'issued') = 'issued'
        AND uuid_sat NOT LIKE 'crm:%'
        AND uuid_sat NOT LIKE 'manual:%'
        AND uuid_sat NOT LIKE 'e2e:%'`,
    [organizationId]
  );

  const DAY = 24 * 60 * 60 * 1000;
  const used = new Set();
  let matched = 0;

  for (const event of events) {
    const data = event.payload?.data || event.payload || {};
    const amount = parseAmount(data.total ?? data.amount ?? data.amountDue);
    if (!amount) continue;
    const eventTime = new Date(event.received_at).getTime();

    let best = null;
    for (const inv of fiscal) {
      if (used.has(inv.id)) continue;
      const total = Number(inv.total) || 0;
      if (Math.abs(total - amount) > Math.max(0.02 * amount, 0.01)) continue;
      const daysApart = Math.abs(new Date(inv.invoice_date).getTime() - eventTime) / DAY;
      if (daysApart > 90) continue;
      if (!best || daysApart < best.daysApart) best = { inv, daysApart };
    }
    if (!best) continue;

    used.add(best.inv.id);
    const ghlInvoiceId = String(data._id || data.id || data.invoiceId || data.invoiceNumber || event.id);
    await pool.query(
      `UPDATE finance.ghl_webhook_events
          SET status = 'already_invoiced', processed_at = now(),
              error_message = $2
        WHERE id = $1`,
      [event.id, `Cubierta por CFDI ${best.inv.uuid_sat}`]
    );
    await pool.query(
      `DELETE FROM finance.invoices
        WHERE organization_id = $1 AND uuid_sat = $2`,
      [organizationId, `crm:${ghlInvoiceId}`]
    );
    matched += 1;
  }

  return { checked: events.length, matched };
}

module.exports = {
  matchPendingToExistingCfdi,
  buildInstallUrl,
  exchangeCode,
  getValidAccessToken,
  apiFetch,
  getInstallForOrg,
  claimInstall,
  listInvoices,
  listContacts,
  getContact,
  addContactNote,
  createInvoiceInGhl,
  createInvoiceForCfdi,
  recordInvoicePayment,
  verifyWebhookSignature,
  recordWebhook,
  processInvoicePaid,
  listPending,
  retryPending,
  dismissPending,
  importCrmHistory,
  syncCrmToLedger,
  markWebhook,
};
