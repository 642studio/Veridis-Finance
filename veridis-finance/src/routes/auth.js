const { login, register } = require('../controllers/authController');
const {
  getAccount,
  updateAccount,
  updateAccountPassword,
  deleteAccount,
  getOrganization,
  updateOrganization,
  uploadOrganizationLogo,
} = require('../controllers/accountController');
const { authenticate, authorize, ROLES } = require('../middleware/auth');

async function authRoutes(app) {
  app.post('/register', register);
  app.post('/login', login);

  app.get('/account', { preHandler: [authenticate] }, getAccount);
  app.put('/account', { preHandler: [authenticate] }, updateAccount);
  app.put('/account/password', { preHandler: [authenticate] }, updateAccountPassword);
  app.delete('/account', { preHandler: [authenticate] }, deleteAccount);

  app.get('/organization', { preHandler: [authenticate] }, getOrganization);
  app.put(
    '/organization',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN])] },
    updateOrganization
  );
  app.post(
    '/organization/logo',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN])] },
    uploadOrganizationLogo
  );
}

module.exports = authRoutes;
