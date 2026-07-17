-- 007_invoice_fiscal_fields.sql
-- Structured fiscal fields on received invoices. The CFDI parser already
-- extracts RFCs, taxes and concepts, but invoices only stored "RFC - Nombre"
-- strings — useless for DIOT (IVA by supplier RFC) and reconciliation.
-- Idempotent.

ALTER TABLE finance.invoices
  ADD COLUMN IF NOT EXISTS emitter_rfc TEXT,
  ADD COLUMN IF NOT EXISTS receiver_rfc TEXT,
  ADD COLUMN IF NOT EXISTS subtotal NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS currency TEXT,
  ADD COLUMN IF NOT EXISTS comprobante_type TEXT,
  ADD COLUMN IF NOT EXISTS forma_pago TEXT,
  ADD COLUMN IF NOT EXISTS metodo_pago TEXT,
  ADD COLUMN IF NOT EXISTS taxes JSONB,
  ADD COLUMN IF NOT EXISTS concepts JSONB;

CREATE INDEX IF NOT EXISTS idx_invoices_org_emitter_rfc
  ON finance.invoices (organization_id, emitter_rfc)
  WHERE emitter_rfc IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_org_invoice_date
  ON finance.invoices (organization_id, invoice_date);
