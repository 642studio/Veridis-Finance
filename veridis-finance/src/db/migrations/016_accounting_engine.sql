-- 016_accounting_engine.sql
-- Motor de contabilidad de partida doble (paridad COI/Contpaqi). Idempotente.
--
--   * chart_of_accounts  catálogo de cuentas con código agrupador del SAT y
--                        naturaleza (deudora/acreedora); jerarquía por parent.
--   * accounting_periods periodos contables con estado abierto/cerrado.
--   * journal_entries    pólizas (Ingreso/Egreso/Diario), con folio y estatus.
--   * journal_lines      partidas (cargo/abono) — el asiento balanceado.
--
-- Invariante cargo=abono se valida en la capa de servicio dentro de una
-- transacción; aquí garantizamos que cada partida sea cargo XOR abono.

CREATE TABLE IF NOT EXISTS finance.chart_of_accounts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  code             TEXT NOT NULL,                 -- número de cuenta (p.ej. 102.01)
  name             TEXT NOT NULL,
  account_type     TEXT NOT NULL CHECK (account_type IN
                     ('activo','pasivo','capital','ingreso','costo','gasto','orden')),
  nature           TEXT NOT NULL CHECK (nature IN ('deudora','acreedora')),
  sat_grouping_code TEXT,                          -- código agrupador SAT (Anexo 24)
  parent_id        UUID REFERENCES finance.chart_of_accounts(id) ON DELETE SET NULL,
  level            INTEGER NOT NULL DEFAULT 1,
  is_postable      BOOLEAN NOT NULL DEFAULT TRUE,  -- solo cuentas de detalle reciben movimientos
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS coa_org_idx ON finance.chart_of_accounts (organization_id, code);

CREATE TABLE IF NOT EXISTS finance.accounting_periods (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  year             INTEGER NOT NULL,
  month            INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_at        TIMESTAMPTZ,
  UNIQUE (organization_id, year, month)
);

CREATE TABLE IF NOT EXISTS finance.journal_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  folio            INTEGER NOT NULL,
  entry_type       TEXT NOT NULL CHECK (entry_type IN ('ingreso','egreso','diario')),
  entry_date       DATE NOT NULL,
  concept          TEXT NOT NULL,
  period_year      INTEGER NOT NULL,
  period_month     INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('draft','posted','canceled')),
  source           TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','cfdi','bank','nomina','depreciation','closing')),
  source_ref       TEXT,
  total_debit      NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_credit     NUMERIC(18,2) NOT NULL DEFAULT 0,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  canceled_at      TIMESTAMPTZ,
  UNIQUE (organization_id, folio)
);

CREATE INDEX IF NOT EXISTS je_org_period_idx
  ON finance.journal_entries (organization_id, period_year, period_month, entry_date);

-- Idempotencia de pólizas automáticas por documento origen.
CREATE UNIQUE INDEX IF NOT EXISTS je_source_idx
  ON finance.journal_entries (organization_id, source, source_ref)
  WHERE source_ref IS NOT NULL AND source <> 'manual';

CREATE TABLE IF NOT EXISTS finance.journal_lines (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  entry_id         UUID NOT NULL REFERENCES finance.journal_entries(id) ON DELETE CASCADE,
  account_id       UUID NOT NULL REFERENCES finance.chart_of_accounts(id),
  debit            NUMERIC(18,2) NOT NULL DEFAULT 0,
  credit           NUMERIC(18,2) NOT NULL DEFAULT 0,
  description      TEXT,
  cfdi_uuid        TEXT,
  line_no          INTEGER NOT NULL DEFAULT 1,
  CHECK (debit >= 0 AND credit >= 0),
  CHECK (NOT (debit > 0 AND credit > 0))          -- cargo XOR abono
);

CREATE INDEX IF NOT EXISTS jl_entry_idx ON finance.journal_lines (entry_id);
CREATE INDEX IF NOT EXISTS jl_account_idx ON finance.journal_lines (organization_id, account_id);

-- Reglas de mapeo concepto/categoría/CFDI -> cuenta (para pólizas automáticas, S9).
CREATE TABLE IF NOT EXISTS finance.accounting_rules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  match_type       TEXT NOT NULL CHECK (match_type IN ('category','keyword','cfdi_use','default_income','default_expense')),
  match_value      TEXT,
  account_id       UUID NOT NULL REFERENCES finance.chart_of_accounts(id) ON DELETE CASCADE,
  times_applied    INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, match_type, match_value)
);
