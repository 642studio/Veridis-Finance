const {
  listInvoices,
  createInvoice,
  uploadInvoice,
  uploadInvoicesBulk,
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

  // Bulk XML upload (up to 50 files per request).
  app.post(
    '/invoices/upload-bulk',
    {
      preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])],
    },
    uploadInvoicesBulk
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
