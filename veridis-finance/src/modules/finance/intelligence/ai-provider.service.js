const crypto = require('crypto');

const pool = require('../../../db/pool');

const SUPPORTED_PROVIDER_HINTS = ['openai', 'google', 'qwen'];
const PROVIDER_NAME_REGEX = /^[a-z0-9_-]{2,40}$/;
const DEFAULT_MODEL_BY_PROVIDER = Object.freeze({
  openai: 'gpt-4o-mini',
  google: 'gemini-1.5-flash',
  qwen: 'qwen-plus',
});
const DEFAULT_COST_PER_1K_TOKENS_USD = 0.0006;
const COST_PER_1K_TOKENS_USD = Object.freeze({
  openai: Object.freeze({
    'gpt-4o-mini': 0.0006,
    default: 0.0009,
  }),
  google: Object.freeze({
    'gemini-1.5-flash': 0.00035,
    default: 0.00045,
  }),
  qwen: Object.freeze({
    'qwen-plus': 0.00045,
    default: 0.00055,
  }),
});

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

function badGateway(message) {
  const error = new Error(message);
  error.statusCode = 502;
  return error;
}

function internalError(message) {
  const error = new Error(message);
  error.statusCode = 500;
  return error;
}

function safeDbTableError(error) {
  return error?.code === '42P01' || error?.code === '42703';
}

function normalizeProvider(value) {
  return String(value || '').trim().toLowerCase();
}

function safeModelName(value, provider) {
  const model = String(value || '').trim().slice(0, 120);
  if (model) {
    return model;
  }
  return DEFAULT_MODEL_BY_PROVIDER[provider] || 'default';
}

function safeBoolean(value, fallback = true) {
  if (value === undefined || value === null) {
    return fallback;
  }
  return Boolean(value);
}

function systemKeyAvailable(provider) {
  return Boolean(keyByProviderFromEnv(provider));
}

function maskApiKey(plainApiKey, provider) {
  const input = String(plainApiKey || '').trim();
  if (!input) {
    return null;
  }

  const suffix = input.slice(-4);
  const prefix =
    provider === 'openai'
      ? 'sk-'
      : provider === 'google'
      ? 'g-'
      : provider === 'qwen'
      ? 'qw-'
      : 'key-';

  return `${prefix}****${suffix}`;
}

function resolveCostPer1kTokensUsd(provider, model) {
  const providerCosts = COST_PER_1K_TOKENS_USD[provider];
  if (!providerCosts) {
    return DEFAULT_COST_PER_1K_TOKENS_USD;
  }

  return providerCosts[model] || providerCosts.default || DEFAULT_COST_PER_1K_TOKENS_USD;
}

function estimateCostUsd({ provider, model, tokens }) {
  const tokenCount = Number(tokens);
  if (!Number.isFinite(tokenCount) || tokenCount <= 0) {
    return 0;
  }

  const per1k = resolveCostPer1kTokensUsd(provider, model);
  const estimated = (tokenCount / 1000) * per1k;
  return Number(estimated.toFixed(6));
}

function requireMasterKey() {
  const raw = String(process.env.AI_MASTER_KEY || '').trim();
  if (!raw) {
    throw internalError('AI_MASTER_KEY is required to encrypt/decrypt provider keys');
  }

  // Always derive a deterministic 32-byte key to support flexible input format.
  return crypto.createHash('sha256').update(raw).digest();
}

function encryptApiKey(plainApiKey) {
  const input = String(plainApiKey || '').trim();
  if (!input) {
    throw badRequest('api_key is required');
  }

  const key = requireMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(input, 'utf8'),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptKey(encryptedApiKey) {
  const payload = String(encryptedApiKey || '').trim();
  if (!payload) {
    throw badRequest('Encrypted API key is empty');
  }

  const [version, ivB64, tagB64, cipherB64] = payload.split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !cipherB64) {
    throw badRequest('Encrypted API key format is invalid');
  }

  const key = requireMasterKey();
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const cipherText = Buffer.from(cipherB64, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(cipherText),
    decipher.final(),
  ]).toString('utf8');

  return decrypted;
}

