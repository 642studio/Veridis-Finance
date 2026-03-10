const { z } = require('zod');

const { resolveOrganizationId } = require('../middleware/auth');
const financeAccountsService = require('../services/financeAccountsService');

const accountTypeSchema = z.enum([
  'bank',
  'cash',
  'credit_card',
  'wallet',
  'accounts_receivable',
  'accounts_payable',
  'internal',
]);

const accountStatusSchema = z.enum(['active', 'inactive', 'archived']);

const createAccountSchema = z.object({
  name: z.string().trim().min(1).max(255),
  type: accountTypeSchema.default('bank'),
  bank_name: z.string().trim().max(255).optional().nullable(),
  account_number_last4: z
    .string()
    .trim()
    .regex(/^\d{4}$/, 'account_number_last4 must have 4 digits')
    .optional()
    .nullable(),
  credit_limit: z.coerce.number().min(0).optional().nullable(),
  cut_day: z.coerce.number().int().min(1).max(31).optional().nullable(),
  due_day: z.coerce.number().int().min(1).max(31).optional().nullable(),
  balance: z.coerce.number().optional(),
  currency: z.string().trim().min(1).max(10).optional(),
  status: accountStatusSchema.default('active'),
});

const updateAccountSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    type: accountTypeSchema.optional(),
    bank_name: z.string().trim().max(255).optional().nullable(),
    account_number_last4: z
      .string()
      .trim()
      .regex(/^\d{4}$/, 'account_number_last4 must have 4 digits')
      .optional()
      .nullable(),
    credit_limit: z.coerce.number().min(0).optional().nullable(),
    cut_day: z.coerce.number().int().min(1).max(31).optional().nullable(),
    due_day: z.coerce.number().int().min(1).max(31).optional().nullable(),
    balance: z.coerce.number().optional(),
    currency: z.string().trim().min(1).max(10).optional(),
    status: accountStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

const accountParamsSchema = z.object({
  id: z.string().uuid(),
});

const listAccountsQuerySchema = z.object({
  status: accountStatusSchema.optional(),
  type: accountTypeSchema.optional(),
});

async function listAccounts(request, reply) {
  const query = listAccountsQuerySchema.parse(request.query || {});
  const organizationId = resolveOrganizationId(request);

  const rows = await financeAccountsService.listAccounts({
    organization_id: organizationId,
    status: query.status,
    type: query.type,
  });

  reply.send({ data: rows });
}

async function createAccount(request, reply) {
  const payload = createAccountSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const row = await financeAccountsService.createAccount({
    ...payload,
    organization_id: organizationId,
  });

  reply.status(201).send({ data: row });
}

async function updateAccount(request, reply) {
  const params = accountParamsSchema.parse(request.params || {});
  const payload = updateAccountSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const row = await financeAccountsService.updateAccount({
    organization_id: organizationId,
    account_id: params.id,
    patch: payload,
  });

  reply.send({ data: row });
}

async function deleteAccount(request, reply) {
  const params = accountParamsSchema.parse(request.params || {});
  const organizationId = resolveOrganizationId(request);

  const row = await financeAccountsService.softDeleteAccount({
    organization_id: organizationId,
    account_id: params.id,
  });

  reply.send({ data: row });
}

module.exports = {
  listAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
};
