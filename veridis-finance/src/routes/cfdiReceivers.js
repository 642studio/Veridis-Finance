const {
  previewCsf,
  createReceiver,
  listReceivers,
  getReceiver,
} = require('../controllers/cfdiReceiversController');
const { authenticate, authorize, ROLES } = require('../middleware/auth');

async function cfdiReceiversRoutes(app) {
  // Upload a client's Constancia de Situación Fiscal -> prefilled fiscal data.
  app.post(
    '/receivers/preview-csf',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])] },
    previewCsf
  );

  app.post(
    '/receivers',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])] },
    createReceiver
  );

  app.get(
    '/receivers',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER])] },
    listReceivers
  );

  app.get(
    '/receivers/:id',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER])] },
    getReceiver
  );
}

module.exports = cfdiReceiversRoutes;
