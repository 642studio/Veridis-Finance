-- 004_pending_csf.sql — allow the 'pending_csf' webhook state (invoice paid in
-- CRM but the client's Constancia isn't on file yet). Idempotent.
ALTER TABLE finance.ghl_webhook_events DROP CONSTRAINT IF EXISTS ghl_webhook_events_status_check;
ALTER TABLE finance.ghl_webhook_events ADD CONSTRAINT ghl_webhook_events_status_check
  CHECK (status IN ('received','processing','processed','ignored','error','pending_csf'));
