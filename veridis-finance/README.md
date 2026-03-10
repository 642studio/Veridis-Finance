# veridis-finance

SaaS-ready, multi-tenant finance microservice built with Node.js, Fastify, PostgreSQL, JWT, and Docker.

## SaaS Architecture

- Multi-tenant by `organization_id` scope in tenant tables.
- Tenant-ready host strategy:
  - Current: `finance.veridis.642studio.com`
  - Future: `finance.veridis.app`
  - Per-tenant future: `<tenant>.finance.veridis.app`
- Prepared for commercial plans and future Stripe integration fields.

## Core Features

- JWT auth with tenant claims
- Organization + owner registration flow
- Role-based access control (`owner`, `admin`, `ops`, `viewer`)
- Operational accounting core (Phase 1):
  - financial accounts
  - unified contacts
  - categories and subcategories
  - transaction split support
  - extended transaction metadata (account/contact/currency/status/tags/source)
- Subscription plan logic:
  - `free`: max 200 transactions/month
  - `pro`: unlimited
  - `enterprise`: unlimited + API access
- API-key automation endpoint (enterprise-only)
- SAT CFDI 4.0 XML invoice upload parser
- Bank statement PDF import preview + confirm flow
- Financial planning module (multi-year Excel import + planning analytics)
- Hybrid classification engine (`rule` -> `member` -> `ai`)
- AI provider configuration per tenant with encrypted API keys (AES-256)
- Duplicate UUID invoice protection
- Structured logging with pino

## Tech Stack

- Node.js 20+
- Fastify
- PostgreSQL
- JWT (`jsonwebtoken`)
- Zod
- `@fastify/multipart`
- `fast-xml-parser`
- Docker / Docker Compose

## Project Structure

```text
veridis-finance/
  src/
    app.js
    server.js
    logger.js
    routes/
      auth.js
      transactions.js
      reports.js
      invoices.js
      bankStatements.js
      intelligence.js
      aiProviders.js
      accounts.js
      contacts.js
      categories.js
      transactionSplits.js
      planning.js
    controllers/
      authController.js
      transactionsController.js
      reportsController.js
      invoicesController.js
      bankStatementsController.js
      intelligenceController.js
      aiProvidersController.js
      financeAccountsController.js
      contactsController.js
      categoriesController.js
      transactionSplitsController.js
      planningController.js
    services/
      authService.js
      organizationService.js
      passwordService.js
      apiKeyService.js
      transactionsService.js
      reportsService.js
      invoicesService.js
      cfdiParserService.js
      bankStatementImportService.js
      financeAccountsService.js
      contactsService.js
      categoriesService.js
      transactionSplitsService.js
      planningService.js
      bankStatements/
        parserRegistry.js
        pdfStatementParserService.js
        parsers/
          parserSantander.js
          parserBBVA.js
          parserBanorte.js
      planning/
        planningXlsxParserService.js
    db/
      schema.sql
      pool.js
    middleware/
      auth.js
      apiKeyAuth.js
      subscription.js
      rateLimit.js
      tenant.js
    modules/
      finance/
        intelligence/
          projection.service.js
          classification.service.js
          ai-provider.service.js
  scripts/
    seed.js
  dockerfile
  docker-compose.yml
  .env.example
  README.md
```

## Environment Variables

Copy `.env.example` to `.env`.

