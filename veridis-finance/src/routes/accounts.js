const {
  listAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
} = require('../controllers/financeAccountsController');
const { authenticate, authorize, ROLES } = require('../middleware/auth');

const READ_ROLES = [ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER];
const WRITE_ROLES = [ROLES.OWNER, ROLES.ADMIN, ROLES.OPS];

async function accountsRoutes(app) {
  app.get(
    '/accounts',
    {
      preHandler: [authenticate, authorize(READ_ROLES)],
    },
    listAccounts
  );

  app.post(
    '/accounts',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    createAccount
  );

  app.put(
    '/accounts/:id',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    updateAccount
  );

  app.delete(
    '/accounts/:id',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    deleteAccount
  );
}

module.exports = accountsRoutes;
