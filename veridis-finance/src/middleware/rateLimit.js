const crypto = require('node:crypto');
const { extractApiKey } = require('./apiKeyAuth');
const store = require('./rateLimitStore');

// Los contadores viven en un store compartido (Postgres, ventana fija), así el
// límite se respeta ENTRE instancias serverless. Si la BD falla, el store cae a
// un contador en memoria por-instancia (comportamiento previo) para no tumbar
// el login. Ventana/máximos configurables por env.

function tooManyRequests(message) {
  const error = new Error(message);
  error.statusCode = 429;
  return error;
}

function numberFromEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function keyHash(rawValue) {
  return crypto.createHash('sha256').update(rawValue).digest('hex').slice(0, 16);
}

function getLimiterKey(request) {
  const rawApiKey = extractApiKey(request);
  const clientIp = request.ip || 'unknown';

  if (typeof rawApiKey === 'string' && rawApiKey.trim()) {
    return `key:${keyHash(rawApiKey.trim())}`;
  }

  return `ip:${clientIp}`;
}

async function automationRateLimit(request, reply) {
  const windowMs = numberFromEnv('AUTOMATION_RATE_LIMIT_WINDOW_MS', 60000);
  const maxRequests = numberFromEnv('AUTOMATION_RATE_LIMIT_MAX', 60);
  const limiterKey = getLimiterKey(request);

  const r = await store.hit(limiterKey, windowMs, maxRequests);

  reply.header('X-RateLimit-Limit', String(maxRequests));
  reply.header('X-RateLimit-Remaining', String(Math.max(0, maxRequests - r.count)));
  reply.header('X-RateLimit-Reset', String(Math.ceil(r.resetAt / 1000)));

  if (r.exceeded) {
    reply.header('Retry-After', String(Math.max(1, Math.ceil((r.resetAt - Date.now()) / 1000))));
    throw tooManyRequests('Automation rate limit exceeded');
  }
}

/**
 * Login limiter with TWO independent gates (ambos en el store compartido):
 *  - per-IP  (10 / 15 min): stops a single host hammering the endpoint.
 *  - per-account (8 / 15 min): stops credential brute force against ONE account
 *    even when the attacker rotates X-Forwarded-For / source IPs. The account is
 *    derived from the login body (organization slug + email) and is only counted
 *    when the body carries them, so it never blocks unrelated users.
 */
async function authRateLimit(request, reply) {
  const windowMs = 900000; // 15 minutes
  const maxIpAttempts = 10;
  const maxAccountAttempts = 8;

  const ip = await store.hit(`auth:ip:${request.ip || 'unknown'}`, windowMs, maxIpAttempts);

  const body = request.body || {};
  const email = String(body.email || '').trim().toLowerCase();
  const org = String(body.organization_slug || body.organizationSlug || body.slug || '')
    .trim()
    .toLowerCase();
  let acct = null;
  if (email) {
    acct = await store.hit(`auth:acct:${keyHash(`${org}|${email}`)}`, windowMs, maxAccountAttempts);
  }

  reply.header('X-RateLimit-Limit', String(maxIpAttempts));
  reply.header('X-RateLimit-Remaining', String(Math.max(0, maxIpAttempts - ip.count)));
  reply.header('X-RateLimit-Reset', String(Math.ceil(ip.resetAt / 1000)));

  if (ip.exceeded || (acct && acct.exceeded)) {
    const resetAt = acct && acct.exceeded ? acct.resetAt : ip.resetAt;
    reply.header('Retry-After', String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))));
    throw tooManyRequests('Too many login attempts. Please try again later.');
  }
}

module.exports = {
  automationRateLimit,
  authRateLimit,
};
