const crypto = require('node:crypto');

const pool = require('../db/pool');

function hashApiKey(rawApiKey) {
  return crypto.createHash('sha256').update(rawApiKey).digest('hex');
}

async function findActiveApiKey(rawApiKey) {
  const keyHash = hashApiKey(rawApiKey);

  const query = {
    text: `
      SELECT
        ak.id AS api_key_id,
        ak.organization_id,
        ak.role,
        ak.is_active,
        ak.last_used_at,
        ak.created_at,
        o.plan,
        o.subscription_status
      FROM finance.api_keys ak
      JOIN finance.organizations o
        ON o.organization_id = ak.organization_id
      WHERE ak.key_hash = $1
        AND ak.is_active = true
      LIMIT 1
    `,
    values: [keyHash],
  };

  const { rows } = await pool.query(query);
  return rows[0] || null;
}

async function touchApiKeyUsage(apiKeyId) {
  await pool.query(
    `
      UPDATE finance.api_keys
      SET last_used_at = now()
      WHERE id = $1
    `,
    [apiKeyId]
  );
}

module.exports = {
  hashApiKey,
  findActiveApiKey,
  touchApiKeyUsage,
};
