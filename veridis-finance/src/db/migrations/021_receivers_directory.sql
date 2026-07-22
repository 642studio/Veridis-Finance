-- 021_receivers_directory.sql
-- Permite sembrar el directorio fiscal de receptores desde las facturas emitidas
-- ANTES de tener su Constancia (CSF). Un receptor recién sembrado no tiene aún
-- régimen ni CP: se llenan cuando el cliente sube su CSF por el link de
-- autoservicio. Además agrega el índice único que el upsert (ON CONFLICT
-- (organization_id, rfc)) necesitaba y no existía. Idempotente.

-- Índice único para el upsert por (organización, RFC).
CREATE UNIQUE INDEX IF NOT EXISTS cfdi_receivers_org_rfc_uidx
  ON finance.cfdi_receivers (organization_id, rfc);

-- Régimen y CP quedan opcionales (pendientes hasta la CSF).
ALTER TABLE finance.cfdi_receivers ALTER COLUMN fiscal_regime DROP NOT NULL;
ALTER TABLE finance.cfdi_receivers ALTER COLUMN zip_code DROP NOT NULL;

-- 'invoice' es una provenencia válida (receptor sembrado desde una factura).
ALTER TABLE finance.cfdi_receivers DROP CONSTRAINT IF EXISTS cfdi_receivers_source_check;
ALTER TABLE finance.cfdi_receivers ADD CONSTRAINT cfdi_receivers_source_check
  CHECK (source = ANY (ARRAY['csf','manual','ghl','invoice']));
