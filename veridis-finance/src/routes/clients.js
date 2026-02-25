const {
  listClients,
  createClient,
  updateClient,
  deleteClient,
} = require('../controllers/clientsController');
const { authenticate, authorize, ROLES } = require('../middleware/auth');

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
