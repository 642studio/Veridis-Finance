-- 024_reconciliation_indexes.sql
-- Índices para las columnas calientes de conciliación que faltaban:
--  - receiver_rfc: reconcileByClient agrupa facturas por RFC del receptor.
--  - payment_reference: reviewList/unmatch/cancel filtran por 'bank_txn:<id>'.
--  - (org, direction, status): cartera y aging filtran emitidas pendientes.
-- Idempotente.

CREATE INDEX IF NOT EXISTS idx_invoices_org_receiver_rfc
  ON finance.invoices (organization_id, receiver_rfc)
  WHERE receiver_rfc IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_payment_reference
  ON finance.invoices (payment_reference)
  WHERE payment_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_org_direction_status
  ON finance.invoices (organization_id, direction, status);
