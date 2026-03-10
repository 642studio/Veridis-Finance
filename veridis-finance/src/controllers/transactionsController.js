const { z } = require('zod');

const transactionsService = require('../services/transactionsService');
const reportsService = require('../services/reportsService');
const recurringDetectionService = require('../services/recurringDetectionService');
const recurringRulesService = require('../services/recurringRulesService');
const { forbidden, resolveOrganizationId } = require('../middleware/auth');

function countLinkedEntities(value) {
  return [value.member_id, value.client_id, value.vendor_id, value.contact_id].filter(
    (item) => item !== undefined && item !== null && String(item).trim() !== ''
  ).length;
}

function withSingleEntityConstraint(schema) {
  return schema.superRefine((value, ctx) => {
    const nonNullCount = countLinkedEntities(value);

    if (nonNullCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Only one entity link is allowed (member_id, client_id, vendor_id, or contact_id)',
        path: ['member_id'],
      });
    }
  });
}

const createTransactionSchema = withSingleEntityConstraint(
  z.object({
    account_id: z.string().uuid().optional().nullable(),
    contact_id: z.string().uuid().optional().nullable(),
    currency: z.string().trim().min(1).max(10).optional(),
    status: z.enum(['posted', 'pending', 'reconciled', 'void']).optional(),
    tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
    source: z.string().trim().min(1).max(80).optional(),
    original_description: z.string().max(500).optional().nullable(),
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
      account_id: z.string().uuid().optional().nullable(),
      contact_id: z.string().uuid().optional().nullable(),
      currency: z.string().trim().min(1).max(10).optional(),
      status: z.enum(['posted', 'pending', 'reconciled', 'void']).optional(),
      tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
      source: z.string().trim().min(1).max(80).optional(),
      original_description: z.string().max(500).optional().nullable(),
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

const transactionHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const recurringCandidatesQuerySchema = z.object({
  lookback_days: z.coerce.number().int().min(30).max(730).default(180),
  min_occurrences: z.coerce.number().int().min(2).max(12).default(3),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const recurringAlertsQuerySchema = z.object({
  lookback_days: z.coerce.number().int().min(30).max(730).default(180),
  min_occurrences: z.coerce.number().int().min(2).max(12).default(3),
  due_window_days: z.coerce.number().int().min(1).max(30).default(7),
  overdue_grace_days: z.coerce.number().int().min(0).max(30).default(2),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const recurringRulesQuerySchema = z.object({
  status: z.enum(['approved', 'suppressed']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const recurringRuleParamsSchema = z.object({
  id: z.string().uuid(),
});

const recurringCandidatePayloadSchema = z.object({
  key: z.string().trim().min(1).max(400),
  type: z.enum(['income', 'expense']),
  amount: z.coerce.number().positive(),
  category: z.string().trim().min(1).max(120).nullable().optional(),
  normalized_description: z.string().trim().min(1).max(500),
  frequency: z.string().trim().min(1).max(30),
  average_interval_days: z.coerce.number().positive(),
  next_expected_date: z.coerce.date(),
  confidence: z.coerce.number().min(0).max(1),
});

const approveRecurringRuleSchema = z.object({
  candidate: recurringCandidatePayloadSchema,
  notes: z.string().trim().max(1000).optional(),
});

const suppressRecurringRuleSchema = z.object({
  candidate: recurringCandidatePayloadSchema,
  suppress_days: z.coerce.number().int().min(1).max(365).default(30),
  notes: z.string().trim().max(1000).optional(),
});

const listTransactionsQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(200).optional(),
    type: z.enum(['income', 'expense']).optional(),
    account_id: z.string().uuid().optional(),
    contact_id: z.string().uuid().optional(),
    status: z.enum(['posted', 'pending', 'reconciled', 'void']).optional(),
    source: z.string().trim().min(1).max(80).optional(),
    member_id: z.string().uuid().optional(),
    client_id: z.string().uuid().optional(),
    vendor_id: z.string().uuid().optional(),
    sort_by: z
      .enum(['transaction_date', 'amount', 'created_at', 'category'])
      .default('transaction_date'),
    sort_order: z.enum(['asc', 'desc']).default('desc'),
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

    const nonNullCount = [
      value.member_id,
      value.client_id,
      value.vendor_id,
      value.contact_id,
    ].filter(Boolean).length;
    if (nonNullCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Use only one entity filter at a time (member_id, client_id, vendor_id, contact_id)',
        path: ['member_id'],
      });
    }
  });

const automationTransactionSchema = z
  .object({
    organization_id: z.string().uuid().optional(),
    transaction: z.object({
      account_id: z.string().uuid().optional().nullable(),
      contact_id: z.string().uuid().optional().nullable(),
      currency: z.string().trim().min(1).max(10).optional(),
      status: z.enum(['posted', 'pending', 'reconciled', 'void']).optional(),
      tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
      source: z.string().trim().min(1).max(80).optional(),
      original_description: z.string().max(500).optional().nullable(),
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
  .superRefine((value, ctx) => {
    const nonNullCount = countLinkedEntities(value.transaction || {});
    if (nonNullCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Only one entity link is allowed (member_id, client_id, vendor_id, or contact_id)',
        path: ['transaction', 'member_id'],
      });
    }
  });

async function createTransaction(request, reply) {
  const payload = createTransactionSchema.parse(request.body);
  const organizationId = resolveOrganizationId(request);

  const created = await transactionsService.createTransaction(
    {
      ...payload,
      organization_id: organizationId,
    },
    {
      actor_user_id: request.user?.user_id || null,
      actor_role: request.user?.role || null,
      audit_source: payload.source || 'api',
    }
  );

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
    actor_user_id: request.user?.user_id || null,
    actor_role: request.user?.role || null,
    audit_source: payload.source || null,
  });

  reply.send({ data: updated });
}

async function deleteTransaction(request, reply) {
  const params = transactionParamsSchema.parse(request.params);
  const organizationId = resolveOrganizationId(request);

  const result = await transactionsService.deleteTransaction({
    organization_id: organizationId,
    transaction_id: params.id,
    actor_user_id: request.user?.user_id || null,
    actor_role: request.user?.role || null,
    audit_source: 'api',
  });

  reply.send({ data: result });
}

async function listTransactionHistory(request, reply) {
  const params = transactionParamsSchema.parse(request.params);
  const query = transactionHistoryQuerySchema.parse(request.query || {});
  const organizationId = resolveOrganizationId(request);

  const rows = await transactionsService.listTransactionHistory({
    organization_id: organizationId,
    transaction_id: params.id,
    limit: query.limit,
  });

  reply.send({ data: rows });
}

async function listRecurringCandidates(request, reply) {
  const query = recurringCandidatesQuerySchema.parse(request.query || {});
  const organizationId = resolveOrganizationId(request);

  const rows = await recurringDetectionService.listRecurringCandidates({
    organization_id: organizationId,
    lookback_days: query.lookback_days,
    min_occurrences: query.min_occurrences,
    limit: query.limit,
  });

  request.log.info(
    {
      organization_id: organizationId,
      lookback_days: query.lookback_days,
      min_occurrences: query.min_occurrences,
      result_count: rows.length,
    },
    'Recurring candidates computed'
  );

  reply.send({ data: rows });
}

async function listRecurringAlerts(request, reply) {
  const query = recurringAlertsQuerySchema.parse(request.query || {});
  const organizationId = resolveOrganizationId(request);

  const result = await recurringDetectionService.listRecurringAlerts({
    organization_id: organizationId,
    lookback_days: query.lookback_days,
    min_occurrences: query.min_occurrences,
    due_window_days: query.due_window_days,
    overdue_grace_days: query.overdue_grace_days,
    limit: query.limit,
  });

  request.log.info(
    {
      organization_id: organizationId,
      due_window_days: query.due_window_days,
      overdue_grace_days: query.overdue_grace_days,
      due_soon_count: result.due_soon.length,
      overdue_count: result.overdue.length,
    },
    'Recurring alerts computed'
  );

  reply.send({ data: result });
}

async function listRecurringRules(request, reply) {
  const query = recurringRulesQuerySchema.parse(request.query || {});
  const organizationId = resolveOrganizationId(request);

  const rows = await recurringRulesService.listRecurringRules({
    organization_id: organizationId,
    status: query.status,
    limit: query.limit,
    offset: query.offset,
  });

  reply.send({ data: rows });
}

async function approveRecurringRule(request, reply) {
  const payload = approveRecurringRuleSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const rule = await recurringRulesService.upsertRecurringRule({
    organization_id: organizationId,
    candidate: payload.candidate,
    status: 'approved',
    suppress_days: null,
    notes: payload.notes,
    actor_user_id: request.user?.user_id || null,
  });

  reply.status(201).send({ data: rule });
}

async function suppressRecurringRule(request, reply) {
  const payload = suppressRecurringRuleSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const rule = await recurringRulesService.upsertRecurringRule({
    organization_id: organizationId,
    candidate: payload.candidate,
    status: 'suppressed',
    suppress_days: payload.suppress_days,
    notes: payload.notes,
    actor_user_id: request.user?.user_id || null,
  });

  reply.status(201).send({ data: rule });
}

async function unsuppressRecurringRule(request, reply) {
  const params = recurringRuleParamsSchema.parse(request.params || {});
  const organizationId = resolveOrganizationId(request);

  const rule = await recurringRulesService.unsuppressRecurringRule({
    organization_id: organizationId,
    rule_id: params.id,
    actor_user_id: request.user?.user_id || null,
  });

  reply.send({ data: rule });
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

  const created = await transactionsService.createTransaction(
    {
      ...payload.transaction,
      source: payload.transaction.source || 'automation',
      organization_id: organizationId,
    },
    {
      actor_user_id: null,
      actor_role: request.apiKey?.role || null,
      audit_source: 'automation',
    }
  );

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
  listTransactionHistory,
  listRecurringCandidates,
  listRecurringAlerts,
  listRecurringRules,
  approveRecurringRule,
  suppressRecurringRule,
  unsuppressRecurringRule,
  createAutomationTransaction,
};
