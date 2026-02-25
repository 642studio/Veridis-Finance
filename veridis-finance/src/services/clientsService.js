const pool = require('../db/pool');

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

function trimOrNull(value, maxLength) {
  const trimmed = String(value || '').trim().slice(0, maxLength);
  return trimmed.length ? trimmed : null;
}

function normalizeClientInput(payload) {
  return {
    name: String(payload.name || '').trim().slice(0, 255),
    business_name: trimOrNull(payload.business_name, 255),
    email: trimOrNull(payload.email, 255),
    phone: trimOrNull(payload.phone, 60),
    notes: trimOrNull(payload.notes, 2000),
    active: payload.active === undefined ? true : Boolean(payload.active),
  };
}

function mapClient(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    organization_id: row.organization_id,
    name: row.name,
    business_name: row.business_name,
    email: row.email,
    phone: row.phone,
    notes: row.notes,
    active: row.active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function createClient(payload) {
  const normalized = normalizeClientInput(payload);

  const query = {
    text: `
      INSERT INTO finance.clients (
        organization_id,
        name,
        business_name,
        email,
        phone,
        notes,
        active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING
        id,
        organization_id,
        name,
        business_name,
        email,
        phone,
        notes,
        active,
        created_at,
        updated_at
    `,
    values: [
      payload.organization_id,
      normalized.name,
      normalized.business_name,
      normalized.email,
      normalized.phone,
      normalized.notes,
      normalized.active,
    ],
  };

  const { rows } = await pool.query(query);
  return mapClient(rows[0]);
}

async function listClients({ organization_id, active }) {
  const values = [organization_id];
  const conditions = ['organization_id = $1'];

  if (typeof active === 'boolean') {
    values.push(active);
    conditions.push(`active = $${values.length}`);
  }

  const query = {
    text: `
      SELECT
        id,
        organization_id,
        name,
        business_name,
        email,
        phone,
        notes,
        active,
        created_at,
        updated_at
      FROM finance.clients
      WHERE ${conditions.join(' AND ')}
      ORDER BY lower(name) ASC, created_at DESC
    `,
    values,
  };

  const { rows } = await pool.query(query);
  return rows.map(mapClient);
}

async function updateClient({ organization_id, client_id, patch }) {
  const values = [organization_id, client_id];
  const assignments = [];

  const normalized = {
    name:
      patch.name === undefined
        ? undefined
        : String(patch.name || '').trim().slice(0, 255),
    business_name:
      patch.business_name === undefined
        ? undefined
        : trimOrNull(patch.business_name, 255),
    email: patch.email === undefined ? undefined : trimOrNull(patch.email, 255),
    phone: patch.phone === undefined ? undefined : trimOrNull(patch.phone, 60),
    notes: patch.notes === undefined ? undefined : trimOrNull(patch.notes, 2000),
    active: patch.active === undefined ? undefined : Boolean(patch.active),
  };

  for (const [key, value] of Object.entries(normalized)) {
    if (value === undefined) {
      continue;
    }

    values.push(value);
    assignments.push(`${key} = $${values.length}`);
  }

  if (!assignments.length) {
    return getClientById({ organization_id, client_id });
  }

  values.push(new Date());
  assignments.push(`updated_at = $${values.length}`);

  const query = {
    text: `
      UPDATE finance.clients
      SET ${assignments.join(', ')}
      WHERE organization_id = $1
        AND id = $2
      RETURNING
        id,
        organization_id,
        name,
        business_name,
        email,
        phone,
        notes,
        active,
        created_at,
        updated_at
    `,
    values,
  };

  const { rows } = await pool.query(query);
  if (!rows[0]) {
    throw notFound(`Client not found: ${client_id}`);
  }

  return mapClient(rows[0]);
}

async function softDeleteClient({ organization_id, client_id }) {
  return updateClient({
    organization_id,
    client_id,
    patch: {
      active: false,
    },
  });
}

async function getClientById({ organization_id, client_id }) {
  const query = {
    text: `
      SELECT
        id,
        organization_id,
        name,
        business_name,
        email,
        phone,
        notes,
        active,
        created_at,
        updated_at
      FROM finance.clients
      WHERE organization_id = $1
        AND id = $2
      LIMIT 1
    `,
    values: [organization_id, client_id],
  };

  const { rows } = await pool.query(query);
  if (!rows[0]) {
    throw notFound(`Client not found: ${client_id}`);
  }

  return mapClient(rows[0]);
}

async function assertClientExists({ organization_id, client_id }) {
  if (!client_id) {
    return null;
  }

  const query = {
    text: `
      SELECT id
      FROM finance.clients
      WHERE organization_id = $1
        AND id = $2
        AND active = true
      LIMIT 1
    `,
    values: [organization_id, client_id],
  };

  const { rows } = await pool.query(query);
  if (!rows[0]) {
    throw notFound(`Client not found or inactive: ${client_id}`);
  }

  return rows[0];
}

module.exports = {
  createClient,
  listClients,
  updateClient,
  softDeleteClient,
  getClientById,
  assertClientExists,
};
