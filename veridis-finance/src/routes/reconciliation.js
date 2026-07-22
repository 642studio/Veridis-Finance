const {
  listCandidates,
  confirmCandidate,
  autoReconcile,
  reviewList,
  latestPeriod,
  unreconcile,
} = require('../controllers/reconciliationController');
const { authenticate, authorize, ROLES } = require('../middleware/auth');

async function reconciliationRoutes(app) {
  // Bulk auto-reconciliation (only unambiguous high-confidence matches).
  app.post(
    '/reconciliation/auto',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])] },
    autoReconcile
  );

  // Bandeja de conciliación del periodo (estados + CFDI ligado).
  app.get(
    '/reconciliation/review',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER])] },
    reviewList
  );

  // Último periodo con movimientos (para abrir donde hay datos).
  app.get(
    '/reconciliation/latest-period',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER])] },
    latestPeriod
  );

  // Deshacer una conciliación.
  app.post(
    '/transactions/:transactionId/unreconcile',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])] },
    unreconcile
  );

  // Ranked invoice candidates for a bank transaction.
  app.get(
    '/transactions/:transactionId/reconciliation-candidates',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS, ROLES.VIEWER])] },
    listCandidates
  );

  // Confirm a match (marks the invoice paid against the transaction).
  app.post(
    '/transactions/:transactionId/reconcile',
    { preHandler: [authenticate, authorize([ROLES.OWNER, ROLES.ADMIN, ROLES.OPS])] },
    confirmCandidate
  );
}

module.exports = reconciliationRoutes;
