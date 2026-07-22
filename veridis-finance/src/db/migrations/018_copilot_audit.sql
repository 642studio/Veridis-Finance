-- 018_copilot_audit.sql
-- Bitácora de acciones ejecutadas por el copiloto (Sprint 27). Idempotente.
-- Cada acción transaccional confirmada por el usuario queda registrada: quién,
-- qué herramienta, con qué parámetros y qué resultado.

CREATE TABLE IF NOT EXISTS finance.copilot_actions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  user_id          UUID,
  tool             TEXT NOT NULL,
  input            JSONB NOT NULL DEFAULT '{}'::jsonb,
  result           JSONB,
  status           TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','error')),
  error_message    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_copilot_actions_org
  ON finance.copilot_actions (organization_id, created_at DESC);
