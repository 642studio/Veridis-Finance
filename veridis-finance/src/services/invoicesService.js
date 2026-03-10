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
        payment_reference
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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

async function listInvoices({
  organization_id,
  status,
  limit = 100,
  offset = 0,
}) {
  const values = [organization_id];
  const conditions = ['organization_id = $1'];

  if (status) {
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }

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
  return rows;
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
  listInvoices,
  findInvoiceByUuid,
  updateInvoiceStatus,
};
