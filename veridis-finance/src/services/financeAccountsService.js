const pool = require('../db/pool');

const ACCOUNT_TYPES = Object.freeze([
  'bank',
  'cash',
  'credit_card',
  'wallet',
  'accounts_receivable',
  'accounts_payable',
  'internal',
]);

const ACCOUNT_STATUSES = Object.freeze(['active', 'inactive', 'archived']);

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

function trimOrNull(value, maxLength) {
  const trimmed = String(value || '').trim().slice(0, maxLength);
  return trimmed.length ? trimmed : null;
}

function toNullableNumber(value, options = {}) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  if (options.min !== undefined && parsed < options.min) {
    return null;
  }

  if (options.max !== undefined && parsed > options.max) {
    return null;
  }

  return Number(parsed.toFixed(2));
}

function toNullableInteger(value, options = {}) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed)) {
    return null;
  }

  if (options.min !== undefined && parsed < options.min) {
    return null;
  }

  if (options.max !== undefined && parsed > options.max) {
    return null;
  }

  return parsed;
}

function normalizeAccountType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ACCOUNT_TYPES.includes(normalized) ? normalized : 'bank';
}

function normalizeAccountStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ACCOUNT_STATUSES.includes(normalized) ? normalized : 'active';
}

function normalizeCurrency(value) {
  const normalized = String(value || 'MXN').trim().toUpperCase().slice(0, 10);
  return normalized || 'MXN';
}

