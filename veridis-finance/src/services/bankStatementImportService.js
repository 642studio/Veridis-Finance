const pool = require('../db/pool');
const {
  classifyTransactions,
  learnRuleFromManualCategorization,
  normalizeDescription,
} = require('../modules/finance/intelligence/classification.service');

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function parseDate(value) {
  const parsed = new Date(value || '');
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function normalizeMoney(value) {
  const amount = Number.parseFloat(String(value || '0'));
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return Number(amount.toFixed(2));
}

function trimLength(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function toUuidOrNull(value) {
  const input = String(value || '').trim();
  if (!input) {
    return null;
  }

  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input
    )
  ) {
    return input.toLowerCase();
  }

  return null;
}

function normalizeMatchMethod(value) {
  const method = String(value || '')
    .trim()
    .toLowerCase();

  if (!method) {
    return null;
  }

  if (method === 'rule' || method === 'fuzzy' || method === 'manual') {
    return method;
  }

  return null;
}

function normalizeMatchConfidence(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) {
    return null;
  }

  if (parsed < 0 || parsed > 1) {
    return null;
  }

  return Number(parsed.toFixed(4));
}

function toDateOnly(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return null;
    }
    return value.toISOString().slice(0, 10);
  }

  const asText = String(value).trim();
  const match = asText.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) {
    return match[1];
  }

  const parsed = parseDate(asText);
  if (!parsed) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function toDateOnlyIso(value) {
  const parsed = parseDate(value);
  if (!parsed) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function dayRangeUtc(value) {
  const parsed = parseDate(value);
  if (!parsed) {
    return null;
  }

  const start = new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())
  );
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  return { start, end };
}

function normalizeImportedTransaction(transaction, fallbackBank) {
  const type = transaction?.type === 'income' ? 'income' : transaction?.type === 'expense' ? 'expense' : null;
  const amount = normalizeMoney(transaction?.amount);
  const transactionDate = parseDate(transaction?.transaction_date);
  const rawDescription = trimLength(transaction?.raw_description, 500);
  const category =
    trimLength(transaction?.category || transaction?.concept, 120) || 'uncategorized';

  if (!type || !amount || !transactionDate || !rawDescription || !category) {
    return null;
  }

  const memberId = toUuidOrNull(transaction?.member_id);
  const clientId = toUuidOrNull(transaction?.client_id);
  const vendorId = toUuidOrNull(transaction?.vendor_id);

  const linkedEntityCount = [memberId, clientId, vendorId].filter(Boolean).length;
  if (linkedEntityCount > 1) {
    return null;
  }

  const finalEntityLinks = {
    member_id: memberId,
    client_id: clientId,
    vendor_id: vendorId,
  };

  const initialMatchMethod = normalizeMatchMethod(transaction?.match_method);
  const inferredMatchMethod =
    initialMatchMethod ||
    (finalEntityLinks.member_id || finalEntityLinks.client_id || finalEntityLinks.vendor_id
      ? 'manual'
      : null);
  const initialMatchConfidence = normalizeMatchConfidence(transaction?.match_confidence);
  const inferredMatchConfidence =
    initialMatchConfidence ??
    (inferredMatchMethod === 'manual' ? 1 : null);

  return {
    transaction_date: transactionDate,
    transaction_date_iso: toDateOnlyIso(transactionDate),
    type,
    amount,
    category,
    concept: trimLength(transaction?.concept, 120) || 'bank_movement',
    raw_description: rawDescription,
    folio: trimLength(transaction?.folio, 120),
    bank: trimLength(transaction?.bank || fallbackBank, 80) || trimLength(fallbackBank, 80),
    category_id: toUuidOrNull(transaction?.category_id),
    subcategory_id: toUuidOrNull(transaction?.subcategory_id),
    member_id: finalEntityLinks.member_id,
    client_id: finalEntityLinks.client_id,
    vendor_id: finalEntityLinks.vendor_id,
    member_name: trimLength(transaction?.member_name, 120),
    client_name: trimLength(transaction?.client_name, 120),
    vendor_name: trimLength(transaction?.vendor_name, 120),
    match_confidence: inferredMatchConfidence,
    match_method: inferredMatchMethod,
    keyword_pattern: trimLength(transaction?.keyword_pattern, 120),
  };
}

function buildDuplicateKey(transaction) {
  return [
    transaction.transaction_date_iso,
    transaction.amount.toFixed(2),
    transaction.raw_description.toLowerCase(),
  ].join('|');
}

function mapImportRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    organization_id: row.organization_id,
    bank: row.bank,
    account_number: row.account_number,
    period_start: toDateOnly(row.period_start),
    period_end: toDateOnly(row.period_end),
    file_name: row.file_name,
    file_size_bytes: row.file_size_bytes,
    preview_count: row.preview_count,
    parsed_transactions: row.parsed_transactions,
    status: row.status,
    created_by_user_id: row.created_by_user_id,
    created_at: row.created_at,
    confirmed_at: row.confirmed_at,
  };
}

