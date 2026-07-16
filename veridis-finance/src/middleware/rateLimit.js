const crypto = require('node:crypto');
const { extractApiKey } = require('./apiKeyAuth');

// LIMITATION: these limiters keep counters in an in-process Map. That is correct
// and sufficient for a single instance, but with multiple instances behind a
// load balancer the limit is enforced per-instance (effective limit = N * max)
// and all counters reset on deploy/restart. For horizontal scaling, back these
// buckets with a shared store (e.g. Redis via a fixed/sliding-window script) and
// keep the same env-configurable window/max contract.
const rateBuckets = new Map();

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

function cleanupExpiredBuckets(now) {
  for (const [key, bucket] of rateBuckets.entries()) {
    if (bucket.resetAt <= now) {
      rateBuckets.delete(key);
    }
  }
}

async function automationRateLimit(request, reply) {
  const windowMs = numberFromEnv('AUTOMATION_RATE_LIMIT_WINDOW_MS', 60000);
  const maxRequests = numberFromEnv('AUTOMATION_RATE_LIMIT_MAX', 60);
  const now = Date.now();
  const limiterKey = getLimiterKey(request);

  let bucket = rateBuckets.get(limiterKey);
  if (!bucket || bucket.resetAt <= now) {
    bucket = {
      count: 0,
      resetAt: now + windowMs,
    };
    rateBuckets.set(limiterKey, bucket);
  }

  bucket.count += 1;

  const remaining = Math.max(0, maxRequests - bucket.count);
  reply.header('X-RateLimit-Limit', String(maxRequests));
  reply.header('X-RateLimit-Remaining', String(remaining));
  reply.header('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

  if (bucket.count > maxRequests) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.resetAt - now) / 1000)
    );
    reply.header('Retry-After', String(retryAfterSeconds));
    throw tooManyRequests('Automation rate limit exceeded');
  }

  if (rateBuckets.size > 10000) {
    cleanupExpiredBuckets(now);
  }
}

const loginBuckets = new Map();

async function authRateLimit(request, reply) {
  const windowMs = 900000; // 15 minutes
  const maxAttempts = 10;
  const now = Date.now();
  const limiterKey = `auth:${request.ip || 'unknown'}`;

  let bucket = loginBuckets.get(limiterKey);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    loginBuckets.set(limiterKey, bucket);
  }

  bucket.count += 1;

  reply.header('X-RateLimit-Limit', String(maxAttempts));
  reply.header('X-RateLimit-Remaining', String(Math.max(0, maxAttempts - bucket.count)));
  reply.header('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

  if (bucket.count > maxAttempts) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    reply.header('Retry-After', String(retryAfterSeconds));
    throw tooManyRequests('Too many login attempts. Please try again later.');
  }

  if (loginBuckets.size > 10000) {
    for (const [key, b] of loginBuckets.entries()) {
      if (b.resetAt <= now) loginBuckets.delete(key);
    }
  }
}

module.exports = {
  automationRateLimit,
  authRateLimit,
};
