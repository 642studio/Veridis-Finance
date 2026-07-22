/**
 * Cliente mínimo de la Messages API de Anthropic para el copiloto (Sprint 25).
 * Sin SDK: fetch directo. La API key llega por env (ANTHROPIC_API_KEY) y NUNCA
 * se registra ni se envía al front. El modelo es configurable (ANTHROPIC_MODEL).
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

function apiKey() {
  const key = String(process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) {
    const err = new Error('El copiloto no está configurado: falta ANTHROPIC_API_KEY.');
    err.statusCode = 503;
    throw err;
  }
  return key;
}

function model() {
  return String(process.env.ANTHROPIC_MODEL || '').trim() || 'claude-sonnet-4-5';
}

/**
 * Una llamada a Messages. `messages` y `tools` en el formato de la API.
 * Devuelve el objeto de respuesta (content[], stop_reason, usage).
 */
async function createMessage({ system, messages, tools, maxTokens = 1500, temperature = 0 }) {
  const body = {
    model: model(),
    max_tokens: maxTokens,
    temperature,
    system,
    messages,
  };
  if (tools && tools.length) {
    body.tools = tools;
    // El system + tools se cachean para abaratar cada turno.
    body.system = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
  }

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey(),
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let detail = text;
    try { detail = JSON.parse(text)?.error?.message || text; } catch { /* texto plano */ }
    const err = new Error(`Anthropic API ${res.status}: ${String(detail).slice(0, 300)}`);
    err.statusCode = res.status === 401 ? 503 : 502;
    throw err;
  }
  return res.json();
}

module.exports = { createMessage, model };
