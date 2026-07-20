-- 017_fixed_assets.sql
-- Activos fijos y depreciación (Sprint 12). Idempotente.
--
--   * fixed_assets  registro de activos con costo, tasa anual (SAT art. 34/35),
--                   método (línea recta) y las cuentas contables de activo,
--                   depreciación acumulada (contra-activo) y gasto.
--
-- La depreciación mensual se calcula en la capa de servicio (línea recta:
-- (costo − valor de rescate) × tasa_anual / 12) y se registra como póliza de
-- diario idempotente (source='depreciacion', source_ref='<asset>:<YYYY-MM>').

CREATE TABLE IF NOT EXISTS finance.fixed_assets (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES finance.organizations(organization_id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  description           TEXT,
  category              TEXT,                          -- p.ej. 'equipo_computo', 'mobiliario'
  acquisition_date      DATE NOT NULL,
  cost                  NUMERIC(16,2) NOT NULL CHECK (cost >= 0),
  salvage_value         NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (salvage_value >= 0),
  annual_rate           NUMERIC(6,4) NOT NULL DEFAULT 0.10,  -- tasa anual de depreciación
  method                TEXT NOT NULL DEFAULT 'linea_recta',
  asset_account_code    TEXT NOT NULL DEFAULT '155.01',      -- activo
  accum_account_code    TEXT NOT NULL DEFAULT '172.01',      -- depreciación acumulada (contra-activo)
  expense_account_code  TEXT NOT NULL DEFAULT '601.85',      -- gasto por depreciación
  cfdi_uuid             TEXT,                                -- CFDI de compra (opcional)
  status                TEXT NOT NULL DEFAULT 'activo'
                          CHECK (status IN ('activo','baja','totalmente_depreciado')),
  disposed_at           DATE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fixed_assets_org
  ON finance.fixed_assets (organization_id, status);
