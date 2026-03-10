const {
  createTransaction,
  listTransactions,
  updateTransaction,
  deleteTransaction,
  listTransactionHistory,
  listRecurringCandidates,
  listRecurringAlerts,
  listRecurringRules,
  approveRecurringRule,
  suppressRecurringRule,
  unsuppressRecurringRule,
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

  app.get(
    '/transactions/recurring-candidates',
    {
      preHandler: [
        authenticate,
        authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER]),
      ],
    },
    listRecurringCandidates
  );

  app.get(
    '/transactions/recurring-alerts',
    {
      preHandler: [
        authenticate,
        authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER]),
      ],
    },
    listRecurringAlerts
  );

  app.get(
    '/transactions/recurring-rules',
    {
      preHandler: [
        authenticate,
        authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER]),
      ],
    },
    listRecurringRules
  );

  app.post(
    '/transactions/recurring-rules/approve',
    {
      preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])],
    },
    approveRecurringRule
  );

  app.post(
    '/transactions/recurring-rules/suppress',
    {
      preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])],
    },
    suppressRecurringRule
  );

  app.post(
    '/transactions/recurring-rules/:id/unsuppress',
    {
      preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])],
    },
    unsuppressRecurringRule
  );

  app.put(
    '/transactions/:id',
    {
      preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])],
    },
    updateTransaction
  );

  app.get(
    '/transactions/:id/history',
    {
      preHandler: [
        authenticate,
        authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER]),
      ],
    },
    listTransactionHistory
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
