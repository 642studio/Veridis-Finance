const {
  getCashflowProjection,
  reclassifyTransactions,
  recategorizeReview,
} = require('../controllers/intelligenceController');
const { authenticate, authorize, ROLES } = require('../middleware/auth');

async function intelligenceRoutes(app) {
  app.get(
    '/intelligence/projection',
    {
      preHandler: [
        authenticate,
        authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER]),
      ],
    },
    getCashflowProjection
  );

  // Bulk re-run the hybrid classification engine over uncategorized
  // transactions. Write operation -> excludes viewer.
  app.post(
    '/intelligence/reclassify',
    {
      preHandler: [
        authenticate,
        authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS]),
      ],
    },
    reclassifyTransactions
  );

  // Re-categoriza los gastos en "Por revisar" (reglas + IA) a la taxonomía
  // canónica. Write -> excluye viewer.
  app.post(
    '/intelligence/recategorize-review',
    {
      preHandler: [
        authenticate,
        authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS]),
      ],
    },
    recategorizeReview
  );
}

module.exports = intelligenceRoutes;
