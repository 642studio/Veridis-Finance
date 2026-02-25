const { z } = require('zod');

const { resolveOrganizationId } = require('../middleware/auth');
const clientsService = require('../services/clientsService');

const baseClientSchema = {
  name: z.string().trim().min(1).max(255),
  business_name: z.string().trim().max(255).optional().nullable(),
  email: z.string().trim().email().max(255).optional().nullable(),
  phone: z.string().trim().max(60).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  active: z.coerce.boolean().optional(),
};

const createClientSchema = z.object(baseClientSchema);

const updateClientSchema = z
  .object({
    name: baseClientSchema.name.optional(),
    business_name: baseClientSchema.business_name,
    email: baseClientSchema.email,
    phone: baseClientSchema.phone,
    notes: baseClientSchema.notes,
    active: baseClientSchema.active,
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

const clientParamsSchema = z.object({
  id: z.string().uuid(),
});

const listClientsQuerySchema = z.object({
  active: z.enum(['true', 'false', 'all']).optional(),
});

function parseActiveFilter(value) {
  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return undefined;
}

async function listClients(request, reply) {
  const query = listClientsQuerySchema.parse(request.query || {});
  const organizationId = resolveOrganizationId(request);

  const clients = await clientsService.listClients({
    organization_id: organizationId,
    active: parseActiveFilter(query.active),
  });

  reply.send({ data: clients });
}

async function createClient(request, reply) {
  const payload = createClientSchema.parse(request.body);
  const organizationId = resolveOrganizationId(request);

  const created = await clientsService.createClient({
    ...payload,
    organization_id: organizationId,
  });

  reply.status(201).send({ data: created });
}

async function updateClient(request, reply) {
  const params = clientParamsSchema.parse(request.params);
  const payload = updateClientSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const updated = await clientsService.updateClient({
    organization_id: organizationId,
    client_id: params.id,
    patch: payload,
  });

  reply.send({ data: updated });
}

async function deleteClient(request, reply) {
  const params = clientParamsSchema.parse(request.params);
  const organizationId = resolveOrganizationId(request);

  const updated = await clientsService.softDeleteClient({
    organization_id: organizationId,
    client_id: params.id,
  });

  reply.send({ data: updated });
}

module.exports = {
  listClients,
  createClient,
  updateClient,
  deleteClient,
};
