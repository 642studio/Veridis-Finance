const pool = require('../db/pool');

const PLAN_TIERS = Object.freeze({
  FREE: 'free',
  PRO: 'pro',
  ENTERPRISE: 'enterprise',
});

const ACTIVE_SUBSCRIPTION_STATES = new Set(['active', 'trialing']);

function sanitizeSlug(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function buildOrganizationRecord(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    organization_id: row.organization_id,
    name: row.name,
    slug: row.slug,
    subdomain: row.subdomain,
    plan: row.plan,
    subscription_status: row.subscription_status,
    stripe_customer_id: row.stripe_customer_id,
    stripe_subscription_id: row.stripe_subscription_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getOrganizationById(organizationId) {
  const query = {
    text: `
      SELECT
        id,
        organization_id,
        name,
        slug,
        subdomain,
        plan,
        subscription_status,
        stripe_customer_id,
        stripe_subscription_id,
        created_at,
        updated_at
      FROM finance.organizations
      WHERE organization_id = $1
      LIMIT 1
    `,
    values: [organizationId],
  };

  const { rows } = await pool.query(query);
  return buildOrganizationRecord(rows[0]);
}

async function getOrganizationBySlug(slug) {
  const query = {
    text: `
      SELECT
        id,
        organization_id,
        name,
        slug,
        subdomain,
        plan,
        subscription_status,
        stripe_customer_id,
        stripe_subscription_id,
        created_at,
        updated_at
      FROM finance.organizations
      WHERE slug = $1
      LIMIT 1
    `,
    values: [sanitizeSlug(slug)],
  };

  const { rows } = await pool.query(query);
  return buildOrganizationRecord(rows[0]);
}

async function ensureSlugIsAvailable(slug) {
  const existing = await getOrganizationBySlug(slug);
  if (existing) {
    const error = new Error(`Organization slug already exists: ${slug}`);
    error.statusCode = 409;
    throw error;
  }
}

function transactionLimitForPlan(plan) {
  if (plan === PLAN_TIERS.FREE) {
    return 200;
  }
  return null;
}

function hasApiAccess(plan) {
  return plan === PLAN_TIERS.ENTERPRISE;
}

function hasActiveSubscription(status) {
  return ACTIVE_SUBSCRIPTION_STATES.has(status);
}

module.exports = {
  PLAN_TIERS,
  sanitizeSlug,
  ensureSlugIsAvailable,
  getOrganizationById,
  getOrganizationBySlug,
  transactionLimitForPlan,
  hasApiAccess,
  hasActiveSubscription,
};
