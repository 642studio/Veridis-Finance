-- 019_copilot_usage.sql
-- Contadores de uso del copiloto por organización y día (Sprint 28). Idempotente.
-- Sirven para aplicar límites (consultas/día, tokens/mes) y para transparencia
-- de costo. Un renglón por organización por día.

CREATE TABLE IF NOT EXISTS finance.copilot_usage (
  organization_id  UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  day              DATE NOT NULL,
  requests         INTEGER NOT NULL DEFAULT 0,
  input_tokens     BIGINT NOT NULL DEFAULT 0,
  output_tokens    BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, day)
);
