const { z } = require('zod');

const transactionsService = require('../services/transactionsService');
const reportsService = require('../services/reportsService');
const { forbidden, resolveOrganizationId } = require('../middleware/auth');

function withSingleEntityConstraint(schema) {
  return schema.superRefine((value, ctx) => {
    const nonNullCount = [value.member_id, value.client_id, value.vendor_id].filter(
      (item) => item !== undefined && item !== null && String(item).trim() !== ''
    ).length;

    if (nonNullCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Only one entity link is allowed (member_id, client_id, or vendor_id)',
        path: ['member_id'],
      });
    }
  });
}

const createTransactionSchema = withSingleEntityConstraint(
  z.object({
    type: z.enum(['income', 'expense']),
    amount: z.coerce.number().positive(),
    category: z.string().min(1).max(120),
    description: z.string().max(500).optional().nullable(),
    entity: z.string().max(255).optional().nullable(),
    member_id: z.string().uuid().optional().nullable(),
    client_id: z.string().uuid().optional().nullable(),
    vendor_id: z.string().uuid().optional().nullable(),
    editable: z.coerce.boolean().optional(),
    notes: z.string().max(2000).optional().nullable(),
    match_confidence: z.coerce.number().min(0).max(1).optional().nullable(),
    match_method: z.enum(['rule', 'fuzzy', 'manual']).optional().nullable(),
    transaction_date: z.coerce.date(),
  })
);

const updateTransactionSchema = withSingleEntityConstraint(
  z
    .object({
      type: z.enum(['income', 'expense']).optional(),
      amount: z.coerce.number().positive().optional(),
      category: z.string().min(1).max(120).optional(),
      description: z.string().max(500).optional().nullable(),
      entity: z.string().max(255).optional().nullable(),
      member_id: z.string().uuid().optional().nullable(),
      client_id: z.string().uuid().optional().nullable(),
      vendor_id: z.string().uuid().optional().nullable(),
      editable: z.coerce.boolean().optional(),
      notes: z.string().max(2000).optional().nullable(),
      match_confidence: z.coerce.number().min(0).max(1).optional().nullable(),
      match_method: z.enum(['rule', 'fuzzy', 'manual']).optional().nullable(),
      transaction_date: z.coerce.date().optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
      message: 'At least one field is required',
    })
);

const transactionParamsSchema = z.object({
  id: z.string().uuid(),
});

const listTransactionsQuerySchema = z
  .object({
    type: z.enum(['income', 'expense']).optional(),
    member_id: z.string().uuid().optional(),
    client_id: z.string().uuid().optional(),
    vendor_id: z.string().uuid().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .superRefine((value, ctx) => {
    if (value.from && value.to && value.from > value.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'from must be before or equal to to',
        path: ['from'],
      });
    }

    const nonNullCount = [value.member_id, value.client_id, value.vendor_id].filter(
      Boolean
    ).length;
    if (nonNullCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Use only one entity filter at a time (member_id, client_id, vendor_id)',
        path: ['member_id'],
      });
    }
  });

const automationTransactionSchema = withSingleEntityConstraint(
  z.object({
    organization_id: z.string().uuid().optional(),
    transaction: z.object({
      type: z.enum(['income', 'expense']),
      amount: z.coerce.number().positive(),
      category: z.string().min(1).max(120),
      description: z.string().max(500).optional().nullable(),
      entity: z.string().max(255).optional().nullable(),
      member_id: z.string().uuid().optional().nullable(),
      client_id: z.string().uuid().optional().nullable(),
      vendor_id: z.string().uuid().optional().nullable(),
      editable: z.coerce.boolean().optional(),
      notes: z.string().max(2000).optional().nullable(),
      match_confidence: z.coerce.number().min(0).max(1).optional().nullable(),
      match_method: z.enum(['rule', 'fuzzy', 'manual']).optional().nullable(),
      transaction_date: z.coerce.date(),
    }),
    metadata: z
      .object({
        source_system: z.string().min(1).max(120).optional(),
        external_id: z.string().min(1).max(120).optional(),
        correlation_id: z.string().min(1).max(120).optional(),
      })
      .optional(),
  })
);

async function createTransaction(request, reply) {
  const payload = createTransactionSchema.parse(request.body);
  const organizationId = resolveOrganizationId(request);

  const created = await transactionsService.createTransaction({
    ...payload,
    organization_id: organizationId,
  });

  reply.status(201).send({ data: created });
}

async function listTransactions(request, reply) {
  const query = listTransactionsQuerySchema.parse(request.query);
  const organizationId = resolveOrganizationId(request);
  const results = await transactionsService.listTransactions({
    ...query,
    organization_id: organizationId,
  });

  reply.send({ data: results });
}

async function updateTransaction(request, reply) {
  const params = transactionParamsSchema.parse(request.params);
  const payload = updateTransactionSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const updated = await transactionsService.updateTransaction({
    organization_id: organizationId,
    transaction_id: params.id,
    patch: payload,
  });

  reply.send({ data: updated });
}

async function deleteTransaction(request, reply) {
  const params = transactionParamsSchema.parse(request.params);
  const organizationId = resolveOrganizationId(request);

  const result = await transactionsService.deleteTransaction({
    organization_id: organizationId,
    transaction_id: params.id,
  });

  reply.send({ data: result });
}

async function createAutomationTransaction(request, reply) {
  const payload = automationTransactionSchema.parse(request.body);
  const organizationId = request.apiKey?.organization_id;

  if (!organizationId) {
    throw forbidden('Automation API key has no organization scope');
  }

  if (payload.organization_id && payload.organization_id !== organizationId) {
    throw forbidden('Payload organization_id does not match API key scope');
  }

  const created = await transactionsService.createTransaction({
    ...payload.transaction,
    organization_id: organizationId,
  });

  const summaryMonth = payload.transaction.transaction_date.getUTCMonth() + 1;
  const summaryYear = payload.transaction.transaction_date.getUTCFullYear();
  const monthlySummary = await reportsService.getMonthlyReport({
    organization_id: organizationId,
    month: summaryMonth,
    year: summaryYear,
  });

  request.log.info(
    {
      source: 'automation',
      organization_id: organizationId,
      transaction_id: created.id,
      automation_key: request.automation?.key_fingerprint,
      metadata: payload.metadata || null,
    },
    'Automation transaction created'
  );

  reply.status(201).send({
    success: true,
    monthly_summary: monthlySummary,
  });
}

module.exports = {
  createTransaction,
  listTransactions,
  updateTransaction,
  deleteTransaction,
  createAutomationTransaction,
};