function mapProviderPublic(row, decryptedApiKey = null) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    organization_id: row.organization_id,
    provider: row.provider,
    model: row.model,
    active: row.active,
    use_system_key: Boolean(row.use_system_key),
    created_at: row.created_at,
    key_configured: Boolean(row.encrypted_api_key),
    api_key_masked: maskApiKey(decryptedApiKey, row.provider),
    system_key_available: systemKeyAvailable(row.provider),
  };
}

function normalizeProviderInput(provider) {
  const normalized = normalizeProvider(provider);
  if (!normalized || !PROVIDER_NAME_REGEX.test(normalized)) {
    throw badRequest('provider is required and must be lowercase alphanumeric text');
  }

  return normalized;
}

async function findProviderRow({
  organizationId,
  provider,
  db = pool,
  activeOnly = false,
}) {
  const values = [organizationId];
  const conditions = ['organization_id = $1'];

  if (provider) {
    values.push(normalizeProvider(provider));
    conditions.push(`provider = $${values.length}`);
  }

  if (activeOnly) {
    conditions.push('active = true');
  }

  const query = {
    text: `
      SELECT
        id,
        organization_id,
        provider,
        encrypted_api_key,
        model,
        use_system_key,
        active,
        created_at
      FROM finance.ai_providers
      WHERE ${conditions.join(' AND ')}
      ORDER BY active DESC, created_at DESC
      LIMIT 1
    `,
    values,
  };

  const { rows } = await db.query(query);
  return rows[0] || null;
}

function providerBaseUrl(provider) {
  if (provider === 'openai') {
    return String(process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  }

  if (provider === 'qwen') {
    return String(
      process.env.QWEN_API_BASE_URL ||
        'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
    ).replace(/\/$/, '');
  }

  return '';
}

function parseJsonObject(rawContent) {
  if (!rawContent) {
    return null;
  }

  if (typeof rawContent === 'object') {
    return rawContent;
  }

  const text = String(rawContent || '').trim();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');

    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }

    return null;
  }
}

async function fetchWithTimeout(url, init, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function requestOpenAiCompatibleJson({
  provider,
  apiKey,
  model,
  prompt,
}) {
  const baseUrl = providerBaseUrl(provider);
  if (!baseUrl) {
    throw badGateway(`Provider ${provider} is not configured`);
  }

  const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: {
        type: 'json_object',
      },
      messages: [
        {
          role: 'system',
          content:
            'You classify finance transactions. Always return strict JSON with keys: category, confidence, member.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  const bodyText = await response.text();

  if (!response.ok) {
    throw badGateway(
      `AI provider ${provider} request failed (${response.status}): ${bodyText.slice(
        0,
        200
      )}`
    );
  }

  const body = parseJsonObject(bodyText) || {};
  const content = body?.choices?.[0]?.message?.content;

  const parsed = Array.isArray(content)
    ? parseJsonObject(
        content
          .map((part) => String(part?.text || part || ''))
          .join('\n')
      )
    : parseJsonObject(content);

  if (!parsed) {
    throw badGateway(`AI provider ${provider} returned invalid JSON content`);
  }

  return {
    parsed,
    usage_tokens: Number(body?.usage?.total_tokens || 0) || 0,
  };
}

async function requestGoogleJson({ apiKey, model, prompt }) {
  const resolvedModel = safeModelName(model, 'google');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    resolvedModel
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
      },
    }),
  });

  const bodyText = await response.text();

  if (!response.ok) {
    throw badGateway(
      `AI provider google request failed (${response.status}): ${bodyText.slice(
        0,
        200
      )}`
    );
  }

  const body = parseJsonObject(bodyText) || {};
  const parts = body?.candidates?.[0]?.content?.parts || [];
  const text = parts
    .map((part) => String(part?.text || ''))
    .join('\n');

  const parsed = parseJsonObject(text);
  if (!parsed) {
    throw badGateway('AI provider google returned invalid JSON content');
  }

  return {
    parsed,
    usage_tokens: Number(body?.usageMetadata?.totalTokenCount || 0) || 0,
  };
}

function normalizeAiResult(value) {
  const category = String(value?.category || '').trim().slice(0, 120);
  if (!category) {
    return null;
  }

  const confidenceRaw = Number(value?.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, confidenceRaw))
    : 0;

  const memberRaw = String(value?.member || '').trim();

  return {
    category,
    confidence: Number(confidence.toFixed(4)),
    member: memberRaw || null,
  };
}

