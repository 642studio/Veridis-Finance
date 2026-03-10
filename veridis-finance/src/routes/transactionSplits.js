const {
  listTransactionSplits,
  createTransactionSplit,
  updateTransactionSplit,
  deleteTransactionSplit,
} = require('../controllers/transactionSplitsController');
const { authenticate, authorize, ROLES } = require('../middleware/auth');

const READ_ROLES = [ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER];
const WRITE_ROLES = [ROLES.OWNER, ROLES.ADMIN, ROLES.OPS];

async function transactionSplitsRoutes(app) {
  app.get(
    '/transactions/:transactionId/splits',
    {
      preHandler: [authenticate, authorize(READ_ROLES)],
    },
    listTransactionSplits
  );

  app.post(
    '/transactions/:transactionId/splits',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    createTransactionSplit
  );

  app.put(
    '/transaction-splits/:splitId',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    updateTransactionSplit
  );

  app.delete(
    '/transaction-splits/:splitId',
    {
      preHandler: [authenticate, authorize(WRITE_ROLES)],
    },
    deleteTransactionSplit
  );
}

module.exports = transactionSplitsRoutes;
