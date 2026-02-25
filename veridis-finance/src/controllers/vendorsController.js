const { z } = require('zod');

const { resolveOrganizationId } = require('../middleware/auth');
const vendorsService = require('../services/vendorsService');

const vendorTypeSchema = z.enum(vendorsService.VENDOR_TYPES);

const baseVendorSchema = {
  name: z.string().trim().min(1).max(255),
  type: vendorTypeSchema.default('other'),
  default_category_id: z.string().uuid().optional().nullable(),
  active: z.coerce.boolean().optional(),
};

const createVendorSchema = z.object(baseVendorSchema);

const updateVendorSchema = z
  .object({
    name: baseVendorSchema.name.optional(),
    type: vendorTypeSchema.optional(),
    default_category_id: baseVendorSchema.default_category_id,
    active: baseVendorSchema.active,
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

const vendorParamsSchema = z.object({
  id: z.string().uuid(),
});

const listVendorsQuerySchema = z.object({
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

async function listVendors(request, reply) {
  const query = listVendorsQuerySchema.parse(request.query || {});
  const organizationId = resolveOrganizationId(request);

  const vendors = await vendorsService.listVendors({
    organization_id: organizationId,
    active: parseActiveFilter(query.active),
  });

  reply.send({ data: vendors });
}

async function createVendor(request, reply) {
  const payload = createVendorSchema.parse(request.body);
  const organizationId = resolveOrganizationId(request);

  const created = await vendorsService.createVendor({
    ...payload,
    organization_id: organizationId,
  });

  reply.status(201).send({ data: created });
}

async function updateVendor(request, reply) {
  const params = vendorParamsSchema.parse(request.params);
  const payload = updateVendorSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const updated = await vendorsService.updateVendor({
    organization_id: organizationId,
    vendor_id: params.id,
    patch: payload,
  });

  reply.send({ data: updated });
}

async function deleteVendor(request, reply) {
  const params = vendorParamsSchema.parse(request.params);
  const organizationId = resolveOrganizationId(request);

  const updated = await vendorsService.softDeleteVendor({
    organization_id: organizationId,
    vendor_id: params.id,
  });

  reply.send({ data: updated });
}

module.exports = {
  listVendors,
  createVendor,
  updateVendor,
  deleteVendor,
};
