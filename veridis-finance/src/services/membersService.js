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

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Number(parsed.toFixed(2));
}

function mapMemberRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    organization_id: row.organization_id,
    full_name: row.full_name,
    alias: row.alias,
    bank_account_last4: row.bank_account_last4,
    rfc: row.rfc,
    salary_estimate:
      row.salary_estimate === null || row.salary_estimate === undefined
        ? null
        : Number(row.salary_estimate),
    active: row.active,
    created_at: row.created_at,
  };
}

function normalizeMemberInput(payload) {
  return {
    full_name: String(payload.full_name || '').trim().slice(0, 255),
    alias: trimOrNull(payload.alias, 120),
    bank_account_last4: trimOrNull(payload.bank_account_last4, 4),
    rfc: trimOrNull(payload.rfc, 13),
    salary_estimate: toNullableNumber(payload.salary_estimate),
    active: payload.active === undefined ? true : Boolean(payload.active),
  };
}

async function createMember(payload) {
  const normalized = normalizeMemberInput(payload);

  const query = {
    text: `
      INSERT INTO finance.members (
        organization_id,
        full_name,
        alias,
        bank_account_last4,
        rfc,
        salary_estimate,
        active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING
        id,
        organization_id,
        full_name,
        alias,
        bank_account_last4,
        rfc,
        salary_estimate,
        active,
        created_at
    `,
    values: [
      payload.organization_id,
      normalized.full_name,
      normalized.alias,
      normalized.bank_account_last4,
      normalized.rfc,
      normalized.salary_estimate,
      normalized.active,
    ],
  };

  const { rows } = await pool.query(query);
  return mapMemberRow(rows[0]);
}

async function listMembers({ organization_id, active }) {
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
        full_name,
        alias,
        bank_account_last4,
        rfc,
        salary_estimate,
        active,
        created_at
      FROM finance.members
      WHERE ${conditions.join(' AND ')}
      ORDER BY full_name ASC, created_at DESC
    `,
    values,
  };

  const { rows } = await pool.query(query);
  return rows.map(mapMemberRow);
}

async function updateMember({ organization_id, member_id, patch }) {
  const assignments = [];
  const values = [organization_id, member_id];

  const normalized = {
    full_name:
      patch.full_name === undefined
        ? undefined
        : String(patch.full_name || '').trim().slice(0, 255),
    alias:
      patch.alias === undefined ? undefined : trimOrNull(patch.alias, 120),
    bank_account_last4:
      patch.bank_account_last4 === undefined
        ? undefined
        : trimOrNull(patch.bank_account_last4, 4),
    rfc: patch.rfc === undefined ? undefined : trimOrNull(patch.rfc, 13),
    salary_estimate:
      patch.salary_estimate === undefined
        ? undefined
        : toNullableNumber(patch.salary_estimate),
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
    return getMemberById({ organization_id, member_id });
  }

  const query = {
    text: `
      UPDATE finance.members
      SET ${assignments.join(', ')}
      WHERE organization_id = $1
        AND id = $2
      RETURNING
        id,
        organization_id,
        full_name,
        alias,
        bank_account_last4,
        rfc,
        salary_estimate,
        active,
        created_at
    `,
    values,
  };

  const { rows } = await pool.query(query);
  if (!rows[0]) {
    throw notFound(`Member not found: ${member_id}`);
  }

  return mapMemberRow(rows[0]);
}

async function deleteMember({ organization_id, member_id }) {
  const query = {
    text: `
      DELETE FROM finance.members
      WHERE organization_id = $1
        AND id = $2
      RETURNING id
    `,
    values: [organization_id, member_id],
  };

  const { rows } = await pool.query(query);
  if (!rows[0]) {
    throw notFound(`Member not found: ${member_id}`);
  }

  return { id: rows[0].id };
}

async function getMemberById({ organization_id, member_id }) {
  const query = {
    text: `
      SELECT
        id,
        organization_id,
        full_name,
        alias,
        bank_account_last4,
        rfc,
        salary_estimate,
        active,
        created_at
      FROM finance.members
      WHERE organization_id = $1
        AND id = $2
      LIMIT 1
    `,
    values: [organization_id, member_id],
  };

  const { rows } = await pool.query(query);
  if (!rows[0]) {
    throw notFound(`Member not found: ${member_id}`);
  }

  return mapMemberRow(rows[0]);
}

async function assertMemberExists({ organization_id, member_id }) {
  if (!member_id) {
    return null;
  }

  const query = {
    text: `
      SELECT id
      FROM finance.members
      WHERE organization_id = $1
        AND id = $2
        AND active = true
      LIMIT 1
    `,
    values: [organization_id, member_id],
  };

  const { rows } = await pool.query(query);
  if (!rows[0]) {
    throw notFound(`Member not found or inactive: ${member_id}`);
  }

  return rows[0];
}

module.exports = {
  createMember,
  listMembers,
  updateMember,
  deleteMember,
  getMemberById,
  assertMemberExists,
};
