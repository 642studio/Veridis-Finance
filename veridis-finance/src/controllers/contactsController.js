const { z } = require('zod');

const { resolveOrganizationId } = require('../middleware/auth');
const contactsService = require('../services/contactsService');

const contactTypeSchema = z.enum([
  'customer',
  'vendor',
  'employee',
  'contractor',
  'internal',
]);

const contactStatusSchema = z.enum(['active', 'inactive']);

const createContactSchema = z.object({
  type: contactTypeSchema,
  name: z.string().trim().min(1).max(255),
  business_name: z.string().trim().max(255).optional().nullable(),
  email: z.string().trim().email().max(255).optional().nullable(),
  phone: z.string().trim().max(60).optional().nullable(),
  rfc: z.string().trim().max(20).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  status: contactStatusSchema.default('active'),
});

const updateContactSchema = z
  .object({
    type: contactTypeSchema.optional(),
    name: z.string().trim().min(1).max(255).optional(),
    business_name: z.string().trim().max(255).optional().nullable(),
    email: z.string().trim().email().max(255).optional().nullable(),
    phone: z.string().trim().max(60).optional().nullable(),
    rfc: z.string().trim().max(20).optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
    tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
    status: contactStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

const contactParamsSchema = z.object({
  id: z.string().uuid(),
});

const listContactsQuerySchema = z.object({
  type: contactTypeSchema.optional(),
  status: contactStatusSchema.optional(),
  q: z.string().trim().min(1).max(200).optional(),
  sort_by: z.enum(['name', 'created_at', 'type']).optional(),
  sort_order: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

async function listContacts(request, reply) {
  const query = listContactsQuerySchema.parse(request.query || {});
  const organizationId = resolveOrganizationId(request);

  const rows = await contactsService.listContacts({
    organization_id: organizationId,
    type: query.type,
    status: query.status,
    q: query.q,
    sort_by: query.sort_by,
    sort_order: query.sort_order,
    limit: query.limit,
    offset: query.offset,
  });

  reply.send({ data: rows });
}

async function getContact(request, reply) {
  const params = contactParamsSchema.parse(request.params || {});
  const organizationId = resolveOrganizationId(request);

  const row = await contactsService.getContactById({
    organization_id: organizationId,
    contact_id: params.id,
  });

  reply.send({ data: row });
}

async function createContact(request, reply) {
  const payload = createContactSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const row = await contactsService.createContact({
    ...payload,
    organization_id: organizationId,
  });

  reply.status(201).send({ data: row });
}

async function updateContact(request, reply) {
  const params = contactParamsSchema.parse(request.params || {});
  const payload = updateContactSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const row = await contactsService.updateContact({
    organization_id: organizationId,
    contact_id: params.id,
    patch: payload,
  });

  reply.send({ data: row });
}

async function deleteContact(request, reply) {
  const params = contactParamsSchema.parse(request.params || {});
  const organizationId = resolveOrganizationId(request);

  const row = await contactsService.softDeleteContact({
    organization_id: organizationId,
    contact_id: params.id,
  });

  reply.send({ data: row });
}

module.exports = {
  listContacts,
  getContact,
  createContact,
  updateContact,
  deleteContact,
};
