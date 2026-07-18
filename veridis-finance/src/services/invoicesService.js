const pool = require('../db/pool');

function conflict(message) {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
}

async function findInvoiceByUuid(organizationId, uuidSat) {
  const query = {
    text: `
      SELECT
        id,
        organization_id,
        uuid_sat,
        emitter,
        receiver,
        total,
        status,
        invoice_date,
        created_at
      FROM finance.invoices
      WHERE organization_id = $1
        AND uuid_sat = $2
      LIMIT 1
    `,
    values: [organizationId, uuidSat],
  };

  const { rows } = await pool.query(query);
  return rows[0] || null;
}

async function ensureUuidIsAvailable(organizationId, uuidSat) {
  const existing = await findInvoiceByUuid(organizationId, uuidSat);
  if (existing) {
    throw conflict(`Invoice UUID already exists: ${uuidSat}`);
  }
}

async function createInvoice(payload) {
  await ensureUuidIsAvailable(payload.organization_id, payload.uuid_sat);

  const query = {
    text: `
      INSERT INTO finance.invoices (
        organization_id,
        uuid_sat,
        emitter,
        receiver,
        total,
        status,
        invoice_date,
        paid_at,
        payment_method,
        payment_reference,
        emitter_rfc,
        receiver_rfc,
        subtotal,
        currency,
        comprobante_type,
        forma_pago,
        metodo_pago,
        taxes,
        concepts,
        direction
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
              $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING
        id,
        organization_id,
        uuid_sat,
        emitter,
        receiver,
        total,
        status,
        invoice_date,
        paid_at,
        payment_method,
        payment_reference,
        emitter_rfc,
        receiver_rfc,
        direction,
        updated_at,
        created_at
    `,
    values: [
      payload.organization_id,
      payload.uuid_sat,
      payload.emitter,
      payload.receiver,
      payload.total,
      payload.status,
      payload.invoice_date,
      payload.status === 'paid' ? new Date() : null,
      null,
      null,
      // Structured fiscal fields from the enriched CFDI parser (DIOT et al).
      payload.emitter_rfc || null,
      payload.receiver_rfc || null,
      payload.subtotal ?? null,
      payload.currency || null,
      payload.comprobante_type || null,
      payload.forma_pago || null,
      payload.metodo_pago || null,
      payload.taxes ? JSON.stringify(payload.taxes) : null,
      payload.concepts ? JSON.stringify(payload.concepts) : null,
      payload.direction === 'issued' ? 'issued' : 'received',
    ],
  };

  try {
    const { rows } = await pool.query(query);
    return rows[0];
  } catch (error) {
    if (error?.code === '23505') {
      throw conflict(`Invoice UUID already exists: ${payload.uuid_sat}`);
    }
    throw error;
  }
}

/**
 * Fiscal UUIDs (folio fiscal) are case-insensitive; the SAT emits uppercase,
 * uploaded XMLs sometimes carry lowercase. Normalize REAL UUIDs to uppercase so
 * (org, uuid_sat) dedupe works across sources. Synthetic refs (crm:…, manual:…)
 * pass through untouched.
 */
function normalizeUuidSat(value) {
  const raw = String(value || '').trim();
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(raw)
    ? raw.toUpperCase()
    : raw;
}

/**
 * Insert-or-update an invoice mirrored from a CFDI (issued or PAC-received), so
 * finance.invoices is the single reconcilable ledger. Deduped by (org, uuid_sat).
 * Never downgrades a 'paid' invoice back to 'pending'.
 */
async function upsertFromCfdi(payload) {
  const { rows } = await pool.query(
    `
    INSERT INTO finance.invoices (
      organization_id, uuid_sat, emitter, receiver, total, status, invoice_date,
      paid_at, emitter_rfc, receiver_rfc, subtotal, currency, comprobante_type,
      forma_pago, metodo_pago, taxes, concepts, direction, source, cfdi_document_id
    )
    VALUES ($1,$2,$3,$4,$5,$6::finance.invoice_status,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
    ON CONFLICT (organization_id, uuid_sat) DO UPDATE SET
      emitter = EXCLUDED.emitter,
      receiver = EXCLUDED.receiver,
      total = EXCLUDED.total,
      status = CASE
        WHEN finance.invoices.status = 'paid'::finance.invoice_status
          THEN finance.invoices.status
        ELSE EXCLUDED.status
      END,
      paid_at = COALESCE(finance.invoices.paid_at, EXCLUDED.paid_at),
      emitter_rfc = COALESCE(EXCLUDED.emitter_rfc, finance.invoices.emitter_rfc),
      receiver_rfc = COALESCE(EXCLUDED.receiver_rfc, finance.invoices.receiver_rfc),
      subtotal = COALESCE(EXCLUDED.subtotal, finance.invoices.subtotal),
      taxes = COALESCE(EXCLUDED.taxes, finance.invoices.taxes),
      direction = EXCLUDED.direction,
      source = EXCLUDED.source,
      cfdi_document_id = COALESCE(EXCLUDED.cfdi_document_id, finance.invoices.cfdi_document_id),
      updated_at = now()
    RETURNING id, uuid_sat, status, direction, source, (xmax = 0) AS inserted
  `,
    [
      payload.organization_id,
      normalizeUuidSat(payload.uuid_sat),
      payload.emitter,
      payload.receiver,
      payload.total,
      payload.status === 'paid' ? 'paid' : 'pending',
      payload.invoice_date,
      payload.status === 'paid' ? payload.paid_at || new Date() : null,
      payload.emitter_rfc || null,
      payload.receiver_rfc || null,
      payload.subtotal ?? null,
      payload.currency || 'MXN',
      payload.comprobante_type || null,
      payload.forma_pago || null,
      payload.metodo_pago || null,
      payload.taxes ? JSON.stringify(payload.taxes) : null,
      payload.concepts ? JSON.stringify(payload.concepts) : null,
      payload.direction === 'issued' ? 'issued' : 'received',
      payload.source || 'issued_cfdi',
      payload.cfdi_document_id || null,
    ]
  );
  return rows[0];
}

