-- 010_invoice_cfdi_link.sql
-- Make finance.invoices the single canonical ledger of ALL fiscal documents.
-- Until now issued CFDIs lived only in cfdi_documents and PAC-received invoices
-- were never persisted, so neither was reconcilable (reconciliation only queries
-- finance.invoices). This links a mirrored invoice back to its CFDI and records
-- where it came from. Idempotent.

ALTER TABLE finance.invoices
  ADD COLUMN IF NOT EXISTS cfdi_document_id UUID
    REFERENCES finance.cfdi_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'upload';

ALTER TABLE finance.invoices DROP CONSTRAINT IF EXISTS invoices_source_check;
ALTER TABLE finance.invoices ADD CONSTRAINT invoices_source_check
  CHECK (source IN ('upload', 'issued_cfdi', 'pac_received', 'crm'));

CREATE INDEX IF NOT EXISTS idx_invoices_cfdi_document
  ON finance.invoices (cfdi_document_id)
  WHERE cfdi_document_id IS NOT NULL;
