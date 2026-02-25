const {
  createTransaction,
  listTransactions,
  updateTransaction,
  deleteTransaction,
  createAutomationTransaction,
} = require('../controllers/transactionsController');
const { authenticate, authorize, ROLES } = require('../middleware/auth');
const {
  authenticateAutomationApiKey,
  authorizeApiKeyRoles,
} = require('../middleware/apiKeyAuth');
const { automationRateLimit } = require('../middleware/rateLimit');
const {
  enforceTransactionPlanLimit,
  requireApiAccessPlan,
} = require('../middleware/subscription');

async function transactionsRoutes(app) {
  app.post(
    '/transactions/automation',
    {
      preHandler: [
        automationRateLimit,
        authenticateAutomationApiKey,
        authorizeApiKeyRoles([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS]),
        requireApiAccessPlan,
        enforceTransactionPlanLimit,
      ],
      bodyLimit: 1024 * 20,
    },
    createAutomationTransaction
  );

  app.post(
    '/transactions',
    {
      preHandler: [
        authenticate,
        authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS]),
        enforceTransactionPlanLimit,
      ],
    },
    createTransaction
  );
  app.get(
    '/transactions',
    {
      preHandler: [
        authenticate,
        authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER]),
      ],
    },
    listTransactions
  );

  app.put(
    '/transactions/:id',
    {
      preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])],
    },
    updateTransaction
  );

  app.delete(
    '/transactions/:id',
    {
      preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])],
    },
    deleteTransaction
  );
}

module.exports = transactionsRoutes;
