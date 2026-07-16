/**
 * Centralised environment validation.
 *
 * Fails fast at boot for misconfiguration that would otherwise surface as
 * confusing 500s deep inside request handling (missing JWT secret, missing DB
 * config, missing AI master key, placeholder secrets in production, permissive
 * CORS in production, etc.).
 */

const PLACEHOLDER_VALUES = new Set([
  'replace-with-a-strong-secret',
  'replace-with-a-strong-32+char-secret',
  'replace-with-the-same-secret-used-in-backend',
  'change-me',
  'changeme',
  'secret',
]);

function isPlaceholder(value) {
  if (!value) return true;
  return PLACEHOLDER_VALUES.has(String(value).trim().toLowerCase());
}

function hasDatabaseConfig() {
  if (process.env.DATABASE_URL) return true;
  // pool.js falls back to sensible localhost defaults, so DB_HOST/DB_NAME are
  // not strictly required, but we surface a hint when nothing is configured.
  return Boolean(
    process.env.DB_HOST ||
      process.env.DB_NAME ||
      process.env.DB_USER ||
      process.env.DB_PASSWORD
  );
}

/**
 * @param {{ logger?: { warn: Function, info: Function } }} [options]
 * @returns {{ errors: string[], warnings: string[] }}
 */
function validateEnv(options = {}) {
  const logger = options.logger || console;
  const isProduction = process.env.NODE_ENV === 'production';

  const errors = [];
  const warnings = [];

  // --- Hard requirements ---
  if (!process.env.JWT_SECRET) {
    errors.push('Missing required environment variable: JWT_SECRET');
  } else if (isProduction && isPlaceholder(process.env.JWT_SECRET)) {
    errors.push(
      'JWT_SECRET is set to a placeholder value; set a strong secret in production'
    );
  } else if (
    isProduction &&
    String(process.env.JWT_SECRET).length < 24
  ) {
    warnings.push('JWT_SECRET is shorter than 24 characters; use a stronger secret');
  }

  // --- AI master key: only required once AI providers are actually used, but
  // misconfiguring it silently breaks encryption, so we validate eagerly. ---
  if (!process.env.AI_MASTER_KEY) {
    warnings.push(
      'AI_MASTER_KEY is not set; AI provider configuration/encryption will be unavailable until it is'
    );
  } else if (isProduction && isPlaceholder(process.env.AI_MASTER_KEY)) {
    errors.push(
      'AI_MASTER_KEY is set to a placeholder value; set a strong 32+ char secret in production'
    );
  } else if (String(process.env.AI_MASTER_KEY).length < 16) {
    warnings.push('AI_MASTER_KEY is shorter than 16 characters; use a stronger key');
  }

  // --- Database ---
  if (!hasDatabaseConfig()) {
    warnings.push(
      'No DATABASE_URL or DB_* variables set; falling back to localhost/postgres defaults'
    );
  }

  // --- CORS in production ---
  if (isProduction) {
    const corsOrigin = process.env.CORS_ORIGIN;
    if (!corsOrigin || corsOrigin === 'true' || corsOrigin === '*') {
      errors.push(
        'CORS_ORIGIN must be set to an explicit allowlist in production (wildcard/credentials is unsafe)'
      );
    }
  }

  for (const warning of warnings) {
    if (typeof logger.warn === 'function') {
      logger.warn(warning);
    }
  }

  return { errors, warnings };
}

/**
 * Validates and throws on the first hard error. Warnings are logged.
 */
function assertEnv(options = {}) {
  const { errors } = validateEnv(options);
  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n - ${errors.join('\n - ')}`
    );
  }
}

module.exports = {
  validateEnv,
  assertEnv,
  isPlaceholder,
};
