const pool = require('../db/pool');

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

function schemaNotReady(message) {
  const error = new Error(message);
  error.statusCode = 503;
  return error;
}

function mapRule(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    organization_id: row.organization_id,
    candidate_key: row.candidate_key,
    status: row.status,
    type: row.type,
    amount: Number.parseFloat(row.amount || '0'),
    category: row.category,
    normalized_description: row.normalized_description,
    frequency: row.frequency,
    average_interval_days: Number.parseFloat(row.average_interval_days || '0'),
    next_expected_date: row.next_expected_date
      ? new Date(row.next_expected_date).toISOString()
      : null,
    confidence_score: Number.parseFloat(row.confidence_score || '0'),
    suppress_until: row.suppress_until
      ? new Date(row.suppress_until).toISOString()
      : null,
    notes: row.notes,
    created_by_user_id: row.created_by_user_id,
    updated_by_user_id: row.updated_by_user_id,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

async function listRecurringRules({
  organization_id,
  status,
  limit = 100,
  offset = 0,
}) {
  const values = [organization_id];
  const conditions = ['organization_id = $1'];

  if (status) {
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }

  values.push(limit);
  values.push(offset);

  try {
    const { rows } = await pool.query(
      `
        SELECT
          id,
          organization_id,
          candidate_key,
          status,
          type,
          amount,
          category,
          normalized_description,
          frequency,
          average_interval_days,
          next_expected_date,
          confidence_score,
          suppress_until,
          notes,
          created_by_user_id,
          updated_by_user_id,
          created_at,
          updated_at
        FROM finance.recurring_rules
        WHERE ${conditions.join(' AND ')}
        ORDER BY updated_at DESC
        LIMIT $${values.length - 1}
        OFFSET $${values.length}
      `,
      values
    );

    return rows.map(mapRule);
  } catch (error) {
    if (error && error.code === '42P01') {
      return [];
    }
    throw error;
  }
}

async function upsertRecurringRule({
  organization_id,
  candidate,
  status,
  suppress_days,
  notes,
  actor_user_id,
}) {
  const now = new Date();
  let suppressUntil = null;

  if (status === 'suppressed') {
    if (Number.isFinite(suppress_days) && suppress_days > 0) {
      suppressUntil = new Date(now);
      suppressUntil.setUTCDate(suppressUntil.getUTCDate() + suppress_days);
    }
  }

  try {
    const { rows } = await pool.query(
      `
        INSERT INTO finance.recurring_rules (
          organization_id,
          candidate_key,
          status,
          type,
          amount,
          category,
          normalized_description,
          frequency,
          average_interval_days,
          next_expected_date,
          confidence_score,
          suppress_until,
          notes,
          created_by_user_id,
          updated_by_user_id
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $14
        )
        ON CONFLICT (organization_id, candidate_key)
        DO UPDATE SET
          status = EXCLUDED.status,
          type = EXCLUDED.type,
          amount = EXCLUDED.amount,
          category = EXCLUDED.category,
          normalized_description = EXCLUDED.normalized_description,
          frequency = EXCLUDED.frequency,
          average_interval_days = EXCLUDED.average_interval_days,
          next_expected_date = EXCLUDED.next_expected_date,
          confidence_score = EXCLUDED.confidence_score,
          suppress_until = EXCLUDED.suppress_until,
          notes = EXCLUDED.notes,
          updated_by_user_id = EXCLUDED.updated_by_user_id,
          updated_at = now()
        RETURNING
          id,
          organization_id,
          candidate_key,
          status,
          type,
          amount,
          category,
          normalized_description,
          frequency,
          average_interval_days,
          next_expected_date,
          confidence_score,
          suppress_until,
          notes,
          created_by_user_id,
          updated_by_user_id,
          created_at,
          updated_at
      `,
      [
        organization_id,
        candidate.key,
        status,
        candidate.type,
        candidate.amount,
        candidate.category || null,
        candidate.normalized_description,
        candidate.frequency,
        candidate.average_interval_days,
        candidate.next_expected_date,
        candidate.confidence,
        suppressUntil,
        notes || null,
        actor_user_id || null,
      ]
    );

    return mapRule(rows[0]);
  } catch (error) {
    if (error && error.code === '42P01') {
      throw schemaNotReady(
        'Recurring rules table is missing. Apply latest schema.sql migration.'
      );
    }

    throw error;
  }
}

async function unsuppressRecurringRule({
  organization_id,
  rule_id,
  actor_user_id,
}) {
  try {
    const { rows } = await pool.query(
      `
        UPDATE finance.recurring_rules
        SET
          status = 'approved',
          suppress_until = NULL,
          updated_by_user_id = $3,
          updated_at = now()
        WHERE organization_id = $1
          AND id = $2
        RETURNING
          id,
          organization_id,
          candidate_key,
          status,
          type,
          amount,
          category,
          normalized_description,
          frequency,
          average_interval_days,
          next_expected_date,
          confidence_score,
          suppress_until,
          notes,
          created_by_user_id,
          updated_by_user_id,
          created_at,
          updated_at
      `,
      [organization_id, rule_id, actor_user_id || null]
    );

    if (!rows[0]) {
      throw notFound(`Recurring rule not found: ${rule_id}`);
    }

    return mapRule(rows[0]);
  } catch (error) {
    if (error && error.code === '42P01') {
      throw schemaNotReady(
        'Recurring rules table is missing. Apply latest schema.sql migration.'
      );
    }
    throw error;
  }
}

module.exports = {
  listRecurringRules,
  upsertRecurringRule,
  unsuppressRecurringRule,
};
