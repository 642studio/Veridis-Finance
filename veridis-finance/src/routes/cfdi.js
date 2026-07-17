const {
  issueCfdi,
  listCfdi,
  getCfdi,
  getCfdiPdf,
  getCfdiXml,
  listReceivedCfdi,
} = require('../controllers/cfdiController');
const { authenticate, authorize, ROLES } = require('../middleware/auth');

async function cfdiRoutes(app) {
  // Emit (timbrar) a CFDI de Ingreso.
  app.post(
    '/cfdi/issue',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])] },
    issueCfdi
  );

  // Received invoices (facturas de proveedores) straight from the PAC.
  app.get(
    '/cfdi/received',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER])] },
    listReceivedCfdi
  );

  // Issued CFDIs from our records.
  app.get(
    '/cfdi',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER])] },
    listCfdi
  );

  app.get(
    '/cfdi/:id',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER])] },
    getCfdi
  );

  app.get(
    '/cfdi/:id/pdf',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER])] },
    getCfdiPdf
  );

  app.get(
    '/cfdi/:id/xml',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER])] },
    getCfdiXml
  );
}

module.exports = cfdiRoutes;
