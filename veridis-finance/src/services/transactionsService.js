const pool = require('../db/pool');
const { assertMemberExists } = require('./membersService');
const { assertClientExists } = require('./clientsService');
const { assertVendorExists } = require('./vendorsService');
const {
  assertAccountExists,
  getDefaultAccount,
  getOrCreateCashAccount,
} = require('./financeAccountsService');
const { assertContactExists } = require('./contactsService');
const {
  logTransactionAudit,
  listTransactionAudit,
} = require('./transactionAuditService');

const ALLOWED_MATCH_METHODS = new Set(['rule', 'fuzzy', 'manual']);
const ALLOWED_TRANSACTION_STATUSES = new Set([
  'posted',
  'pending',
  'reconciled',
  'void',
]);

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

function normalizeCurrency(value, options = {}) {
  if (value === undefined && options.allowUndefined !== false) {
    return undefined;
  }

  const normalized = String(value || 'MXN').trim().toUpperCase().slice(0, 10);
  if (!normalized) {
    return 'MXN';
  }
  return normalized;
}

function normalizeTransactionStatus(value, options = {}) {
  if (value === undefined && options.allowUndefined !== false) {
    return undefined;
  }

  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return 'posted';
  }

  if (!ALLOWED_TRANSACTION_STATUSES.has(normalized)) {
    throw badRequest(
      'status must be one of: posted, pending, reconciled, void'
    );
  }

  return normalized;
}