function buildClassificationPrompt({ description, categories, members }) {
  return [
    'Classify a financial transaction and return JSON only.',
    'Use one category from `categories` whenever possible.',
    'Use one member from `members` only when clearly identified; otherwise null.',
    'Respond with: {"category":"...","confidence":0.0,"member":"...|null"}.',
    '',
    JSON.stringify(
      {
        transaction_description: description,
        categories,
        members,
      },
      null,
      2
    ),
  ].join('\n');
}

function keyByProviderFromEnv(provider) {
  if (provider === 'openai') {
    return (
      String(process.env.AI_SYSTEM_OPENAI_API_KEY || '').trim() ||
      String(process.env.OPENAI_API_KEY || '').trim() ||
      null
    );
  }

  if (provider === 'google') {
    return (
      String(process.env.AI_SYSTEM_GOOGLE_API_KEY || '').trim() ||
      String(process.env.GOOGLE_API_KEY || '').trim() ||
      null
    );
  }

  if (provider === 'qwen') {
    return (
      String(process.env.AI_SYSTEM_QWEN_API_KEY || '').trim() ||
      String(process.env.QWEN_API_KEY || '').trim() ||
      null
    );
  }

  return null;
}

function modelByProviderFromEnv(provider) {
  if (provider === 'openai') {
    return String(process.env.AI_SYSTEM_OPENAI_MODEL || '').trim() || null;
  }

  if (provider === 'google') {
    return String(process.env.AI_SYSTEM_GOOGLE_MODEL || '').trim() || null;
  }

  if (provider === 'qwen') {
    return String(process.env.AI_SYSTEM_QWEN_MODEL || '').trim() || null;
  }

  return null;
}

function resolveSystemProviderCredentials(preferredProvider) {
  const normalizedPreferred = normalizeProvider(preferredProvider);
  const candidateProviders = [];

  if (normalizedPreferred) {
    candidateProviders.push(normalizedPreferred);
  }

  const configuredProvider = normalizeProvider(process.env.AI_SYSTEM_PROVIDER);
  if (configuredProvider && !candidateProviders.includes(configuredProvider)) {
    candidateProviders.push(configuredProvider);
  }

  for (const provider of SUPPORTED_PROVIDER_HINTS) {
    if (!candidateProviders.includes(provider)) {
      candidateProviders.push(provider);
    }
  }

  for (const provider of candidateProviders) {
    const apiKey = keyByProviderFromEnv(provider);
    if (!apiKey) {
      continue;
    }

    return {
      provider,
      model: modelByProviderFromEnv(provider) || safeModelName('', provider),
      api_key: apiKey,
      key_source: 'system',
    };
  }

  return null;
}

async function resolveProviderCredentials({ organizationId, provider, db = pool }) {
  const providerRow = await findProviderRow({
    organizationId,
    provider,
    db,
    activeOnly: true,
  });

  if (providerRow?.use_system_key) {
    const systemCredentials = resolveSystemProviderCredentials(
      providerRow.provider
    );
    if (!systemCredentials) {
      return null;
    }

    return {
      ...systemCredentials,
      provider: providerRow.provider,
      model: providerRow.model || systemCredentials.model,
      provider_id: providerRow.id,
      forced_system_key: true,
    };
  }

  if (providerRow?.encrypted_api_key) {
    const decrypted = decryptKey(providerRow.encrypted_api_key);

    return {
      provider: providerRow.provider,
      model: safeModelName(providerRow.model, providerRow.provider),
      api_key: decrypted,
      key_source: 'organization',
      provider_id: providerRow.id,
    };
  }

  return resolveSystemProviderCredentials(provider || providerRow?.provider);
}

async function requestProviderJson({
  provider,
  apiKey,
  model,
  prompt,
}) {
  if (provider === 'openai' || provider === 'qwen') {
    return requestOpenAiCompatibleJson({
      provider,
      apiKey,
      model,
      prompt,
    });
  }

  if (provider === 'google') {
    return requestGoogleJson({
      apiKey,
      model,
      prompt,
    });
  }

  throw badRequest(
    `Provider ${provider} is not supported by the current AI adapter`
  );
}

