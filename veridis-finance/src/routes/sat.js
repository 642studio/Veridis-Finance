const {
  getCredentials,
  uploadCredentials,
  deleteCredentials,
  createRequest,
  checkRequest,
  reimportRequest,
  listRequests,
} = require('../controllers/satController');
const { authenticate, authorize, ROLES } = require('../middleware/auth');

/**
 * SAT Descarga Masiva — the connector that reads a taxpayer's COMPLETE fiscal
 * history from the SAT using their e.firma. e.firma handling is Owner/Admin only
 * (it stores the taxpayer's most sensitive credential).
 */
async function satRoutes(app) {
  app.get(
    '/sat/credentials',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN])] },
    getCredentials
  );

  app.post(
    '/sat/credentials',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN])] },
    uploadCredentials
  );

  app.delete(
    '/sat/credentials',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN])] },
    deleteCredentials
  );

  app.get(
    '/sat/requests',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])] },
    listRequests
  );

  app.post(
    '/sat/requests',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN])] },
    createRequest
  );

  app.post(
    '/sat/requests/:id/check',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])] },
    checkRequest
  );

  // Re-download + re-import an already-finished solicitud (same SAT folio).
  app.post(
    '/sat/requests/:id/reimport',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN])] },
    reimportRequest
  );
}

module.exports = satRoutes;
