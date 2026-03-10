const jwt = require('jsonwebtoken');

const pool = require('../db/pool');
const { hashPassword, verifyPassword } = require('./passwordService');
const {
  PLAN_TIERS,
  sanitizeSlug,
  ensureSlugIsAvailable,
} = require('./organizationService');

const VALID_PLAN_VALUES = new Set(Object.values(PLAN_TIERS));

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function unauthorized(message) {
  const error = new Error(message);
  error.statusCode = 401;
  return error;
}

function conflict(message) {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function signAccessToken({ userId, organizationId, role }) {
  return jwt.sign(
    {
      user_id: userId,
      organization_id: organizationId,
      role,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

async function register(payload) {
  const organizationName = String(payload.organization_name || '').trim();
  const ownerName = String(payload.owner_name || '').trim();
  const ownerEmail = normalizeEmail(payload.owner_email);
  const plan = payload.plan || PLAN_TIERS.FREE;

  if (!VALID_PLAN_VALUES.has(plan)) {
    throw badRequest(`Invalid plan value: ${plan}`);
  }

  const requestedSlug = payload.organization_slug || organizationName;
  const slug = sanitizeSlug(requestedSlug);

  if (!slug) {
    throw badRequest('organization_slug could not be derived');
  }

  await ensureSlugIsAvailable(slug);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const organizationResult = await client.query(
      `
        INSERT INTO finance.organizations (
          organization_id,
          name,
          slug,
          subdomain,
          plan,
          subscription_status
        )
        VALUES (gen_random_uuid(), $1, $2, $3, $4, 'active')
        RETURNING organization_id, name, slug, subdomain, plan, subscription_status
      `,
      [organizationName, slug, slug, plan]
    );

    const organization = organizationResult.rows[0];

    await client.query(
      `
        INSERT INTO finance.accounts (
          organization_id,
          name,
          type,
          currency,
          status
        )
        VALUES ($1, 'General', 'bank'::finance.account_type, 'MXN', 'active'::finance.account_status)
        ON CONFLICT DO NOTHING
      `,
      [organization.organization_id]
    );

    const passwordHash = hashPassword(payload.password);

    const userResult = await client.query(
      `
        INSERT INTO finance.users (
          organization_id,
          email,
          full_name,
          role,
          password_hash
        )
        VALUES ($1, $2, $3, 'owner', $4)
        RETURNING id, organization_id, email, full_name, role
      `,
      [organization.organization_id, ownerEmail, ownerName, passwordHash]
    );

    await client.query('COMMIT');

    const user = userResult.rows[0];
    const normalizedRole = String(user.role || '').toLowerCase();
    const token = signAccessToken({
      userId: user.id,
      organizationId: user.organization_id,
      role: normalizedRole,
    });

    return {
      token,
      user: {
        user_id: user.id,
        organization_id: user.organization_id,
        email: user.email,
        full_name: user.full_name,
        role: normalizedRole,
      },
      organization: {
        organization_id: organization.organization_id,
        name: organization.name,
        slug: organization.slug,
        subdomain: organization.subdomain,
        plan: organization.plan,
        subscription_status: organization.subscription_status,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');

    if (error?.code === '23505') {
      throw conflict('Organization slug or owner email already exists');
    }

    throw error;
  } finally {
    client.release();
  }
}

async function login({
  email,
  password,
  organization_id,
  organization_slug,
  tenant_slug,
}) {
  const normalizedEmail = normalizeEmail(email);

  let query;
  if (organization_id) {
    query = {
      text: `
        SELECT
          u.id AS user_id,
          u.organization_id,
          u.email,
          u.full_name,
          u.role,
          u.password_hash,
          u.is_active,
          o.name AS organization_name,
          o.slug AS organization_slug,
          o.subdomain AS organization_subdomain,
          o.plan,
          o.subscription_status
        FROM finance.users u
        JOIN finance.organizations o
          ON o.organization_id = u.organization_id
        WHERE u.organization_id = $1
          AND lower(u.email) = lower($2)
        LIMIT 1
      `,
      values: [organization_id, normalizedEmail],
    };
  } else {
    const resolvedSlug = sanitizeSlug(organization_slug || tenant_slug);
    if (!resolvedSlug) {
      throw badRequest(
        'organization_id or organization_slug is required for tenant login'
      );
    }

    query = {
      text: `
        SELECT
          u.id AS user_id,
          u.organization_id,
          u.email,
          u.full_name,
          u.role,
          u.password_hash,
          u.is_active,
          o.name AS organization_name,
          o.slug AS organization_slug,
          o.subdomain AS organization_subdomain,
          o.plan,
          o.subscription_status
        FROM finance.users u
        JOIN finance.organizations o
          ON o.organization_id = u.organization_id
        WHERE o.slug = $1
          AND lower(u.email) = lower($2)
        LIMIT 1
      `,
      values: [resolvedSlug, normalizedEmail],
    };
  }

  const { rows } = await pool.query(query);
  const user = rows[0];

  if (!user || !user.is_active) {
    throw unauthorized('Invalid credentials');
  }

  const passwordMatches = verifyPassword(password, user.password_hash);
  if (!passwordMatches) {
    throw unauthorized('Invalid credentials');
  }

  const normalizedRole = String(user.role || '').toLowerCase();
  const token = signAccessToken({
    userId: user.user_id,
    organizationId: user.organization_id,
    role: normalizedRole,
  });

  return {
    token,
    user: {
      user_id: user.user_id,
      organization_id: user.organization_id,
      email: user.email,
      full_name: user.full_name,
      role: normalizedRole,
    },
    organization: {
      organization_id: user.organization_id,
      name: user.organization_name,
      slug: user.organization_slug,
      subdomain: user.organization_subdomain,
      plan: user.plan,
      subscription_status: user.subscription_status,
    },
  };
}

module.exports = {
  register,
  login,
  signAccessToken,
};
