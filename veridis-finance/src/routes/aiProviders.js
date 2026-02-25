const {
  saveAiProvider,
  getAiProvider,
  testAiProviderConnection,
  getAiUsageStats,
} = require('../controllers/aiProvidersController');
const { authenticate, authorize, ROLES } = require('../middleware/auth');

async function aiProvidersRoutes(app) {
  app.get(
    '/intelligence/ai-provider',
    {
      preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN])],
    },
    getAiProvider
  );

  app.post(
    '/intelligence/ai-provider',
    {
      preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN])],
    },
    saveAiProvider
  );

  app.post(
    '/intelligence/ai-provider/test',
    {
      preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN])],
    },
    testAiProviderConnection
  );

  app.get(
    '/intelligence/ai-provider/usage',
    {
      preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN])],
    },
    getAiUsageStats
  );
}

module.exports = aiProvidersRoutes;