- `NODE_ENV`
- `HOST`
- `PORT`
- `LOG_LEVEL`
- `JWT_SECRET` (required)
- `JWT_EXPIRES_IN` (default `8h`)
- `APP_BASE_DOMAIN` (future-ready tenant routing)
- `AUTOMATION_RATE_LIMIT_MAX` (default `60`)
- `AUTOMATION_RATE_LIMIT_WINDOW_MS` (default `60000`)
- `INVOICE_XML_MAX_FILE_SIZE_BYTES` (default `1048576`)
- `BANK_STATEMENT_PDF_MAX_FILE_SIZE_BYTES` (default `8388608`)
- `AI_MASTER_KEY` (required for encrypt/decrypt of `finance.ai_providers.encrypted_api_key`)
- `AI_SYSTEM_PROVIDER` (optional fallback: `openai` | `google` | `qwen`)
- `AI_SYSTEM_OPENAI_API_KEY` / `AI_SYSTEM_OPENAI_MODEL` (optional)
- `AI_SYSTEM_GOOGLE_API_KEY` / `AI_SYSTEM_GOOGLE_MODEL` (optional)
- `AI_SYSTEM_QWEN_API_KEY` / `AI_SYSTEM_QWEN_MODEL` (optional)
- `OPENAI_API_BASE_URL` (optional)
- `QWEN_API_BASE_URL` (optional)
- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `DB_SSL`
- `DB_POOL_MAX`
- `DB_IDLE_TIMEOUT_MS`
- `DB_CONNECT_TIMEOUT_MS`
- `DATABASE_URL` (optional)

Seed-related:

- `SEED_ORG_NAME`
- `SEED_ORG_SLUG`
- `SEED_ORG_PLAN`
- `SEED_ADMIN_EMAIL`
- `SEED_ADMIN_NAME`
- `SEED_ADMIN_PASSWORD`
- `SEED_ADMIN_PASSWORD_HASH` (optional)
- `SEED_API_KEY` (optional, creates key hash in `finance.api_keys`)

## Database Model (SaaS)

Main tables:

- `finance.organizations`
- `finance.users`
- `finance.api_keys`
- `finance.ai_providers`
- `finance.ai_usage_events`
- `finance.transactions`
- `finance.invoices`
- `finance.bank_statement_imports`
- `finance.members`
- `finance.transaction_rules`
- `finance.accounts`
- `finance.contacts`
- `finance.categories`
- `finance.subcategories`
- `finance.transaction_splits`

Planning v3 (current):

- `finance.financial_models`
- `finance.model_products`
- `finance.model_income_statements`
- `finance.model_monthly_budget`
- `finance.model_cashflow`
- `finance.model_investments`
- `finance.model_loans`
- `finance.model_loan_schedule`
- `finance.financial_model_snapshots`

Planning legacy (kept for migration/backward compatibility):

- `finance.financial_plans`
- `finance.plan_assumptions`
- `finance.plan_products`
- `finance.plan_monthly_budget`
- `finance.plan_cashflow_monthly`
- `finance.plan_investments`
- `finance.plan_loans`
- `finance.plan_loan_schedule`
- `finance.plan_pnl_annual`

`schema.sql` also includes:

- `plan_tier` enum (`free`, `pro`, `enterprise`)
- `subscription_status` enum
- role enum (`owner`, `admin`, `ops`, `viewer`)
- planning enums:
  - `planning_scenario` (`base`, `optimistic`, `conservative`)
  - `planning_budget_type` (`income`, `cost`, `expense`, `capex`, `loan_payment`)
  - `planning_funding_source` (`capital`, `debt`, `mixed`)
- planning v3 enums:
  - `financial_model_scenario` (`Base`, `Optimistic`, `Conservative`)
  - `model_budget_type` (`income`, `expense`, `cost`, `capex`, `loan_payment`)
  - `model_funding_source` (`capital`, `debt`, `mixed`)

## Authentication

### Register tenant

`POST /auth/register`

Creates:

- organization
- owner user
- JWT token with claims:
  - `user_id`
  - `organization_id`
  - `role`

Example body:

```json
{
  "organization_name": "642 Studio",
  "organization_slug": "642-studio",
  "owner_name": "Owner Name",
  "owner_email": "owner@642studio.com",
  "password": "StrongPassword123",
  "plan": "free"
}
```

### Login tenant user

`POST /auth/login`

Use `organization_id` or `organization_slug` (or future tenant host inference).

