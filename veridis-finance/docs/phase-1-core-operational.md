# Phase 1 - Core Operational Accounting

This document describes the Phase 1 implementation delivered for `veridis-finance` and how to validate it end-to-end.

## Scope

Phase 1 adds the operational finance foundation:

1. Accounts (`finance.accounts`)
2. Contacts (`finance.contacts`)
3. Categories and subcategories (`finance.categories`, `finance.subcategories`)
4. Transaction splits (`finance.transaction_splits`)
5. Extended transactions (`finance.transactions`) with:
   - `account_id` (required)
   - `contact_id` (optional)
   - `currency`
   - `status`
   - `tags`
   - `source`
   - `original_description`

All reads and writes are scoped by `organization_id`.

## Step 1 - Apply schema changes

Run schema migration against your configured DB:

```bash
cd /Users/642studio/VeridisFinance/veridis-finance
node -e "require('dotenv').config(); const fs=require('fs'); const pool=require('./src/db/pool'); (async()=>{ await pool.query(fs.readFileSync('src/db/schema.sql','utf8')); await pool.end(); console.log('schema-applied'); })().catch((err)=>{ console.error(err); process.exit(1); });"
```

What this migration does:

- Creates new enums for accounts/contacts/transaction status.
- Creates tables for accounts, contacts, categories, subcategories, and transaction splits.
- Extends transactions with the new fields.
- Backfills a default `General` account per organization.
- Auto-creates a default `General` account for new organizations when needed.
- Registration flow now creates `General` account for every new organization.
- Backfills `transactions.account_id` and sets it `NOT NULL`.
- Replaces single-entity check to include `contact_id`.
- Adds indexes for high-frequency operational filters.

## Step 2 - New API surface

All endpoints require JWT auth and tenant scope from token.

### Accounts

- `GET /api/accounts`
- `POST /api/accounts`
- `PUT /api/accounts/:id`
- `DELETE /api/accounts/:id` (soft delete: `status=inactive`)

### Contacts

- `GET /api/contacts`
- `POST /api/contacts`
- `PUT /api/contacts/:id`
- `DELETE /api/contacts/:id` (soft delete: `status=inactive`)

### Categories/Subcategories

- `GET /api/categories`
- `POST /api/categories`
- `PUT /api/categories/:categoryId`
- `DELETE /api/categories/:categoryId` (soft delete: `active=false`)
- `GET /api/categories/:categoryId/subcategories`
- `POST /api/categories/:categoryId/subcategories`
- `PUT /api/subcategories/:subcategoryId`
- `DELETE /api/subcategories/:subcategoryId` (soft delete: `active=false`)

### Transaction splits

- `GET /api/transactions/:transactionId/splits`
- `POST /api/transactions/:transactionId/splits`
- `PUT /api/transaction-splits/:splitId`
- `DELETE /api/transaction-splits/:splitId`

Split rules:

- split amount must be `> 0`
- category/subcategory must exist in same organization
- subcategory must belong to selected category
- total split amount cannot exceed transaction amount

### Extended transactions

- `POST /api/transactions`
- `GET /api/transactions`
- `GET /api/transactions/recurring-candidates`
- `GET /api/transactions/recurring-alerts`
- `GET /api/transactions/recurring-rules`
- `POST /api/transactions/recurring-rules/approve`
- `POST /api/transactions/recurring-rules/suppress`
- `POST /api/transactions/recurring-rules/:id/unsuppress`
- `PUT /api/transactions/:id`
- `DELETE /api/transactions/:id`
- `GET /api/transactions/:id/history`

Additional accepted fields:

- `account_id`, `contact_id`, `currency`, `status`, `tags`, `source`, `original_description`
- filters: `account_id`, `contact_id`, `status`, `source`

Entity guard:

- only one of `contact_id`, `member_id`, `client_id`, `vendor_id` can be present.

Recurring detection endpoint:

- `GET /api/transactions/recurring-candidates`
- query params:
  - `lookback_days` (default `180`, min `30`, max `730`)
  - `min_occurrences` (default `3`, min `2`, max `12`)
  - `limit` (default `20`, max `100`)
- detection strategy:
  - groups transactions by `type + amount + normalized description`
  - computes average interval and confidence score
  - returns frequency (`weekly`, `biweekly`, `monthly`, `bimonthly`, `quarterly`, `custom`)
- returns `next_expected_date` for operational alerting

Recurring alert endpoint:

- `GET /api/transactions/recurring-alerts`
- query params:
  - `lookback_days` (default `180`)
  - `min_occurrences` (default `3`)
  - `due_window_days` (default `7`)
  - `overdue_grace_days` (default `2`)
  - `limit` (default `20`)
- returns grouped operational queues:
  - `due_soon`: expected transactions within the due window
  - `overdue`: expected transactions beyond grace period

Recurring rules endpoints:

- `POST /api/transactions/recurring-rules/approve`
  - persists a candidate as an approved recurring rule
- `POST /api/transactions/recurring-rules/suppress`
  - suppresses alerts for a candidate (default 30 days)
- `POST /api/transactions/recurring-rules/:id/unsuppress`
  - restores a suppressed rule back to approved
- suppression is applied automatically by the candidate/alert engines

## Step 3 - Import flow compatibility

Bank statement confirm flow (`POST /api/finance/bank-statements/confirm/:importId`) now inserts transactions with:

- `account_id` from organization default account
- `source='bank_statement_import'`
- `original_description` from parsed row

This keeps import flow compatible with the new `transactions.account_id NOT NULL` rule.

## Step 4 - Smoke test checklist

Minimal functional test order:

1. Register organization via `POST /auth/register`.
2. Create account via `POST /api/accounts`.
3. Create contact via `POST /api/contacts`.
4. Create category + subcategory.
5. Create transaction linked to account + contact.
6. Create split under that transaction.
7. Query transactions using `account_id` and `contact_id` filters.
8. Update transaction (`notes`, `source`).
9. Confirm split list returns created split.
10. Confirm transaction history returns `create` and `update`.

## Step 5 - Automated smoke runner

You can run the full checklist above using the bundled smoke script:

```bash
cd /Users/642studio/VeridisFinance/veridis-finance
npm run smoke:phase1
```

Optional base URL override:

```bash
API_BASE_URL=http://127.0.0.1:4000 npm run smoke:phase1
```

The script validates:

1. tenant registration and login
2. account/contact/category/subcategory creation
3. transaction creation with `account_id` + `contact_id`
4. split create/list
5. filtered transaction listing
6. transaction update path
7. transaction audit history (`create`, `update`)

## Step 6 - Security and integrity notes

- Query scope always includes `organization_id`.
- Soft-deleted transactions are excluded by `deleted_at IS NULL`.
- Soft-deleted operational entities remain auditable.
- DB-level constraints backstop service-layer validations.
- Services/controllers are separated by module for maintainability.
