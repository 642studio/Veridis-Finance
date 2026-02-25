const { z } = require('zod');

const { resolveOrganizationId } = require('../middleware/auth');
const {
  saveProvider,
  getProvider,
  testConnection,
  getMonthlyUsageStats,
} = require('../modules/finance/intelligence/ai-provider.service');

const saveProviderSchema = z.object({
  provider: z.string().trim().min(2).max(40),
  api_key: z.string().trim().min(10).max(4096).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  use_system_key: z.coerce.boolean().optional(),
  active: z.coerce.boolean().optional(),
});

const getProviderQuerySchema = z.object({
  provider: z.string().trim().min(2).max(40).optional(),
});

const testConnectionSchema = z.object({
  provider: z.string().trim().min(2).max(40).optional(),
});

const usageQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(9999).optional(),
});

async function saveAiProvider(request, reply) {
  const payload = saveProviderSchema.parse(request.body);
  const organizationId = resolveOrganizationId(request);

  const saved = await saveProvider({
    organizationId,
    provider: payload.provider,
    apiKey: payload.api_key,
    model: payload.model,
    useSystemKey: payload.use_system_key,
    active: payload.active,
  });

  request.log.info(
    {
      source: 'ai_provider_save',
      organization_id: organizationId,
      provider: saved.provider,
      active: saved.active,
    },
    'AI provider saved'
  );

  reply.send({ data: saved });
}

async function getAiProvider(request, reply) {
  const query = getProviderQuerySchema.parse(request.query);
  const organizationId = resolveOrganizationId(request);

  const provider = await getProvider({
    organizationId,
    provider: query.provider,
  });

  reply.send({ data: provider });
}

async function testAiProviderConnection(request, reply) {
  const payload = testConnectionSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const result = await testConnection({
    organizationId,
    provider: payload.provider,
  });

  request.log.info(
    {
      source: 'ai_provider_test',
      organization_id: organizationId,
      provider: result.provider,
      key_source: result.key_source,
      usage_tokens: result.usage_tokens,
      ok: result.ok,
    },
    'AI provider connectivity tested'
  );

  reply.send({ data: result });
}

async function getAiUsageStats(request, reply) {
  const query = usageQuerySchema.parse(request.query);
  const organizationId = resolveOrganizationId(request);

  const stats = await getMonthlyUsageStats({
    organizationId,
    month: query.month,
    year: query.year,
  });

  reply.send({ data: stats });
}

module.exports = {
  saveAiProvider,
  getAiProvider,
  testAiProviderConnection,
  getAiUsageStats,
};
