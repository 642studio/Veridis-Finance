require('dotenv').config();

const pool = require('../src/db/pool');
const logger = require('../src/logger');
const { hashPassword } = require('../src/services/passwordService');
const { hashApiKey } = require('../src/services/apiKeyService');
const { sanitizeSlug } = require('../src/services/organizationService');

async function seed() {
  let client;

  const organizationName = process.env.SEED_ORG_NAME || '642 Studio';
  const organizationSlug = sanitizeSlug(
    process.env.SEED_ORG_SLUG || organizationName
  );
  const ownerEmail = (process.env.SEED_ADMIN_EMAIL || 'admin@642studio.com')
    .trim()
    .toLowerCase();
  const ownerName = process.env.SEED_ADMIN_NAME || '642 Studio Owner';
  const ownerPassword = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!';
  const ownerPasswordHash =
    process.env.SEED_ADMIN_PASSWORD_HASH || hashPassword(ownerPassword);
  const defaultPlan = process.env.SEED_ORG_PLAN || 'free';
  const seedApiKey = (process.env.SEED_API_KEY || '').trim();

  try {
    client = await pool.connect();
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
        ON CONFLICT (slug)
        DO UPDATE SET
          name = EXCLUDED.name,
          slug = EXCLUDED.slug,
          subdomain = EXCLUDED.subdomain,
          plan = EXCLUDED.plan,
          updated_at = now()
        RETURNING organization_id, name, slug, subdomain, plan
      `,
      [organizationName, organizationSlug, organizationSlug, defaultPlan]
    );

    const organization = organizationResult.rows[0];

    let ownerResult = await client.query(
      `
        UPDATE finance.users
        SET
          full_name = $3,
          role = 'owner',
          password_hash = $4,
          is_active = true,
          updated_at = now()
        WHERE organization_id = $1
          AND lower(email) = lower($2)
        RETURNING id, organization_id, email, full_name, role
      `,
      [organization.organization_id, ownerEmail, ownerName, ownerPasswordHash]
    );

    if (ownerResult.rows.length === 0) {
      ownerResult = await client.query(
        `
          INSERT INTO finance.users (
            organization_id,
            email,
            full_name,
            role,
            password_hash,
            is_active
          )
          VALUES ($1, $2, $3, 'owner', $4, true)
          RETURNING id, organization_id, email, full_name, role
        `,
        [organization.organization_id, ownerEmail, ownerName, ownerPasswordHash]
      );
    }

    if (seedApiKey) {
      const keyHash = hashApiKey(seedApiKey);
      await client.query(
        `
          INSERT INTO finance.api_keys (
            organization_id,
            key_name,
            key_hash,
            role,
            created_by_user_id
          )
          VALUES ($1, 'default-seed-key', $2, 'admin', $3)
          ON CONFLICT (organization_id, key_hash)
          DO UPDATE SET
            role = EXCLUDED.role,
            is_active = true
        `,
        [organization.organization_id, keyHash, ownerResult.rows[0].id]
      );
    }

    await client.query('COMMIT');

    logger.info(
      {
        organization_id: organization.organization_id,
        organization_name: organization.name,
        organization_plan: organization.plan,
        owner_email: ownerResult.rows[0].email,
        owner_role: ownerResult.rows[0].role,
        has_seed_api_key: Boolean(seedApiKey),
      },
      'Seed completed'
    );

    if (!process.env.SEED_ADMIN_PASSWORD_HASH) {
      logger.warn(
        'SEED_ADMIN_PASSWORD_HASH not provided; generated from SEED_ADMIN_PASSWORD. Rotate credentials for production use.'
      );
    }
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK');
    }
    logger.error({ err: error }, 'Seed failed');
    process.exitCode = 1;
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

seed();
