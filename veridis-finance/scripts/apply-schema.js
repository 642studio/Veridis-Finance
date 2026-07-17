#!/usr/bin/env node

/**
 * Deprecated entry point — kept for backward compatibility.
 *
 * This script used to apply ONLY `src/db/schema.sql`, which silently skipped the
 * incremental migrations in `src/db/migrations/` and left CFDI/GHL tables
 * uncreated on clean deploys. It now delegates to the versioned runner
 * (`scripts/migrate.js`), which applies the base schema AND the migrations.
 *
 * Prefer `node scripts/migrate.js` / `npm run db:migrate` directly.
 */

// eslint-disable-next-line no-console
console.log('[apply-schema] delegating to scripts/migrate.js (versioned runner)');

require('./migrate');
