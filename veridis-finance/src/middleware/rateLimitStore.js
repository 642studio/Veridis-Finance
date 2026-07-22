/**
 * Store de rate limiting respaldado por Postgres (ventana fija), para que el
 * límite se respete ENTRE instancias serverless — no por-instancia como el Map
 * en memoria. Incremento atómico con INSERT ... ON CONFLICT DO UPDATE.
 *
 * Resiliencia: si la BD falla, cae a un contador en memoria del proceso (el
 * comportamiento anterior) para no tumbar el login por un hipo de la BD. Se
 * loggea la degradación.
 */

const pool = require('../db/pool');

// Fallback en memoria (por-instancia) cuando la BD no responde.
const memBuckets = new Map();

function memHit(key, windowMs, now) {
  const bucket = memBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    const fresh = { count: 1, resetAt: now + windowMs };
    memBuckets.set(key, fresh);
    return fresh;
  }
  bucket.count += 1;
  return bucket;
}

/**
 * Registra un golpe al bucket y devuelve el conteo dentro de la ventana actual.
 * @returns {{count:number, resetAt:number, max:number, exceeded:boolean, source:'db'|'memory'}}
 */
async function hit(key, windowMs, max) {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = windowStart + windowMs;

  try {
    const { rows } = await pool.query(
      `INSERT INTO finance.rate_limits (bucket_key, window_start, count)
       VALUES ($1, $2, 1)
       ON CONFLICT (bucket_key, window_start)
       DO UPDATE SET count = finance.rate_limits.count + 1, updated_at = now()
       RETURNING count`,
      [key, windowStart]
    );
    const count = rows[0].count;
    return { count, resetAt, max, exceeded: count > max, source: 'db' };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[rate-limit] BD no disponible, usando memoria: ${String(err.message || '').slice(0, 120)}`);
    if (memBuckets.size > 10000) {
      for (const [k, b] of memBuckets.entries()) if (b.resetAt <= now) memBuckets.delete(k);
    }
    const b = memHit(key, windowMs, now);
    return { count: b.count, resetAt: b.resetAt, max, exceeded: b.count > max, source: 'memory' };
  }
}

/** Purga ventanas viejas (llamar desde el cron). */
async function purge(olderThanMs = 3600000) {
  const cutoff = Date.now() - olderThanMs;
  const { rowCount } = await pool.query(
    `DELETE FROM finance.rate_limits WHERE window_start < $1`,
    [cutoff]
  );
  return { deleted: rowCount };
}

module.exports = { hit, purge };
