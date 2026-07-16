#!/usr/bin/env node

/**
 * Applies src/db/schema.sql against the configured database.
 *
 * The schema file is written to be idempotent (CREATE ... IF NOT EXISTS,
 * ALTER TABLE ... ADD COLUMN IF NOT EXISTS, guarded CREATE TYPE, etc.), so this
 * script is safe to run repeatedly. It replaces the ad-hoc one-liner previously
 * documented in the README and gives the project a single, versioned entry point
 * for bootstrapping / migrating the database.
 *
 * Usage:
 *   node scripts/apply-schema.js
 *   npm run db:migrate
 */

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const pool = require('../src/db/pool');

const SCHEMA_PATH = path.join(__dirname, '..', 'src', 'db', 'schema.sql');

async function main() {
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');

  const client = await pool.connect();
  try {
    // The schema mixes DDL that cannot run inside a single transaction in some
    // Postgres versions (e.g. ALTER TYPE ... ADD VALUE). We therefore apply it
    // as a single multi-statement batch outside an explicit transaction, which
    // matches how `psql -f schema.sql` behaves.
    await client.query(sql);
    console.log('schema-applied');
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
    console.error('Failed to apply schema:', error.message);
    try {
      await pool.end();
    } catch {
      // ignore pool shutdown errors
    }
    process.exit(1);
  });
