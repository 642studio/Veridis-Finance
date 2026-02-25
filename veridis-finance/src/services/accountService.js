const pool = require('../db/pool');
const { hashPassword, verifyPassword } = require('./passwordService');

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

function forbidden(message) {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
}

function conflict(message) {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeCurrency(value) {
  const normalized = String(value || 'MXN').trim().toUpperCase();
  if (!normalized) {
    return 'MXN';
  }

  return normalized.slice(0, 10);
}

function normalizeTimezone(value) {
  const normalized = String(value || 'America/Mexico_City').trim();
  if (!normalized) {
    return 'America/Mexico_City';
  }

  return normalized.slice(0, 100);
}

function mapAccountRow(row) {
  if (!row) {
    return null;
  }

  return {
    user: {
      user_id: row.user_id,
      organization_id: row.organization_id,
      full_name: row.full_name,
      email: row.email,
      role: row.role,
      is_active: row.is_active,
      created_at: row.user_created_at,
      updated_at: row.user_updated_at,
    },
    organization: {
      organization_id: row.organization_id,
      name: row.organization_name,
      slug: row.organization_slug,
      subdomain: row.organization_subdomain,
      logo_url: row.organization_logo_url,
      currency: row.organization_currency,
      timezone: row.organization_timezone,
      plan: row.organization_plan,
      subscription_status: row.organization_subscription_status,
      created_at: row.organization_created_at,
      updated_at: row.organization_updated_at,
    },
  };
}

async function getAccountContext({ organization_id, user_id }) {
  const query = {
    text: `
      SELECT
        u.id AS user_id,
        u.organization_id,
        u.full_name,
        u.email,
        u.role,
        u.is_active,
        u.created_at AS user_created_at,
        u.updated_at AS user_updated_at,
        o.name AS organization_name,
        o.slug AS organization_slug,
        o.subdomain AS organization_subdomain,
        o.logo_url AS organization_logo_url,
        o.currency AS organization_currency,
        o.timezone AS organization_timezone,
        o.plan AS organization_plan,
        o.subscription_status AS organization_subscription_status,
        o.created_at AS organization_created_at,
        o.updated_at AS organization_updated_at
      FROM finance.users u
      JOIN finance.organizations o
        ON o.organization_id = u.organization_id
      WHERE u.organization_id = $1
        AND u.id = $2
      LIMIT 1
    `,
    values: [organization_id, user_id],
  };

  const { rows } = await pool.query(query);
  const account = mapAccountRow(rows[0]);
  if (!account || !account.user.is_active) {
    throw unauthorized('Account not found or inactive');
  }

  return account;
}

async function updateAccountProfile({ organization_id, user_id, full_name, email }) {
  const values = [organization_id, user_id];
  const assignments = [];

  if (full_name !== undefined) {
    values.push(String(full_name || '').trim().slice(0, 120));
    assignments.push(`full_name = $${values.length}`);
  }

  if (email !== undefined) {
    values.push(normalizeEmail(email));
    assignments.push(`email = $${values.length}`);
  }

  if (!assignments.length) {
    return getAccountContext({ organization_id, user_id });
  }

  values.push(new Date());
  assignments.push(`updated_at = $${values.length}`);

  try {
    const query = {
      text: `
        UPDATE finance.users
        SET ${assignments.join(', ')}
        WHERE organization_id = $1
          AND id = $2
          AND is_active = true
        RETURNING id
      `,
      values,
    };

    const { rows } = await pool.query(query);
    if (!rows[0]) {
      throw unauthorized('Account not found or inactive');
    }
  } catch (error) {
    if (error?.code === '23505') {
      throw conflict('Email already exists in your organization');
    }

    throw error;
  }

  return getAccountContext({ organization_id, user_id });
}

async function changeAccountPassword({
  organization_id,
  user_id,
  current_password,
  new_password,
}) {
  const query = {
    text: `
      SELECT
        id,
        organization_id,
        password_hash,
        is_active
      FROM finance.users
      WHERE organization_id = $1
        AND id = $2
      LIMIT 1
    `,
    values: [organization_id, user_id],
  };

  const { rows } = await pool.query(query);
  const user = rows[0];
  if (!user || !user.is_active) {
    throw unauthorized('Account not found or inactive');
  }

  if (!verifyPassword(current_password, user.password_hash)) {
    throw forbidden('Current password is incorrect');
  }

  if (verifyPassword(new_password, user.password_hash)) {
    throw badRequest('New password must be different from current password');
  }

  const updateQuery = {
    text: `
      UPDATE finance.users
      SET
        password_hash = $3,
        updated_at = now()
      WHERE organization_id = $1
        AND id = $2
    `,
    values: [organization_id, user_id, hashPassword(new_password)],
  };

  await pool.query(updateQuery);

  return {
    changed: true,
  };
}

async function deactivateAccount({ organization_id, user_id, password }) {
  const query = {
    text: `
      SELECT
        id,
        organization_id,
        password_hash,
        is_active
      FROM finance.users
      WHERE organization_id = $1
        AND id = $2
      LIMIT 1
    `,
    values: [organization_id, user_id],
  };

  const { rows } = await pool.query(query);
  const user = rows[0];
  if (!user || !user.is_active) {
    throw unauthorized('Account not found or inactive');
  }

  if (!verifyPassword(password, user.password_hash)) {
    throw forbidden('Password is incorrect');
  }

  await pool.query(
    `
      UPDATE finance.users
      SET
        is_active = false,
        updated_at = now()
      WHERE organization_id = $1
        AND id = $2
    `,
    [organization_id, user_id]
  );

  return {
    deleted: true,
  };
}

async function updateOrganizationSettings({
  organization_id,
  name,
  currency,
  timezone,
}) {
  const values = [organization_id];
  const assignments = [];

  if (name !== undefined) {
    values.push(String(name || '').trim().slice(0, 120));
    assignments.push(`name = $${values.length}`);
  }

  if (currency !== undefined) {
    values.push(normalizeCurrency(currency));
    assignments.push(`currency = $${values.length}`);
  }

  if (timezone !== undefined) {
    values.push(normalizeTimezone(timezone));
    assignments.push(`timezone = $${values.length}`);
  }

  if (!assignments.length) {
    const account = await getOrganizationSettings({ organization_id });
    return account;
  }

  values.push(new Date());
  assignments.push(`updated_at = $${values.length}`);

  const query = {
    text: `
      UPDATE finance.organizations
      SET ${assignments.join(', ')}
      WHERE organization_id = $1
      RETURNING
        organization_id,
        name,
        slug,
        subdomain,
        logo_url,
        currency,
        timezone,
        plan,
        subscription_status,
        created_at,
        updated_at
    `,
    values,
  };

  const { rows } = await pool.query(query);
  const organization = rows[0];
  if (!organization) {
    throw unauthorized('Organization not found');
  }

  return {
    organization_id: organization.organization_id,
    name: organization.name,
    slug: organization.slug,
    subdomain: organization.subdomain,
    logo_url: organization.logo_url,
    currency: organization.currency,
    timezone: organization.timezone,
    plan: organization.plan,
    subscription_status: organization.subscription_status,
    created_at: organization.created_at,
    updated_at: organization.updated_at,
  };
}

async function getOrganizationSettings({ organization_id }) {
  const query = {
    text: `
      SELECT
        organization_id,
        name,
        slug,
        subdomain,
        logo_url,
        currency,
        timezone,
        plan,
        subscription_status,
        created_at,
        updated_at
      FROM finance.organizations
      WHERE organization_id = $1
      LIMIT 1
    `,
    values: [organization_id],
  };

  const { rows } = await pool.query(query);
  const organization = rows[0];
  if (!organization) {
    throw unauthorized('Organization not found');
  }

  return {
    organization_id: organization.organization_id,
    name: organization.name,
    slug: organization.slug,
    subdomain: organization.subdomain,
    logo_url: organization.logo_url,
    currency: organization.currency,
    timezone: organization.timezone,
    plan: organization.plan,
    subscription_status: organization.subscription_status,
    created_at: organization.created_at,
    updated_at: organization.updated_at,
  };
}

async function updateOrganizationLogo({ organization_id, logo_data_url }) {
  const query = {
    text: `
      UPDATE finance.organizations
      SET
        logo_url = $2,
        updated_at = now()
      WHERE organization_id = $1
      RETURNING
        organization_id,
        name,
        slug,
        subdomain,
        logo_url,
        currency,
        timezone,
        plan,
        subscription_status,
        created_at,
        updated_at
    `,
    values: [organization_id, logo_data_url],
  };

  const { rows } = await pool.query(query);
  const organization = rows[0];
  if (!organization) {
    throw unauthorized('Organization not found');
  }

  return {
    organization_id: organization.organization_id,
    name: organization.name,
    slug: organization.slug,
    subdomain: organization.subdomain,
    logo_url: organization.logo_url,
    currency: organization.currency,
    timezone: organization.timezone,
    plan: organization.plan,
    subscription_status: organization.subscription_status,
    created_at: organization.created_at,
    updated_at: organization.updated_at,
  };
}

module.exports = {
  getAccountContext,
  updateAccountProfile,
  changeAccountPassword,
  deactivateAccount,
  getOrganizationSettings,
  updateOrganizationSettings,
  updateOrganizationLogo,
};