function normalizeTags(value, options = {}) {
  if (value === undefined && options.allowUndefined !== false) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const tags = [];

  for (const item of value) {
    const tag = String(item || '').trim().toLowerCase().slice(0, 60);
    if (!tag || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    tags.push(tag);
  }

  return tags;
}

function normalizeSource(value, options = {}) {
  if (value === undefined && options.allowUndefined !== false) {
    return undefined;
  }

  const normalized = String(value || '').trim().toLowerCase().slice(0, 80);
  if (!normalized) {
    return 'manual';
  }

  return normalized;
}

function normalizeEntity(value, options = {}) {
  if (value === undefined) {
    if (options.allowUndefined === false) {
      return null;
    }
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const normalized = String(value).trim().slice(0, 255);
  if (!normalized) {
    return null;
  }

  return normalized;
}

function ensureSingleLinkedEntity({
  member_id,
  client_id,
  vendor_id,
  contact_id,
}) {
  const nonNullCount = [member_id, client_id, vendor_id, contact_id].filter(
    Boolean
  ).length;
  if (nonNullCount > 1) {
    throw badRequest(
      'Only one linked entity is allowed per transaction (member, client, vendor, or contact)'
    );
  }
}

async function assertLinkedEntities(payload) {
  ensureSingleLinkedEntity(payload);

  const checks = [];
  if (payload.account_id) {
    checks.push(
      assertAccountExists({
        organization_id: payload.organization_id,
        account_id: payload.account_id,
      })
    );
  }

  if (payload.contact_id) {
    checks.push(
      assertContactExists({
        organization_id: payload.organization_id,
        contact_id: payload.contact_id,
      })
    );
  }

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

async function resolveLinkedEntityLabel({
  organization_id,
  contact_id,
  member_id,
  client_id,
  vendor_id,
}) {
  if (contact_id) {
    const { rows } = await pool.query(
      `
        SELECT name
        FROM finance.contacts
        WHERE organization_id = $1
          AND id = $2
        LIMIT 1
      `,
      [organization_id, contact_id]
    );
    return rows[0]?.name || null;
  }

  if (member_id) {
    const { rows } = await pool.query(
      `
        SELECT full_name
        FROM finance.members
        WHERE organization_id = $1
          AND id = $2
        LIMIT 1
      `,
      [organization_id, member_id]
    );
    return rows[0]?.full_name || null;
  }

  if (client_id) {
    const { rows } = await pool.query(
      `
        SELECT COALESCE(business_name, name) AS display_name
        FROM finance.clients
        WHERE organization_id = $1
          AND id = $2
        LIMIT 1
      `,
      [organization_id, client_id]
    );
    return rows[0]?.display_name || null;
  }

  if (vendor_id) {
    const { rows } = await pool.query(
      `
        SELECT name
        FROM finance.vendors
        WHERE organization_id = $1
          AND id = $2
        LIMIT 1
      `,
      [organization_id, vendor_id]
    );
    return rows[0]?.name || null;
  }

  return null;
}

function mapTransactionRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    organization_id: row.organization_id,
    account_id: row.account_id || null,
    account_name: row.account_name || null,
    contact_id: row.contact_id || null,
    contact_name: row.contact_name || null,
    contact_type: row.contact_type || null,
    currency: row.currency || 'MXN',
    status: row.status || 'posted',
    tags: Array.isArray(row.tags) ? row.tags : [],
    source: row.source || 'manual',
    original_description: row.original_description || row.description || null,
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

function toAuditSnapshot(transaction) {
  if (!transaction) {
    return null;
  }

  return {
    id: transaction.id,
    type: transaction.type,
    amount: transaction.amount,
    category: transaction.category,
    account_id: transaction.account_id,
    contact_id: transaction.contact_id,
    member_id: transaction.member_id,
    client_id: transaction.client_id,
    vendor_id: transaction.vendor_id,
    entity: transaction.entity,
    status: transaction.status,
    source: transaction.source,
    notes: transaction.notes,
    transaction_date: transaction.transaction_date,
  };
}

function mapTransactionAuditRow(row) {
  return {
    id: row.id,
    organization_id: row.organization_id,
    transaction_id: row.transaction_id,
    action: row.action,
    actor_user_id: row.actor_user_id || null,
    actor_role: row.actor_role || null,
    source: row.source || 'api',
    changes: row.changes || {},
    created_at: row.created_at,
  };
}

async function createTransaction(payload, options = {}) {
  const source = normalizeSource(payload.source, { allowUndefined: false });
  const accountId = coerceUuidOrNull(payload.account_id);
  const contactId = coerceUuidOrNull(payload.contact_id);
  const memberId = coerceUuidOrNull(payload.member_id);
  const clientId = coerceUuidOrNull(payload.client_id);
  const vendorId = coerceUuidOrNull(payload.vendor_id);
  const hasLinkedEntity = Boolean(memberId || clientId || vendorId || contactId);
  const providedMatchMethod = normalizeMatchMethod(payload.match_method);
  const effectiveMatchMethod = providedMatchMethod || (hasLinkedEntity ? 'manual' : null);
  const providedMatchConfidence = normalizeMatchConfidence(payload.match_confidence);
  const effectiveMatchConfidence =
    providedMatchConfidence ??
    (effectiveMatchMethod === 'manual' ? 1 : null);
  const fallbackAccount = (() => {
    if (payload.type === 'expense' && source === 'cash') {
      return getOrCreateCashAccount({
        organization_id: payload.organization_id,
      }).then((account) => account.id);
    }

    if (accountId) {
      return Promise.resolve(accountId);
    }

    return getDefaultAccount({
      organization_id: payload.organization_id,
    }).then((account) => account.id);
  })();

  const normalized = {
    ...payload,
    account_id: await fallbackAccount,
    contact_id: contactId,
    member_id: memberId,
    client_id: clientId,
    vendor_id: vendorId,
    currency: normalizeCurrency(payload.currency, { allowUndefined: false }),
    status: normalizeTransactionStatus(payload.status, { allowUndefined: false }),
    tags: normalizeTags(payload.tags, { allowUndefined: false }),
    source,
    original_description:
      payload.original_description === undefined ||
      payload.original_description === null
        ? payload.description === undefined
          ? null
          : String(payload.description).trim().slice(0, 500)
        : String(payload.original_description).trim().slice(0, 500),
    editable: payload.editable === undefined ? true : Boolean(payload.editable),
    notes:
      payload.notes === undefined || payload.notes === null
        ? null
        : String(payload.notes).trim().slice(0, 2000),
    entity: normalizeEntity(payload.entity, { allowUndefined: false }),
    match_method: effectiveMatchMethod,
    match_confidence: effectiveMatchConfidence,
  };

  await assertLinkedEntities(normalized);
  const linkedEntityLabel = await resolveLinkedEntityLabel(normalized);
  const resolvedEntity = normalized.entity || linkedEntityLabel || null;

  const query = {
    text: `
      INSERT INTO finance.transactions (
        organization_id,
        account_id,
        contact_id,
        currency,
        status,
        tags,
        source,
        original_description,
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
      VALUES (
        $1, $2, $3, $4, $5, $6::text[], $7, $8,
        $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
      )
      RETURNING
        id,
        organization_id,
        account_id,
        contact_id,
        currency,
        status,
        tags,
        source,
        original_description,
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
      normalized.account_id,
      normalized.contact_id,
      normalized.currency,
      normalized.status,
      normalized.tags,
      normalized.source,
      normalized.original_description,
      normalized.type,
      normalized.amount,
      normalized.category,
      normalized.description ?? null,
      resolvedEntity,
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
  const mappedCreated = mapTransactionRow({
    ...created,
    member_name: null,
    client_name: null,
    vendor_name: null,
  });

  await logTransactionAudit({
    organization_id: mappedCreated.organization_id,
    transaction_id: mappedCreated.id,
    action: 'create',
    actor_user_id: options.actor_user_id || null,
    actor_role: options.actor_role || null,
    source: options.audit_source || mappedCreated.source || 'api',
    changes: {
      after: toAuditSnapshot(mappedCreated),
    },
  });

  return mappedCreated;
}

async function getTransactionById({ organization_id, transaction_id }) {
  const query = {
    text: `
      SELECT
        t.id,
        t.organization_id,
        t.account_id,
        a.name AS account_name,
        t.contact_id,
        ct.name AS contact_name,
        ct.type AS contact_type,
        t.currency,
        t.status,
        t.tags,
        t.source,
        t.original_description,
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
      LEFT JOIN finance.accounts a
        ON a.id = t.account_id
       AND a.organization_id = t.organization_id
      LEFT JOIN finance.contacts ct
        ON ct.id = t.contact_id
       AND ct.organization_id = t.organization_id
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
  const allowedSortColumns = {
    transaction_date: 't.transaction_date',
    amount: 't.amount',
    created_at: 't.created_at',
    category: 't.category',
  };
  const sortBy = allowedSortColumns[filters.sort_by] || 't.transaction_date';
  const sortOrder =
    String(filters.sort_order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

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

  if (filters.account_id) {
    conditions.push(`t.account_id = $${cursor}`);
    values.push(filters.account_id);
    cursor += 1;
  }

  if (filters.contact_id) {
    conditions.push(`t.contact_id = $${cursor}`);
    values.push(filters.contact_id);
    cursor += 1;
  }

  if (filters.status) {
    conditions.push(`t.status = $${cursor}`);
    values.push(normalizeTransactionStatus(filters.status, { allowUndefined: false }));
    cursor += 1;
  }

  if (filters.q) {
    const queryText = String(filters.q).trim();
    if (queryText) {
      values.push(`%${queryText}%`);
      conditions.push(`(
        COALESCE(t.description, '') ILIKE $${cursor}
        OR COALESCE(t.original_description, '') ILIKE $${cursor}
        OR COALESCE(t.category, '') ILIKE $${cursor}
        OR COALESCE(t.entity, '') ILIKE $${cursor}
        OR COALESCE(t.notes, '') ILIKE $${cursor}
        OR COALESCE(t.source, '') ILIKE $${cursor}
      )`);
      cursor += 1;
    }
  }

  if (filters.source) {
    conditions.push(`t.source = $${cursor}`);
    values.push(normalizeSource(filters.source, { allowUndefined: false }));
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
        t.account_id,
        a.name AS account_name,
        t.contact_id,
        ct.name AS contact_name,
        ct.type AS contact_type,
        t.currency,
        t.status,
        t.tags,
        t.source,
        t.original_description,
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
      LEFT JOIN finance.accounts a
        ON a.id = t.account_id
       AND a.organization_id = t.organization_id
      LEFT JOIN finance.contacts ct
        ON ct.id = t.contact_id
       AND ct.organization_id = t.organization_id
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
      ORDER BY ${sortBy} ${sortOrder}, t.created_at DESC
      LIMIT $${limitIndex}
      OFFSET $${offsetIndex}
    `,
    values,
  };

  const { rows } = await pool.query(query);
  return rows.map(mapTransactionRow);
}

async function updateTransaction({
  organization_id,
  transaction_id,
  patch,
  actor_user_id = null,
  actor_role = null,
  audit_source = null,
}) {
  const existing = await getTransactionById({ organization_id, transaction_id });
  const existingAccountId = coerceUuidOrNull(existing.account_id);
  const existingSource = normalizeSource(existing.source, { allowUndefined: false });
  const nextSource =
    patch.source === undefined
      ? existingSource
      : normalizeSource(patch.source, { allowUndefined: false });
  const nextType = patch.type || existing.type;

  let resolvedAccountId =
    patch.account_id === undefined
      ? existingAccountId
      : coerceUuidOrNull(patch.account_id);

  if (nextType === 'expense' && nextSource === 'cash') {
    resolvedAccountId = (
      await getOrCreateCashAccount({
        organization_id,
      })
    ).id;
  } else if (!resolvedAccountId) {
    resolvedAccountId = (
      await getDefaultAccount({
        organization_id,
      })
    ).id;
  }

  const shouldUpdateAccountId = resolvedAccountId !== existingAccountId;

  const normalized = {
    organization_id,
    account_id: resolvedAccountId,
    contact_id:
      patch.contact_id === undefined
        ? coerceUuidOrNull(existing.contact_id)
        : coerceUuidOrNull(patch.contact_id),
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
    patch.contact_id !== undefined ||
    patch.member_id !== undefined ||
    patch.client_id !== undefined ||
    patch.vendor_id !== undefined;
  const hasLinkedEntity = Boolean(
    normalized.contact_id ||
      normalized.member_id ||
      normalized.client_id ||
      normalized.vendor_id
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
    account_id: shouldUpdateAccountId ? resolvedAccountId : undefined,
    contact_id:
      patch.contact_id === undefined ? undefined : coerceUuidOrNull(patch.contact_id),
    currency:
      patch.currency === undefined
        ? undefined
        : normalizeCurrency(patch.currency, { allowUndefined: false }),
    status:
      patch.status === undefined
        ? undefined
        : normalizeTransactionStatus(patch.status, { allowUndefined: false }),
    tags:
      patch.tags === undefined
        ? undefined
        : normalizeTags(patch.tags, { allowUndefined: false }),
    source: patch.source === undefined ? undefined : nextSource,
    original_description:
      patch.original_description === undefined
        ? undefined
        : patch.original_description === null
        ? null
        : String(patch.original_description).trim().slice(0, 500),
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
        : normalizeEntity(patch.entity, { allowUndefined: false }),
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

  if (patch.entity === undefined && hasEntityPatch && hasLinkedEntity) {
    mutable.entity = await resolveLinkedEntityLabel(normalized);
  }

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
  const updated = await getTransactionById({ organization_id, transaction_id });

  await logTransactionAudit({
    organization_id,
    transaction_id,
    action: 'update',
    actor_user_id,
    actor_role,
    source: audit_source || updated.source || existing.source || 'api',
    changes: {
      patch,
      before: toAuditSnapshot(existing),
      after: toAuditSnapshot(updated),
    },
  });

  return updated;
}

async function deleteTransaction({
  organization_id,
  transaction_id,
  actor_user_id = null,
  actor_role = null,
  audit_source = 'api',
}) {
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

  await logTransactionAudit({
    organization_id,
    transaction_id,
    action: 'delete',
    actor_user_id,
    actor_role,
    source: audit_source,
    changes: {
      before: toAuditSnapshot(transaction),
    },
  });

  return {
    id: rows[0].id,
    deleted: true,
  };
}

async function listTransactionHistory({ organization_id, transaction_id, limit = 100 }) {
  await getTransactionById({ organization_id, transaction_id });
  const rows = await listTransactionAudit({
    organization_id,
    transaction_id,
    limit,
  });
  return rows.map(mapTransactionAuditRow);
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
  listTransactionHistory,
  countTransactionsInRange,
};
