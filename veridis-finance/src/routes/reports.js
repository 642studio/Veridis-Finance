const { getMonthlyReport, getDiotReport } = require('../controllers/reportsController');
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

  // IVA mensual por proveedor (base para DIOT), desde CFDIs recibidos subidos.
  app.get(
    '/report/diot',
    {
      preHandler: [
        authenticate,
        authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER]),
      ],
    },
    getDiotReport
  );
}

module.exports = reportsRoutes;
