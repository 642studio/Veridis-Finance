const test = require('node:test');
const assert = require('node:assert/strict');

const { validateEnv, isPlaceholder } = require('../src/config/env');

const SILENT_LOGGER = { warn() {}, info() {} };

function withEnv(overrides, fn) {
  const snapshot = { ...process.env };
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    return fn();
  } finally {
    process.env = snapshot;
  }
}

test('isPlaceholder detects known placeholder secrets', () => {
  assert.equal(isPlaceholder('replace-with-a-strong-secret'), true);
  assert.equal(isPlaceholder(''), true);
  assert.equal(isPlaceholder(undefined), true);
  assert.equal(isPlaceholder('a-real-production-secret-value'), false);
});

test('validateEnv errors when JWT_SECRET is missing', () => {
  withEnv({ JWT_SECRET: undefined, NODE_ENV: 'development' }, () => {
    const { errors } = validateEnv({ logger: SILENT_LOGGER });
    assert.ok(errors.some((e) => /JWT_SECRET/.test(e)));
  });
});

test('validateEnv passes with a strong secret in development', () => {
  withEnv(
    {
      JWT_SECRET: 'a-sufficiently-long-dev-secret-value',
      NODE_ENV: 'development',
      AI_MASTER_KEY: 'a-strong-master-key-value',
    },
    () => {
      const { errors } = validateEnv({ logger: SILENT_LOGGER });
      assert.deepEqual(errors, []);
    }
  );
});

test('validateEnv rejects placeholder secrets in production', () => {
  withEnv(
    {
      JWT_SECRET: 'replace-with-a-strong-secret',
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://app.example.com',
    },
    () => {
      const { errors } = validateEnv({ logger: SILENT_LOGGER });
      assert.ok(errors.some((e) => /JWT_SECRET/.test(e)));
    }
  );
});

test('validateEnv rejects permissive CORS in production', () => {
  withEnv(
    {
      JWT_SECRET: 'a-sufficiently-long-prod-secret-value',
      NODE_ENV: 'production',
      CORS_ORIGIN: 'true',
      AI_MASTER_KEY: 'a-strong-master-key-value',
    },
    () => {
      const { errors } = validateEnv({ logger: SILENT_LOGGER });
      assert.ok(errors.some((e) => /CORS_ORIGIN/.test(e)));
    }
  );
});

test('validateEnv accepts an explicit CORS allowlist in production', () => {
  withEnv(
    {
      JWT_SECRET: 'a-sufficiently-long-prod-secret-value',
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://app.example.com,https://admin.example.com',
      AI_MASTER_KEY: 'a-strong-master-key-value',
    },
    () => {
      const { errors } = validateEnv({ logger: SILENT_LOGGER });
      assert.deepEqual(errors, []);
    }
  );
});
