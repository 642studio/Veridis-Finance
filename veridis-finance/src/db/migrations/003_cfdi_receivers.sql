-- 003_cfdi_receivers.sql
-- Customer tax profiles (receptores): the fiscal data needed to issue a CFDI to
-- a client, sourced from their Constancia de Situación Fiscal (CSF), manual
-- entry, or a GHL contact. Idempotent and safe to run repeatedly.

CREATE TABLE IF NOT EXISTS finance.cfdi_receivers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,

  rfc               TEXT NOT NULL,
  name              TEXT NOT NULL,                    -- razón social (UPPERCASE, sin régimen de capital)
  fiscal_regime     TEXT NOT NULL,                    -- c_RegimenFiscal (e.g. '601', '626')
  zip_code          TEXT NOT NULL,                    -- domicilio fiscal (CP)
  cfdi_use          TEXT NOT NULL DEFAULT 'G03',      -- c_UsoCFDI por defecto
  email             TEXT,

  ghl_contact_id    TEXT,                             -- link to the GHL contact
  source            TEXT NOT NULL DEFAULT 'manual'    -- 'csf' | 'manual' | 'ghl'
                      CHECK (source IN ('csf', 'manual', 'ghl')),
  csf_uploaded      BOOLEAN NOT NULL DEFAULT FALSE,
  raw_csf           JSONB,                            -- parsed CSF fields for auditing

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cfdi_receivers_org_rfc_idx
  ON finance.cfdi_receivers (organization_id, rfc);
CREATE INDEX IF NOT EXISTS cfdi_receivers_ghl_contact_idx
  ON finance.cfdi_receivers (organization_id, ghl_contact_id) WHERE ghl_contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cfdi_receivers_email_idx
  ON finance.cfdi_receivers (organization_id, lower(email)) WHERE email IS NOT NULL;

-- Link a stamped CFDI back to the receiver profile it used.
ALTER TABLE finance.cfdi_documents
  ADD COLUMN IF NOT EXISTS receiver_id UUID REFERENCES finance.cfdi_receivers(id) ON DELETE SET NULL;
