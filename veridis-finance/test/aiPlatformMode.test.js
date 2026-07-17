const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_MASTER_KEY = process.env.AI_MASTER_KEY || 'test-master-key-32-characters-long-xx';

const {
  platformManaged,
  resolveProviderCredentials,
  saveProvider,
  getProvider,
} = require('../src/modules/finance/intelligence/ai-provider.service');

beforeEach(() => {
  delete process.env.AI_PROVIDER_MODE;
  delete process.env.AI_SYSTEM_PROVIDER;
  delete process.env.AI_SYSTEM_GOOGLE_API_KEY;
  delete process.env.AI_SYSTEM_OPENAI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.AI_SYSTEM_QWEN_API_KEY;
  delete process.env.QWEN_API_KEY;
});

test('platform mode is the default; byok is the explicit escape hatch', () => {
  assert.equal(platformManaged(), true);
  process.env.AI_PROVIDER_MODE = 'byok';
  assert.equal(platformManaged(), false);
});

test('platform mode resolves the system key without touching org rows', async () => {
  process.env.AI_SYSTEM_PROVIDER = 'google';
  process.env.AI_SYSTEM_GOOGLE_API_KEY = 'platform-gemini-key';
  process.env.AI_SYSTEM_GOOGLE_MODEL = 'gemini-1.5-flash';

  // No db passed on purpose: in platform mode this must short-circuit before
  // any query — it would throw if it hit the pool.
  const creds = await resolveProviderCredentials({
    organizationId: '00000000-0000-0000-0000-000000000000',
    db: { query() { throw new Error('DB must not be queried in platform mode'); } },
  });

  assert.equal(creds.provider, 'google');
  assert.equal(creds.api_key, 'platform-gemini-key');
  assert.equal(creds.model, 'gemini-1.5-flash');
  assert.equal(creds.key_source, 'system');
});

test('platform mode rejects org-supplied API keys', async () => {
  await assert.rejects(
    saveProvider({
      organizationId: '00000000-0000-0000-0000-000000000000',
      provider: 'openai',
      apiKey: 'sk-customer-key',
    }),
    /incluida en tu plan/
  );
});

test('getProvider reports the managed state and never leaks the key', async () => {
  process.env.AI_SYSTEM_PROVIDER = 'google';
  process.env.AI_SYSTEM_GOOGLE_API_KEY = 'platform-gemini-key';

  const view = await getProvider({
    organizationId: '00000000-0000-0000-0000-000000000000',
    db: { query() { throw new Error('DB must not be queried in platform mode'); } },
  });

  assert.equal(view.managed, true);
  assert.equal(view.provider, 'google');
  assert.equal(view.key_configured, true);
  assert.equal(view.api_key_masked, null);
  const serialized = JSON.stringify(view);
  assert.ok(!serialized.includes('platform-gemini-key'), 'key must never be returned');
});

test('platform mode without a configured key reports not-ready (no crash)', async () => {
  const view = await getProvider({
    organizationId: '00000000-0000-0000-0000-000000000000',
    db: { query() { throw new Error('DB must not be queried in platform mode'); } },
  });
  assert.equal(view.managed, true);
  assert.equal(view.key_configured, false);

  const creds = await resolveProviderCredentials({
    organizationId: '00000000-0000-0000-0000-000000000000',
    db: { query() { throw new Error('DB must not be queried in platform mode'); } },
  });
  assert.equal(creds, null);
});
