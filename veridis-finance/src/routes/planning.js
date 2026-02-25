const {
  importPlanningWorkbook,
  listPlans,
  getPlanOverview,
  getPlanResults,
  updatePlanConfig,
  getPlanProducts,
  createProduct,
  updateProduct,
  patchProductById,
  deleteProduct,
  getPlanFixedCosts,
  createFixedCost,
  updateFixedCost,
  patchFixedCostById,
  deleteFixedCost,
  getPlanVariables,
  replaceVariables,
  patchVariableById,
  recalculatePlan,
} = require('../controllers/planningController');
const { authenticate, authorize, ROLES } = require('../middleware/auth');

const READ_ROLES = [ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER];
const WRITE_ROLES = [ROLES.OWNER, ROLES.ADMIN, ROLES.OPS];

async function planningRoutes(app) {
  app.post(
    '/planning/import',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
      bodyLimit: 1024 * 1024 * 20,
    },
    importPlanningWorkbook
  );

  app.get(
    '/planning/plans',
    {
      preHandler: [authenticate, authorize(READ_ROLES)],
    },
    listPlans
  );

  app.get(
    '/planning/plans/:planId/overview',
    {
      preHandler: [authenticate, authorize(READ_ROLES)],
    },
    getPlanOverview
  );

  app.get(
    '/planning/plans/:planId/results',
    {
      preHandler: [authenticate, authorize(READ_ROLES)],
    },
    getPlanResults
  );

  app.put(
    '/planning/plans/:planId/config',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    updatePlanConfig
  );

  app.patch(
    '/planning/plans/:planId/config',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    updatePlanConfig
  );

  // Input-based canonical endpoint requested.
  app.patch(
    '/planning/config/:planId',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    updatePlanConfig
  );

  app.post(
    '/planning/plans/:planId/recalculate',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    recalculatePlan
  );

  app.get(
    '/planning/plans/:planId/products',
    {
      preHandler: [authenticate, authorize(READ_ROLES)],
    },
    getPlanProducts
  );

  app.post(
    '/planning/plans/:planId/products',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    createProduct
  );

  app.put(
    '/planning/plans/:planId/products/:productId',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    updateProduct
  );

  app.patch(
    '/planning/plans/:planId/products/:productId',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    updateProduct
  );

  // Input-based canonical endpoint requested.
  app.patch(
    '/planning/products/:productId',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    patchProductById
  );

  app.delete(
    '/planning/plans/:planId/products/:productId',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    deleteProduct
  );

  app.get(
    '/planning/plans/:planId/fixed-costs',
    {
      preHandler: [authenticate, authorize(READ_ROLES)],
    },
    getPlanFixedCosts
  );

  app.post(
    '/planning/plans/:planId/fixed-costs',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    createFixedCost
  );

  app.put(
    '/planning/plans/:planId/fixed-costs/:costId',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    updateFixedCost
  );

  app.patch(
    '/planning/plans/:planId/fixed-costs/:costId',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    updateFixedCost
  );

  // Input-based canonical endpoint requested.
  app.patch(
    '/planning/fixed-costs/:costId',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    patchFixedCostById
  );

  app.delete(
    '/planning/plans/:planId/fixed-costs/:costId',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    deleteFixedCost
  );

  app.get(
    '/planning/plans/:planId/variables',
    {
      preHandler: [authenticate, authorize(READ_ROLES)],
    },
    getPlanVariables
  );

  app.put(
    '/planning/plans/:planId/variables',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    replaceVariables
  );

  app.patch(
    '/planning/plans/:planId/variables',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    replaceVariables
  );

  // Input-based canonical endpoint requested.
  app.patch(
    '/planning/variables/:variableId',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    patchVariableById
  );
}

module.exports = planningRoutes;
