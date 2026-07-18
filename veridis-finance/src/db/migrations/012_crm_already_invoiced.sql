-- 012_crm_already_invoiced.sql
-- CRM sales that already have a real CFDI at the SAT shouldn't sit in the
-- "pending" queue: the cross-matcher marks them 'already_invoiced' and removes
-- their crm:<id> ledger placeholder (the SAT invoice is the real record).
ALTER TABLE finance.ghl_webhook_events DROP CONSTRAINT IF EXISTS ghl_webhook_events_status_check;
ALTER TABLE finance.ghl_webhook_events ADD CONSTRAINT ghl_webhook_events_status_check
  CHECK (status IN ('received','processing','processed','ignored','error','pending_csf','already_invoiced'));
