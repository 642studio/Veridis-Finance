-- 002_ghl_integration.sql
-- GoHighLevel (GHL) integration: per-location OAuth installs and idempotent
-- webhook ingestion. Idempotent and safe to run repeatedly.

-- ---------------------------------------------------------------------------
-- Installs: one row per GHL location (sub-account) or company that authorized
-- our Marketplace app. Refresh tokens rotate on use, so writes must be atomic.
-- The refresh token is stored encrypted at rest.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance.ghl_installs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  ghl_user_type      TEXT NOT NULL DEFAULT 'Location'      -- 'Location' | 'Company'
                       CHECK (ghl_user_type IN ('Location', 'Company')),
  location_id        TEXT,                                 -- GHL sub-account id
  company_id         TEXT,                                 -- GHL agency id
  access_token       TEXT,
  refresh_token_enc  TEXT,                                 -- encrypted at rest
  scope              TEXT,
  token_expires_at   TIMESTAMPTZ,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  installed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ghl_installs_location_idx
  ON finance.ghl_installs (location_id) WHERE location_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ghl_installs_company_idx
  ON finance.ghl_installs (company_id) WHERE company_id IS NOT NULL AND location_id IS NULL;
CREATE INDEX IF NOT EXISTS ghl_installs_org_idx
  ON finance.ghl_installs (organization_id);

-- ---------------------------------------------------------------------------
-- Webhook events: dedupe log + processing state. GHL can retry/duplicate and
-- deliver out of order, so every event is deduped on its webhook id and heavy
-- work (CFDI generation) runs off the ingest path.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance.ghl_webhook_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id     TEXT,                                    -- GHL webhookId (dedupe)
  event_type     TEXT NOT NULL,                           -- InvoicePaid, InvoiceCreate, ...
  location_id    TEXT,
  status         TEXT NOT NULL DEFAULT 'received'
                   CHECK (status IN ('received', 'processing', 'processed', 'ignored', 'error')),
  payload        JSONB NOT NULL,
  error_message  TEXT,
  received_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at   TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS ghl_webhook_events_dedupe_idx
  ON finance.ghl_webhook_events (webhook_id, event_type) WHERE webhook_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ghl_webhook_events_status_idx
  ON finance.ghl_webhook_events (status, received_at DESC);
