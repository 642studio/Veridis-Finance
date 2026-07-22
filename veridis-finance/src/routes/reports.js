const {
  getMonthlyReport,
  getDiotReport,
  getDiotBatch,
  getAgingReport,
  getCollectionReminders,
} = require('../controllers/reportsController');
const categoryReport = require('../services/categoryReportService');
const { resolveOrganizationId } = require('../middleware/auth');
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

  // Recordatorios de cobro por cliente (mensaje listo para copiar/enviar).
  app.get(
    '/report/collection-reminders',
    {
      preHandler: [
        authenticate,
        authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS]),
      ],
    },
    getCollectionReminders
  );

  const READ = [ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER];

  // Catálogo canónico de categorías (para poblar selects en Movimientos).
  app.get('/categories/catalog', { preHandler: [authenticate, authorize(READ)] },
    async () => ({ data: categoryReport.catalog() }));

  // Desglose por categoría del mes + semáforo "Por revisar" (S32).
  app.get('/report/category-breakdown', { preHandler: [authenticate, authorize(READ)] },
    async (request) => {
      const organizationId = resolveOrganizationId(request);
      const now = new Date();
      const year = Number(request.query?.year) || now.getUTCFullYear();
      const month = Number(request.query?.month) || (now.getUTCMonth() + 1);
      return { data: await categoryReport.monthlyBreakdown({ organizationId, year, month }) };
    });

  // Exportación CSV de movimientos (S33).
  app.get('/report/transactions.csv', { preHandler: [authenticate, authorize(READ)] },
    async (request, reply) => {
      const organizationId = resolveOrganizationId(request);
      const { from, to } = request.query || {};
      const { csv, count } = await categoryReport.exportCsv({ organizationId, from, to });
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="movimientos_${from || 'inicio'}_${to || 'hoy'}.csv"`);
      reply.header('X-Row-Count', String(count));
      return reply.send(csv);
    });
}

module.exports = reportsRoutes;
