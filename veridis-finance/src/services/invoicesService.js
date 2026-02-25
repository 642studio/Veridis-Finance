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
        invoice_date
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING
        id,
        organization_id,
        uuid_sat,
        emitter,
        receiver,
        total,
        status,
        invoice_date,
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

module.exports = {
  createInvoice,
  findInvoiceByUuid,
};
