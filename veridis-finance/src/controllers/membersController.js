const { z } = require('zod');

const { resolveOrganizationId } = require('../middleware/auth');
const membersService = require('../services/membersService');

const memberBaseSchema = {
  full_name: z.string().trim().min(1).max(255),
  alias: z.string().trim().max(120).optional().nullable(),
  bank_account_last4: z
    .string()
    .trim()
    .regex(/^\d{4}$/, 'bank_account_last4 must contain 4 digits')
    .optional()
    .nullable(),
  rfc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z&\u00d1]{3,4}[0-9]{6}[A-Z0-9]{3}$/, 'Invalid RFC format')
    .optional()
    .nullable(),
  salary_estimate: z.coerce.number().min(0).max(1000000000).optional().nullable(),
  active: z.coerce.boolean().optional(),
};

const createMemberSchema = z.object(memberBaseSchema);

const listMembersQuerySchema = z.object({
  active: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => {
      if (value === undefined) {
        return undefined;
      }
      return value === 'true';
    }),
});

const memberParamsSchema = z.object({
  memberId: z.string().uuid(),
});

const updateMemberSchema = z
  .object({
    full_name: memberBaseSchema.full_name.optional(),
    alias: memberBaseSchema.alias,
    bank_account_last4: memberBaseSchema.bank_account_last4,
    rfc: memberBaseSchema.rfc,
    salary_estimate: memberBaseSchema.salary_estimate,
    active: memberBaseSchema.active,
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

async function createMember(request, reply) {
  const payload = createMemberSchema.parse(request.body);
  const organizationId = resolveOrganizationId(request);

  const created = await membersService.createMember({
    ...payload,
    organization_id: organizationId,
  });

  reply.status(201).send({ data: created });
}

async function listMembers(request, reply) {
  const query = listMembersQuerySchema.parse(request.query);
  const organizationId = resolveOrganizationId(request);

  const results = await membersService.listMembers({
    organization_id: organizationId,
    active: query.active,
  });

  reply.send({ data: results });
}

async function updateMember(request, reply) {
  const params = memberParamsSchema.parse(request.params);
  const payload = updateMemberSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const updated = await membersService.updateMember({
    organization_id: organizationId,
    member_id: params.memberId,
    patch: payload,
  });

  reply.send({ data: updated });
}

async function deleteMember(request, reply) {
  const params = memberParamsSchema.parse(request.params);
  const organizationId = resolveOrganizationId(request);

  await membersService.deleteMember({
    organization_id: organizationId,
    member_id: params.memberId,
  });

  reply.send({ data: { id: params.memberId, deleted: true } });
}

module.exports = {
  createMember,
  listMembers,
  updateMember,
  deleteMember,
};
