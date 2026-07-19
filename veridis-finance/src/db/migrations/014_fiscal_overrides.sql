-- 014_fiscal_overrides.sql
-- Per-CFDI include/exclude overrides for the IVA/ISR cash-flow reconciliation
-- (the "No considerar IVA" toggle in Siigo Fiscal). Idempotent.

CREATE TABLE IF NOT EXISTS finance.fiscal_overrides (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  uuid             TEXT NOT NULL,          -- CFDI folio fiscal
  excluded         BOOLEAN NOT NULL DEFAULT TRUE,
  reason           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, uuid)
);
