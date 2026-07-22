const { z } = require('zod');

const copilot = require('../services/copilot/copilotService');
const { authenticate, authorize, ROLES, resolveOrganizationId } = require('../middleware/auth');

const READ = [ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER];
const WRITE = [ROLES.OWNER, ROLES.ADMIN, ROLES.OPS];

const chatSchema = z.object({
  message: z.string().min(1).max(4000),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(8000),
  })).max(20).optional(),
  context: z.string().max(120).optional(),
});

async function copilotRoutes(app) {
  app.post('/copilot/chat', { preHandler: [authenticate, authorize(READ)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    const { message, history, context } = chatSchema.parse(request.body || {});
    const data = await copilot.chat({
      organizationId,
      organizationName: request.user?.organization_name || null,
      message,
      history: history || [],
      context: context || null,
    });
    reply.send({ data });
  });

  // Ejecuta una acción propuesta por el copiloto, ya confirmada por el usuario.
  app.post('/copilot/execute', { preHandler: [authenticate, authorize(WRITE)] }, async (request, reply) => {
    const organizationId = resolveOrganizationId(request);
    const { tool, input } = z.object({
      tool: z.string().min(1).max(60),
      input: z.record(z.unknown()).optional(),
    }).parse(request.body || {});
    const data = await copilot.executeAction({
      organizationId,
      userId: request.user?.user_id || null,
      tool,
      input: input || {},
    });
    reply.send({ data });
  });
}

module.exports = copilotRoutes;
