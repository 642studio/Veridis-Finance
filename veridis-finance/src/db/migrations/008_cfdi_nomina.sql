-- 008_cfdi_nomina.sql
-- Allow CFDI de Nómina ('N') in the documents lifecycle. Idempotent.

ALTER TABLE finance.cfdi_documents DROP CONSTRAINT IF EXISTS cfdi_documents_cfdi_type_check;
ALTER TABLE finance.cfdi_documents ADD CONSTRAINT cfdi_documents_cfdi_type_check
  CHECK (cfdi_type IN ('I', 'E', 'P', 'N'));