async function logUsageEvent({
  organizationId,
  provider,
  model,
  keySource,
  tokensUsed,
  operation = 'classification',
  db = pool,
}) {
  const safeTokens = Math.max(0, Number.parseInt(String(tokensUsed || 0), 10) || 0);
  const safeProvider = normalizeProvider(provider || 'unknown').slice(0, 40) || 'unknown';
  const safeModel = safeModelName(model, safeProvider);
  const safeKeySource = keySource === 'system' ? 'system' : 'organization';
  const safeOperation = String(operation || 'classification').trim().slice(0, 40) || 'classification';
  const estimatedCostUsd = estimateCostUsd({
    provider: safeProvider,
    model: safeModel,
    tokens: safeTokens,
  });

  try {
    await db.query(
      `
        INSERT INTO finance.ai_usage_events (
          organization_id,
          provider,
          model,
          key_source,
          operation,
          tokens_used,
          estimated_cost_usd
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        organizationId,
        safeProvider,
        safeModel,
        safeKeySource,
        safeOperation,
        safeTokens,
        estimatedCostUsd,
      ]
    );
  } catch (error) {
    if (!safeDbTableError(error)) {
      throw error;
    }
  }

  return {
    tokens_used: safeTokens,
    estimated_cost_usd: estimatedCostUsd,
  };
}

async function getMonthlyUsageStats({
  organizationId,
  month,
  year,
  db = pool,
}) {
  const now = new Date();
  const safeMonth = Number.isFinite(Number(month))
    ? Math.min(12, Math.max(1, Number(month)))
    : now.getUTCMonth() + 1;
  const safeYear = Number.isFinite(Number(year))
    ? Math.min(9999, Math.max(2000, Number(year)))
    : now.getUTCFullYear();

  const periodStart = new Date(Date.UTC(safeYear, safeMonth - 1, 1, 0, 0, 0, 0));
  const periodEnd = new Date(Date.UTC(safeYear, safeMonth, 1, 0, 0, 0, 0));

  const query = {
    text: `
      SELECT
        COALESCE(SUM(tokens_used), 0)::int AS monthly_tokens_used,
        COALESCE(SUM(estimated_cost_usd), 0)::numeric(12, 6) AS estimated_cost_usd,
        COUNT(*)::int AS total_requests
      FROM finance.ai_usage_events
      WHERE organization_id = $1
        AND created_at >= $2
        AND created_at < $3
    `,
    values: [organizationId, periodStart, periodEnd],
  };

  let row = {};
  try {
    const result = await db.query(query);
    row = result.rows[0] || {};
  } catch (error) {
    if (!safeDbTableError(error)) {
      throw error;
    }
  }

  return {
    organization_id: organizationId,
    month: safeMonth,
    year: safeYear,
    monthly_tokens_used: Number(row.monthly_tokens_used || 0),
    estimated_cost_usd: Number(row.estimated_cost_usd || 0),
    total_requests: Number(row.total_requests || 0),
  };
}

async function saveProvider({
  organizationId,
  provider,
  apiKey,
  model,
  useSystemKey,
  active,
  db = pool,
}) {
  const normalizedProvider = normalizeProviderInput(provider);
  const existing = await findProviderRow({
    organizationId,
    provider: normalizedProvider,
    db,
    activeOnly: false,
  });

  const normalizedUseSystemKey = safeBoolean(
    useSystemKey,
    existing?.use_system_key ?? false
  );
  const encryptedApiKey = String(apiKey || '').trim()
    ? encryptApiKey(apiKey)
    : existing?.encrypted_api_key || null;

  if (!encryptedApiKey && !normalizedUseSystemKey) {
    throw badRequest(
      'api_key is required unless use_system_key is enabled'
    );
  }

  const query = {
    text: `
      INSERT INTO finance.ai_providers (
        organization_id,
        provider,
        encrypted_api_key,
        model,
        use_system_key,
        active
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (organization_id, provider)
      DO UPDATE
      SET
        encrypted_api_key = EXCLUDED.encrypted_api_key,
        model = EXCLUDED.model,
        use_system_key = EXCLUDED.use_system_key,
        active = EXCLUDED.active
      RETURNING
        id,
        organization_id,
        provider,
        encrypted_api_key,
        model,
        use_system_key,
        active,
        created_at
    `,
    values: [
      organizationId,
      normalizedProvider,
      encryptedApiKey,
      safeModelName(model || existing?.model, normalizedProvider),
      normalizedUseSystemKey,
      safeBoolean(active, existing?.active ?? true),
    ],
  };

  const { rows } = await db.query(query);
  const persisted = rows[0];
  let decryptedPreview = null;
  if (encryptedApiKey) {
    try {
      decryptedPreview = decryptKey(encryptedApiKey);
    } catch {
      decryptedPreview = null;
    }
  }
  return mapProviderPublic(persisted, decryptedPreview);
}

async function getProvider({
  organizationId,
  provider,
  db = pool,
}) {
  const normalizedProvider = provider ? normalizeProviderInput(provider) : null;

  const row = await findProviderRow({
    organizationId,
    provider: normalizedProvider,
    db,
    activeOnly: false,
  });

  if (!row) {
    if (normalizedProvider) {
      return {
        id: null,
        organization_id: organizationId,
        provider: normalizedProvider,
        model: safeModelName('', normalizedProvider),
        active: true,
        use_system_key: false,
        created_at: null,
        key_configured: false,
        api_key_masked: null,
        system_key_available: systemKeyAvailable(normalizedProvider),
      };
    }

    return null;
  }

  let decryptedPreview = null;
  if (row.encrypted_api_key) {
    try {
      decryptedPreview = decryptKey(row.encrypted_api_key);
    } catch {
      decryptedPreview = null;
    }
  }

  return mapProviderPublic(row, decryptedPreview);
}

async function classifyTransactionWithAi({
  organizationId,
  description,
  categories,
  members,
  provider,
  db = pool,
}) {
  const credentials = await resolveProviderCredentials({
    organizationId,
    provider,
    db,
  });

  if (!credentials?.provider || !credentials?.api_key) {
    return null;
  }

  const prompt = buildClassificationPrompt({
    description,
    categories: Array.isArray(categories)
      ? categories.filter(Boolean).slice(0, 80)
      : [],
    members: Array.isArray(members)
      ? members
          .map((member) => ({
            full_name: String(member?.full_name || '').trim(),
            alias: String(member?.alias || '').trim() || null,
          }))
          .filter((member) => member.full_name)
          .slice(0, 80)
      : [],
  });

  const response = await requestProviderJson({
    provider: credentials.provider,
    apiKey: credentials.api_key,
    model: credentials.model,
    prompt,
  });

  const normalized = normalizeAiResult(response.parsed);
  if (!normalized) {
    return null;
  }

  const usageEvent = await logUsageEvent({
    organizationId,
    provider: credentials.provider,
    model: credentials.model,
    keySource: credentials.key_source,
    tokensUsed: response.usage_tokens,
    operation: 'classification',
    db,
  });

  return {
    ...normalized,
    provider: credentials.provider,
    model: credentials.model,
    key_source: credentials.key_source,
    usage_tokens: usageEvent.tokens_used,
    estimated_cost_usd: usageEvent.estimated_cost_usd,
  };
}

async function testConnection({
  organizationId,
  provider,
  db = pool,
}) {
  const credentials = await resolveProviderCredentials({
    organizationId,
    provider,
    db,
  });

  if (!credentials) {
    throw notFound(
      'No active AI provider found for this organization or system fallback'
    );
  }

  const probePrompt = [
    'Return strict JSON: {"category":"system_test","confidence":1,"member":null}.',
    'This is a health check.',
  ].join('\n');

  const response = await requestProviderJson({
    provider: credentials.provider,
    apiKey: credentials.api_key,
    model: credentials.model,
    prompt: probePrompt,
  });

  const parsed = normalizeAiResult(response.parsed);
  const usageEvent = await logUsageEvent({
    organizationId,
    provider: credentials.provider,
    model: credentials.model,
    keySource: credentials.key_source,
    tokensUsed: response.usage_tokens,
    operation: 'connection_test',
    db,
  });

  return {
    ok: Boolean(parsed),
    provider: credentials.provider,
    model: credentials.model,
    key_source: credentials.key_source,
    usage_tokens: usageEvent.tokens_used,
    estimated_cost_usd: usageEvent.estimated_cost_usd,
    checked_at: new Date().toISOString(),
  };
}

module.exports = {
  saveProvider,
  getProvider,
  decryptKey,
  testConnection,
  classifyTransactionWithAi,
  getMonthlyUsageStats,
};
