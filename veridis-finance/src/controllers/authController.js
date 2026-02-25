const { z } = require('zod');

const authService = require('../services/authService');
const { PLAN_TIERS } = require('../services/organizationService');
const { parseTenantSlugFromHost } = require('../middleware/tenant');

const registerSchema = z.object({
  organization_name: z.string().min(2).max(120),
  organization_slug: z.string().min(2).max(120).optional(),
  owner_name: z.string().min(2).max(120),
  owner_email: z.string().email(),
  password: z.string().min(8).max(120),
  plan: z
    .enum([PLAN_TIERS.FREE, PLAN_TIERS.PRO, PLAN_TIERS.ENTERPRISE])
    .default(PLAN_TIERS.FREE),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(120),
  organization_id: z.string().uuid().optional(),
  organization_slug: z.string().min(2).max(120).optional(),
});

async function register(request, reply) {
  const payload = registerSchema.parse(request.body);
  const result = await authService.register(payload);
  reply.status(201).send({ data: result });
}

async function login(request, reply) {
  const payload = loginSchema.parse(request.body);
  const tenantSlug = parseTenantSlugFromHost(request.hostname);

  const result = await authService.login({
    ...payload,
    tenant_slug: tenantSlug,
  });

  reply.send({ data: result });
}

module.exports = {
  register,
  login,
};