async function createImportPreview(payload) {
  const parsedTransactions = Array.isArray(payload.parsed_transactions)
    ? payload.parsed_transactions
    : [];

  const classifiedTransactions = await classifyTransactions({
    organizationId: payload.organization_id,
    transactions: parsedTransactions,
    db: pool,
    incrementRuleUsage: true,
  });

  const query = {
    text: `
      INSERT INTO finance.bank_statement_imports (
        organization_id,
        bank,
        account_number,
        period_start,
        period_end,
        file_name,
        file_size_bytes,
        preview_count,
        parsed_transactions,
        created_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
      RETURNING
        id,
        organization_id,
        bank,
        account_number,
        period_start,
        period_end,
        file_name,
        file_size_bytes,
        preview_count,
        parsed_transactions,
        status,
        created_by_user_id,
        created_at,
        confirmed_at
    `,
    values: [
      payload.organization_id,
      payload.bank,
      payload.account_number || null,
      toDateOnly(payload.period_start),
      toDateOnly(payload.period_end),
      payload.file_name || null,
      payload.file_size_bytes || null,
      classifiedTransactions.length,
      JSON.stringify(classifiedTransactions),
      payload.created_by_user_id || null,
    ],
  };

  const { rows } = await pool.query(query);
  return mapImportRow(rows[0]);
}

async function getImportById({ importId, organizationId, client, lock = false }) {
  const db = client || pool;
  const lockClause = lock ? 'FOR UPDATE' : '';

  const query = {
    text: `
      SELECT
        id,
        organization_id,
        bank,
        account_number,
        period_start,
        period_end,
        file_name,
        file_size_bytes,
        preview_count,
        parsed_transactions,
        status,
        created_by_user_id,
        created_at,
        confirmed_at
      FROM finance.bank_statement_imports
      WHERE id = $1
        AND organization_id = $2
      LIMIT 1
      ${lockClause}
    `,
    values: [importId, organizationId],
  };

  const { rows } = await db.query(query);
  return mapImportRow(rows[0]);
}

