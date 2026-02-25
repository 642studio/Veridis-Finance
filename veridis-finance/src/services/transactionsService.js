const pool = require('../db/pool');
const { assertMemberExists } = require('./membersService');
const { assertClientExists } = require('./clientsService');
const { assertVendorExists } = require('./vendorsService');

const ALLOWED_MATCH_METHODS = new Set(['rule', 'fuzzy', 'manual']);

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

function conflict(message) {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function coerceUuidOrNull(value) {
  if (!value) {
    return null;
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  return text;
}

function normalizeMatchMethod(value, options = {}) {
  if (value === undefined && options.allowUndefined !== false) {
    return undefined;
  }

  if (value === null || String(value).trim() === '') {
    return null;
  }

  const method = String(value).trim().toLowerCase();
  if (!ALLOWED_MATCH_METHODS.has(method)) {
    throw badRequest('match_method must be one of: rule, fuzzy, manual');
  }

  return method;
}

function normalizeMatchConfidence(value, options = {}) {
  if (value === undefined && options.allowUndefined !== false) {
    return undefined;
  }

  if (value === null || String(value).trim() === '') {
    return null;
  }

  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw badRequest('match_confidence must be a number between 0 and 1');
  }

  return Number(parsed.toFixed(4));
}

function ensureSingleLinkedEntity({ member_id, client_id, vendor_id }) {
  const nonNullCount = [member_id, client_id, vendor_id].filter(Boolean).length;
  if (nonNullCount > 1) {
    throw badRequest(
      'Only one linked entity is allowed per transaction (member, client, or vendor)'
    );
  }
}

async function assertLinkedEntities(payload) {
  ensureSingleLinkedEntity(payload);

  const checks = [];
  if (payload.member_id) {
    checks.push(
      assertMemberExists({
        organization_id: payload.organization_id,
        member_id: payload.member_id,
      })
    );
  }

  if (payload.client_id) {
    checks.push(
      assertClientExists({
        organization_id: payload.organization_id,
        client_id: payload.client_id,
      })
    );
  }

  if (payload.vendor_id) {
    checks.push(
      assertVendorExists({
        organization_id: payload.organization_id,
        vendor_id: payload.vendor_id,
      })
    );
  }

  await Promise.all(checks);
}

function mapTransactionRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    organization_id: row.organization_id,
    type: row.type,
    amount: Number(row.amount),
    category: row.category,
    description: row.description,
    entity: row.entity,
    member_id: row.member_id,
    client_id: row.client_id,
    vendor_id: row.vendor_id,
    editable: row.editable,
    notes: row.notes,
    match_confidence:
      row.match_confidence === null || row.match_confidence === undefined
        ? null
        : Number(row.match_confidence),
    match_method: row.match_method || null,
    deleted_at: row.deleted_at || null,
    transaction_date: row.transaction_date,
    created_at: row.created_at,
    member_name: row.member_name || null,
    client_name: row.client_name || null,
    vendor_name: row.vendor_name || null,
  };
}

async function createTransaction(payload) {
  const memberId = coerceUuidOrNull(payload.member_id);
  const clientId = coerceUuidOrNull(payload.client_id);
  const vendorId = coerceUuidOrNull(payload.vendor_id);
  const hasLinkedEntity = Boolean(memberId || clientId || vendorId);
  const providedMatchMethod = normalizeMatchMethod(payload.match_method);
  const effectiveMatchMethod = providedMatchMethod || (hasLinkedEntity ? 'manual' : null);
  const providedMatchConfidence = normalizeMatchConfidence(payload.match_confidence);
  const effectiveMatchConfidence =
    providedMatchConfidence ??
    (effectiveMatchMethod === 'manual' ? 1 : null);

  const normalized = {
    ...payload,
    member_id: memberId,
    client_id: clientId,
    vendor_id: vendorId,
    editable: payload.editable === undefined ? true : Boolean(payload.editable),
    notes:
      payload.notes === undefined || payload.notes === null
        ? null
        : String(payload.notes).trim().slice(0, 2000),
    match_method: effectiveMatchMethod,
    match_confidence: effectiveMatchConfidence,
  };

  await assertLinkedEntities(normalized);

  const query = {
    text: `
      INSERT INTO finance.transactions (
        organization_id,
        type,
        amount,
        category,
        description,
        entity,
        member_id,
        client_id,
        vendor_id,
        editable,
        notes,
        match_confidence,
        match_method,
        transaction_date
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING
        id,
        organization_id,
        type,
        amount,
        category,
        description,
        entity,
        member_id,
        client_id,
        vendor_id,
        editable,
        notes,
        match_confidence,
        match_method,
        deleted_at,
        transaction_date,
        created_at
    `,
    values: [
      normalized.organization_id,
      normalized.type,
      normalized.amount,
      normalized.category,
      normalized.description ?? null,
      normalized.entity ?? null,
      normalized.member_id,
      normalized.client_id,
      normalized.vendor_id,
      normalized.editable,
      normalized.notes,
      normalized.match_confidence,
      normalized.match_method,
      normalized.transaction_date,
    ],
  };

  const { rows } = await pool.query(query);

  const created = rows[0];
  return mapTransactionRow({
    ...created,
    member_name: null,
    client_name: null,
    vendor_name: null,
  });
}

