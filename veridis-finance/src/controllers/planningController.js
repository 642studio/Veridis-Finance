const { z } = require('zod');

const { resolveOrganizationId } = require('../middleware/auth');
const planningService = require('../services/planningService');

const variableKeySchema = z.enum([
  'accounts_receivable',
  'accounts_payable',
  'discount_rate',
  'inventory',
]);

function decimal2Schema({ min, max } = {}) {
  let schema = z.coerce.number();

  if (min !== undefined) {
    schema = schema.min(min);
  }

  if (max !== undefined) {
    schema = schema.max(max);
  }

  return schema.refine(
    (value) => Number.isFinite(value) && Number(value.toFixed(2)) === value,
    {
      message: 'Value must have at most 2 decimals',
    }
  );
}

const importFieldsSchema = z
  .object({
    plan_name: z.string().trim().min(1).max(180).optional(),
    start_year: z.coerce.number().int().optional(),
    end_year: z.coerce.number().int().optional(),
    tax_rate: decimal2Schema({ min: 0, max: 100 }).optional(),
    inflation: decimal2Schema({ min: 0, max: 100 }).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.start_year !== undefined &&
      value.end_year !== undefined &&
      value.end_year < value.start_year
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end_year'],
        message: 'end_year must be greater than or equal to start_year',
      });
    }
  });

const planParamsSchema = z.object({
  planId: z.string().uuid(),
});

const productParamsSchema = z.object({
  planId: z.string().uuid(),
  productId: z.string().uuid(),
});

const productByIdParamsSchema = z.object({
  productId: z.string().uuid(),
});

const fixedCostParamsSchema = z.object({
  planId: z.string().uuid(),
  costId: z.string().uuid(),
});

const fixedCostByIdParamsSchema = z.object({
  costId: z.string().uuid(),
});

const variableByIdParamsSchema = z.object({
  variableId: z.string().uuid(),
});

const createProductSchema = z
  .object({
    product_name: z.string().trim().min(1).max(255),
    category: z.string().trim().max(120).optional().nullable(),
    base_monthly_units: decimal2Schema({ min: 0 }).optional(),
    price: decimal2Schema({ min: 0 }).optional(),
    growth_percent_annual: decimal2Schema({ min: 0, max: 300 }).optional(),
    cogs_percent: decimal2Schema({ min: 0, max: 100 }).optional(),
    active: z.coerce.boolean().optional(),

    // Backward-compatible aliases.
    monthly_price: decimal2Schema({ min: 0 }).optional(),
    monthly_cost: decimal2Schema({ min: 0 }).optional(),
    growth_rate_percent: decimal2Schema({ min: 0, max: 300 }).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.price === undefined && value.monthly_price === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['price'],
        message: 'price (or monthly_price) is required',
      });
    }
  });

const updateProductSchema = z
  .object({
    product_name: z.string().trim().min(1).max(255).optional(),
    category: z.string().trim().max(120).optional().nullable(),
    base_monthly_units: decimal2Schema({ min: 0 }).optional(),
    price: decimal2Schema({ min: 0 }).optional(),
    growth_percent_annual: decimal2Schema({ min: 0, max: 300 }).optional(),
    cogs_percent: decimal2Schema({ min: 0, max: 100 }).optional(),
    active: z.coerce.boolean().optional(),

    monthly_price: decimal2Schema({ min: 0 }).optional(),
    monthly_cost: decimal2Schema({ min: 0 }).optional(),
    growth_rate_percent: decimal2Schema({ min: 0, max: 300 }).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one product field is required',
  });

const createFixedCostSchema = z.object({
  cost_name: z.string().trim().min(1).max(255),
  category: z.string().trim().max(120).optional().nullable(),
  monthly_amount: decimal2Schema({ min: 0 }),
  growth_percent_annual: decimal2Schema({ min: 0, max: 300 }).optional(),
  annual_growth_percent: decimal2Schema({ min: 0, max: 300 }).optional(),
  active: z.coerce.boolean().optional(),
});

const updateFixedCostSchema = z
  .object({
    cost_name: z.string().trim().min(1).max(255).optional(),
    category: z.string().trim().max(120).optional().nullable(),
    monthly_amount: decimal2Schema({ min: 0 }).optional(),
    growth_percent_annual: decimal2Schema({ min: 0, max: 300 }).optional(),
    annual_growth_percent: decimal2Schema({ min: 0, max: 300 }).optional(),
    active: z.coerce.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one fixed cost field is required',
  });

