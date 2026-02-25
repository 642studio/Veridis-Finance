const { getCashflowProjection } = require('../controllers/intelligenceController');
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
}

module.exports = intelligenceRoutes;