function mapAccount(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    organization_id: row.organization_id,
    name: row.name,
    type: row.type,
    bank_name: row.bank_name,
    account_number_last4: row.account_number_last4,
    credit_limit:
      row.credit_limit === null || row.credit_limit === undefined
        ? null
        : Number(row.credit_limit),
    cut_day: row.cut_day,
    due_day: row.due_day,
    balance:
      row.balance === null || row.balance === undefined ? 0 : Number(row.balance),
    currency: row.currency,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeAccountPayload(payload) {
  return {
    name: String(payload.name || '').trim().slice(0, 255),
    type: normalizeAccountType(payload.type),
    bank_name: trimOrNull(payload.bank_name, 255),
    account_number_last4: trimOrNull(payload.account_number_last4, 4),
    credit_limit: toNullableNumber(payload.credit_limit, { min: 0 }),
    cut_day: toNullableInteger(payload.cut_day, { min: 1, max: 31 }),
    due_day: toNullableInteger(payload.due_day, { min: 1, max: 31 }),
    balance: toNullableNumber(payload.balance, { min: -999999999999 }) || 0,
    currency: normalizeCurrency(payload.currency),
    status: normalizeAccountStatus(payload.status),
  };
}

async function createAccount(payload) {
  const normalized = normalizeAccountPayload(payload);

  const query = {
    text: `
      INSERT INTO finance.accounts (
        organization_id,
        name,
        type,
        bank_name,
        account_number_last4,
        credit_limit,
        cut_day,
        due_day,
        balance,
        currency,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING
        id,
        organization_id,
        name,
        type,
        bank_name,
        account_number_last4,
        credit_limit,
        cut_day,
        due_day,
        balance,
        currency,
        status,
        created_at,
        updated_at
    `,
    values: [
      payload.organization_id,
      normalized.name,
      normalized.type,
      normalized.bank_name,
      normalized.account_number_last4,
      normalized.credit_limit,
      normalized.cut_day,
      normalized.due_day,
      normalized.balance,
      normalized.currency,
      normalized.status,
    ],
  };

  const { rows } = await pool.query(query);
  return mapAccount(rows[0]);
}

async function listAccounts({ organization_id, status, type }) {
  const values = [organization_id];
  const conditions = ['organization_id = $1'];

  if (status) {
    values.push(normalizeAccountStatus(status));
    conditions.push(`status = $${values.length}`);
  }

  if (type) {
    values.push(normalizeAccountType(type));
    conditions.push(`type = $${values.length}`);
  }

  const query = {
    text: `
      SELECT
        id,
        organization_id,
        name,
        type,
        bank_name,
        account_number_last4,
        credit_limit,
        cut_day,
        due_day,
        balance,
        currency,
        status,
        created_at,
        updated_at
      FROM finance.accounts
      WHERE ${conditions.join(' AND ')}
      ORDER BY
        CASE WHEN lower(name) = 'general' THEN 0 ELSE 1 END,
        lower(name) ASC,
        created_at ASC
    `,
    values,
  };

  const { rows } = await pool.query(query);
  return rows.map(mapAccount);
}

async function getAccountById({ organization_id, account_id }) {
  const query = {
    text: `
      SELECT
        id,
        organization_id,
        name,
        type,
        bank_name,
        account_number_last4,
        credit_limit,
        cut_day,
        due_day,
        balance,
        currency,
        status,
        created_at,
        updated_at
      FROM finance.accounts
      WHERE organization_id = $1
        AND id = $2
      LIMIT 1
    `,
    values: [organization_id, account_id],
  };

  const { rows } = await pool.query(query);
  if (!rows[0]) {
    throw notFound(`Account not found: ${account_id}`);
  }

  return mapAccount(rows[0]);
}

async function updateAccount({ organization_id, account_id, patch }) {
  const values = [organization_id, account_id];
  const assignments = [];

  const normalized = {
    name:
      patch.name === undefined
        ? undefined
        : String(patch.name || '').trim().slice(0, 255),
    type: patch.type === undefined ? undefined : normalizeAccountType(patch.type),
    bank_name:
      patch.bank_name === undefined ? undefined : trimOrNull(patch.bank_name, 255),
    account_number_last4:
      patch.account_number_last4 === undefined
        ? undefined
        : trimOrNull(patch.account_number_last4, 4),
    credit_limit:
      patch.credit_limit === undefined
        ? undefined
        : toNullableNumber(patch.credit_limit, { min: 0 }),
    cut_day:
      patch.cut_day === undefined
        ? undefined
        : toNullableInteger(patch.cut_day, { min: 1, max: 31 }),
    due_day:
      patch.due_day === undefined
        ? undefined
        : toNullableInteger(patch.due_day, { min: 1, max: 31 }),
    balance:
      patch.balance === undefined
        ? undefined
        : toNullableNumber(patch.balance, { min: -999999999999 }),
    currency:
      patch.currency === undefined ? undefined : normalizeCurrency(patch.currency),
    status:
      patch.status === undefined ? undefined : normalizeAccountStatus(patch.status),
  };

  for (const [key, value] of Object.entries(normalized)) {
    if (value === undefined) {
      continue;
    }

    values.push(value);
    assignments.push(`${key} = $${values.length}`);
  }

  if (!assignments.length) {
    return getAccountById({ organization_id, account_id });
  }

  values.push(new Date());
  assignments.push(`updated_at = $${values.length}`);

  const query = {
    text: `
      UPDATE finance.accounts
      SET ${assignments.join(', ')}
      WHERE organization_id = $1
        AND id = $2
      RETURNING
        id,
        organization_id,
        name,
        type,
        bank_name,
        account_number_last4,
        credit_limit,
        cut_day,
        due_day,
        balance,
        currency,
        status,
        created_at,
        updated_at
    `,
    values,
  };

  const { rows } = await pool.query(query);
  if (!rows[0]) {
    throw notFound(`Account not found: ${account_id}`);
  }

  return mapAccount(rows[0]);
}

async function softDeleteAccount({ organization_id, account_id }) {
  return updateAccount({
    organization_id,
    account_id,
    patch: {
      status: 'inactive',
    },
  });
}

async function assertAccountExists({ organization_id, account_id, activeOnly = true }) {
  if (!account_id) {
    return null;
  }

  const values = [organization_id, account_id];
  let statusFilter = '';
  if (activeOnly) {
    values.push('active');
    statusFilter = `AND status = $${values.length}`;
  }

  const query = {
    text: `
      SELECT id
      FROM finance.accounts
      WHERE organization_id = $1
        AND id = $2
        ${statusFilter}
      LIMIT 1
    `,
    values,
  };

  const { rows } = await pool.query(query);
  if (!rows[0]) {
    throw notFound(`Account not found${activeOnly ? ' or inactive' : ''}: ${account_id}`);
  }

  return rows[0];
}

async function getDefaultAccount({ organization_id, client }) {
  const db = client || pool;
  const selectDefaultAccount = async () => {
    const query = {
      text: `
        SELECT
          id,
          organization_id,
          name,
          type,
          bank_name,
          account_number_last4,
          credit_limit,
          cut_day,
          due_day,
          balance,
          currency,
          status,
          created_at,
          updated_at
        FROM finance.accounts
        WHERE organization_id = $1
          AND status = 'active'
        ORDER BY
          CASE WHEN lower(name) = 'general' THEN 0 ELSE 1 END,
          created_at ASC
        LIMIT 1
      `,
      values: [organization_id],
    };

    const { rows } = await db.query(query);
    return rows[0] ? mapAccount(rows[0]) : null;
  };

  const existing = await selectDefaultAccount();
  if (existing) {
    return existing;
  }

  try {
    await createAccount({
      organization_id,
      name: 'General',
      type: 'bank',
      currency: 'MXN',
      status: 'active',
    });
  } catch (error) {
    if (error.code !== '23505') {
      throw error;
    }
  }

  const afterInsert = await selectDefaultAccount();
  if (afterInsert) {
    return afterInsert;
  }

  throw notFound(`No active account available for organization: ${organization_id}`);
}

async function getOrCreateCashAccount({ organization_id, client }) {
  const db = client || pool;

  const selectCashAccount = async () => {
    const query = {
      text: `
        SELECT
          id,
          organization_id,
          name,
          type,
          bank_name,
          account_number_last4,
          credit_limit,
          cut_day,
          due_day,
          balance,
          currency,
          status,
          created_at,
          updated_at
        FROM finance.accounts
        WHERE organization_id = $1
          AND status = 'active'
          AND (type = 'cash' OR lower(name) = 'cash')
        ORDER BY
          CASE WHEN lower(name) = 'cash' THEN 0 ELSE 1 END,
          created_at ASC
        LIMIT 1
      `,
      values: [organization_id],
    };

    const { rows } = await db.query(query);
    return rows[0] ? mapAccount(rows[0]) : null;
  };

  const existing = await selectCashAccount();
  if (existing) {
    return existing;
  }

  const orgCurrencyResult = await db.query(
    `
      SELECT COALESCE(NULLIF(trim(currency), ''), 'MXN') AS currency
      FROM finance.organizations
      WHERE organization_id = $1
      LIMIT 1
    `,
    [organization_id]
  );
  const currency = orgCurrencyResult.rows[0]?.currency || 'MXN';

  try {
    await db.query(
      `
        INSERT INTO finance.accounts (
          organization_id,
          name,
          type,
          balance,
          currency,
          status
        )
        VALUES ($1, $2, $3::finance.account_type, 0, $4, $5::finance.account_status)
      `,
      [organization_id, 'Cash', 'cash', currency, 'active']
    );
  } catch (error) {
    if (error.code !== '23505') {
      throw error;
    }
  }

  const afterInsert = await selectCashAccount();
  if (afterInsert) {
    return afterInsert;
  }

  throw notFound(`No cash account available for organization: ${organization_id}`);
}

module.exports = {
  ACCOUNT_TYPES,
  ACCOUNT_STATUSES,
  createAccount,
  listAccounts,
  getAccountById,
  updateAccount,
  softDeleteAccount,
  assertAccountExists,
  getDefaultAccount,
  getOrCreateCashAccount,
};