async function getTransactionById({ organization_id, transaction_id }) {
  const query = {
    text: `
      SELECT
        t.id,
        t.organization_id,
        t.type,
        t.amount,
        t.category,
        t.description,
        t.entity,
        t.member_id,
        t.client_id,
        t.vendor_id,
        t.editable,
        t.notes,
        t.match_confidence,
        t.match_method,
        t.deleted_at,
        t.transaction_date,
        t.created_at,
        m.full_name AS member_name,
        COALESCE(c.business_name, c.name) AS client_name,
        v.name AS vendor_name
      FROM finance.transactions t
      LEFT JOIN finance.members m
        ON m.id = t.member_id
       AND m.organization_id = t.organization_id
      LEFT JOIN finance.clients c
        ON c.id = t.client_id
       AND c.organization_id = t.organization_id
      LEFT JOIN finance.vendors v
        ON v.id = t.vendor_id
       AND v.organization_id = t.organization_id
      WHERE t.organization_id = $1
        AND t.id = $2
        AND t.deleted_at IS NULL
      LIMIT 1
    `,
    values: [organization_id, transaction_id],
  };

  const { rows } = await pool.query(query);
  if (!rows[0]) {
    throw notFound(`Transaction not found: ${transaction_id}`);
  }

  return mapTransactionRow(rows[0]);
}

async function listTransactions(filters) {
  const values = [filters.organization_id];
  const conditions = ['t.organization_id = $1'];
  let cursor = 2;

  if (filters.type) {
    conditions.push(`t.type = $${cursor}`);
    values.push(filters.type);
    cursor += 1;
  }

  if (filters.member_id) {
    conditions.push(`t.member_id = $${cursor}`);
    values.push(filters.member_id);
    cursor += 1;
  }

  if (filters.client_id) {
    conditions.push(`t.client_id = $${cursor}`);
    values.push(filters.client_id);
    cursor += 1;
  }

  if (filters.vendor_id) {
    conditions.push(`t.vendor_id = $${cursor}`);
    values.push(filters.vendor_id);
    cursor += 1;
  }

  if (filters.from) {
    conditions.push(`t.transaction_date >= $${cursor}`);
    values.push(filters.from);
    cursor += 1;
  }

  if (filters.to) {
    conditions.push(`t.transaction_date <= $${cursor}`);
    values.push(filters.to);
    cursor += 1;
  }

  const limitIndex = cursor;
  values.push(filters.limit);
  cursor += 1;

  const offsetIndex = cursor;
  values.push(filters.offset);

  const query = {
    text: `
      SELECT
        t.id,
        t.organization_id,
        t.type,
        t.amount,
        t.category,
        t.description,
        t.entity,
        t.member_id,
        t.client_id,
        t.vendor_id,
        t.editable,
        t.notes,
        t.match_confidence,
        t.match_method,
        t.deleted_at,
        t.transaction_date,
        t.created_at,
        m.full_name AS member_name,
        COALESCE(c.business_name, c.name) AS client_name,
        v.name AS vendor_name
      FROM finance.transactions t
      LEFT JOIN finance.members m
        ON m.id = t.member_id
       AND m.organization_id = t.organization_id
      LEFT JOIN finance.clients c
        ON c.id = t.client_id
       AND c.organization_id = t.organization_id
      LEFT JOIN finance.vendors v
        ON v.id = t.vendor_id
       AND v.organization_id = t.organization_id
      WHERE ${conditions.join(' AND ')}
        AND t.deleted_at IS NULL
      ORDER BY t.transaction_date DESC, t.created_at DESC
      LIMIT $${limitIndex}
      OFFSET $${offsetIndex}
    `,
    values,
  };

  const { rows } = await pool.query(query);
  return rows.map(mapTransactionRow);
}

