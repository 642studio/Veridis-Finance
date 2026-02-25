const {
  createInvoice,
  uploadInvoice,
} = require('../controllers/invoicesController');
const { authenticate, authorize, ROLES } = require('../middleware/auth');

async function invoicesRoutes(app) {
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
}

module.exports = invoicesRoutes;
