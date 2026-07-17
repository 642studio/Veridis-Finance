-- 009_invoice_direction.sql
-- Distinguish EMITTED vs RECEIVED uploaded CFDIs. Without this, bulk-importing
-- a full SAT history mixes both and the org's own RFC pollutes DIOT as a
-- "supplier". Direction is derived at upload time by comparing the XML's
-- emitter RFC against the org's fiscal issuer RFC. Idempotent.

ALTER TABLE finance.invoices
  ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'received';

ALTER TABLE finance.invoices DROP CONSTRAINT IF EXISTS invoices_direction_check;
ALTER TABLE finance.invoices ADD CONSTRAINT invoices_direction_check
  CHECK (direction IN ('received', 'issued'));

CREATE INDEX IF NOT EXISTS idx_invoices_org_direction
  ON finance.invoices (organization_id, direction);
