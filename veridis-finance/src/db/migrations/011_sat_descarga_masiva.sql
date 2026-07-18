-- 011_sat_descarga_masiva.sql
-- SAT "Descarga Masiva" connector. This is the ONLY mechanism that reads a
-- taxpayer's COMPLETE fiscal history from the SAT — every CFDI they ever issued
-- or received, regardless of which PAC stamped it. It authenticates with the
-- taxpayer's e.firma (FIEL): certificate (.cer), private key (.key) and password.
--
-- Secrets are stored encrypted at rest (AES-256-GCM via lib/crypto) and are
-- NEVER returned to any client. Idempotent.

-- One e.firma vault per organization. Only the derived, non-secret metadata
-- (RFC, serial, validity window) is queryable; the raw cert/key/password live
-- encrypted.
CREATE TABLE IF NOT EXISTS finance.sat_credentials (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  rfc              TEXT NOT NULL,
  legal_name       TEXT,
  cert_serial      TEXT,
  valid_from       TIMESTAMPTZ,
  valid_to         TIMESTAMPTZ,
  cer_enc          TEXT NOT NULL,
  key_enc          TEXT NOT NULL,
  password_enc     TEXT NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sat_credentials_active_org
  ON finance.sat_credentials (organization_id)
  WHERE is_active = true;

-- One row per Descarga Masiva request. The SAT flow is asynchronous: you ask
-- for a date range, poll until the packages are ready, then download them. We
-- track the whole lifecycle so the UI can show progress and results.
CREATE TABLE IF NOT EXISTS finance.sat_download_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  sat_request_id   TEXT,               -- IdSolicitud returned by the SAT
  request_type     TEXT NOT NULL,      -- 'issued' (emitidas) | 'received' (recibidas)
  download_type    TEXT NOT NULL DEFAULT 'CFDI',  -- 'CFDI' | 'Metadata'
  date_from        DATE NOT NULL,
  date_to          DATE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'requested',
    -- requested | accepted | in_progress | ready | downloading | completed | failed
  sat_status_code  TEXT,               -- CodEstatus / raw SAT status
  sat_message      TEXT,               -- human-readable SAT message / our error
  package_ids      JSONB NOT NULL DEFAULT '[]'::jsonb,
  cfdi_found       INTEGER NOT NULL DEFAULT 0,
  cfdi_imported    INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sat_requests_org
  ON finance.sat_download_requests (organization_id, created_at DESC);

-- Allow the unified ledger to record CFDIs that came from the SAT bulk download.
ALTER TABLE finance.invoices DROP CONSTRAINT IF EXISTS invoices_source_check;
ALTER TABLE finance.invoices ADD CONSTRAINT invoices_source_check
  CHECK (source IN ('upload', 'issued_cfdi', 'pac_received', 'crm', 'sat_download'));