async function confirmImport({ importId, organizationId, transactionOverrides }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const importRecord = await getImportById({
      importId,
      organizationId,
      client,
      lock: true,
    });

    if (!importRecord) {
      throw notFound(`Bank statement import not found: ${importId}`);
    }

    if (importRecord.status === 'confirmed') {
      await client.query('COMMIT');
      return {
        import_id: importId,
        inserted_count: 0,
        skipped_duplicates: 0,
        skipped_invalid: 0,
        already_confirmed: true,
      };
    }

    const previewTransactions = Array.isArray(importRecord.parsed_transactions)
      ? importRecord.parsed_transactions
      : [];
    const overrides = Array.isArray(transactionOverrides)
      ? transactionOverrides
      : [];

    if (!previewTransactions.length) {
      throw badRequest('Import preview has no transactions to confirm');
    }

    const seenKeys = new Set();
    const memberNameById = new Map();
    const clientNameById = new Map();
    const vendorNameById = new Map();
    let insertedCount = 0;
    let skippedDuplicates = 0;
    let skippedInvalid = 0;

    async function resolveMemberName(memberId) {
      if (!memberId) {
        return null;
      }

      if (memberNameById.has(memberId)) {
        return memberNameById.get(memberId);
      }

      const memberQuery = {
        text: `
          SELECT full_name
          FROM finance.members
          WHERE organization_id = $1
            AND id = $2
            AND active = true
          LIMIT 1
        `,
        values: [organizationId, memberId],
      };

      const memberResult = await client.query(memberQuery);
      const fullName = String(memberResult.rows[0]?.full_name || '').trim() || null;
      memberNameById.set(memberId, fullName);
      return fullName;
    }

    async function resolveClientName(clientId) {
      if (!clientId) {
        return null;
      }

      if (clientNameById.has(clientId)) {
        return clientNameById.get(clientId);
      }

      const clientQuery = {
        text: `
          SELECT COALESCE(business_name, name) AS name
          FROM finance.clients
          WHERE organization_id = $1
            AND id = $2
            AND active = true
          LIMIT 1
        `,
        values: [organizationId, clientId],
      };

      const clientResult = await client.query(clientQuery);
      const name = String(clientResult.rows[0]?.name || '').trim() || null;
      clientNameById.set(clientId, name);
      return name;
    }

    async function resolveVendorName(vendorId) {
      if (!vendorId) {
        return null;
      }

      if (vendorNameById.has(vendorId)) {
        return vendorNameById.get(vendorId);
      }

      const vendorQuery = {
        text: `
          SELECT name
          FROM finance.vendors
          WHERE organization_id = $1
            AND id = $2
            AND active = true
          LIMIT 1
        `,
        values: [organizationId, vendorId],
      };

      const vendorResult = await client.query(vendorQuery);
      const name = String(vendorResult.rows[0]?.name || '').trim() || null;
      vendorNameById.set(vendorId, name);
      return name;
    }

    for (
      let transactionIndex = 0;
      transactionIndex < previewTransactions.length;
      transactionIndex += 1
    ) {
      const previewTransaction = previewTransactions[transactionIndex];
      const overrideCandidate = overrides[transactionIndex];
      const hasOverride =
        overrideCandidate && typeof overrideCandidate === 'object';

      const mergedTransaction = hasOverride
        ? {
            ...previewTransaction,
            ...overrideCandidate,
            category:
              trimLength(
                overrideCandidate.category ||
                  previewTransaction.category ||
                  overrideCandidate.concept ||
                  previewTransaction.concept,
                120
              ) ||
              trimLength(
                previewTransaction.category || previewTransaction.concept,
                120
              ) ||
              'uncategorized',
            concept:
              trimLength(
                overrideCandidate.category ||
                  overrideCandidate.concept ||
                  previewTransaction.concept,
                120
              ) || previewTransaction.concept,
          }
        : previewTransaction;

      const previewCategory = trimLength(
        previewTransaction?.category || previewTransaction?.concept,
        120
      );
      const overrideCategory = trimLength(overrideCandidate?.category, 120);
      const manualCategoryChanged =
        hasOverride &&
        overrideCategory &&
        normalizeDescription(overrideCategory) !==
          normalizeDescription(previewCategory);

      if (manualCategoryChanged) {
        await learnRuleFromManualCategorization({
          organizationId,
          description:
            previewTransaction?.raw_description ||
            previewTransaction?.concept ||
            '',
          category: overrideCategory,
          categoryId: overrideCandidate?.category_id || previewTransaction?.category_id,
          subcategoryId:
            overrideCandidate?.subcategory_id || previewTransaction?.subcategory_id,
          memberId: overrideCandidate?.member_id || previewTransaction?.member_id,
          db: client,
        });
      }

      const normalized = normalizeImportedTransaction(
        mergedTransaction,
        importRecord.bank
      );

      if (!normalized) {
        skippedInvalid += 1;
        continue;
      }

      const duplicateKey = buildDuplicateKey(normalized);
      if (seenKeys.has(duplicateKey)) {
        skippedDuplicates += 1;
        continue;
      }
      seenKeys.add(duplicateKey);

      const resolvedMemberName =
        normalized.member_name || (await resolveMemberName(normalized.member_id));
      const resolvedClientName =
        normalized.client_name || (await resolveClientName(normalized.client_id));
      const resolvedVendorName =
        normalized.vendor_name || (await resolveVendorName(normalized.vendor_id));

      const resolvedEntityName =
        resolvedMemberName ||
        resolvedClientName ||
        resolvedVendorName ||
        normalized.bank;

      const duplicateQuery = {
        text: `
          SELECT 1
          FROM finance.transactions
          WHERE organization_id = $1
            AND transaction_date >= $2
            AND transaction_date < $3
            AND amount = $4
            AND COALESCE(description, '') = COALESCE($5, '')
            AND deleted_at IS NULL
          LIMIT 1
        `,
        values: (() => {
          const range = dayRangeUtc(normalized.transaction_date);
          return [
            organizationId,
            range.start,
            range.end,
            normalized.amount,
            normalized.raw_description,
          ];
        })(),
      };

      const duplicateResult = await client.query(duplicateQuery);
      if (duplicateResult.rows.length > 0) {
        skippedDuplicates += 1;
        continue;
      }

      const insertTransactionQuery = {
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
            match_confidence,
            match_method,
            transaction_date
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `,
        values: [
          organizationId,
          normalized.type,
          normalized.amount,
          normalized.category,
          normalized.raw_description,
          resolvedEntityName,
          normalized.member_id,
          normalized.client_id,
          normalized.vendor_id,
          normalized.match_confidence,
          normalized.match_method,
          normalized.transaction_date,
        ],
      };

      await client.query(insertTransactionQuery);
      insertedCount += 1;
    }

    await client.query(
      `
        UPDATE finance.bank_statement_imports
        SET
          status = 'confirmed',
          confirmed_at = now()
        WHERE id = $1
          AND organization_id = $2
      `,
      [importId, organizationId]
    );

    await client.query('COMMIT');

    return {
      import_id: importId,
      inserted_count: insertedCount,
      skipped_duplicates: skippedDuplicates,
      skipped_invalid: skippedInvalid,
      already_confirmed: false,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  createImportPreview,
  confirmImport,
  getImportById,
};
