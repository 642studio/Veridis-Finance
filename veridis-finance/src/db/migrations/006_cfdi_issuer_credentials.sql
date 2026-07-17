-- 006_cfdi_issuer_credentials.sql
-- Make per-tenant CFDI issuing real. Until now resolveCreds() ignored the issuer
-- record and always read PAC credentials from process.env, so every tenant would
-- stamp with the SAME RFC — a hard blocker for a multi-company SaaS.
--
-- This adds the columns needed to store per-tenant PAC credentials encrypted at
-- rest and to pick sandbox vs production per issuer. Idempotent.

ALTER TABLE finance.cfdi_issuers
  ADD COLUMN IF NOT EXISTS pac_env TEXT NOT NULL DEFAULT 'sandbox';

ALTER TABLE finance.cfdi_issuers
  DROP CONSTRAINT IF EXISTS cfdi_issuers_pac_env_check;
ALTER TABLE finance.cfdi_issuers
  ADD CONSTRAINT cfdi_issuers_pac_env_check
  CHECK (pac_env IN ('sandbox', 'production'));

-- Facturama uses HTTP Basic auth (user + password); Facturapi uses a single API
-- key. We store the username (Facturama) and the secret (password / API key)
-- each encrypted with the app encryption key. pac_api_key_enc already existed.
ALTER TABLE finance.cfdi_issuers
  ADD COLUMN IF NOT EXISTS pac_username_enc TEXT;
