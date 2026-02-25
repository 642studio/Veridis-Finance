const {
  listVendors,
  createVendor,
  updateVendor,
  deleteVendor,
} = require('../controllers/vendorsController');
const { authenticate, authorize, ROLES } = require('../middleware/auth');

async function vendorsRoutes(app) {
  app.get(
    '/vendors',
    {
      preHandler: [
        authenticate,
        authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER]),
      ],
    },
    listVendors
  );

  app.post(
    '/vendors',
    {
      preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])],
    },
    createVendor
  );

  app.put(
    '/vendors/:id',
    {
      preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])],
    },
    updateVendor
  );

  app.delete(
    '/vendors/:id',
    {
      preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])],
    },
    deleteVendor
  );
}

module.exports = vendorsRoutes;
