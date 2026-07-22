const {
  listClients,
  createClient,
  updateClient,
  deleteClient,
} = require('../controllers/clientsController');
const clientDirectory = require('../services/clientDirectoryService');
const { authenticate, authorize, ROLES, resolveOrganizationId } = require('../middleware/auth');

async function clientsRoutes(app) {
  app.get(
    '/clients',
    {
      preHandler: [
        authenticate,
        authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER]),
      ],
    },
    listClients
  );

  // Sincroniza el directorio de clientes desde facturas emitidas + CRM (S34).
  app.post(
    '/clients/sync',
    {
      preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])],
    },
    async (request) => {
      const organizationId = resolveOrganizationId(request);
      const result = await clientDirectory.sync({ organizationId });
      return { data: result };
    }
  );

  app.post(
    '/clients',
    {
      preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])],
    },
    createClient
  );

  app.put(
    '/clients/:id',
    {
      preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])],
    },
    updateClient
  );

  app.delete(
    '/clients/:id',
    {
      preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])],
    },
    deleteClient
  );
}

module.exports = clientsRoutes;
