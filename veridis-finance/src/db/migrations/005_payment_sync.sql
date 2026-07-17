-- 005_payment_sync.sql
-- Two-way payment reconciliation between Veridis and the 642 CRM (GHL).
--
--   * ghl_invoice_id  links a Veridis-issued CFDI to the invoice we create in
--     the CRM (Veridis -> CRM), so a later CRM payment can be matched back.
--   * ghl_contact_id  the CRM contact the CFDI belongs to (for write-back).
--   * payment_status / paid_at / paid_source  the reconciled payment state. A
--     CFDI is only "paid" once it's marked paid in Veridis OR in the CRM.
-- Idempotent and safe to run repeatedly.

ALTER TABLE finance.cfdi_documents
  ADD COLUMN IF NOT EXISTS ghl_invoice_id TEXT,
  ADD COLUMN IF NOT EXISTS ghl_contact_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'paid')),
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_source TEXT
    CHECK (paid_source IN ('veridis', 'crm'));

-- Match an incoming CRM payment webhook back to a Veridis-originated CFDI.
CREATE INDEX IF NOT EXISTS cfdi_documents_ghl_invoice_idx
  ON finance.cfdi_documents (organization_id, ghl_invoice_id)
  WHERE ghl_invoice_id IS NOT NULL;