```json
{
  "email": "owner@642studio.com",
  "password": "StrongPassword123",
  "organization_slug": "642-studio"
}
```

## Roles

- `owner`: full control
- `admin`: manage transactions
- `ops`: create/edit-style transaction operations
- `viewer`: read-only

## Plans and Limits

- `free`: maximum `200` transactions per month
- `pro`: unlimited transactions
- `enterprise`: unlimited transactions + external API access

Transaction creation routes enforce plan limits via middleware.
Automation API access is restricted to enterprise organizations.

## Endpoints

Public auth:

- `POST /auth/register`
- `POST /auth/login`

Protected finance:

- `GET /health`
- `POST /api/finance/transactions`
- `GET /api/finance/transactions`
- `PUT /api/finance/transactions/:id`
- `DELETE /api/finance/transactions/:id`
- `GET /api/finance/accounts`
- `POST /api/finance/accounts`
- `PUT /api/finance/accounts/:id`
- `DELETE /api/finance/accounts/:id`
- `GET /api/finance/contacts`
- `POST /api/finance/contacts`
- `PUT /api/finance/contacts/:id`
- `DELETE /api/finance/contacts/:id`
- `GET /api/finance/categories`
- `POST /api/finance/categories`
- `PUT /api/finance/categories/:categoryId`
- `DELETE /api/finance/categories/:categoryId`
- `GET /api/finance/categories/:categoryId/subcategories`
- `POST /api/finance/categories/:categoryId/subcategories`
- `PUT /api/finance/subcategories/:subcategoryId`
- `DELETE /api/finance/subcategories/:subcategoryId`
- `GET /api/finance/transactions/:transactionId/splits`
- `POST /api/finance/transactions/:transactionId/splits`
- `PUT /api/finance/transaction-splits/:splitId`
- `DELETE /api/finance/transaction-splits/:splitId`
- `GET /api/finance/report/month?month=MM&year=YYYY`
- `POST /api/finance/invoices`
- `POST /api/finance/invoices/upload`
- `POST /api/finance/bank-statements/upload`
- `POST /api/finance/bank-statements/confirm/:importId`
- `GET /api/finance/intelligence/projection`
- `GET /api/finance/intelligence/ai-provider?provider=<name>`
- `POST /api/finance/intelligence/ai-provider`
- `POST /api/finance/intelligence/ai-provider/test`
- `GET /api/finance/intelligence/ai-provider/usage?month=MM&year=YYYY`
- `POST /api/planning/import` (xlsx upload)
- `GET /api/planning/plans`
- `GET /api/planning/plans/:planId/overview`
- `GET /api/planning/plans/:planId/cashflow`
- `GET /api/planning/plans/:planId/budget`
- `GET /api/planning/plans/:planId/products`
- `GET /api/planning/plans/:planId/investments`
- `GET /api/planning/plans/:planId/loans`

Planning import v3 requirements:

- Required sheet names (strict):
  - `MODEL_INFO`
  - `INCOME_STATEMENT_ANNUAL`
  - `PRODUCT_MIX`
  - `MONTHLY_BUDGET`
  - `CASHFLOW`
  - `INVESTMENTS`
  - `LOANS`
- Validation returns structured errors:
  - `error: "Planning workbook validation failed"`
  - `errors: [{ code, sheet, row?, field?, message }]`
- Success shape:
  - `success`
  - `model_id`
  - `years`
  - `summary` (`total_products`, `total_revenue`, `net_income_year_1`)

API-key automation (enterprise only):

- `POST /api/finance/transactions/automation`

Canonical aliases (same handlers, no `/finance` prefix):

- `/api/transactions`
- `/api/accounts`
- `/api/contacts`
- `/api/categories`
- `/api/subcategories/:subcategoryId`
- `/api/transactions/:transactionId/splits`
- `/api/transaction-splits/:splitId`

## Phase 1 Operational Core

Phase 1 is now implemented with tenant-safe scoping by `organization_id`.

