const {
  getMonthlyReport,
  getDiotReport,
  getDiotBatch,
  getAgingReport,
} = require('../controllers/reportsController');
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

  // Archivo batch oficial de la DIOT (.txt de 23 campos, listo para el applet).
  app.get(
    '/report/diot/batch',
    {
      preHandler: [
        authenticate,
        authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS]),
      ],
    },
    getDiotBatch
  );

  // Antigüedad de saldos (CxC/CxP) del libro de facturas pendientes.
  app.get(
    '/report/aging',
    {
      preHandler: [
        authenticate,
        authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER]),
      ],
    },
    getAgingReport
  );
}

module.exports = reportsRoutes;
