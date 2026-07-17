const { test } = require('node:test');
const assert = require('node:assert/strict');

// resolveCreds must decrypt per-tenant PAC credentials and only fall back to env
// when the tenant has none. This is what makes multi-company issuing real.
process.env.APP_ENCRYPTION_KEY =
  process.env.APP_ENCRYPTION_KEY || 'test-app-encryption-key-32-chars-long';

const { encrypt } = require('../src/lib/crypto');
const issuers = require('../src/services/cfdiIssuersService');

test('resolveCreds uses per-tenant Facturama credentials when present', () => {
  const issuer = {
    pac_provider: 'facturama',
    pac_env: 'production',
    pac_username_enc: encrypt('tenantB_user'),
    pac_api_key_enc: encrypt('tenantB_password'),
  };
  const { provider, creds } = issuers.resolveCreds(issuer);
  assert.equal(provider, 'facturama');
  assert.equal(creds.user, 'tenantB_user');
  assert.equal(creds.password, 'tenantB_password');
  assert.equal(creds.env, 'production');
});

test('resolveCreds falls back to env for the bootstrap tenant', () => {
  process.env.FACTURAMA_USER = 'envUser';
  process.env.FACTURAMA_PASSWORD = 'envPass';
  const { creds } = issuers.resolveCreds(null);
  assert.equal(creds.user, 'envUser');
  assert.equal(creds.password, 'envPass');
  assert.equal(creds.env, 'sandbox');
});

test('resolveCreds decrypts a per-tenant Facturapi API key', () => {
  const issuer = {
    pac_provider: 'facturapi',
    pac_organization_id: 'org_123',
    pac_api_key_enc: encrypt('sk_test_tenantB'),
  };
  const { provider, creds } = issuers.resolveCreds(issuer);
  assert.equal(provider, 'facturapi');
  assert.equal(creds.apiKey, 'sk_test_tenantB');
  assert.equal(creds.organizationId, 'org_123');
});

test('toPublic never leaks secrets', () => {
  const pub = issuers.toPublic({
    id: 'x',
    rfc: 'EKU9003173C9',
    legal_name: 'Empresa',
    fiscal_regime: '601',
    zip_code: '01000',
    pac_provider: 'facturama',
    pac_env: 'sandbox',
    pac_api_key_enc: encrypt('secret'),
    pac_username_enc: encrypt('user'),
    is_active: true,
  });
  assert.equal(pub.has_credentials, true);
  assert.equal('pac_api_key_enc' in pub, false);
  assert.equal('pac_username_enc' in pub, false);
});
