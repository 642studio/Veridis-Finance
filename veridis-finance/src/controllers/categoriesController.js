const { z } = require('zod');

const { resolveOrganizationId } = require('../middleware/auth');
const categoriesService = require('../services/categoriesService');

const categoryBaseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  icon: z.string().trim().max(80).optional().nullable(),
  color: z.string().trim().max(40).optional().nullable(),
  active: z.coerce.boolean().optional(),
});

const updateCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    icon: z.string().trim().max(80).optional().nullable(),
    color: z.string().trim().max(40).optional().nullable(),
    active: z.coerce.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

const subcategoryBaseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  icon: z.string().trim().max(80).optional().nullable(),
  color: z.string().trim().max(40).optional().nullable(),
  active: z.coerce.boolean().optional(),
});

const updateSubcategorySchema = z
  .object({
    category_id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(120).optional(),
    icon: z.string().trim().max(80).optional().nullable(),
    color: z.string().trim().max(40).optional().nullable(),
    active: z.coerce.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

const categoryParamsSchema = z.object({
  categoryId: z.string().uuid(),
});

const subcategoryParamsSchema = z.object({
  subcategoryId: z.string().uuid(),
});

const listCategoriesQuerySchema = z.object({
  active: z
    .enum(['true', 'false', 'all'])
    .optional()
    .default('true')
    .transform((value) => (value === 'all' ? undefined : value === 'true')),
});

const listSubcategoriesQuerySchema = z.object({
  active: z
    .enum(['true', 'false', 'all'])
    .optional()
    .default('true')
    .transform((value) => (value === 'all' ? undefined : value === 'true')),
});

async function listCategories(request, reply) {
  const query = listCategoriesQuerySchema.parse(request.query || {});
  const organizationId = resolveOrganizationId(request);

  const rows = await categoriesService.listCategories({
    organization_id: organizationId,
    active: query.active,
  });

  reply.send({ data: rows });
}

async function createCategory(request, reply) {
  const payload = categoryBaseSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const row = await categoriesService.createCategory({
    ...payload,
    organization_id: organizationId,
  });

  reply.status(201).send({ data: row });
}

async function updateCategory(request, reply) {
  const params = categoryParamsSchema.parse(request.params || {});
  const payload = updateCategorySchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const row = await categoriesService.updateCategory({
    organization_id: organizationId,
    category_id: params.categoryId,
    patch: payload,
  });

  reply.send({ data: row });
}

async function deleteCategory(request, reply) {
  const params = categoryParamsSchema.parse(request.params || {});
  const organizationId = resolveOrganizationId(request);

  const row = await categoriesService.softDeleteCategory({
    organization_id: organizationId,
    category_id: params.categoryId,
  });

  reply.send({ data: row });
}

async function listSubcategories(request, reply) {
  const params = categoryParamsSchema.parse(request.params || {});
  const query = listSubcategoriesQuerySchema.parse(request.query || {});
  const organizationId = resolveOrganizationId(request);

  const rows = await categoriesService.listSubcategories({
    organization_id: organizationId,
    category_id: params.categoryId,
    active: query.active,
  });

  reply.send({ data: rows });
}

async function createSubcategory(request, reply) {
  const params = categoryParamsSchema.parse(request.params || {});
  const payload = subcategoryBaseSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const row = await categoriesService.createSubcategory({
    ...payload,
    organization_id: organizationId,
    category_id: params.categoryId,
  });

  reply.status(201).send({ data: row });
}

async function updateSubcategory(request, reply) {
  const params = subcategoryParamsSchema.parse(request.params || {});
  const payload = updateSubcategorySchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const row = await categoriesService.updateSubcategory({
    organization_id: organizationId,
    subcategory_id: params.subcategoryId,
    patch: payload,
  });

  reply.send({ data: row });
}

async function deleteSubcategory(request, reply) {
  const params = subcategoryParamsSchema.parse(request.params || {});
  const organizationId = resolveOrganizationId(request);

  const row = await categoriesService.softDeleteSubcategory({
    organization_id: organizationId,
    subcategory_id: params.subcategoryId,
  });

  reply.send({ data: row });
}

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listSubcategories,
  createSubcategory,
  updateSubcategory,
  deleteSubcategory,
};
