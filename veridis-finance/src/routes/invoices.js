const {
  listInvoices,
  createInvoice,
  uploadInvoice,
  updateInvoiceStatus,
} = require('../controllers/invoicesController');
const { authenticate, authorize, ROLES } = require('../middleware/auth');

async function invoicesRoutes(app) {
  app.get(
    '/invoices',
    {
      preHandler: [
        authenticate,
        authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER]),
      ],
    },
    listInvoices
  );

  app.post(
    '/invoices/upload',
    {
      preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])],
    },
    uploadInvoice
  );

  app.post(
    '/invoices',
    {
      preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])],
    },
    createInvoice
  );

  app.patch(
    '/invoices/:id/status',
    {
      preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])],
    },
    updateInvoiceStatus
  );
}

module.exports = invoicesRoutes;
