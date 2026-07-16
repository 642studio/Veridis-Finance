const {
  getCashflowProjection,
  reclassifyTransactions,
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
}

module.exports = intelligenceRoutes;
