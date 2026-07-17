#!/usr/bin/env node

/**
 * Versioned database migrator.
 *
 * Applies the schema in two ordered stages:
 *
 *   1. `src/db/schema.sql`     — the idempotent base schema (safe to re-run).
 *   2. `src/db/migrations/*.sql` — incremental migrations, applied in filename
 *                                  order, each recorded once in
 *                                  `finance.schema_migrations`.
 *
 * Why this exists: `apply-schema.js` only applied `schema.sql` and never touched
 * `src/db/migrations/`, so tables/columns introduced by migrations 001–005
 * (cfdi_issuers, cfdi_documents, ghl_installs, ghl_webhook_events,
 * cfdi_receivers, payment-sync columns) were NEVER created on a clean deploy —
 * even though live services depend on them. This runner closes that gap and
 * gives us a real, trackable migration history.
 *
 * Each migration runs inside a transaction together with its bookkeeping insert,
 * so a failure leaves no half-applied, unrecorded state. A migration that cannot
 * run inside a transaction (e.g. `ALTER TYPE ... ADD VALUE` on older Postgres)
 * must declare `-- migrate:no-transaction` on its first line.
 *
 * Usage:
 *   node scripts/migrate.js
 *   npm run db:migrate
 */

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const pool = require('../src/db/pool');

const SCHEMA_PATH = path.join(__dirname, '..', 'src', 'db', 'schema.sql');
const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');

const NO_TRANSACTION_MARKER = 'migrate:no-transaction';

function log(message) {
  // eslint-disable-next-line no-console
  console.log(`[migrate] ${message}`);
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS finance;
    CREATE TABLE IF NOT EXISTS finance.schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function applyBaseSchema(client) {
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  // The base schema mixes DDL that cannot run inside a single transaction in
  // some Postgres versions (e.g. ALTER TYPE ... ADD VALUE), so it is applied as
  // a single multi-statement batch outside an explicit transaction, matching
  // how `psql -f schema.sql` behaves. It is written to be idempotent.
  await client.query(sql);
  log('base schema applied (schema.sql)');
}

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

async function appliedMigrationIds(client) {
  const { rows } = await client.query(
    'SELECT id FROM finance.schema_migrations'
  );
  return new Set(rows.map((row) => row.id));
}

async function runMigration(client, id, sql) {
  const runsInTransaction = !sql.includes(NO_TRANSACTION_MARKER);

  if (runsInTransaction) {
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO finance.schema_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING',
        [id]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } else {
    // Cannot wrap in a transaction; apply then record. Migrations are written to
    // be idempotent so a mid-way failure is safe to re-run.
    await client.query(sql);
    await client.query(
      'INSERT INTO finance.schema_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING',
      [id]
    );
  }

  log(`applied migration ${id}`);
}

async function main() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    await applyBaseSchema(client);

    const files = listMigrationFiles();
    const alreadyApplied = await appliedMigrationIds(client);

    let pending = 0;
    for (const file of files) {
      const id = file.replace(/\.sql$/i, '');
      if (alreadyApplied.has(id)) {
        continue;
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await runMigration(client, id, sql);
      pending += 1;
    }

    if (pending === 0) {
      log('no pending migrations; schema is up to date');
    } else {
      log(`done — ${pending} migration(s) applied`);
    }
  } finally {
    client.release();
  }
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    // eslint-disable-next-line no-console
    console.error('[migrate] failed:', error.message);
    try {
      await pool.end();
    } catch {
      // ignore pool shutdown errors
    }
    process.exit(1);
  });
