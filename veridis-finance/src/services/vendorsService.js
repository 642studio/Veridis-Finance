const pool = require('../db/pool');

const VENDOR_TYPES = Object.freeze([
  'ads',
  'software',
  'rent',
  'utilities',
  'payroll',
  'other',
]);

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

function trimOrNull(value, maxLength) {
  const trimmed = String(value || '').trim().slice(0, maxLength);
  return trimmed.length ? trimmed : null;
}

function normalizeVendorType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return VENDOR_TYPES.includes(normalized) ? normalized : 'other';
}

function mapVendor(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    organization_id: row.organization_id,
    name: row.name,
    type: row.type,
    default_category_id: row.default_category_id,
    active: row.active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeVendorInput(payload) {
  return {
    name: String(payload.name || '').trim().slice(0, 255),
    type: normalizeVendorType(payload.type),
    default_category_id: trimOrNull(payload.default_category_id, 120),
    active: payload.active === undefined ? true : Boolean(payload.active),
  };
}

async function createVendor(payload) {
  const normalized = normalizeVendorInput(payload);

  const query = {
    text: `
      INSERT INTO finance.vendors (
        organization_id,
        name,
        type,
        default_category_id,
        active
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING
        id,
        organization_id,
        name,
        type,
        default_category_id,
        active,
        created_at,
        updated_at
    `,
    values: [
      payload.organization_id,
      normalized.name,
      normalized.type,
      normalized.default_category_id,
      normalized.active,
    ],
  };

  const { rows } = await pool.query(query);
  return mapVendor(rows[0]);
}

async function listVendors({ organization_id, active }) {
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
        type,
        default_category_id,
        active,
        created_at,
        updated_at
      FROM finance.vendors
      WHERE ${conditions.join(' AND ')}
      ORDER BY lower(name) ASC, created_at DESC
    `,
    values,
  };

  const { rows } = await pool.query(query);
  return rows.map(mapVendor);
}

async function updateVendor({ organization_id, vendor_id, patch }) {
  const values = [organization_id, vendor_id];
  const assignments = [];

  const normalized = {
    name:
      patch.name === undefined
        ? undefined
        : String(patch.name || '').trim().slice(0, 255),
    type: patch.type === undefined ? undefined : normalizeVendorType(patch.type),
    default_category_id:
      patch.default_category_id === undefined
        ? undefined
        : trimOrNull(patch.default_category_id, 120),
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
    return getVendorById({ organization_id, vendor_id });
  }

  values.push(new Date());
  assignments.push(`updated_at = $${values.length}`);

  const query = {
    text: `
      UPDATE finance.vendors
      SET ${assignments.join(', ')}
      WHERE organization_id = $1
        AND id = $2
      RETURNING
        id,
        organization_id,
        name,
        type,
        default_category_id,
        active,
        created_at,
        updated_at
    `,
    values,
  };

  const { rows } = await pool.query(query);
  if (!rows[0]) {
    throw notFound(`Vendor not found: ${vendor_id}`);
  }

  return mapVendor(rows[0]);
}

async function softDeleteVendor({ organization_id, vendor_id }) {
  return updateVendor({
    organization_id,
    vendor_id,
    patch: {
      active: false,
    },
  });
}

async function getVendorById({ organization_id, vendor_id }) {
  const query = {
    text: `
      SELECT
        id,
        organization_id,
        name,
        type,
        default_category_id,
        active,
        created_at,
        updated_at
      FROM finance.vendors
      WHERE organization_id = $1
        AND id = $2
      LIMIT 1
    `,
    values: [organization_id, vendor_id],
  };

  const { rows } = await pool.query(query);
  if (!rows[0]) {
    throw notFound(`Vendor not found: ${vendor_id}`);
  }

  return mapVendor(rows[0]);
}

async function assertVendorExists({ organization_id, vendor_id }) {
  if (!vendor_id) {
    return null;
  }

  const query = {
    text: `
      SELECT id
      FROM finance.vendors
      WHERE organization_id = $1
        AND id = $2
        AND active = true
      LIMIT 1
    `,
    values: [organization_id, vendor_id],
  };

  const { rows } = await pool.query(query);
  if (!rows[0]) {
    throw notFound(`Vendor not found or inactive: ${vendor_id}`);
  }

  return rows[0];
}

module.exports = {
  VENDOR_TYPES,
  createVendor,
  listVendors,
  updateVendor,
  softDeleteVendor,
  getVendorById,
  assertVendorExists,
};
