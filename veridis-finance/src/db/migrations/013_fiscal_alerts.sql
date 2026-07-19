-- 013_fiscal_alerts.sql
-- Fiscal alerting suite (Siigo-parity):
--   * EFOS 69-B blacklist mirror + refresh log (monitoreo de proveedores)
--   * in-app notifications (centro de alertas: EFOS, errores CFDI, sync)
--   * CFDI evidence attachments (materialidad, CFF art. 49 Bis)
-- Idempotent and safe to run repeatedly.

-- Global mirror of the SAT 69-B list (shared across tenants; the list is public).
CREATE TABLE IF NOT EXISTS finance.efos_blacklist (
  rfc            TEXT PRIMARY KEY,
  name           TEXT,
  situacion      TEXT NOT NULL,            -- Definitivo | Presunto | Desvirtuado | Sentencia Favorable
  raw            JSONB,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance.efos_refresh_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source         TEXT NOT NULL,            -- 'sat-csv' | 'manual-upload'
  row_count      INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error')),
  error_message  TEXT,
  refreshed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- In-app alert center. Email delivery is best-effort on top (RESEND_API_KEY).
CREATE TABLE IF NOT EXISTS finance.notifications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  type             TEXT NOT NULL,          -- 'efos' | 'cfdi_error' | 'cfdi_canceled' | 'sat_sync' | 'system'
  severity         TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  title            TEXT NOT NULL,
  body             TEXT,
  ref_type         TEXT,
  ref_id           TEXT,
  read_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_org_idx
  ON finance.notifications (organization_id, created_at DESC);

-- Materialidad (CFF 49 Bis): evidence files attached to a CFDI. Content stored
-- inline (bytea, capped by app at 5MB) — no external storage dependency.
CREATE TABLE IF NOT EXISTS finance.cfdi_evidence (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  cfdi_id          UUID NOT NULL REFERENCES finance.cfdi_documents(id) ON DELETE CASCADE,
  filename         TEXT NOT NULL,
  mime_type        TEXT NOT NULL,
  size_bytes       INTEGER NOT NULL,
  content          BYTEA NOT NULL,
  note             TEXT,
  tags             TEXT[] NOT NULL DEFAULT '{}',
  uploaded_by      UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cfdi_evidence_cfdi_idx
  ON finance.cfdi_evidence (organization_id, cfdi_id);
