const pool = require('../db/pool');

function normalizeAction(action) {
  const normalized = String(action || '').trim().toLowerCase();
  if (!['create', 'update', 'delete'].includes(normalized)) {
    throw new Error(`Invalid transaction audit action: ${action}`);
  }
  return normalized;
}

function normalizeChanges(changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    return {};
  }
  return changes;
}

async function logTransactionAudit({
  organization_id,
  transaction_id,
  action,
  actor_user_id = null,
  actor_role = null,
  source = 'api',
  changes = {},
}) {
  const normalizedAction = normalizeAction(action);
  const normalizedSource = String(source || 'api').trim().toLowerCase().slice(0, 80) || 'api';
  const normalizedRole =
    actor_role === null || actor_role === undefined
      ? null
      : String(actor_role).trim().toLowerCase().slice(0, 40) || null;

  const query = {
    text: `
      INSERT INTO finance.transaction_audit_logs (
        organization_id,
        transaction_id,
        action,
        actor_user_id,
        actor_role,
        source,
        changes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      RETURNING
        id,
        organization_id,
        transaction_id,
        action,
        actor_user_id,
        actor_role,
        source,
        changes,
        created_at
    `,
    values: [
      organization_id,
      transaction_id,
      normalizedAction,
      actor_user_id,
      normalizedRole,
      normalizedSource,
      JSON.stringify(normalizeChanges(changes)),
    ],
  };

  const { rows } = await pool.query(query);
  return rows[0] || null;
}

async function listTransactionAudit({ organization_id, transaction_id, limit = 100 }) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));

  const query = {
    text: `
      SELECT
        id,
        organization_id,
        transaction_id,
        action,
        actor_user_id,
        actor_role,
        source,
        changes,
        created_at
      FROM finance.transaction_audit_logs
      WHERE organization_id = $1
        AND transaction_id = $2
      ORDER BY created_at DESC
      LIMIT $3
    `,
    values: [organization_id, transaction_id, safeLimit],
  };

  const { rows } = await pool.query(query);
  return rows;
}

module.exports = {
  logTransactionAudit,
  listTransactionAudit,
};