- Transactions now include:
  - `account_id` (required, auto-fallback to default account if omitted)
  - `contact_id` (optional)
  - `currency`, `status`, `tags`, `source`, `original_description`
- Single entity guard enforced on transactions:
  - only one of `contact_id`, `member_id`, `client_id`, `vendor_id`
- Transaction audit trail:
  - logs `create`, `update`, `delete`
  - endpoint: `GET /api/transactions/:id/history`
- Recurring detection:
  - endpoint: `GET /api/transactions/recurring-candidates`
  - pattern engine groups by normalized description + amount + type
  - includes `frequency`, `confidence`, and `next_expected_date`
  - alerts endpoint: `GET /api/transactions/recurring-alerts`
    with `due_soon` and `overdue` buckets
  - persistent rules:
    - `GET /api/transactions/recurring-rules`
    - `POST /api/transactions/recurring-rules/approve`
    - `POST /api/transactions/recurring-rules/suppress`
    - `POST /api/transactions/recurring-rules/:id/unsuppress`
- Soft delete preserved:
  - transactions use `deleted_at`
  - accounts/contacts/categories/subcategories use status or `active=false`
- Bank statement confirm import now inserts transactions with required `account_id`.
- If an organization has no active accounts yet, service auto-creates `General`.
- Detailed step-by-step guide:
  - `docs/phase-1-core-operational.md`
- Automated smoke test (server must be running):
  - `npm run smoke:phase1`
  - optional base URL override: `API_BASE_URL=http://127.0.0.1:4000 npm run smoke:phase1`

## Automation API Key Endpoint

Header options:

- `x-api-key: <api-key>`
- `Authorization: ApiKey <api-key>`

Rate-limit headers:

- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`
- `Retry-After` on `429`

Response shape:

```json
{
  "success": true,
  "monthly_summary": {
    "organization_id": "...",
    "year": 2026,
    "month": 2,
    "total_income": 0,
    "total_expense": 0,
    "net_profit": 0,
    "transaction_count": 0,
    "by_category": []
  }
}
```

## CFDI 4.0 XML Upload

`POST /api/finance/invoices/upload`

Multipart form data:

- `file` (XML)
- optional `organization_id` (must match JWT tenant scope)

Extracted fields:

- UUID (`uuid_sat`)
- Total
- Emitter
- Receiver
- Date

Duplicate UUID in same organization returns `409`.

## Bank Statement Import (Preview + Confirm)

### Upload statement PDF

`POST /api/finance/bank-statements/upload`

Multipart form data:

- `file` (PDF)
- `bank` (currently `santander`; `bbva` and `banorte` parsers scaffolded for future)

Flow:

- parses PDF text with `pdf-parse`
- runs bank parser
- stores parsed preview in `finance.bank_statement_imports`
- returns `import_id` + `transactions_preview` (not inserted yet in `finance.transactions`)

### Confirm import

`POST /api/finance/bank-statements/confirm/:importId`

Flow:

- loads stored preview by tenant scope
- inserts into `finance.transactions`
- prevents duplicates by same `date + amount + description` in organization scope
- marks import as confirmed
- returns inserted/skipped counts

## Local Run

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
cp .env.example .env
```

3. Apply schema:

```bash
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -f src/db/schema.sql
```

4. Seed default tenant/user (optional):

```bash
npm run seed
```

5. Start service:

```bash
npm run dev
```

Service URL: `http://localhost:4000`

## Docker Run

1. Create env file:

```bash
cp .env.example .env
```

2. Start services:

```bash
docker compose up --build
```

3. Seed optional data:

```bash
docker compose exec app npm run seed
```

## Future-Ready Notes

- `finance.organizations` includes Stripe placeholders (`stripe_customer_id`, `stripe_subscription_id`).
- Tenant slug/subdomain fields support future tenant-host routing.
- API key table and middleware are separated for future webhooks/integration expansion.
