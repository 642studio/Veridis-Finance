const { getMonthlyReport } = require('../controllers/reportsController');
const { authenticate, authorize, ROLES } = require('../middleware/auth');

async function reportsRoutes(app) {
  app.get(
    '/report/month',
    {
      preHandler: [
        authenticate,
        authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER]),
      ],
    },
    getMonthlyReport
  );
}

module.exports = reportsRoutes;
