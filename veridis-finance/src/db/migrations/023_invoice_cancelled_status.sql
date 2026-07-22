-- 023_invoice_cancelled_status.sql
-- migrate:no-transaction
-- Agrega el estado 'cancelled' al enum invoice_status para poder CANCELAR
-- recibos (los del CRM que no requieren CFDI). ALTER TYPE ADD VALUE no puede
-- correr dentro de una transacción, por eso el marcador de arriba. Idempotente
-- vía IF NOT EXISTS.

ALTER TYPE finance.invoice_status ADD VALUE IF NOT EXISTS 'cancelled';
