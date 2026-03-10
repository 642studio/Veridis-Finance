const {
  listContacts,
  getContact,
  createContact,
  updateContact,
  deleteContact,
} = require('../controllers/contactsController');
const { authenticate, authorize, ROLES } = require('../middleware/auth');

const READ_ROLES = [ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER];
const WRITE_ROLES = [ROLES.OWNER, ROLES.ADMIN, ROLES.OPS];

async function contactsRoutes(app) {
  app.get(
    '/contacts',
    {
      preHandler: [authenticate, authorize(READ_ROLES)],
    },
    listContacts
  );
  app.get(
    '/contacts/:id',
    {
      preHandler: [authenticate, authorize(READ_ROLES)],
    },
    getContact
  );

  app.post(
    '/contacts',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    createContact
  );

  app.put(
    '/contacts/:id',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    updateContact
  );

  app.delete(
    '/contacts/:id',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    deleteContact
  );
}

module.exports = contactsRoutes;
