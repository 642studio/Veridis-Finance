const crypto = require('node:crypto');
const { extractApiKey } = require('./apiKeyAuth');

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

module.exports = {
  automationRateLimit,
};
