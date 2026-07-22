-- 022_client_requires_invoice.sql
-- No todo lo que se vende necesita CFDI: hay ventas cobradas "sin factura"
-- (público en general, anticipos, cobros por CRM/Stripe). Esas NO son cartera
-- por cobrar. Marca a nivel cliente si requiere factura (default true).
-- Idempotente.

ALTER TABLE finance.clients
  ADD COLUMN IF NOT EXISTS requires_invoice boolean NOT NULL DEFAULT true;
