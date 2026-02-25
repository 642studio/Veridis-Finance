CREATE SCHEMA IF NOT EXISTS finance;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'transaction_type'
      AND n.nspname = 'finance'
  ) THEN
    CREATE TYPE finance.transaction_type AS ENUM ('income', 'expense');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'invoice_status'
      AND n.nspname = 'finance'
  ) THEN
    CREATE TYPE finance.invoice_status AS ENUM ('pending', 'paid');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'user_role'
      AND n.nspname = 'finance'
  ) THEN
    CREATE TYPE finance.user_role AS ENUM ('owner', 'admin', 'ops', 'viewer');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'plan_tier'
      AND n.nspname = 'finance'
  ) THEN
    CREATE TYPE finance.plan_tier AS ENUM ('free', 'pro', 'enterprise');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'subscription_status'
      AND n.nspname = 'finance'
  ) THEN
    CREATE TYPE finance.subscription_status AS ENUM (
      'active',
      'trialing',
      'past_due',
      'canceled'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'planning_scenario'
      AND n.nspname = 'finance'
  ) THEN
    CREATE TYPE finance.planning_scenario AS ENUM (
      'base',
      'optimistic',
      'conservative'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'planning_budget_type'
      AND n.nspname = 'finance'
  ) THEN
    CREATE TYPE finance.planning_budget_type AS ENUM (
      'income',
      'cost',
      'expense',
      'capex',
      'loan_payment'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'planning_funding_source'
      AND n.nspname = 'finance'
  ) THEN
    CREATE TYPE finance.planning_funding_source AS ENUM (
      'capital',
      'debt',
      'mixed'
    );
  END IF;
END $$;

ALTER TYPE finance.user_role ADD VALUE IF NOT EXISTS 'owner';
ALTER TYPE finance.user_role ADD VALUE IF NOT EXISTS 'admin';
ALTER TYPE finance.user_role ADD VALUE IF NOT EXISTS 'ops';
ALTER TYPE finance.user_role ADD VALUE IF NOT EXISTS 'viewer';

ALTER TYPE finance.plan_tier ADD VALUE IF NOT EXISTS 'free';
ALTER TYPE finance.plan_tier ADD VALUE IF NOT EXISTS 'pro';
ALTER TYPE finance.plan_tier ADD VALUE IF NOT EXISTS 'enterprise';

ALTER TYPE finance.subscription_status ADD VALUE IF NOT EXISTS 'active';
ALTER TYPE finance.subscription_status ADD VALUE IF NOT EXISTS 'trialing';
ALTER TYPE finance.subscription_status ADD VALUE IF NOT EXISTS 'past_due';
ALTER TYPE finance.subscription_status ADD VALUE IF NOT EXISTS 'canceled';

ALTER TYPE finance.planning_scenario ADD VALUE IF NOT EXISTS 'base';
ALTER TYPE finance.planning_scenario ADD VALUE IF NOT EXISTS 'optimistic';
ALTER TYPE finance.planning_scenario ADD VALUE IF NOT EXISTS 'conservative';

ALTER TYPE finance.planning_budget_type ADD VALUE IF NOT EXISTS 'income';
ALTER TYPE finance.planning_budget_type ADD VALUE IF NOT EXISTS 'cost';
ALTER TYPE finance.planning_budget_type ADD VALUE IF NOT EXISTS 'expense';
ALTER TYPE finance.planning_budget_type ADD VALUE IF NOT EXISTS 'capex';
ALTER TYPE finance.planning_budget_type ADD VALUE IF NOT EXISTS 'loan_payment';

ALTER TYPE finance.planning_funding_source ADD VALUE IF NOT EXISTS 'capital';
ALTER TYPE finance.planning_funding_source ADD VALUE IF NOT EXISTS 'debt';
ALTER TYPE finance.planning_funding_source ADD VALUE IF NOT EXISTS 'mixed';

CREATE TABLE IF NOT EXISTS finance.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  subdomain TEXT,
  logo_url TEXT,
  currency TEXT NOT NULL DEFAULT 'MXN',
  timezone TEXT NOT NULL DEFAULT 'America/Mexico_City',
  plan finance.plan_tier NOT NULL DEFAULT 'free',
  subscription_status finance.subscription_status NOT NULL DEFAULT 'active',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE finance.organizations
  ADD COLUMN IF NOT EXISTS organization_id UUID;

ALTER TABLE finance.organizations
  ADD COLUMN IF NOT EXISTS slug TEXT;

ALTER TABLE finance.organizations
  ADD COLUMN IF NOT EXISTS subdomain TEXT;

ALTER TABLE finance.organizations
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

ALTER TABLE finance.organizations
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'MXN';

ALTER TABLE finance.organizations
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Mexico_City';

ALTER TABLE finance.organizations
  ADD COLUMN IF NOT EXISTS plan finance.plan_tier NOT NULL DEFAULT 'free';

ALTER TABLE finance.organizations
  ADD COLUMN IF NOT EXISTS subscription_status finance.subscription_status
    NOT NULL DEFAULT 'active';

ALTER TABLE finance.organizations
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

ALTER TABLE finance.organizations
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

ALTER TABLE finance.organizations
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT now();

ALTER TABLE finance.organizations
  DROP CONSTRAINT IF EXISTS organizations_name_key;

UPDATE finance.organizations
SET organization_id = id
WHERE organization_id IS NULL;

ALTER TABLE finance.organizations
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE finance.organizations
  ALTER COLUMN organization_id SET DEFAULT gen_random_uuid();

UPDATE finance.organizations
SET slug = concat('org-', substr(replace(organization_id::text, '-', ''), 1, 12))
WHERE slug IS NULL OR length(trim(slug)) = 0;

UPDATE finance.organizations
SET currency = 'MXN'
WHERE currency IS NULL OR length(trim(currency)) = 0;

UPDATE finance.organizations
SET timezone = 'America/Mexico_City'
WHERE timezone IS NULL OR length(trim(timezone)) = 0;

ALTER TABLE finance.organizations
  ALTER COLUMN slug SET NOT NULL;

ALTER TABLE finance.organizations
  ALTER COLUMN currency SET NOT NULL;