async function listInvoices({
  organization_id,
  status,
  direction,
  source,
  q,
  limit = 100,
  offset = 0,
}) {
  const values = [organization_id];
  const conditions = ['organization_id = $1'];

  if (status) {
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }
  if (direction) {
    values.push(direction);
    conditions.push(`COALESCE(direction, 'issued') = $${values.length}`);
  }
  if (source) {
    values.push(source);
    conditions.push(`COALESCE(source, 'upload') = $${values.length}`);
  }
  if (q) {
    values.push(`%${q}%`);
    const p = `$${values.length}`;
    conditions.push(
      `(emitter ILIKE ${p} OR receiver ILIKE ${p} OR uuid_sat ILIKE ${p}
        OR emitter_rfc ILIKE ${p} OR receiver_rfc ILIKE ${p})`
    );
  }

  // Total for pagination (same filters, before limit/offset).
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM finance.invoices WHERE ${conditions.join(' AND ')}`,
    values.slice()
  );
  const total = countRows[0]?.total ?? 0;

  values.push(limit);
  const limitParam = `$${values.length}`;
  values.push(offset);
  const offsetParam = `$${values.length}`;

  const query = {
    text: `
      SELECT
        id,
        organization_id,
        uuid_sat,
        emitter,
        receiver,
        total,
        status,
        invoice_date,
        paid_at,
        payment_method,
        payment_reference,
        emitter_rfc,
        receiver_rfc,
        direction,
        source,
        cfdi_document_id,
        updated_at,
        created_at
      FROM finance.invoices
      WHERE ${conditions.join(' AND ')}
      ORDER BY invoice_date DESC, created_at DESC
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
    `,
    values,
  };

  const { rows } = await pool.query(query);
  return { rows, total };
}

async function updateInvoiceStatus({
  organization_id,
  invoice_id,
  status,
  payment_method = null,
  payment_reference = null,
}) {
  const normalizedStatus = String(status || '')
    .trim()
    .toLowerCase();
  if (normalizedStatus !== 'pending' && normalizedStatus !== 'paid') {
    const error = new Error('status must be pending or paid');
    error.statusCode = 400;
    throw error;
  }

  const methodValue =
    payment_method === null || payment_method === undefined
      ? null
      : String(payment_method).trim().slice(0, 120) || null;
  const referenceValue =
    payment_reference === null || payment_reference === undefined
      ? null
      : String(payment_reference).trim().slice(0, 255) || null;

  const query = {
    text: `
      UPDATE finance.invoices
      SET
        status = $3::finance.invoice_status,
        paid_at = CASE
          WHEN $3 = 'paid'::finance.invoice_status THEN COALESCE(paid_at, now())
          ELSE NULL
        END,
        payment_method = CASE
          WHEN $3 = 'paid'::finance.invoice_status THEN $4
          ELSE NULL
        END,
        payment_reference = CASE
          WHEN $3 = 'paid'::finance.invoice_status THEN $5
          ELSE NULL
        END,
        updated_at = now()
      WHERE organization_id = $1
        AND id = $2
      RETURNING
        id,
        organization_id,
        uuid_sat,
        emitter,
        receiver,
        total,
        status,
        invoice_date,
        paid_at,
        payment_method,
        payment_reference,
        updated_at,
        created_at
    `,
    values: [
      organization_id,
      invoice_id,
      normalizedStatus,
      normalizedStatus === 'paid' ? methodValue : null,
      normalizedStatus === 'paid' ? referenceValue : null,
    ],
  };

  const { rows } = await pool.query(query);
  if (!rows[0]) {
    const error = new Error(`Invoice not found: ${invoice_id}`);
    error.statusCode = 404;
    throw error;
  }

  return rows[0];
}

module.exports = {
  createInvoice,
  upsertFromCfdi,
  listInvoices,
  findInvoiceByUuid,
  updateInvoiceStatus,
  normalizeUuidSat,
};
