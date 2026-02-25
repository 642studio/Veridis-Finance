const {
  uploadBankStatement,
  confirmBankStatementImport,
} = require('../controllers/bankStatementsController');
const { authenticate, authorize, ROLES } = require('../middleware/auth');

async function bankStatementsRoutes(app) {
  app.post(
    '/bank-statements/upload',
    {
      preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])],
      bodyLimit: 1024 * 1024 * 10,
    },
    uploadBankStatement
  );

  app.post(
    '/bank-statements/confirm/:importId',
    {
      preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])],
    },
    confirmBankStatementImport
  );
}

module.exports = bankStatementsRoutes;
