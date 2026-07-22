-- 025_rate_limits.sql
-- Store compartido para rate limiting entre instancias serverless. Ventana fija:
-- la clave es (bucket, inicio-de-ventana en epoch ms). El incremento es atómico
-- vía INSERT ... ON CONFLICT DO UPDATE count+1. Idempotente.

CREATE TABLE IF NOT EXISTS finance.rate_limits (
  bucket_key   text   NOT NULL,
  window_start bigint NOT NULL,          -- epoch ms del inicio de la ventana
  count        int    NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_key, window_start)
);

-- Para purgar ventanas viejas de forma barata.
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON finance.rate_limits (window_start);