async function updateTransaction({ organization_id, transaction_id, patch }) {
  const existing = await getTransactionById({ organization_id, transaction_id });

  const normalized = {
    organization_id,
    member_id:
      patch.member_id === undefined
        ? coerceUuidOrNull(existing.member_id)
        : coerceUuidOrNull(patch.member_id),
    client_id:
      patch.client_id === undefined
        ? coerceUuidOrNull(existing.client_id)
        : coerceUuidOrNull(patch.client_id),
    vendor_id:
      patch.vendor_id === undefined
        ? coerceUuidOrNull(existing.vendor_id)
        : coerceUuidOrNull(patch.vendor_id),
  };

  await assertLinkedEntities(normalized);

  const hasEntityPatch =
    patch.member_id !== undefined ||
    patch.client_id !== undefined ||
    patch.vendor_id !== undefined;
  const hasLinkedEntity = Boolean(
    normalized.member_id || normalized.client_id || normalized.vendor_id
  );

  let resolvedMatchMethod = normalizeMatchMethod(patch.match_method);
  let resolvedMatchConfidence = normalizeMatchConfidence(patch.match_confidence);

  if (hasEntityPatch && hasLinkedEntity && patch.match_method === undefined) {
    resolvedMatchMethod = 'manual';
  }

  if (
    hasEntityPatch &&
    hasLinkedEntity &&
    patch.match_confidence === undefined &&
    (resolvedMatchMethod === 'manual' || patch.match_method === undefined)
  ) {
    resolvedMatchConfidence = 1;
  }

  if (hasEntityPatch && !hasLinkedEntity && patch.match_method === undefined) {
    resolvedMatchMethod = null;
  }

  if (hasEntityPatch && !hasLinkedEntity && patch.match_confidence === undefined) {
    resolvedMatchConfidence = null;
  }

  if (
    resolvedMatchMethod === 'manual' &&
    patch.match_confidence === undefined &&
    resolvedMatchConfidence === undefined
  ) {
    resolvedMatchConfidence = 1;
  }

  const values = [organization_id, transaction_id];
  const assignments = [];

  const mutable = {
    type: patch.type,
    amount: patch.amount,
    category: patch.category,
    description:
      patch.description === undefined
        ? undefined
        : patch.description === null
        ? null
        : String(patch.description).trim().slice(0, 500),
    entity:
      patch.entity === undefined
        ? undefined
        : patch.entity === null
        ? null
        : String(patch.entity).trim().slice(0, 255),
    member_id:
      patch.member_id === undefined ? undefined : coerceUuidOrNull(patch.member_id),
    client_id:
      patch.client_id === undefined ? undefined : coerceUuidOrNull(patch.client_id),
    vendor_id:
      patch.vendor_id === undefined ? undefined : coerceUuidOrNull(patch.vendor_id),
    editable: patch.editable === undefined ? undefined : Boolean(patch.editable),
    notes:
      patch.notes === undefined
        ? undefined
        : patch.notes === null
        ? null
        : String(patch.notes).trim().slice(0, 2000),
    match_confidence: resolvedMatchConfidence,
    match_method: resolvedMatchMethod,
    transaction_date: patch.transaction_date,
  };

  for (const [key, value] of Object.entries(mutable)) {
    if (value === undefined) {
      continue;
    }

    values.push(value);
    assignments.push(`${key} = $${values.length}`);
  }

  if (!assignments.length) {
    return existing;
  }

  const query = {
    text: `
      UPDATE finance.transactions
      SET ${assignments.join(', ')}
      WHERE organization_id = $1
        AND id = $2
        AND deleted_at IS NULL
      RETURNING id
    `,
    values,
  };

  const { rows } = await pool.query(query);
  if (!rows[0]) {
    throw notFound(`Transaction not found: ${transaction_id}`);
  }

  return getTransactionById({ organization_id, transaction_id });
}

async function deleteTransaction({ organization_id, transaction_id }) {
  const transaction = await getTransactionById({ organization_id, transaction_id });

  if (!transaction.editable) {
    throw conflict('Transaction is locked and cannot be deleted');
  }

  const query = {
    text: `
      UPDATE finance.transactions
      SET deleted_at = now()
      WHERE organization_id = $1
        AND id = $2
        AND deleted_at IS NULL
      RETURNING id
    `,
    values: [organization_id, transaction_id],
  };

  const { rows } = await pool.query(query);
  if (!rows[0]) {
    throw notFound(`Transaction not found: ${transaction_id}`);
  }

  return {
    id: rows[0].id,
    deleted: true,
  };
}

async function countTransactionsInRange({ organization_id, from, to }) {
  const query = {
    text: `
      SELECT COUNT(*)::int AS total
      FROM finance.transactions
      WHERE organization_id = $1
        AND transaction_date >= $2
        AND transaction_date < $3
        AND deleted_at IS NULL
    `,
    values: [organization_id, from, to],
  };

  const { rows } = await pool.query(query);
  return rows[0]?.total || 0;
}

module.exports = {
  createTransaction,
  listTransactions,
  updateTransaction,
  deleteTransaction,
  getTransactionById,
  countTransactionsInRange,
};