ALTER TABLE finance.organizations
  ALTER COLUMN timezone SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_organization_id
  ON finance.organizations (organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_slug
  ON finance.organizations (slug);

CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_subdomain
  ON finance.organizations (subdomain)
  WHERE subdomain IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_organizations_plan
  ON finance.organizations (plan);

CREATE TABLE IF NOT EXISTS finance.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role finance.user_role NOT NULL DEFAULT 'viewer',
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE finance.users
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE finance.users
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_users_organization_id
  ON finance.users (organization_id);

CREATE INDEX IF NOT EXISTS idx_users_organization_role
  ON finance.users (organization_id, role);

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_org_email
  ON finance.users (organization_id, lower(email));

CREATE TABLE IF NOT EXISTS finance.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  key_name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  role finance.user_role NOT NULL DEFAULT 'ops',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMP,
  created_by_user_id UUID REFERENCES finance.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_org_id
  ON finance.api_keys (organization_id);

CREATE INDEX IF NOT EXISTS idx_api_keys_active
  ON finance.api_keys (is_active);

CREATE UNIQUE INDEX IF NOT EXISTS uq_api_keys_org_hash
  ON finance.api_keys (organization_id, key_hash);

CREATE TABLE IF NOT EXISTS finance.ai_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  encrypted_api_key TEXT,
  model TEXT NOT NULL,
  use_system_key BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE finance.ai_providers
  ADD COLUMN IF NOT EXISTS model TEXT;

ALTER TABLE finance.ai_providers
  ADD COLUMN IF NOT EXISTS use_system_key BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE finance.ai_providers
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE finance.ai_providers
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT now();

UPDATE finance.ai_providers
SET model = 'gpt-4o-mini'
WHERE model IS NULL OR length(trim(model)) = 0;

ALTER TABLE finance.ai_providers
  ALTER COLUMN model SET NOT NULL;

ALTER TABLE finance.ai_providers
  ALTER COLUMN encrypted_api_key DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_providers_org
  ON finance.ai_providers (organization_id);

CREATE INDEX IF NOT EXISTS idx_ai_providers_org_active
  ON finance.ai_providers (organization_id, active);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_providers_org_provider
  ON finance.ai_providers (organization_id, provider);

CREATE TABLE IF NOT EXISTS finance.ai_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  key_source TEXT NOT NULL CHECK (key_source IN ('organization', 'system')),
  operation TEXT NOT NULL DEFAULT 'classification',
  tokens_used INTEGER NOT NULL DEFAULT 0 CHECK (tokens_used >= 0),
  estimated_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0 CHECK (estimated_cost_usd >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_org
  ON finance.ai_usage_events (organization_id);

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_org_created_at
  ON finance.ai_usage_events (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS finance.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  type finance.transaction_type NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  category TEXT NOT NULL,
  description TEXT,
  entity TEXT,
  member_id UUID,
  client_id UUID,
  vendor_id UUID,
  editable BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  match_confidence NUMERIC(4, 3),
  match_method TEXT,
  deleted_at TIMESTAMP,
  transaction_date TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE finance.transactions
  ADD COLUMN IF NOT EXISTS member_id UUID;

ALTER TABLE finance.transactions
  ADD COLUMN IF NOT EXISTS client_id UUID;

ALTER TABLE finance.transactions
  ADD COLUMN IF NOT EXISTS vendor_id UUID;

ALTER TABLE finance.transactions
  ADD COLUMN IF NOT EXISTS editable BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE finance.transactions
  ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE finance.transactions
  ADD COLUMN IF NOT EXISTS match_confidence NUMERIC(4, 3);

ALTER TABLE finance.transactions
  ADD COLUMN IF NOT EXISTS match_method TEXT;

ALTER TABLE finance.transactions
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_transactions_org_id
  ON finance.transactions (organization_id);

CREATE INDEX IF NOT EXISTS idx_transactions_date
  ON finance.transactions (transaction_date);

CREATE INDEX IF NOT EXISTS idx_transactions_type
  ON finance.transactions (type);

CREATE INDEX IF NOT EXISTS idx_transactions_org_date
  ON finance.transactions (organization_id, transaction_date);

CREATE INDEX IF NOT EXISTS idx_transactions_org_type
  ON finance.transactions (organization_id, type);

CREATE INDEX IF NOT EXISTS idx_transactions_org_member
  ON finance.transactions (organization_id, member_id);

CREATE INDEX IF NOT EXISTS idx_transactions_org_client
  ON finance.transactions (organization_id, client_id);

CREATE INDEX IF NOT EXISTS idx_transactions_org_vendor
  ON finance.transactions (organization_id, vendor_id);

CREATE INDEX IF NOT EXISTS idx_transactions_org_deleted
  ON finance.transactions (organization_id, deleted_at);

CREATE TABLE IF NOT EXISTS finance.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  uuid_sat TEXT NOT NULL,
  emitter TEXT NOT NULL,
  receiver TEXT NOT NULL,
  total NUMERIC(12, 2) NOT NULL CHECK (total >= 0),
  status finance.invoice_status NOT NULL DEFAULT 'pending',
  invoice_date TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_org_id
  ON finance.invoices (organization_id);

CREATE INDEX IF NOT EXISTS idx_invoices_date
  ON finance.invoices (invoice_date);

DROP INDEX IF EXISTS finance.uq_invoices_uuid_sat;

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_org_uuid_sat
  ON finance.invoices (organization_id, uuid_sat);

CREATE TABLE IF NOT EXISTS finance.bank_statement_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  bank TEXT NOT NULL,
  account_number TEXT,
  period_start DATE,
  period_end DATE,
  file_name TEXT,
  file_size_bytes INTEGER,
  preview_count INTEGER NOT NULL DEFAULT 0 CHECK (preview_count >= 0),
  parsed_transactions JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'preview' CHECK (status IN ('preview', 'confirmed')),
  created_by_user_id UUID REFERENCES finance.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bank_statement_imports_org
  ON finance.bank_statement_imports (organization_id);

CREATE INDEX IF NOT EXISTS idx_bank_statement_imports_status
  ON finance.bank_statement_imports (status);

CREATE INDEX IF NOT EXISTS idx_bank_statement_imports_created_at
  ON finance.bank_statement_imports (created_at DESC);

CREATE TABLE IF NOT EXISTS finance.members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  alias TEXT,
  bank_account_last4 TEXT,
  rfc TEXT,
  salary_estimate FLOAT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE finance.members
  ADD COLUMN IF NOT EXISTS alias TEXT;

ALTER TABLE finance.members
  ADD COLUMN IF NOT EXISTS bank_account_last4 TEXT;

ALTER TABLE finance.members
  ADD COLUMN IF NOT EXISTS rfc TEXT;

ALTER TABLE finance.members
  ADD COLUMN IF NOT EXISTS salary_estimate FLOAT;

ALTER TABLE finance.members
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE finance.members
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_members_org_id
  ON finance.members (organization_id);

CREATE INDEX IF NOT EXISTS idx_members_org_active
  ON finance.members (organization_id, active);

CREATE INDEX IF NOT EXISTS idx_members_org_name
  ON finance.members (organization_id, lower(full_name));

CREATE INDEX IF NOT EXISTS idx_members_org_alias
  ON finance.members (organization_id, lower(alias))
  WHERE alias IS NOT NULL;

CREATE TABLE IF NOT EXISTS finance.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  business_name TEXT,
  email TEXT,
  phone TEXT,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE finance.clients
  ADD COLUMN IF NOT EXISTS business_name TEXT;

ALTER TABLE finance.clients
  ADD COLUMN IF NOT EXISTS email TEXT;

ALTER TABLE finance.clients
  ADD COLUMN IF NOT EXISTS phone TEXT;

ALTER TABLE finance.clients
  ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE finance.clients
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE finance.clients
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT now();

ALTER TABLE finance.clients
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_clients_org
  ON finance.clients (organization_id);

CREATE INDEX IF NOT EXISTS idx_clients_org_active
  ON finance.clients (organization_id, active);

CREATE INDEX IF NOT EXISTS idx_clients_org_name
  ON finance.clients (organization_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_clients_org_business_name
  ON finance.clients (organization_id, lower(business_name))
  WHERE business_name IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'vendor_type'
      AND n.nspname = 'finance'
  ) THEN
    CREATE TYPE finance.vendor_type AS ENUM (
      'ads',
      'software',
      'rent',
      'utilities',
      'payroll',
      'other'
    );
  END IF;
END $$;

ALTER TYPE finance.vendor_type ADD VALUE IF NOT EXISTS 'ads';
ALTER TYPE finance.vendor_type ADD VALUE IF NOT EXISTS 'software';
ALTER TYPE finance.vendor_type ADD VALUE IF NOT EXISTS 'rent';
ALTER TYPE finance.vendor_type ADD VALUE IF NOT EXISTS 'utilities';
ALTER TYPE finance.vendor_type ADD VALUE IF NOT EXISTS 'payroll';
ALTER TYPE finance.vendor_type ADD VALUE IF NOT EXISTS 'other';

CREATE TABLE IF NOT EXISTS finance.vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type finance.vendor_type NOT NULL DEFAULT 'other',
  default_category_id UUID,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE finance.vendors
  ADD COLUMN IF NOT EXISTS type finance.vendor_type NOT NULL DEFAULT 'other';

ALTER TABLE finance.vendors
  ADD COLUMN IF NOT EXISTS default_category_id UUID;

ALTER TABLE finance.vendors
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE finance.vendors
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT now();

ALTER TABLE finance.vendors
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_vendors_org
  ON finance.vendors (organization_id);

CREATE INDEX IF NOT EXISTS idx_vendors_org_active
  ON finance.vendors (organization_id, active);

CREATE INDEX IF NOT EXISTS idx_vendors_org_name
  ON finance.vendors (organization_id, lower(name));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'finance.transactions'::regclass
      AND contype = 'f'
      AND conkey = ARRAY[
        (
          SELECT attnum
          FROM pg_attribute
          WHERE attrelid = 'finance.transactions'::regclass
            AND attname = 'member_id'
            AND NOT attisdropped
          LIMIT 1
        )
      ]::smallint[]
  ) THEN
    ALTER TABLE finance.transactions
      ADD CONSTRAINT fk_transactions_member
      FOREIGN KEY (member_id)
      REFERENCES finance.members(id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_transactions_client'
  ) THEN
    ALTER TABLE finance.transactions
      ADD CONSTRAINT fk_transactions_client
      FOREIGN KEY (client_id)
      REFERENCES finance.clients(id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_transactions_vendor'
  ) THEN
    ALTER TABLE finance.transactions
      ADD CONSTRAINT fk_transactions_vendor
      FOREIGN KEY (vendor_id)
      REFERENCES finance.vendors(id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_transactions_single_entity'
  ) THEN
    ALTER TABLE finance.transactions
      ADD CONSTRAINT chk_transactions_single_entity
      CHECK (num_nonnulls(member_id, client_id, vendor_id) <= 1);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_transactions_match_confidence'
  ) THEN
    ALTER TABLE finance.transactions
      ADD CONSTRAINT chk_transactions_match_confidence
      CHECK (
        match_confidence IS NULL
        OR (match_confidence >= 0 AND match_confidence <= 1)
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_transactions_match_method'
  ) THEN
    ALTER TABLE finance.transactions
      ADD CONSTRAINT chk_transactions_match_method
      CHECK (
        match_method IS NULL
        OR match_method IN ('rule', 'fuzzy', 'manual')
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS finance.transaction_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  keyword_pattern TEXT NOT NULL,
  category_id UUID,
  subcategory_id UUID,
  member_id UUID REFERENCES finance.members(id) ON DELETE SET NULL,
  category_label TEXT,
  subcategory_label TEXT,
  confidence_score FLOAT NOT NULL DEFAULT 1.0,
  times_applied INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE finance.transaction_rules
  ADD COLUMN IF NOT EXISTS category_label TEXT;

ALTER TABLE finance.transaction_rules
  ADD COLUMN IF NOT EXISTS subcategory_label TEXT;

CREATE INDEX IF NOT EXISTS idx_transaction_rules_org
  ON finance.transaction_rules (organization_id);

CREATE INDEX IF NOT EXISTS idx_transaction_rules_org_keyword
  ON finance.transaction_rules (organization_id, keyword_pattern);

CREATE INDEX IF NOT EXISTS idx_transaction_rules_org_member
  ON finance.transaction_rules (organization_id, member_id);

CREATE INDEX IF NOT EXISTS idx_transaction_rules_org_usage
  ON finance.transaction_rules (organization_id, times_applied DESC);

CREATE TABLE IF NOT EXISTS finance.financial_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  year INT NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  scenario finance.planning_scenario NOT NULL DEFAULT 'base',
  name TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_plans_org
  ON finance.financial_plans (organization_id);

CREATE INDEX IF NOT EXISTS idx_financial_plans_org_year
  ON finance.financial_plans (organization_id, year DESC);

CREATE INDEX IF NOT EXISTS idx_financial_plans_org_scenario
  ON finance.financial_plans (organization_id, scenario);

CREATE TABLE IF NOT EXISTS finance.plan_assumptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES finance.financial_plans(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_assumptions_org
  ON finance.plan_assumptions (organization_id);

CREATE INDEX IF NOT EXISTS idx_plan_assumptions_plan
  ON finance.plan_assumptions (plan_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_assumptions_plan_key
  ON finance.plan_assumptions (plan_id, key);

CREATE TABLE IF NOT EXISTS finance.plan_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES finance.financial_plans(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  sales_mix_percent NUMERIC(10, 4),
  unit_price NUMERIC(14, 2),
  unit_cost NUMERIC(14, 2),
  gross_margin_percent NUMERIC(10, 4),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_products_org
  ON finance.plan_products (organization_id);

CREATE INDEX IF NOT EXISTS idx_plan_products_plan
  ON finance.plan_products (plan_id);

CREATE TABLE IF NOT EXISTS finance.plan_monthly_budget (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES finance.financial_plans(id) ON DELETE CASCADE,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  budget_type finance.planning_budget_type NOT NULL,
  group_name TEXT,
  item_name TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_monthly_budget_org
  ON finance.plan_monthly_budget (organization_id);

CREATE INDEX IF NOT EXISTS idx_plan_monthly_budget_plan
  ON finance.plan_monthly_budget (plan_id);

CREATE INDEX IF NOT EXISTS idx_plan_monthly_budget_plan_month
  ON finance.plan_monthly_budget (plan_id, month);

CREATE INDEX IF NOT EXISTS idx_plan_monthly_budget_plan_type
  ON finance.plan_monthly_budget (plan_id, budget_type);

CREATE TABLE IF NOT EXISTS finance.plan_cashflow_monthly (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES finance.financial_plans(id) ON DELETE CASCADE,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  starting_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_inflows NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_outflows NUMERIC(14, 2) NOT NULL DEFAULT 0,
  ending_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_cashflow_monthly_org
  ON finance.plan_cashflow_monthly (organization_id);

CREATE INDEX IF NOT EXISTS idx_plan_cashflow_monthly_plan
  ON finance.plan_cashflow_monthly (plan_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_cashflow_monthly_plan_month
  ON finance.plan_cashflow_monthly (plan_id, month);

CREATE TABLE IF NOT EXISTS finance.plan_investments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES finance.financial_plans(id) ON DELETE CASCADE,
  objective TEXT,
  strategy TEXT,
  planned_date DATE,
  description TEXT,
  amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  funding_source finance.planning_funding_source NOT NULL DEFAULT 'capital',
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_investments_org
  ON finance.plan_investments (organization_id);

CREATE INDEX IF NOT EXISTS idx_plan_investments_plan
  ON finance.plan_investments (plan_id);

CREATE TABLE IF NOT EXISTS finance.plan_loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES finance.financial_plans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  principal NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (principal >= 0),
  annual_interest_rate NUMERIC(10, 4) NOT NULL DEFAULT 0 CHECK (annual_interest_rate >= 0),
  term_months INT NOT NULL CHECK (term_months > 0),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_loans_org
  ON finance.plan_loans (organization_id);

CREATE INDEX IF NOT EXISTS idx_plan_loans_plan
  ON finance.plan_loans (plan_id);

CREATE TABLE IF NOT EXISTS finance.plan_loan_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES finance.financial_plans(id) ON DELETE CASCADE,
  loan_id UUID NOT NULL REFERENCES finance.plan_loans(id) ON DELETE CASCADE,
  month_number INT NOT NULL CHECK (month_number > 0),
  starting_principal NUMERIC(14, 2) NOT NULL DEFAULT 0,
  interest_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  principal_payment NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_payment NUMERIC(14, 2) NOT NULL DEFAULT 0,
  remaining_principal NUMERIC(14, 2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_plan_loan_schedule_org
  ON finance.plan_loan_schedule (organization_id);

CREATE INDEX IF NOT EXISTS idx_plan_loan_schedule_plan
  ON finance.plan_loan_schedule (plan_id);

CREATE INDEX IF NOT EXISTS idx_plan_loan_schedule_loan
  ON finance.plan_loan_schedule (loan_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_loan_schedule_loan_month
  ON finance.plan_loan_schedule (loan_id, month_number);

CREATE TABLE IF NOT EXISTS finance.plan_pnl_annual (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES finance.financial_plans(id) ON DELETE CASCADE,
  year INT NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  revenue NUMERIC(14, 2) NOT NULL DEFAULT 0,
  cogs NUMERIC(14, 2) NOT NULL DEFAULT 0,
  gross_profit NUMERIC(14, 2) NOT NULL DEFAULT 0,
  admin_expenses NUMERIC(14, 2) NOT NULL DEFAULT 0,
  sales_expenses NUMERIC(14, 2) NOT NULL DEFAULT 0,
  financial_expenses NUMERIC(14, 2) NOT NULL DEFAULT 0,
  operating_profit NUMERIC(14, 2) NOT NULL DEFAULT 0,
  taxes NUMERIC(14, 2) NOT NULL DEFAULT 0,
  net_profit NUMERIC(14, 2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_plan_pnl_annual_org
  ON finance.plan_pnl_annual (organization_id);

CREATE INDEX IF NOT EXISTS idx_plan_pnl_annual_plan
  ON finance.plan_pnl_annual (plan_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_pnl_annual_plan_year
  ON finance.plan_pnl_annual (plan_id, year);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'financial_model_scenario'
      AND n.nspname = 'finance'
  ) THEN
    CREATE TYPE finance.financial_model_scenario AS ENUM (
      'Base',
      'Optimistic',
      'Conservative'
    );
  END IF;
END $$;

ALTER TYPE finance.financial_model_scenario ADD VALUE IF NOT EXISTS 'Base';
ALTER TYPE finance.financial_model_scenario ADD VALUE IF NOT EXISTS 'Optimistic';
ALTER TYPE finance.financial_model_scenario ADD VALUE IF NOT EXISTS 'Conservative';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'model_budget_type'
      AND n.nspname = 'finance'
  ) THEN
    CREATE TYPE finance.model_budget_type AS ENUM (
      'income',
      'expense',
      'cost',
      'capex',
      'loan_payment'
    );
  END IF;
END $$;

ALTER TYPE finance.model_budget_type ADD VALUE IF NOT EXISTS 'income';
ALTER TYPE finance.model_budget_type ADD VALUE IF NOT EXISTS 'expense';
ALTER TYPE finance.model_budget_type ADD VALUE IF NOT EXISTS 'cost';
ALTER TYPE finance.model_budget_type ADD VALUE IF NOT EXISTS 'capex';
ALTER TYPE finance.model_budget_type ADD VALUE IF NOT EXISTS 'loan_payment';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'model_funding_source'
      AND n.nspname = 'finance'
  ) THEN
    CREATE TYPE finance.model_funding_source AS ENUM (
      'capital',
      'debt',
      'mixed'
    );
  END IF;
END $$;

ALTER TYPE finance.model_funding_source ADD VALUE IF NOT EXISTS 'capital';
ALTER TYPE finance.model_funding_source ADD VALUE IF NOT EXISTS 'debt';
ALTER TYPE finance.model_funding_source ADD VALUE IF NOT EXISTS 'mixed';

CREATE TABLE IF NOT EXISTS finance.financial_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  scenario finance.financial_model_scenario NOT NULL DEFAULT 'Base',
  start_year INT NOT NULL CHECK (start_year BETWEEN 2000 AND 2100),
  end_year INT NOT NULL CHECK (end_year BETWEEN 2000 AND 2100),
  currency TEXT NOT NULL,
  inflation_rate NUMERIC(12, 6) NOT NULL DEFAULT 0,
  growth_rate NUMERIC(12, 6) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CHECK (end_year >= start_year)
);

CREATE INDEX IF NOT EXISTS idx_financial_models_org
  ON finance.financial_models (organization_id);

CREATE INDEX IF NOT EXISTS idx_financial_models_org_years
  ON finance.financial_models (organization_id, start_year DESC, end_year DESC);

CREATE INDEX IF NOT EXISTS idx_financial_models_org_scenario
  ON finance.financial_models (organization_id, scenario);

CREATE TABLE IF NOT EXISTS finance.model_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  model_id UUID NOT NULL REFERENCES finance.financial_models(id) ON DELETE CASCADE,
  year INT NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  product_code TEXT NOT NULL,
  category TEXT,
  product_name TEXT NOT NULL,
  projected_units NUMERIC(18, 4) NOT NULL DEFAULT 0,
  unit_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_products_org
  ON finance.model_products (organization_id);

CREATE INDEX IF NOT EXISTS idx_model_products_model_year
  ON finance.model_products (model_id, year);

CREATE INDEX IF NOT EXISTS idx_model_products_product_code
  ON finance.model_products (product_code);

CREATE UNIQUE INDEX IF NOT EXISTS uq_model_products_model_year_code
  ON finance.model_products (model_id, year, lower(product_code));

CREATE TABLE IF NOT EXISTS finance.model_income_statements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  model_id UUID NOT NULL REFERENCES finance.financial_models(id) ON DELETE CASCADE,
  year INT NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  revenue NUMERIC(14, 2) NOT NULL DEFAULT 0,
  cogs NUMERIC(14, 2) NOT NULL DEFAULT 0,
  admin_expenses NUMERIC(14, 2) NOT NULL DEFAULT 0,
  sales_expenses NUMERIC(14, 2) NOT NULL DEFAULT 0,
  financial_expenses NUMERIC(14, 2) NOT NULL DEFAULT 0,
  taxes NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_income_statements_org
  ON finance.model_income_statements (organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_model_income_statements_model_year
  ON finance.model_income_statements (model_id, year);

CREATE TABLE IF NOT EXISTS finance.model_monthly_budget (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  model_id UUID NOT NULL REFERENCES finance.financial_models(id) ON DELETE CASCADE,
  year INT NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  type finance.model_budget_type NOT NULL,
  category TEXT,
  item TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_monthly_budget_org
  ON finance.model_monthly_budget (organization_id);

CREATE INDEX IF NOT EXISTS idx_model_monthly_budget_model_year_month
  ON finance.model_monthly_budget (model_id, year, month);

CREATE INDEX IF NOT EXISTS idx_model_monthly_budget_model_type
  ON finance.model_monthly_budget (model_id, type);

CREATE TABLE IF NOT EXISTS finance.model_cashflow (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  model_id UUID NOT NULL REFERENCES finance.financial_models(id) ON DELETE CASCADE,
  year INT NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  starting_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  manual_inflows NUMERIC(14, 2) NOT NULL DEFAULT 0,
  manual_outflows NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_cashflow_org
  ON finance.model_cashflow (organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_model_cashflow_model_year_month
  ON finance.model_cashflow (model_id, year, month);

CREATE TABLE IF NOT EXISTS finance.model_investments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  model_id UUID NOT NULL REFERENCES finance.financial_models(id) ON DELETE CASCADE,
  year INT NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  objective TEXT,
  description TEXT,
  planned_date DATE,
  amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  funding_source finance.model_funding_source NOT NULL DEFAULT 'capital',
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_investments_org
  ON finance.model_investments (organization_id);

CREATE INDEX IF NOT EXISTS idx_model_investments_model
  ON finance.model_investments (model_id);

CREATE TABLE IF NOT EXISTS finance.model_loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  model_id UUID NOT NULL REFERENCES finance.financial_models(id) ON DELETE CASCADE,
  loan_name TEXT NOT NULL,
  principal NUMERIC(14, 2) NOT NULL CHECK (principal >= 0),
  annual_interest_rate NUMERIC(12, 6) NOT NULL CHECK (annual_interest_rate >= 0),
  term_months INT NOT NULL CHECK (term_months > 0),
  start_year INT NOT NULL CHECK (start_year BETWEEN 2000 AND 2100),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_loans_org
  ON finance.model_loans (organization_id);

CREATE INDEX IF NOT EXISTS idx_model_loans_model
  ON finance.model_loans (model_id);

CREATE TABLE IF NOT EXISTS finance.model_loan_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  model_id UUID NOT NULL REFERENCES finance.financial_models(id) ON DELETE CASCADE,
  loan_id UUID NOT NULL REFERENCES finance.model_loans(id) ON DELETE CASCADE,
  payment_number INT NOT NULL CHECK (payment_number > 0),
  payment_date DATE NOT NULL,
  principal_payment NUMERIC(14, 2) NOT NULL DEFAULT 0,
  interest_payment NUMERIC(14, 2) NOT NULL DEFAULT 0,
  remaining_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_loan_schedule_org
  ON finance.model_loan_schedule (organization_id);

CREATE INDEX IF NOT EXISTS idx_model_loan_schedule_model
  ON finance.model_loan_schedule (model_id);

CREATE INDEX IF NOT EXISTS idx_model_loan_schedule_loan
  ON finance.model_loan_schedule (loan_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_model_loan_schedule_loan_payment
  ON finance.model_loan_schedule (loan_id, payment_number);

CREATE TABLE IF NOT EXISTS finance.financial_model_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  model_id UUID NOT NULL REFERENCES finance.financial_models(id) ON DELETE CASCADE,
  version INT NOT NULL CHECK (version > 0),
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_model_snapshots_org
  ON finance.financial_model_snapshots (organization_id);

CREATE INDEX IF NOT EXISTS idx_financial_model_snapshots_model_version
  ON finance.financial_model_snapshots (model_id, version DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_model_snapshots_model_version
  ON finance.financial_model_snapshots (model_id, version);

INSERT INTO finance.financial_models (
  id,
  organization_id,
  name,
  scenario,
  start_year,
  end_year,
  currency,
  inflation_rate,
  growth_rate,
  created_at,
  updated_at
)
SELECT
  fp.id,
  fp.organization_id,
  fp.name,
  CASE fp.scenario::text
    WHEN 'optimistic' THEN 'Optimistic'::finance.financial_model_scenario
    WHEN 'conservative' THEN 'Conservative'::finance.financial_model_scenario
    ELSE 'Base'::finance.financial_model_scenario
  END AS scenario,
  fp.year,
  fp.year,
  'MXN',
  0,
  0,
  fp.created_at,
  fp.updated_at
FROM finance.financial_plans fp
LEFT JOIN finance.financial_models fm ON fm.id = fp.id
WHERE fm.id IS NULL;

INSERT INTO finance.model_products (
  id,
  organization_id,
  model_id,
  year,
  product_code,
  category,
  product_name,
  projected_units,
  unit_price,
  unit_cost,
  created_at
)
SELECT
  pp.id,
  pp.organization_id,
  pp.plan_id,
  fp.year,
  CONCAT('LEGACY-', SUBSTRING(pp.id::text FROM 1 FOR 8)),
  NULL,
  pp.product_name,
  0,
  COALESCE(pp.unit_price, 0),
  COALESCE(pp.unit_cost, 0),
  pp.created_at
FROM finance.plan_products pp
JOIN finance.financial_plans fp ON fp.id = pp.plan_id
JOIN finance.financial_models fm ON fm.id = pp.plan_id
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.model_income_statements (
  id,
  organization_id,
  model_id,
  year,
  revenue,
  cogs,
  admin_expenses,
  sales_expenses,
  financial_expenses,
  taxes,
  created_at
)
SELECT
  ppa.id,
  ppa.organization_id,
  ppa.plan_id,
  ppa.year,
  COALESCE(ppa.revenue, 0),
  COALESCE(ppa.cogs, 0),
  COALESCE(ppa.admin_expenses, 0),
  COALESCE(ppa.sales_expenses, 0),
  COALESCE(ppa.financial_expenses, 0),
  COALESCE(ppa.taxes, 0),
  now()
FROM finance.plan_pnl_annual ppa
JOIN finance.financial_models fm ON fm.id = ppa.plan_id
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.model_monthly_budget (
  id,
  organization_id,
  model_id,
  year,
  month,
  type,
  category,
  item,
  amount,
  created_at
)
SELECT
  pmb.id,
  pmb.organization_id,
  pmb.plan_id,
  fp.year,
  pmb.month,
  pmb.budget_type::text::finance.model_budget_type,
  pmb.group_name,
  pmb.item_name,
  COALESCE(pmb.amount, 0),
  pmb.created_at
FROM finance.plan_monthly_budget pmb
JOIN finance.financial_plans fp ON fp.id = pmb.plan_id
JOIN finance.financial_models fm ON fm.id = pmb.plan_id
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.model_cashflow (
  id,
  organization_id,
  model_id,
  year,
  month,
  starting_balance,
  manual_inflows,
  manual_outflows,
  created_at
)
SELECT
  pcm.id,
  pcm.organization_id,
  pcm.plan_id,
  fp.year,
  pcm.month,
  COALESCE(pcm.starting_balance, 0),
  COALESCE(pcm.total_inflows, 0),
  COALESCE(pcm.total_outflows, 0),
  pcm.created_at
FROM finance.plan_cashflow_monthly pcm
JOIN finance.financial_plans fp ON fp.id = pcm.plan_id
JOIN finance.financial_models fm ON fm.id = pcm.plan_id
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.model_investments (
  id,
  organization_id,
  model_id,
  year,
  objective,
  description,
  planned_date,
  amount,
  funding_source,
  created_at
)
SELECT
  pi.id,
  pi.organization_id,
  pi.plan_id,
  COALESCE(EXTRACT(YEAR FROM pi.planned_date)::int, fp.year),
  pi.objective,
  pi.description,
  pi.planned_date,
  COALESCE(pi.amount, 0),
  pi.funding_source::text::finance.model_funding_source,
  pi.created_at
FROM finance.plan_investments pi
JOIN finance.financial_plans fp ON fp.id = pi.plan_id
JOIN finance.financial_models fm ON fm.id = pi.plan_id
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.model_loans (
  id,
  organization_id,
  model_id,
  loan_name,
  principal,
  annual_interest_rate,
  term_months,
  start_year,
  created_at
)
SELECT
  pl.id,
  pl.organization_id,
  pl.plan_id,
  pl.name,
  COALESCE(pl.principal, 0),
  COALESCE(pl.annual_interest_rate, 0),
  pl.term_months,
  fp.year,
  pl.created_at
FROM finance.plan_loans pl
JOIN finance.financial_plans fp ON fp.id = pl.plan_id
JOIN finance.financial_models fm ON fm.id = pl.plan_id
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.model_loan_schedule (
  id,
  organization_id,
  model_id,
  loan_id,
  payment_number,
  payment_date,
  principal_payment,
  interest_payment,
  remaining_balance,
  created_at
)
SELECT
  pls.id,
  pls.organization_id,
  ml.model_id,
  pls.loan_id,
  pls.month_number,
  (make_date(ml.start_year, 1, 1) + ((pls.month_number - 1) * interval '1 month'))::date,
  COALESCE(pls.principal_payment, 0),
  COALESCE(pls.interest_amount, 0),
  COALESCE(pls.remaining_principal, 0),
  now()
FROM finance.plan_loan_schedule pls
JOIN finance.model_loans ml ON ml.id = pls.loan_id
JOIN finance.financial_models fm ON fm.id = ml.model_id
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.financial_model_snapshots (
  organization_id,
  model_id,
  version,
  snapshot,
  created_at
)
SELECT
  pa.organization_id,
  pa.plan_id,
  1,
  jsonb_build_object(
    'legacy', true,
    'source', 'plan_assumptions',
    'key', pa.key,
    'value', pa.value
  ),
  pa.created_at
FROM finance.plan_assumptions pa
JOIN finance.financial_models fm ON fm.id = pa.plan_id
WHERE pa.key = 'import_snapshot'
ON CONFLICT (model_id, version) DO NOTHING;

INSERT INTO finance.financial_model_snapshots (
  organization_id,
  model_id,
  version,
  snapshot,
  created_at
)
SELECT
  fm.organization_id,
  fm.id,
  1,
  jsonb_build_object(
    'legacy', true,
    'source', 'financial_models',
    'message', 'Auto-generated migration snapshot'
  ),
  fm.created_at
FROM finance.financial_models fm
LEFT JOIN finance.financial_model_snapshots fms
  ON fms.model_id = fm.id
  AND fms.version = 1
WHERE fms.id IS NULL
ON CONFLICT (model_id, version) DO NOTHING;

-- Dynamic input-based financial planning engine (VERIDIS_Input_Based_Template_642.xlsx)
ALTER TABLE finance.financial_plans
  DROP CONSTRAINT IF EXISTS financial_plans_year_check;

ALTER TABLE finance.financial_plans
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES finance.users(id) ON DELETE SET NULL;

ALTER TABLE finance.financial_plans
  ADD COLUMN IF NOT EXISTS plan_name TEXT;

ALTER TABLE finance.financial_plans
  ADD COLUMN IF NOT EXISTS start_year INT;

ALTER TABLE finance.financial_plans
  ADD COLUMN IF NOT EXISTS end_year INT;

ALTER TABLE finance.financial_plans
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT now();

UPDATE finance.financial_plans
SET plan_name = COALESCE(NULLIF(trim(plan_name), ''), NULLIF(trim(name), ''), concat('Plan ', year::text))
WHERE plan_name IS NULL OR length(trim(plan_name)) = 0;

UPDATE finance.financial_plans
SET start_year = COALESCE(start_year, year)
WHERE start_year IS NULL;

UPDATE finance.financial_plans
SET end_year = COALESCE(end_year, start_year, year)
WHERE end_year IS NULL;

ALTER TABLE finance.financial_plans
  ALTER COLUMN plan_name SET NOT NULL;

ALTER TABLE finance.financial_plans
  ALTER COLUMN start_year SET NOT NULL;

ALTER TABLE finance.financial_plans
  ALTER COLUMN end_year SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_financial_plans_year_range_dynamic'
  ) THEN
    ALTER TABLE finance.financial_plans
      ADD CONSTRAINT chk_financial_plans_year_range_dynamic
      CHECK (end_year >= start_year);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_financial_plans_org_start_end
  ON finance.financial_plans (organization_id, start_year, end_year);

CREATE INDEX IF NOT EXISTS idx_financial_plans_user
  ON finance.financial_plans (user_id);

CREATE TABLE IF NOT EXISTS finance.financial_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES finance.financial_plans(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  monthly_price NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (monthly_price >= 0),
  monthly_cost NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (monthly_cost >= 0),
  growth_rate_percent NUMERIC(10, 4) NOT NULL DEFAULT 0,
  category TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_products_org
  ON finance.financial_products (organization_id);

CREATE INDEX IF NOT EXISTS idx_financial_products_plan
  ON finance.financial_products (plan_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_products_plan_name_category
  ON finance.financial_products (plan_id, lower(product_name), COALESCE(lower(category), ''));

CREATE TABLE IF NOT EXISTS finance.financial_fixed_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES finance.financial_plans(id) ON DELETE CASCADE,
  cost_name TEXT NOT NULL,
  monthly_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (monthly_amount >= 0),
  annual_growth_percent NUMERIC(10, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_fixed_costs_org
  ON finance.financial_fixed_costs (organization_id);

CREATE INDEX IF NOT EXISTS idx_financial_fixed_costs_plan
  ON finance.financial_fixed_costs (plan_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_fixed_costs_plan_name
  ON finance.financial_fixed_costs (plan_id, lower(cost_name));

CREATE TABLE IF NOT EXISTS finance.financial_variables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES finance.financial_plans(id) ON DELETE CASCADE,
  variable_key TEXT NOT NULL,
  variable_value JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_variables_org
  ON finance.financial_variables (organization_id);

CREATE INDEX IF NOT EXISTS idx_financial_variables_plan
  ON finance.financial_variables (plan_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_variables_plan_key
  ON finance.financial_variables (plan_id, lower(variable_key));

CREATE TABLE IF NOT EXISTS finance.financial_year_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES finance.financial_plans(id) ON DELETE CASCADE,
  year INT NOT NULL,
  total_revenue NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_cost NUMERIC(14, 2) NOT NULL DEFAULT 0,
  gross_profit NUMERIC(14, 2) NOT NULL DEFAULT 0,
  net_profit NUMERIC(14, 2) NOT NULL DEFAULT 0,
  margin_percent NUMERIC(10, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_year_results_org
  ON finance.financial_year_results (organization_id);

CREATE INDEX IF NOT EXISTS idx_financial_year_results_plan
  ON finance.financial_year_results (plan_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_year_results_plan_year
  ON finance.financial_year_results (plan_id, year);

INSERT INTO finance.financial_plans (
  id,
  organization_id,
  user_id,
  plan_name,
  start_year,
  end_year,
  name,
  year,
  scenario,
  created_at,
  updated_at
)
SELECT
  fm.id,
  fm.organization_id,
  NULL,
  fm.name,
  fm.start_year,
  fm.end_year,
  fm.name,
  fm.start_year,
  'base'::finance.planning_scenario,
  fm.created_at,
  fm.updated_at
FROM finance.financial_models fm
LEFT JOIN finance.financial_plans fp ON fp.id = fm.id
WHERE fp.id IS NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.financial_products (
  id,
  organization_id,
  plan_id,
  product_name,
  monthly_price,
  monthly_cost,
  growth_rate_percent,
  category,
  created_at,
  updated_at
)
SELECT
  mp.id,
  mp.organization_id,
  mp.model_id,
  COALESCE(mp.product_name, mp.product_code, 'Product'),
  COALESCE(mp.unit_price, 0),
  COALESCE(mp.unit_cost, 0),
  0,
  mp.category,
  mp.created_at,
  mp.created_at
FROM finance.model_products mp
JOIN finance.financial_plans fp ON fp.id = mp.model_id
WHERE mp.year = fp.start_year
ON CONFLICT DO NOTHING;

INSERT INTO finance.financial_fixed_costs (
  organization_id,
  plan_id,
  cost_name,
  monthly_amount,
  annual_growth_percent,
  created_at,
  updated_at
)
SELECT
  mb.organization_id,
  mb.model_id,
  COALESCE(mb.item, 'Fixed Cost'),
  COALESCE(AVG(mb.amount), 0)::numeric(14, 2),
  0,
  MIN(mb.created_at),
  MIN(mb.created_at)
FROM finance.model_monthly_budget mb
JOIN finance.financial_plans fp ON fp.id = mb.model_id
WHERE mb.type = 'expense'::finance.model_budget_type
  AND mb.year = fp.start_year
GROUP BY mb.organization_id, mb.model_id, COALESCE(mb.item, 'Fixed Cost')
ON CONFLICT DO NOTHING;

INSERT INTO finance.financial_variables (
  organization_id,
  plan_id,
  variable_key,
  variable_value,
  created_at,
  updated_at
)
SELECT
  pa.organization_id,
  pa.plan_id,
  pa.key,
  pa.value,
  pa.created_at,
  pa.created_at
FROM finance.plan_assumptions pa
JOIN finance.financial_plans fp ON fp.id = pa.plan_id
ON CONFLICT DO NOTHING;

INSERT INTO finance.financial_year_results (
  organization_id,
  plan_id,
  year,
  total_revenue,
  total_cost,
  gross_profit,
  net_profit,
  margin_percent,
  created_at,
  updated_at
)
SELECT
  mis.organization_id,
  mis.model_id,
  mis.year,
  COALESCE(mis.revenue, 0),
  (
    COALESCE(mis.cogs, 0) +
    COALESCE(mis.admin_expenses, 0) +
    COALESCE(mis.sales_expenses, 0) +
    COALESCE(mis.financial_expenses, 0)
  )::numeric(14, 2),
  (COALESCE(mis.revenue, 0) - COALESCE(mis.cogs, 0))::numeric(14, 2),
  (
    COALESCE(mis.revenue, 0) -
    COALESCE(mis.cogs, 0) -
    COALESCE(mis.admin_expenses, 0) -
    COALESCE(mis.sales_expenses, 0) -
    COALESCE(mis.financial_expenses, 0) -
    COALESCE(mis.taxes, 0)
  )::numeric(14, 2),
  CASE
    WHEN COALESCE(mis.revenue, 0) = 0 THEN 0
    ELSE (
      (
        COALESCE(mis.revenue, 0) -
        COALESCE(mis.cogs, 0) -
        COALESCE(mis.admin_expenses, 0) -
        COALESCE(mis.sales_expenses, 0) -
        COALESCE(mis.financial_expenses, 0) -
        COALESCE(mis.taxes, 0)
      ) / COALESCE(NULLIF(mis.revenue, 0), 1)
    ) * 100
  END,
  mis.created_at,
  mis.created_at
FROM finance.model_income_statements mis
JOIN finance.financial_plans fp ON fp.id = mis.model_id
ON CONFLICT (plan_id, year) DO NOTHING;

-- Input-based planning schema hardening (VERIDIS_Input_Based_Template_642.xlsx)
ALTER TABLE finance.financial_plans
  ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(10, 4) NOT NULL DEFAULT 0;

ALTER TABLE finance.financial_plans
  ADD COLUMN IF NOT EXISTS inflation NUMERIC(10, 4) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_financial_plans_year_range_max_20'
  ) THEN
    ALTER TABLE finance.financial_plans
      ADD CONSTRAINT chk_financial_plans_year_range_max_20
      CHECK ((end_year - start_year + 1) <= 20);
  END IF;
END $$;

ALTER TABLE finance.financial_products
  ADD COLUMN IF NOT EXISTS base_monthly_units NUMERIC(14, 2) NOT NULL DEFAULT 0;

ALTER TABLE finance.financial_products
  ADD COLUMN IF NOT EXISTS price NUMERIC(14, 2) NOT NULL DEFAULT 0;

ALTER TABLE finance.financial_products
  ADD COLUMN IF NOT EXISTS growth_percent_annual NUMERIC(10, 4) NOT NULL DEFAULT 0;

ALTER TABLE finance.financial_products
  ADD COLUMN IF NOT EXISTS cogs_percent NUMERIC(10, 4) NOT NULL DEFAULT 0;

ALTER TABLE finance.financial_products
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

UPDATE finance.financial_products
SET
  price = COALESCE(price, monthly_price, 0),
  growth_percent_annual = COALESCE(growth_percent_annual, growth_rate_percent, 0),
  cogs_percent = CASE
    WHEN COALESCE(price, monthly_price, 0) > 0
      THEN (COALESCE(monthly_cost, 0) / COALESCE(price, monthly_price, 1)) * 100
    ELSE COALESCE(cogs_percent, 0)
  END,
  active = COALESCE(active, true)
WHERE
  price IS NULL
  OR growth_percent_annual IS NULL
  OR cogs_percent IS NULL
  OR active IS NULL;

ALTER TABLE finance.financial_fixed_costs
  ADD COLUMN IF NOT EXISTS category TEXT;

ALTER TABLE finance.financial_fixed_costs
  ADD COLUMN IF NOT EXISTS growth_percent_annual NUMERIC(10, 4) NOT NULL DEFAULT 0;

ALTER TABLE finance.financial_fixed_costs
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

UPDATE finance.financial_fixed_costs
SET
  growth_percent_annual = COALESCE(growth_percent_annual, annual_growth_percent, 0),
  active = COALESCE(active, true)
WHERE growth_percent_annual IS NULL OR active IS NULL;

DROP INDEX IF EXISTS finance.uq_financial_products_plan_name_category;
DROP INDEX IF EXISTS finance.uq_financial_fixed_costs_plan_name;

CREATE INDEX IF NOT EXISTS idx_financial_products_plan_active
  ON finance.financial_products (plan_id, active);

CREATE INDEX IF NOT EXISTS idx_financial_fixed_costs_plan_active
  ON finance.financial_fixed_costs (plan_id, active);
