-- 001_cfdi_issuance.sql
-- Adds CFDI 4.0 issuance (timbrado) to Veridis Finance.
--
-- Today the app only *parses* incoming CFDI XML. This migration introduces the
-- data model to *issue* CFDIs through a PAC (Facturapi by default, swappable),
-- one issuer (RFC + CSD) per tenant, and an idempotent record of every stamped
-- document. Idempotent and safe to run repeatedly.

-- ---------------------------------------------------------------------------
-- Issuers: one fiscal emitter (RFC + régimen) per tenant, linked to the PAC.
-- The CSD lives at the PAC; we only store the PAC's per-tenant identifiers.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance.cfdi_issuers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  rfc                 TEXT NOT NULL,
  legal_name          TEXT NOT NULL,
  fiscal_regime       TEXT NOT NULL,                       -- c_RegimenFiscal (e.g. '601')
  zip_code            TEXT NOT NULL,                       -- lugar de expedición (CP emisor)
  pac_provider        TEXT NOT NULL DEFAULT 'facturama'    -- 'facturama' | 'facturapi'
                        CHECK (pac_provider IN ('facturapi', 'facturama')),
  pac_organization_id TEXT,                                -- Facturapi Organization id (per tenant)
  pac_api_key_enc     TEXT,                                -- per-tenant PAC key, encrypted at rest
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cfdi_issuers_org_rfc_idx
  ON finance.cfdi_issuers (organization_id, rfc);

-- ---------------------------------------------------------------------------
-- Documents: every CFDI we attempt to stamp, with its lifecycle and PAC result.
-- `source` + `source_ref` give us idempotency against GHL invoice webhooks so a
-- retried event never double-stamps.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance.cfdi_documents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  issuer_id        UUID REFERENCES finance.cfdi_issuers(id) ON DELETE SET NULL,
  invoice_id       UUID REFERENCES finance.invoices(id) ON DELETE SET NULL,

  cfdi_type        TEXT NOT NULL DEFAULT 'I'              -- I=Ingreso, E=Egreso, P=Pago
                     CHECK (cfdi_type IN ('I', 'E', 'P')),
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'stamped', 'canceled', 'error')),

  uuid             TEXT,                                  -- Folio Fiscal (SAT UUID), once stamped
  folio            TEXT,
  serie            TEXT,

  receiver_rfc     TEXT,
  receiver_name    TEXT,
  cfdi_use         TEXT,                                  -- c_UsoCFDI (e.g. 'G03')
  metodo_pago      TEXT CHECK (metodo_pago IN ('PUE', 'PPD')),
  forma_pago       TEXT,                                  -- c_FormaPago ('99' when PPD)

  currency         TEXT NOT NULL DEFAULT 'MXN',
  subtotal         NUMERIC(18,4),
  total            NUMERIC(18,4),

  pac_provider     TEXT,                                  -- provider that stamped it
  pac_document_id  TEXT,                                  -- Facturapi invoice id (for pdf/xml/cancel)
  xml_url          TEXT,
  pdf_url          TEXT,

  source           TEXT NOT NULL DEFAULT 'manual'         -- 'manual' | 'ghl'
                     CHECK (source IN ('manual', 'ghl', 'api')),
  source_ref       TEXT,                                  -- e.g. GHL invoice id (idempotency key)

  error_message    TEXT,
  raw              JSONB,                                 -- full PAC response

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  stamped_at       TIMESTAMPTZ,
  canceled_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS cfdi_documents_org_status_idx
  ON finance.cfdi_documents (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS cfdi_documents_uuid_idx
  ON finance.cfdi_documents (uuid);

-- Idempotency: one CFDI per external source document per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS cfdi_documents_source_idx
  ON finance.cfdi_documents (organization_id, source, source_ref)
  WHERE source_ref IS NOT NULL;
