/**
 * Límites y contadores de uso del copiloto (Sprint 28).
 *
 * Presupuesto por organización, configurable por env:
 *   COPILOT_DAILY_REQUESTS  — consultas por día (default 300)
 *   COPILOT_MONTHLY_TOKENS  — tokens totales (in+out) por mes (default 15M)
 *
 * `limitState` es puro y testeado; `check` lee los contadores y `record` los
 * acumula tras cada respuesta. Los contadores viven en finance.copilot_usage.
 */

const pool = require('../../db/pool');

function limits() {
  return {
    dailyRequests: Number(process.env.COPILOT_DAILY_REQUESTS || 300),
    monthlyTokens: Number(process.env.COPILOT_MONTHLY_TOKENS || 15000000),
  };
}

/** Decisión pura de límite. Devuelve { allowed, reason }. */
function limitState({ requestsToday, tokensMonth, dailyRequests, monthlyTokens }) {
  if (requestsToday >= dailyRequests) {
    return {
      allowed: false,
      reason: `Límite diario del copiloto alcanzado (${dailyRequests} consultas). Se restablece mañana.`,
    };
  }
  if (tokensMonth >= monthlyTokens) {
    return {
      allowed: false,
      reason: 'Límite mensual de uso del copiloto alcanzado. Se restablece el próximo mes.',
    };
  }
  return { allowed: true, reason: null };
}

/** Lee contadores del día/mes y aplica limitState. Lanza 429 si no procede. */
async function check(organizationId) {
  const { rows } = await pool.query(
    `SELECT
       COALESCE(SUM(requests) FILTER (WHERE day = CURRENT_DATE), 0)::int AS requests_today,
       COALESCE(SUM(input_tokens + output_tokens)
         FILTER (WHERE date_trunc('month', day) = date_trunc('month', CURRENT_DATE)), 0)::bigint AS tokens_month
     FROM finance.copilot_usage
     WHERE organization_id = $1 AND day >= date_trunc('month', CURRENT_DATE)`,
    [organizationId]
  );
  const state = limitState({
    requestsToday: Number(rows[0]?.requests_today || 0),
    tokensMonth: Number(rows[0]?.tokens_month || 0),
    ...limits(),
  });
  if (!state.allowed) {
    const err = new Error(state.reason);
    err.statusCode = 429;
    throw err;
  }
}

/** Acumula una consulta y sus tokens. Nunca tumba la respuesta si falla. */
async function record(organizationId, usage) {
  try {
    await pool.query(
      `INSERT INTO finance.copilot_usage (organization_id, day, requests, input_tokens, output_tokens)
       VALUES ($1, CURRENT_DATE, 1, $2, $3)
       ON CONFLICT (organization_id, day) DO UPDATE SET
         requests = finance.copilot_usage.requests + 1,
         input_tokens = finance.copilot_usage.input_tokens + EXCLUDED.input_tokens,
         output_tokens = finance.copilot_usage.output_tokens + EXCLUDED.output_tokens`,
      [organizationId, Number(usage?.input_tokens || 0), Number(usage?.output_tokens || 0)]
    );
  } catch { /* contadores jamás rompen el chat */ }
}

/** Resumen para la UI: consultas de hoy y tokens del mes. */
async function summary(organizationId) {
  const { rows } = await pool.query(
    `SELECT
       COALESCE(SUM(requests) FILTER (WHERE day = CURRENT_DATE), 0)::int AS requests_today,
       COALESCE(SUM(input_tokens + output_tokens), 0)::bigint AS tokens_month
     FROM finance.copilot_usage
     WHERE organization_id = $1 AND day >= date_trunc('month', CURRENT_DATE)`,
    [organizationId]
  );
  const l = limits();
  return {
    requests_today: Number(rows[0]?.requests_today || 0),
    daily_limit: l.dailyRequests,
    tokens_month: Number(rows[0]?.tokens_month || 0),
    monthly_token_limit: l.monthlyTokens,
  };
}

module.exports = { limitState, check, record, summary };
