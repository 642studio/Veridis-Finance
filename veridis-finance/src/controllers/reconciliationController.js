const { z } = require('zod');

const reconciliationService = require('../services/reconciliationService');
const { resolveOrganizationId } = require('../middleware/auth');

const idParams = z.object({ transactionId: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(5),
});
const confirmSchema = z.object({ invoice_id: z.string().uuid() });

/** Ranked invoice candidates for a bank transaction. */
async function listCandidates(request, reply) {
  const { transactionId } = idParams.parse(request.params);
  const { limit } = listQuery.parse(request.query);
  const organizationId = resolveOrganizationId(request);
  const data = await reconciliationService.findInvoiceCandidates({
    organization_id: organizationId,
    transaction_id: transactionId,
    limit,
  });
  reply.send({ data });
}

/** Confirm a match: mark the chosen invoice paid against this transaction. */
async function confirmCandidate(request, reply) {
  const { transactionId } = idParams.parse(request.params);
  const { invoice_id } = confirmSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);
  const data = await reconciliationService.confirmMatch({
    organization_id: organizationId,
    transaction_id: transactionId,
    invoice_id,
  });
  reply.send({ data });
}

module.exports = { listCandidates, confirmCandidate };
