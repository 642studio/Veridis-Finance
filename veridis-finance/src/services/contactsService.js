const pool = require('../db/pool');

const CONTACT_TYPES = Object.freeze([
  'customer',
  'vendor',
  'employee',
  'contractor',
  'internal',
]);

const CONTACT_STATUSES = Object.freeze(['active', 'inactive']);

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

function trimOrNull(value, maxLength) {
  const trimmed = String(value || '').trim().slice(0, maxLength);
  return trimmed.length ? trimmed : null;
}

function normalizeContactType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return CONTACT_TYPES.includes(normalized) ? normalized : 'customer';
}

function normalizeContactStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return CONTACT_STATUSES.includes(normalized) ? normalized : 'active';
}

function normalizeTags(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const tags = [];

  for (const tag of value) {
    const normalized = String(tag || '').trim().toLowerCase().slice(0, 60);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    tags.push(normalized);
  }

  return tags;
}

function mapContact(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    organization_id: row.organization_id,
    type: row.type,
    name: row.name,
    business_name: row.business_name,
    email: row.email,
    phone: row.phone,
    rfc: row.rfc,
    notes: row.notes,
    tags: Array.isArray(row.tags) ? row.tags : [],
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeContactPayload(payload) {
  return {
    type: normalizeContactType(payload.type),
    name: String(payload.name || '').trim().slice(0, 255),
    business_name: trimOrNull(payload.business_name, 255),
    email: trimOrNull(payload.email, 255),
    phone: trimOrNull(payload.phone, 60),
    rfc: trimOrNull(payload.rfc, 20),
    notes: trimOrNull(payload.notes, 2000),
    tags: normalizeTags(payload.tags),
    status: normalizeContactStatus(payload.status),
  };
}

async function createContact(payload) {
  const normalized = normalizeContactPayload(payload);

  const query = {
    text: `
      INSERT INTO finance.contacts (
        organization_id,
        type,
        name,
        business_name,
        email,
        phone,
        rfc,
        notes,
        tags,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[], $10)
      RETURNING
        id,
        organization_id,
        type,
        name,
        business_name,
        email,
        phone,
        rfc,
        notes,
        tags,
        status,
        created_at,
        updated_at
    `,
    values: [
      payload.organization_id,
      normalized.type,
      normalized.name,
      normalized.business_name,
      normalized.email,
      normalized.phone,
      normalized.rfc,
      normalized.notes,
      normalized.tags,
      normalized.status,
    ],
  };

  const { rows } = await pool.query(query);
  return mapContact(rows[0]);
}

async function listContacts({
  organization_id,
  type,
  status,
  q,
  sort_by,
  sort_order,
  limit,
  offset,
}) {
  const values = [organization_id];
  const conditions = ['organization_id = $1'];
  const allowedSortColumns = {
    name: 'lower(name)',
    created_at: 'created_at',
    type: 'type',
  };
  const sortBy = allowedSortColumns[sort_by] || 'lower(name)';
  const sortOrder =
    String(sort_order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const secondarySort = sortBy === 'created_at' ? 'lower(name) ASC' : 'created_at DESC';

  if (type) {
    values.push(normalizeContactType(type));
    conditions.push(`type = $${values.length}`);
  }

  if (status) {
    values.push(normalizeContactStatus(status));
    conditions.push(`status = $${values.length}`);
  }

  if (q) {
    const queryText = String(q).trim();
    if (queryText) {
      values.push(`%${queryText}%`);
      conditions.push(`(
        COALESCE(name, '') ILIKE $${values.length}
        OR COALESCE(business_name, '') ILIKE $${values.length}
        OR COALESCE(email, '') ILIKE $${values.length}
        OR COALESCE(phone, '') ILIKE $${values.length}
        OR COALESCE(rfc, '') ILIKE $${values.length}
        OR COALESCE(notes, '') ILIKE $${values.length}
        OR COALESCE(tags::text, '') ILIKE $${values.length}
      )`);
    }
  }

  let paginationClause = '';
  if (Number.isFinite(limit)) {
    values.push(Number(limit));
    paginationClause += ` LIMIT $${values.length}`;
  }

  if (Number.isFinite(offset)) {
    values.push(Number(offset));
    paginationClause += ` OFFSET $${values.length}`;
  }

  const query = {
    text: `
      SELECT
        id,
        organization_id,
        type,
        name,
        business_name,
        email,
        phone,
        rfc,
        notes,
        tags,
        status,
        created_at,
        updated_at
      FROM finance.contacts
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${sortBy} ${sortOrder}, ${secondarySort}
      ${paginationClause}
    `,
    values,
  };

  const { rows } = await pool.query(query);
  return rows.map(mapContact);
}

async function getContactById({ organization_id, contact_id }) {
  const query = {
    text: `
      SELECT
        id,
        organization_id,
        type,
        name,
        business_name,
        email,
        phone,
        rfc,
        notes,
        tags,
        status,
        created_at,
        updated_at
      FROM finance.contacts
      WHERE organization_id = $1
        AND id = $2
      LIMIT 1
    `,
    values: [organization_id, contact_id],
  };

  const { rows } = await pool.query(query);
  if (!rows[0]) {
    throw notFound(`Contact not found: ${contact_id}`);
  }

  return mapContact(rows[0]);
}

async function updateContact({ organization_id, contact_id, patch }) {
  const values = [organization_id, contact_id];
  const assignments = [];

  const normalized = {
    type: patch.type === undefined ? undefined : normalizeContactType(patch.type),
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
    rfc: patch.rfc === undefined ? undefined : trimOrNull(patch.rfc, 20),
    notes: patch.notes === undefined ? undefined : trimOrNull(patch.notes, 2000),
    tags: patch.tags === undefined ? undefined : normalizeTags(patch.tags),
    status:
      patch.status === undefined ? undefined : normalizeContactStatus(patch.status),
  };

  for (const [key, value] of Object.entries(normalized)) {
    if (value === undefined) {
      continue;
    }

    values.push(value);
    if (key === 'tags') {
      assignments.push(`${key} = $${values.length}::text[]`);
      continue;
    }
    assignments.push(`${key} = $${values.length}`);
  }

  if (!assignments.length) {
    return getContactById({ organization_id, contact_id });
  }

  values.push(new Date());
  assignments.push(`updated_at = $${values.length}`);

  const query = {
    text: `
      UPDATE finance.contacts
      SET ${assignments.join(', ')}
      WHERE organization_id = $1
        AND id = $2
      RETURNING
        id,
        organization_id,
        type,
        name,
        business_name,
        email,
        phone,
        rfc,
        notes,
        tags,
        status,
        created_at,
        updated_at
    `,
    values,
  };

  const { rows } = await pool.query(query);
  if (!rows[0]) {
    throw notFound(`Contact not found: ${contact_id}`);
  }

  return mapContact(rows[0]);
}

async function softDeleteContact({ organization_id, contact_id }) {
  return updateContact({
    organization_id,
    contact_id,
    patch: {
      status: 'inactive',
    },
  });
}

async function assertContactExists({ organization_id, contact_id, activeOnly = true }) {
  if (!contact_id) {
    return null;
  }

  const values = [organization_id, contact_id];
  let statusFilter = '';
  if (activeOnly) {
    values.push('active');
    statusFilter = `AND status = $${values.length}`;
  }

  const query = {
    text: `
      SELECT id
      FROM finance.contacts
      WHERE organization_id = $1
        AND id = $2
        ${statusFilter}
      LIMIT 1
    `,
    values,
  };

  const { rows } = await pool.query(query);
  if (!rows[0]) {
    throw notFound(`Contact not found${activeOnly ? ' or inactive' : ''}: ${contact_id}`);
  }

  return rows[0];
}

module.exports = {
  CONTACT_TYPES,
  CONTACT_STATUSES,
  createContact,
  listContacts,
  getContactById,
  updateContact,
  softDeleteContact,
  assertContactExists,
};
