const { z } = require('zod');

const { resolveOrganizationId } = require('../middleware/auth');
const transactionSplitsService = require('../services/transactionSplitsService');

const transactionParamsSchema = z.object({
  transactionId: z.string().uuid(),
});

const splitParamsSchema = z.object({
  splitId: z.string().uuid(),
});

const createSplitSchema = z.object({
  category_id: z.string().uuid(),
  subcategory_id: z.string().uuid().optional().nullable(),
  amount: z.coerce.number().positive(),
});

const updateSplitSchema = z
  .object({
    category_id: z.string().uuid().optional(),
    subcategory_id: z.string().uuid().optional().nullable(),
    amount: z.coerce.number().positive().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

async function listTransactionSplits(request, reply) {
  const params = transactionParamsSchema.parse(request.params || {});
  const organizationId = resolveOrganizationId(request);

  const rows = await transactionSplitsService.listSplitsByTransaction({
    organization_id: organizationId,
    transaction_id: params.transactionId,
  });

  reply.send({ data: rows });
}

async function createTransactionSplit(request, reply) {
  const params = transactionParamsSchema.parse(request.params || {});
  const payload = createSplitSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const row = await transactionSplitsService.createSplit({
    ...payload,
    organization_id: organizationId,
    transaction_id: params.transactionId,
  });

  reply.status(201).send({ data: row });
}

async function updateTransactionSplit(request, reply) {
  const params = splitParamsSchema.parse(request.params || {});
  const payload = updateSplitSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const row = await transactionSplitsService.updateSplit({
    organization_id: organizationId,
    split_id: params.splitId,
    patch: payload,
  });

  reply.send({ data: row });
}

async function deleteTransactionSplit(request, reply) {
  const params = splitParamsSchema.parse(request.params || {});
  const organizationId = resolveOrganizationId(request);

  const row = await transactionSplitsService.deleteSplit({
    organization_id: organizationId,
    split_id: params.splitId,
  });

  reply.send({ data: row });
}

module.exports = {
  listTransactionSplits,
  createTransactionSplit,
  updateTransactionSplit,
  deleteTransactionSplit,
};
