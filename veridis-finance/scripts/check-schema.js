#!/usr/bin/env node
// Deployment check only. Schema changes use a separate migration administrator.
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../src/db/pool');
async function check() {
  const expected = fs.readdirSync(path.join(__dirname, '..', 'src/db/migrations'))
    .filter((name) => name.endsWith('.sql')).map((name) => name.replace(/\.sql$/, ''));
  const { rows } = await pool.query('SELECT id FROM finance.schema_migrations');
  const applied = new Set(rows.map((row) => row.id));
  const missing = expected.filter((id) => !applied.has(id));
  if (missing.length) throw new Error(`Missing Finance migrations: ${missing.join(', ')}. Apply with the migration administrator before deploying.`);
  console.log(`[schema-check] ${expected.length} migrations present; no DDL executed.`);
}
check().catch((error) => { console.error('[schema-check]', error.message); process.exitCode = 1; })
  .finally(() => pool.end());
