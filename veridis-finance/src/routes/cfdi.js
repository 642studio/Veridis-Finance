const {
  issueCfdi,
  listCfdi,
  getCfdi,
  getCfdiPdf,
  getCfdiXml,
  listReceivedCfdi,
  markPaidCfdi,
  pushCfdiToCrm,
  getIssuer,
  putIssuer,
} = require('../controllers/cfdiController');
const { authenticate, authorize, ROLES } = require('../middleware/auth');

async function cfdiRoutes(app) {
  // Fiscal issuer (emisor) config per tenant. Owner/Admin only — writes PAC creds.
  app.get(
    '/cfdi/issuer',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN])] },
    getIssuer
  );
  app.put(
    '/cfdi/issuer',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN])] },
    putIssuer
  );

  // Emit (timbrar) a CFDI de Ingreso.
  app.post(
    '/cfdi/issue',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])] },
    issueCfdi
  );

  // Reconcile a CFDI as paid (syncs the payment to the 642 CRM).
  app.post(
    '/cfdi/:id/mark-paid',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])] },
    markPaidCfdi
  );

  // Mirror an issued CFDI to the 642 CRM as an invoice (retry helper).
  app.post(
    '/cfdi/:id/push-crm',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])] },
    pushCfdiToCrm
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
