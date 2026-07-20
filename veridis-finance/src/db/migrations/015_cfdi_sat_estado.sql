-- 015_cfdi_sat_estado.sql
-- Validación automática de comprobantes (paridad Siigo): estatus del CFDI
-- ante el SAT (Vigente / Cancelado / No Encontrado) vía el servicio público
-- ConsultaCFDI, con marca de tiempo de la última verificación. Idempotente.

ALTER TABLE finance.invoices
  ADD COLUMN IF NOT EXISTS sat_estado TEXT,                    -- Vigente | Cancelado | No Encontrado
  ADD COLUMN IF NOT EXISTS sat_estado_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sat_es_cancelable TEXT,
  ADD COLUMN IF NOT EXISTS sat_estatus_cancelacion TEXT;

CREATE INDEX IF NOT EXISTS invoices_sat_estado_idx
  ON finance.invoices (organization_id, sat_estado);
