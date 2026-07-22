const {
  listVendors,
  createVendor,
  updateVendor,
  deleteVendor,
} = require('../controllers/vendorsController');
const clientDirectory = require('../services/clientDirectoryService');
const { authenticate, authorize, ROLES, resolveOrganizationId } = require('../middleware/auth');

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

  // Siembra proveedores desde los emisores de CFDIs recibidos (S39).
  app.post(
    '/vendors/sync',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])] },
    async (request) => {
      const organizationId = resolveOrganizationId(request);
      return { data: await clientDirectory.syncVendors({ organizationId }) };
    }
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
