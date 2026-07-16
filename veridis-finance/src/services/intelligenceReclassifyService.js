const pool = require('../db/pool');
const {
  classifyTransaction,
} = require('../modules/finance/intelligence/classification.service');

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const DEFAULT_MIN_CONFIDENCE = 0.5;

function clampLimit(value) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(numeric, MAX_LIMIT);
}

function clampConfidence(value) {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_MIN_CONFIDENCE;
  }
  return Math.min(Math.max(numeric, 0), 1);
}

// classification_source -> transactions.match_method (rule|fuzzy|manual)
function toMatchMethod(source) {
  return source === 'rule' ? 'rule' : 'fuzzy';
}

/**
 * Re-runs the hybrid classification engine over currently-uncategorized
 * transactions and persists the resulting category + match metadata.
 *
 * Deliberately conservative: it only writes `category`, `match_confidence` and
 * `match_method`. It does NOT auto-assign entity links (member/client/vendor)
 * here, to avoid ever violating the single-linked-entity CHECK constraint from a
 * bulk operation.
 *
 * @param {{ organizationId: string, limit?: number, minConfidence?: number }} params
 */
async function reclassifyUncategorizedTransactions({
  organizationId,
  limit,
  minConfidence,
}) {
  if (!organizationId) {
    const error = new Error('organizationId is required');
    error.statusCode = 400;
    throw error;
  }

  const effectiveLimit = clampLimit(limit);
  const threshold = clampConfidence(minConfidence);

  const candidates = await pool.query({
    text: `
      SELECT id, description, notes
      FROM finance.transactions
      WHERE organization_id = $1
        AND deleted_at IS NULL
        AND (
          category IS NULL
          OR btrim(category) = ''
          OR lower(category) = 'uncategorized'
        )
      ORDER BY transaction_date DESC
      LIMIT $2
    `,
    values: [organizationId, effectiveLimit],
  });

  let scanned = 0;
  let updated = 0;
  const results = [];

  for (const row of candidates.rows) {
    scanned += 1;

    const description = row.description || row.notes || '';
    if (!String(description).trim()) {
      continue;
    }

    const classification = await classifyTransaction({
      organizationId,
      description,
      db: pool,
      incrementRuleUsage: false,
    });

    const isClassified =
      classification.classification_status === 'classified' &&
      classification.category &&
      classification.category !== 'uncategorized' &&
      Number(classification.confidence_score) >= threshold;

    if (!isClassified) {
      continue;
    }

    await pool.query({
      text: `
        UPDATE finance.transactions
        SET category = $3,
            match_confidence = $4,
            match_method = $5
        WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
      `,
      values: [
        row.id,
        organizationId,
        classification.category,
        Number(classification.confidence_score),
        toMatchMethod(classification.classification_source),
      ],
    });

    updated += 1;
    results.push({
      transaction_id: row.id,
      category: classification.category,
      confidence_score: Number(classification.confidence_score),
      source: classification.classification_source,
    });
  }

  return {
    scanned,
    updated,
    skipped: scanned - updated,
    min_confidence: threshold,
    limit: effectiveLimit,
    results,
  };
}

module.exports = {
  reclassifyUncategorizedTransactions,
};