const updatePlanConfigSchema = z
  .object({
    plan_name: z.string().trim().min(1).max(180).optional(),
    start_year: z.coerce.number().int().optional(),
    end_year: z.coerce.number().int().optional(),
    tax_rate: decimal2Schema({ min: 0, max: 100 }).optional(),
    inflation: decimal2Schema({ min: 0, max: 100 }).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one config field is required',
  })
  .superRefine((value, ctx) => {
    if (
      value.start_year !== undefined &&
      value.end_year !== undefined &&
      value.end_year < value.start_year
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end_year'],
        message: 'end_year must be greater than or equal to start_year',
      });
    }
  });

const replaceVariablesSchema = z.object({
  variables: z.array(
    z.object({
      key: variableKeySchema.optional(),
      variable_key: variableKeySchema.optional(),
      type: z.enum(['percentage', 'fixed']),
      value: decimal2Schema(),
      applies_to: z.string().trim().max(120).optional().nullable(),
    })
  ),
});

const updateVariableByIdSchema = z
  .object({
    key: variableKeySchema.optional(),
    variable_name: variableKeySchema.optional(),
    variable_key: variableKeySchema.optional(),
    type: z.enum(['percentage', 'fixed']).optional(),
    value: decimal2Schema().optional(),
    applies_to: z.string().trim().max(120).optional().nullable(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one variable field is required',
  });

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

async function importPlanningWorkbook(request, reply) {
  if (!request.isMultipart()) {
    throw badRequest('Content-Type must be multipart/form-data');
  }

  let fileBuffer = null;
  let fileName = '';
  let fileMimeType = '';
  let planNameRaw = null;
  let startYearRaw = null;
  let endYearRaw = null;
  let taxRateRaw = null;
  let inflationRaw = null;

  for await (const part of request.parts()) {
    if (part.type === 'file') {
      if (fileBuffer) {
        throw badRequest('Only one XLSX file is allowed');
      }

      fileName = String(part.filename || '');
      fileMimeType = String(part.mimetype || '');
      fileBuffer = await part.toBuffer();
      continue;
    }

    if (part.fieldname === 'plan_name') {
      planNameRaw = part.value;
      continue;
    }

    if (part.fieldname === 'start_year') {
      startYearRaw = part.value;
      continue;
    }

    if (part.fieldname === 'end_year') {
      endYearRaw = part.value;
      continue;
    }

    if (part.fieldname === 'tax_rate') {
      taxRateRaw = part.value;
      continue;
    }

    if (part.fieldname === 'inflation') {
      inflationRaw = part.value;
    }
  }

  if (!fileBuffer) {
    throw badRequest('XLSX file is required');
  }

  const isXlsxName = fileName.toLowerCase().endsWith('.xlsx');
  const isXlsxMime =
    fileMimeType ===
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  if (!isXlsxName && !isXlsxMime) {
    throw badRequest('Uploaded file must be .xlsx');
  }

  const fields = importFieldsSchema.parse({
    plan_name: planNameRaw === null || planNameRaw === '' ? undefined : planNameRaw,
    start_year:
      startYearRaw === null || startYearRaw === '' ? undefined : startYearRaw,
    end_year: endYearRaw === null || endYearRaw === '' ? undefined : endYearRaw,
    tax_rate: taxRateRaw === null || taxRateRaw === '' ? undefined : taxRateRaw,
    inflation:
      inflationRaw === null || inflationRaw === '' ? undefined : inflationRaw,
  });

  const organizationId = resolveOrganizationId(request);
  const userId = request.user?.user_id;

  let result;
  try {
    result = await planningService.importPlanningWorkbook({
      organization_id: organizationId,
      user_id: userId,
      workbook_buffer: fileBuffer,
      file_name: fileName || null,
      plan_name_override: fields.plan_name,
      start_year_override: fields.start_year,
      end_year_override: fields.end_year,
      tax_rate_override: fields.tax_rate,
      inflation_override: fields.inflation,
    });
  } catch (error) {
    if (error?.code === 'PLANNING_MISSING_SHEET') {
      return reply.status(400).send({
        success: false,
        error: error.message,
      });
    }

    if (error?.code === 'PLANNING_IMPORT_VALIDATION') {
      const firstValidationMessage =
        error.validation_errors?.[0]?.message || null;

      return reply.status(400).send({
        success: false,
        error: firstValidationMessage || 'Planning workbook validation failed',
        errors: error.validation_errors || [],
      });
    }

    if (error?.statusCode === 400) {
      return reply.status(400).send({ success: false, error: error.message });
    }

    throw error;
  }

  request.log.info(
    {
      source: 'planning_import_input_based',
      organization_id: organizationId,
      user_id: userId,
      plan_id: result.plan_id,
      parsed_counts: result.parsed_counts,
    },
    'Input-based planning workbook imported'
  );

  reply.status(201).send({ data: result });
}

async function listPlans(request, reply) {
  const organizationId = resolveOrganizationId(request);

  const plans = await planningService.listPlans({
    organization_id: organizationId,
  });

  reply.send({ data: plans });
}

async function getPlanOverview(request, reply) {
  const { planId } = planParamsSchema.parse(request.params || {});
  const organizationId = resolveOrganizationId(request);

  const data = await planningService.getPlanOverview({
    organization_id: organizationId,
    plan_id: planId,
  });

  reply.send({ data });
}

async function getPlanResults(request, reply) {
  const { planId } = planParamsSchema.parse(request.params || {});
  const organizationId = resolveOrganizationId(request);

  const data = await planningService.getPlanResults({
    organization_id: organizationId,
    plan_id: planId,
  });

  reply.send({ data });
}

async function updatePlanConfig(request, reply) {
  const { planId } = planParamsSchema.parse(request.params || {});
  const payload = updatePlanConfigSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const data = await planningService.updatePlanConfig({
    organization_id: organizationId,
    plan_id: planId,
    patch: payload,
  });

  request.log.info(
    {
      source: 'planning_config_update',
      organization_id: organizationId,
      plan_id: planId,
      updated_by: request.user?.user_id,
    },
    'Financial plan config updated'
  );

  reply.send({ data });
}

async function getPlanProducts(request, reply) {
  const { planId } = planParamsSchema.parse(request.params || {});
  const organizationId = resolveOrganizationId(request);

  const data = await planningService.getPlanProducts({
    organization_id: organizationId,
    plan_id: planId,
  });

  reply.send({ data });
}

async function createProduct(request, reply) {
  const { planId } = planParamsSchema.parse(request.params || {});
  const payload = createProductSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const data = await planningService.createProduct({
    organization_id: organizationId,
    plan_id: planId,
    payload,
  });

  request.log.info(
    {
      source: 'planning_product_create',
      organization_id: organizationId,
      plan_id: planId,
      updated_by: request.user?.user_id,
    },
    'Financial product created'
  );

  reply.status(201).send({ data });
}

async function updateProduct(request, reply) {
  const { planId, productId } = productParamsSchema.parse(request.params || {});
  const payload = updateProductSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const data = await planningService.updateProduct({
    organization_id: organizationId,
    plan_id: planId,
    product_id: productId,
    patch: payload,
  });

  request.log.info(
    {
      source: 'planning_product_update',
      organization_id: organizationId,
      plan_id: planId,
      product_id: productId,
      updated_by: request.user?.user_id,
    },
    'Financial product updated'
  );

  reply.send({ data });
}

async function patchProductById(request, reply) {
  const { productId } = productByIdParamsSchema.parse(request.params || {});
  const payload = updateProductSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const data = await planningService.updateProductById({
    organization_id: organizationId,
    product_id: productId,
    patch: payload,
  });

  request.log.info(
    {
      source: 'planning_product_patch',
      organization_id: organizationId,
      product_id: productId,
      updated_by: request.user?.user_id,
    },
    'Financial product patched'
  );

  reply.send({ data });
}

async function deleteProduct(request, reply) {
  const { planId, productId } = productParamsSchema.parse(request.params || {});
  const organizationId = resolveOrganizationId(request);

  const data = await planningService.deleteProduct({
    organization_id: organizationId,
    plan_id: planId,
    product_id: productId,
  });

  request.log.info(
    {
      source: 'planning_product_delete',
      organization_id: organizationId,
      plan_id: planId,
      product_id: productId,
      updated_by: request.user?.user_id,
    },
    'Financial product deleted'
  );

  reply.send({ data });
}

async function getPlanFixedCosts(request, reply) {
  const { planId } = planParamsSchema.parse(request.params || {});
  const organizationId = resolveOrganizationId(request);

  const data = await planningService.getPlanFixedCosts({
    organization_id: organizationId,
    plan_id: planId,
  });

  reply.send({ data });
}

async function createFixedCost(request, reply) {
  const { planId } = planParamsSchema.parse(request.params || {});
  const payload = createFixedCostSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const data = await planningService.createFixedCost({
    organization_id: organizationId,
    plan_id: planId,
    payload,
  });

  request.log.info(
    {
      source: 'planning_fixed_cost_create',
      organization_id: organizationId,
      plan_id: planId,
      updated_by: request.user?.user_id,
    },
    'Financial fixed cost created'
  );

  reply.status(201).send({ data });
}

async function updateFixedCost(request, reply) {
  const { planId, costId } = fixedCostParamsSchema.parse(request.params || {});
  const payload = updateFixedCostSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const data = await planningService.updateFixedCost({
    organization_id: organizationId,
    plan_id: planId,
    cost_id: costId,
    patch: payload,
  });

  request.log.info(
    {
      source: 'planning_fixed_cost_update',
      organization_id: organizationId,
      plan_id: planId,
      cost_id: costId,
      updated_by: request.user?.user_id,
    },
    'Financial fixed cost updated'
  );

  reply.send({ data });
}

async function patchFixedCostById(request, reply) {
  const { costId } = fixedCostByIdParamsSchema.parse(request.params || {});
  const payload = updateFixedCostSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const data = await planningService.updateFixedCostById({
    organization_id: organizationId,
    cost_id: costId,
    patch: payload,
  });

  request.log.info(
    {
      source: 'planning_fixed_cost_patch',
      organization_id: organizationId,
      cost_id: costId,
      updated_by: request.user?.user_id,
    },
    'Financial fixed cost patched'
  );

  reply.send({ data });
}

async function deleteFixedCost(request, reply) {
  const { planId, costId } = fixedCostParamsSchema.parse(request.params || {});
  const organizationId = resolveOrganizationId(request);

  const data = await planningService.deleteFixedCost({
    organization_id: organizationId,
    plan_id: planId,
    cost_id: costId,
  });

  request.log.info(
    {
      source: 'planning_fixed_cost_delete',
      organization_id: organizationId,
      plan_id: planId,
      cost_id: costId,
      updated_by: request.user?.user_id,
    },
    'Financial fixed cost deleted'
  );

  reply.send({ data });
}

async function getPlanVariables(request, reply) {
  const { planId } = planParamsSchema.parse(request.params || {});
  const organizationId = resolveOrganizationId(request);

  const data = await planningService.getPlanVariables({
    organization_id: organizationId,
    plan_id: planId,
  });

  reply.send({ data });
}

async function replaceVariables(request, reply) {
  const { planId } = planParamsSchema.parse(request.params || {});
  const payload = replaceVariablesSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const data = await planningService.replaceVariables({
    organization_id: organizationId,
    plan_id: planId,
    variables: payload.variables,
  });

  request.log.info(
    {
      source: 'planning_variables_replace',
      organization_id: organizationId,
      plan_id: planId,
      updated_by: request.user?.user_id,
      variables_count: payload.variables.length,
    },
    'Financial variables replaced'
  );

  reply.send({ data });
}

async function patchVariableById(request, reply) {
  const { variableId } = variableByIdParamsSchema.parse(request.params || {});
  const payload = updateVariableByIdSchema.parse(request.body || {});
  const organizationId = resolveOrganizationId(request);

  const data = await planningService.updateVariableById({
    organization_id: organizationId,
    variable_id: variableId,
    patch: payload,
  });

  request.log.info(
    {
      source: 'planning_variable_patch',
      organization_id: organizationId,
      variable_id: variableId,
      updated_by: request.user?.user_id,
    },
    'Financial variable patched'
  );

  reply.send({ data });
}

async function recalculatePlan(request, reply) {
  const { planId } = planParamsSchema.parse(request.params || {});
  const organizationId = resolveOrganizationId(request);

  const data = await planningService.recalculatePlan({
    organization_id: organizationId,
    plan_id: planId,
  });

  request.log.info(
    {
      source: 'planning_recalculate',
      organization_id: organizationId,
      plan_id: planId,
      updated_by: request.user?.user_id,
    },
    'Financial plan recalculated'
  );

  reply.send({ data });
}

module.exports = {
  importPlanningWorkbook,
  listPlans,
  getPlanOverview,
  getPlanResults,
  updatePlanConfig,
  getPlanProducts,
  createProduct,
  updateProduct,
  patchProductById,
  deleteProduct,
  getPlanFixedCosts,
  createFixedCost,
  updateFixedCost,
  patchFixedCostById,
  deleteFixedCost,
  getPlanVariables,
  replaceVariables,
  patchVariableById,
  recalculatePlan,
};
