const pool = require('../db/pool');
const {
  parsePlanningWorkbook,
  badRequest,
} = require('./planning/planningXlsxParserService');
const {
  calculatePlan,
  ALLOWED_VARIABLE_KEYS,
} = require('./planning/financialProjectionService');

const VARIABLE_KEYS = Object.freeze(Array.from(ALLOWED_VARIABLE_KEYS));
const VARIABLE_KEYS_SET = new Set(VARIABLE_KEYS);
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}

function toYearsRange(startYear, endYear) {
  const years = [];

  for (let year = Number(startYear); year <= Number(endYear); year += 1) {
    years.push(year);
  }

  return years;
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function trimOrNull(value, maxLength) {
  const trimmed = String(value || '').trim();

  if (!trimmed) {
    return null;
  }

  return maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function toBoolean(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  const normalized = String(value).trim().toLowerCase();

  if (!normalized) {
    return defaultValue;
  }

  if (['true', '1', 'yes', 'y', 'si'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'n'].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function decimalPlaces(value) {
  const text = String(value);
  if (!text.includes('.')) {
    return 0;
  }

  return text.split('.')[1].length;
}

function assertMax2Decimals(field, value) {
  if (!Number.isFinite(value)) {
    throw badRequest(`${field} must be numeric`);
  }

  if (decimalPlaces(value) > 2) {
    throw badRequest(`${field} must have at most 2 decimals`);
  }
}

function normalizeNumberField({ field, value, required = true, min, max }) {
  if ((value === undefined || value === null || value === '') && !required) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw badRequest(`${field} must be numeric`);
  }

  assertMax2Decimals(field, parsed);

  if (min !== undefined && parsed < min) {
    throw badRequest(`${field} must be greater than or equal to ${min}`);
  }

  if (max !== undefined && parsed > max) {
    throw badRequest(`${field} must be less than or equal to ${max}`);
  }

  return round2(parsed);
}

function normalizePercentageField({ field, value, required = true, min = 0, max = 100 }) {
  return normalizeNumberField({ field, value, required, min, max });
}

function normalizeCurrencyField({ field, value, required = true }) {
  return normalizeNumberField({ field, value, required, min: 0 });
}

function normalizeUnitField({ field, value, required = true }) {
  return normalizeNumberField({ field, value, required, min: 0 });
}

function normalizeVariableKey(value) {
  const key = String(value || '').trim().toLowerCase();
  return VARIABLE_KEYS_SET.has(key) ? key : null;
}

function normalizeAppliesTo(value) {
  if (value === undefined || value === null) {
    return 'global';
  }

  const normalized = String(value).trim();

  if (!normalized) {
    return 'global';
  }

  if (normalized.toLowerCase() === 'global') {
    return 'global';
  }

  if (!UUID_REGEX.test(normalized)) {
    throw badRequest('applies_to must be "global", null, or a valid product_id UUID');
  }

  return normalized;
}

function validateYearRange(startYear, endYear) {
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear)) {
    throw badRequest('start_year and end_year must be integers');
  }

  if (endYear < startYear) {
    throw badRequest('end_year must be greater than or equal to start_year');
  }

  if (endYear - startYear + 1 > 20) {
    throw badRequest('Year range cannot exceed 20 years');
  }
}

function mapPlan(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    organization_id: row.organization_id,
    user_id: row.user_id || null,
    plan_name: row.plan_name || row.name,
    start_year: Number(row.start_year),
    end_year: Number(row.end_year),
    tax_rate: Number(row.tax_rate || 0),
    inflation: Number(row.inflation || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,

    year: Number(row.start_year),
    scenario: 'base',
    name: row.plan_name || row.name,
  };
}

function mapProduct(row) {
  if (!row) {
    return null;
  }

  const price = Number(row.price ?? row.monthly_price ?? 0);
  const cogsPercent = Number(row.cogs_percent ?? 0);

  return {
    id: row.id,
    organization_id: row.organization_id,
    plan_id: row.plan_id,
    product_name: row.product_name,
    category: row.category || null,
    base_monthly_units: Number(row.base_monthly_units ?? 0),
    price,
    growth_percent_annual: Number(
      row.growth_percent_annual ?? row.growth_rate_percent ?? 0
    ),
    cogs_percent: cogsPercent,
    active: row.active === undefined ? true : Boolean(row.active),

    // Backward-compatible aliases
    monthly_price: price,
    monthly_cost: Number(row.monthly_cost ?? (price * (cogsPercent / 100))),
    growth_rate_percent: Number(
      row.growth_percent_annual ?? row.growth_rate_percent ?? 0
    ),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapFixedCost(row) {
  if (!row) {
    return null;
  }

  const growth = Number(
    row.growth_percent_annual ?? row.annual_growth_percent ?? 0
  );

  return {
    id: row.id,
    organization_id: row.organization_id,
    plan_id: row.plan_id,
    cost_name: row.cost_name,
    category: row.category || null,
    monthly_amount: Number(row.monthly_amount || 0),
    growth_percent_annual: growth,
    annual_growth_percent: growth,
    active: row.active === undefined ? true : Boolean(row.active),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeVariableJson(value, defaultKey = null) {
  if (value === null || value === undefined || typeof value !== 'object') {
    return null;
  }

  const key = normalizeVariableKey(value.key || defaultKey);
  const type = String(value.type || '').trim().toLowerCase();
  const appliesTo = normalizeAppliesTo(value.applies_to);

  if (!key) {
    return null;
  }

  if (type !== 'percentage' && type !== 'fixed') {
    return null;
  }

  const numericValue = Number(value.value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  if (type === 'percentage') {
    if (numericValue < 0 || numericValue > 100) {
      return null;
    }
  }

  return {
    key,
    type,
    value: round2(numericValue),
    applies_to: appliesTo,
  };
}

function mapVariable(row) {
  if (!row) {
    return null;
  }

  const key = normalizeVariableKey(row.variable_key);
  if (!key) {
    return null;
  }

  const normalized = normalizeVariableJson(row.variable_value, key);
  if (!normalized) {
    return null;
  }

  return {
    id: row.id,
    organization_id: row.organization_id,
    plan_id: row.plan_id,
    variable_key: normalized.key,
    key: normalized.key,
    variable_name: normalized.key,
    variable_type: normalized.type,
    type: normalized.type,
    applies_to: normalized.applies_to,
    value: normalized.value,
    variable_value: normalized,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function projectionSummary(projection) {
  return {
    years_count: projection.summary.years_count,
    total_revenue: round2(projection.summary.total_revenue),
    total_cost: round2(projection.summary.total_cost),
    total_net_profit: round2(projection.summary.total_net_profit),
    total_cashflow: round2(projection.summary.total_cashflow || 0),
    average_margin_percent: Number(
      Number(projection.summary.average_margin_percent || 0).toFixed(4)
    ),
    net_profit_year_1: round2(projection.summary.net_profit_year_1),
  };
}

function validateSupportedVariableKeys(variables) {
  for (const variable of variables || []) {
    const key = String(variable.variable_name || variable.variable_key || '')
      .trim()
      .toLowerCase();

    if (!VARIABLE_KEYS_SET.has(key)) {
      throw badRequest(`Unsupported variable key: ${key}`);
    }

    if (key === 'inflation' || key === 'revenue_growth_annual') {
      throw badRequest(`Variable ${key} is no longer supported`);
    }
  }
}

function normalizeProductPayload(payload, current = null) {
  const merged = {
    product_name: payload.product_name ?? current?.product_name,
    category: payload.category === undefined ? current?.category : payload.category,
    base_monthly_units:
      payload.base_monthly_units ?? current?.base_monthly_units ?? 0,
    price: payload.price ?? payload.monthly_price ?? current?.price ?? current?.monthly_price,
    growth_percent_annual:
      payload.growth_percent_annual ??
      payload.growth_rate_percent ??
      current?.growth_percent_annual ??
      current?.growth_rate_percent ??
      0,
    cogs_percent: payload.cogs_percent ?? current?.cogs_percent ?? 0,
    active:
      payload.active === undefined
        ? current?.active ?? true
        : toBoolean(payload.active, true),
  };

  const productName = trimOrNull(merged.product_name, 255);
  if (!productName) {
    throw badRequest('product_name is required');
  }

  const baseUnits = normalizeUnitField({
    field: 'base_monthly_units',
    value: merged.base_monthly_units,
  });

  const price = normalizeCurrencyField({
    field: 'price',
    value: merged.price,
  });

  const growth = normalizePercentageField({
    field: 'growth_percent_annual',
    value: merged.growth_percent_annual,
    min: 0,
    max: 300,
  });

  const cogsPercent = normalizePercentageField({
    field: 'cogs_percent',
    value: merged.cogs_percent,
    min: 0,
    max: 100,
  });

  return {
    product_name: productName,
    category: trimOrNull(merged.category, 120),
    base_monthly_units: baseUnits,
    price,
    growth_percent_annual: growth,
    cogs_percent: cogsPercent,
    active: Boolean(merged.active),

    // Backward-compatible aliases
    monthly_price: price,
    monthly_cost: round2(price * (cogsPercent / 100)),
    growth_rate_percent: growth,
  };
}

function normalizeFixedCostPayload(payload, current = null) {
  const merged = {
    cost_name: payload.cost_name ?? current?.cost_name,
    category: payload.category === undefined ? current?.category : payload.category,
    monthly_amount: payload.monthly_amount ?? current?.monthly_amount,
    growth_percent_annual:
      payload.growth_percent_annual ??
      payload.annual_growth_percent ??
      current?.growth_percent_annual ??
      current?.annual_growth_percent ??
      0,
    active:
      payload.active === undefined
        ? current?.active ?? true
        : toBoolean(payload.active, true),
  };

  const costName = trimOrNull(merged.cost_name, 255);
  if (!costName) {
    throw badRequest('cost_name is required');
  }

  const monthlyAmount = normalizeCurrencyField({
    field: 'monthly_amount',
    value: merged.monthly_amount,
  });

  const growth = normalizePercentageField({
    field: 'growth_percent_annual',
    value: merged.growth_percent_annual,
    min: 0,
    max: 300,
  });

  return {
    cost_name: costName,
    category: trimOrNull(merged.category, 120),
    monthly_amount: monthlyAmount,
    growth_percent_annual: growth,
    annual_growth_percent: growth,
    active: Boolean(merged.active),
  };
}

function normalizeVariablePayload(payload, current = null) {
  const key = normalizeVariableKey(
    payload.key ??
      payload.variable_key ??
      payload.variable_name ??
      current?.variable_key
  );

  if (!key) {
    throw badRequest(
      `variable key must be one of: ${VARIABLE_KEYS.join(', ')}`
    );
  }

  if (key === 'inflation' || key === 'revenue_growth_annual') {
    throw badRequest(`Variable ${key} is no longer supported`);
  }

  const currentType = current?.variable_type || current?.type;
  const type = String(payload.type ?? currentType ?? '').toLowerCase();
  if (type !== 'percentage' && type !== 'fixed') {
    throw badRequest('variable type must be "percentage" or "fixed"');
  }

  const rawValue = payload.value ?? current?.value;
  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    throw badRequest('variable value must be numeric');
  }

  assertMax2Decimals('variable value', value);

  if (type === 'percentage' && (value < 0 || value > 100)) {
    throw badRequest('percentage variable value must be between 0 and 100');
  }

  const appliesTo = normalizeAppliesTo(payload.applies_to ?? current?.applies_to);

  return {
    variable_key: key,
    variable_value: {
      key,
      type,
      value: round2(value),
      applies_to: appliesTo,
    },
  };
}

async function getPlanScoped({ organization_id, plan_id, client }) {
  const db = client || pool;

  const { rows } = await db.query(
    `
      SELECT
        id,
        organization_id,
        user_id,
        plan_name,
        start_year,
        end_year,
        tax_rate,
        inflation,
        name,
        created_at,
        updated_at
      FROM finance.financial_plans
      WHERE organization_id = $1
        AND id = $2
      LIMIT 1
    `,
    [organization_id, plan_id]
  );

  const plan = mapPlan(rows[0]);

  if (!plan) {
    throw notFound(`Financial plan not found: ${plan_id}`);
  }

  return plan;
}

async function touchPlanUpdatedAt({ organization_id, plan_id, client }) {
  const db = client || pool;

  await db.query(
    `
      UPDATE finance.financial_plans
      SET updated_at = now()
      WHERE organization_id = $1
        AND id = $2
    `,
    [organization_id, plan_id]
  );
}

async function getProductScoped({ organization_id, product_id, client }) {
  const db = client || pool;

  const { rows } = await db.query(
    `
      SELECT
        id,
        organization_id,
        plan_id,
        product_name,
        category,
        base_monthly_units,
        price,
        growth_percent_annual,
        cogs_percent,
        active,
        monthly_price,
        monthly_cost,
        growth_rate_percent,
        created_at,
        updated_at
      FROM finance.financial_products
      WHERE organization_id = $1
        AND id = $2
      LIMIT 1
    `,
    [organization_id, product_id]
  );

  const row = rows[0];
  if (!row) {
    throw notFound(`Product not found: ${product_id}`);
  }

  return mapProduct(row);
}

async function getFixedCostScoped({ organization_id, cost_id, client }) {
  const db = client || pool;

  const { rows } = await db.query(
    `
      SELECT
        id,
        organization_id,
        plan_id,
        cost_name,
        category,
        monthly_amount,
        growth_percent_annual,
        annual_growth_percent,
        active,
        created_at,
        updated_at
      FROM finance.financial_fixed_costs
      WHERE organization_id = $1
        AND id = $2
      LIMIT 1
    `,
    [organization_id, cost_id]
  );

  const row = rows[0];
  if (!row) {
    throw notFound(`Fixed cost not found: ${cost_id}`);
  }

  return mapFixedCost(row);
}

async function getVariableScoped({ organization_id, variable_id, client }) {
  const db = client || pool;

  const { rows } = await db.query(
    `
      SELECT
        id,
        organization_id,
        plan_id,
        variable_key,
        variable_value,
        created_at,
        updated_at
      FROM finance.financial_variables
      WHERE organization_id = $1
        AND id = $2
      LIMIT 1
    `,
    [organization_id, variable_id]
  );

  const row = rows[0];
  if (!row) {
    throw notFound(`Variable not found: ${variable_id}`);
  }

  const mapped = mapVariable(row);
  if (!mapped) {
    throw badRequest('Variable schema is invalid for this plan');
  }

  return mapped;
}

async function insertRowsInChunks({
  client,
  table,
  columns,
  rows,
  chunkSize = 500,
  jsonColumns = new Set(),
}) {
  if (!rows.length) {
    return 0;
  }

  let inserted = 0;

  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const values = [];

    const placeholders = chunk
      .map((row, rowIndex) => {
        const base = rowIndex * columns.length;

        for (const column of columns) {
          const value = row[column];
          values.push(jsonColumns.has(column) ? JSON.stringify(value ?? null) : value);
        }

        return `(${columns
          .map((column, columnIndex) => {
            const parameter = `$${base + columnIndex + 1}`;
            return jsonColumns.has(column) ? `${parameter}::jsonb` : parameter;
          })
          .join(', ')})`;
      })
      .join(', ');

    await client.query(
      `
        INSERT INTO ${table} (${columns.join(', ')})
        VALUES ${placeholders}
      `,
      values
    );

    inserted += chunk.length;
  }

  return inserted;
}

async function calculateProjectionSummary({ organization_id, plan_id, client }) {
  const projection = await calculatePlan({ organization_id, plan_id, client });

  return {
    projection,
    summary: projectionSummary(projection),
  };
}

async function importPlanningWorkbook({
  organization_id,
  user_id,
  workbook_buffer,
  file_name,
  plan_name_override,
  start_year_override,
  end_year_override,
  tax_rate_override,
  inflation_override,
}) {
  if (!Buffer.isBuffer(workbook_buffer) || !workbook_buffer.length) {
    throw badRequest('XLSX file is required');
  }

  const parsed = parsePlanningWorkbook(workbook_buffer, {
    plan_name_override,
    start_year_override,
    end_year_override,
    tax_rate_override,
    inflation_override,
  });

  validateSupportedVariableKeys(parsed.variables);

  validateYearRange(parsed.plan_config.start_year, parsed.plan_config.end_year);

  const taxRate = normalizePercentageField({
    field: 'tax_rate',
    value: parsed.plan_config.tax_rate,
    min: 0,
    max: 100,
  });

  const inflation = normalizePercentageField({
    field: 'inflation',
    value: parsed.plan_config.inflation,
    min: 0,
    max: 100,
  });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const planResult = await client.query(
      `
        INSERT INTO finance.financial_plans (
          organization_id,
          user_id,
          plan_name,
          start_year,
          end_year,
          tax_rate,
          inflation,
          name,
          year,
          scenario,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $3, $4, 'base'::finance.planning_scenario, now(), now())
        RETURNING
          id,
          organization_id,
          user_id,
          plan_name,
          start_year,
          end_year,
          tax_rate,
          inflation,
          name,
          created_at,
          updated_at
      `,
      [
        organization_id,
        user_id || null,
        parsed.plan_config.plan_name,
        parsed.plan_config.start_year,
        parsed.plan_config.end_year,
        taxRate,
        inflation,
      ]
    );

    const plan = mapPlan(planResult.rows[0]);

    const productsRows = parsed.products.map((row) => ({
      organization_id,
      plan_id: plan.id,
      ...normalizeProductPayload(row),
    }));

    const fixedCostsRows = parsed.fixed_costs.map((row) => ({
      organization_id,
      plan_id: plan.id,
      ...normalizeFixedCostPayload(row),
    }));

    const variableByKey = new Map();
    for (const row of parsed.variables) {
      const normalized = normalizeVariablePayload({
        key: row.variable_key || row.variable_name,
        type: row.type,
        value: row.value,
        applies_to: row.applies_to,
      });

      if (variableByKey.has(normalized.variable_key)) {
        throw badRequest(`Duplicate variable key in import: ${normalized.variable_key}`);
      }

      variableByKey.set(normalized.variable_key, {
        organization_id,
        plan_id: plan.id,
        variable_key: normalized.variable_key,
        variable_value: normalized.variable_value,
      });
    }

    const variablesRows = Array.from(variableByKey.values());

    const productsCount = await insertRowsInChunks({
      client,
      table: 'finance.financial_products',
      columns: [
        'organization_id',
        'plan_id',
        'product_name',
        'category',
        'base_monthly_units',
        'price',
        'growth_percent_annual',
        'cogs_percent',
        'active',
        'monthly_price',
        'monthly_cost',
        'growth_rate_percent',
      ],
      rows: productsRows,
      chunkSize: 1000,
    });

    const fixedCostsCount = await insertRowsInChunks({
      client,
      table: 'finance.financial_fixed_costs',
      columns: [
        'organization_id',
        'plan_id',
        'cost_name',
        'category',
        'monthly_amount',
        'growth_percent_annual',
        'annual_growth_percent',
        'active',
      ],
      rows: fixedCostsRows,
      chunkSize: 1000,
    });

    const variablesCount = await insertRowsInChunks({
      client,
      table: 'finance.financial_variables',
      columns: ['organization_id', 'plan_id', 'variable_key', 'variable_value'],
      rows: variablesRows,
      chunkSize: 1000,
      jsonColumns: new Set(['variable_value']),
    });

    await client.query(
      `
        INSERT INTO finance.plan_assumptions (
          organization_id,
          plan_id,
          key,
          value,
          created_at
        )
        VALUES ($1, $2, 'import_snapshot_input_based', $3::jsonb, now())
        ON CONFLICT (plan_id, key)
        DO UPDATE SET
          value = EXCLUDED.value,
          created_at = now()
      `,
      [
        organization_id,
        plan.id,
        JSON.stringify({
          file_name: file_name || null,
          ...parsed.snapshot,
        }),
      ]
    );

    await client.query('COMMIT');

    const projection = await calculatePlan({
      organization_id,
      plan_id: plan.id,
    });

    return {
      success: true,
      plan_id: plan.id,
      years: projection.years,
      summary: {
        total_products: productsCount,
        total_revenue: round2(projection.summary.total_revenue),
        net_income_year_1: round2(projection.summary.net_profit_year_1),
      },
      warnings: [],
      parsed_counts: {
        products: productsCount,
        fixed_costs: fixedCostsCount,
        variables: variablesCount,
        year_results: projection.rows.length,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listPlans({ organization_id }) {
  const { rows } = await pool.query(
    `
      SELECT
        id,
        organization_id,
        user_id,
        plan_name,
        start_year,
        end_year,
        tax_rate,
        inflation,
        name,
        created_at,
        updated_at
      FROM finance.financial_plans
      WHERE organization_id = $1
      ORDER BY updated_at DESC, created_at DESC
    `,
    [organization_id]
  );

  return rows.map(mapPlan);
}

async function getPlanOverview({ organization_id, plan_id }) {
  const [plan, projection, countsResult] = await Promise.all([
    getPlanScoped({ organization_id, plan_id }),
    calculatePlan({ organization_id, plan_id }),
    pool.query(
      `
        SELECT
          (SELECT COUNT(*)::int FROM finance.financial_products p
           WHERE p.organization_id = $1 AND p.plan_id = $2) AS products,
          (SELECT COUNT(*)::int FROM finance.financial_fixed_costs c
           WHERE c.organization_id = $1 AND c.plan_id = $2) AS fixed_costs,
          (SELECT COUNT(*)::int FROM finance.financial_variables v
           WHERE v.organization_id = $1 AND v.plan_id = $2
             AND lower(v.variable_key) = ANY($3::text[])
          ) AS variables
      `,
      [organization_id, plan_id, VARIABLE_KEYS]
    ),
  ]);

  return {
    plan,
    summary: projectionSummary(projection),
    counts: countsResult.rows[0] || {
      products: 0,
      fixed_costs: 0,
      variables: 0,
    },
    results: projection.rows,
    years: projection.years,
    revenue: projection.revenue,
    gross_profit: projection.gross_profit,
    net_profit: projection.net_profit,
    cashflow: projection.cashflow,
  };
}

async function getPlanResults({ organization_id, plan_id }) {
  const [plan, projection] = await Promise.all([
    getPlanScoped({ organization_id, plan_id }),
    calculatePlan({ organization_id, plan_id }),
  ]);

  return {
    plan,
    rows: projection.rows,
    years: projection.years,
    revenue: projection.revenue,
    gross_profit: projection.gross_profit,
    net_profit: projection.net_profit,
    cashflow: projection.cashflow,
  };
}

async function getPlanProducts({ organization_id, plan_id }) {
  const [plan, result] = await Promise.all([
    getPlanScoped({ organization_id, plan_id }),
    pool.query(
      `
        SELECT
          id,
          organization_id,
          plan_id,
          product_name,
          category,
          base_monthly_units,
          price,
          growth_percent_annual,
          cogs_percent,
          active,
          monthly_price,
          monthly_cost,
          growth_rate_percent,
          created_at,
          updated_at
        FROM finance.financial_products
        WHERE organization_id = $1
          AND plan_id = $2
        ORDER BY created_at ASC, lower(product_name) ASC
      `,
      [organization_id, plan_id]
    ),
  ]);

  return {
    plan,
    rows: result.rows.map(mapProduct),
  };
}

async function getPlanFixedCosts({ organization_id, plan_id }) {
  const [plan, result] = await Promise.all([
    getPlanScoped({ organization_id, plan_id }),
    pool.query(
      `
        SELECT
          id,
          organization_id,
          plan_id,
          cost_name,
          category,
          monthly_amount,
          growth_percent_annual,
          annual_growth_percent,
          active,
          created_at,
          updated_at
        FROM finance.financial_fixed_costs
        WHERE organization_id = $1
          AND plan_id = $2
        ORDER BY created_at ASC, lower(cost_name) ASC
      `,
      [organization_id, plan_id]
    ),
  ]);

  return {
    plan,
    rows: result.rows.map(mapFixedCost),
  };
}

async function getPlanVariables({ organization_id, plan_id }) {
  const [plan, result] = await Promise.all([
    getPlanScoped({ organization_id, plan_id }),
    pool.query(
      `
        SELECT
          id,
          organization_id,
          plan_id,
          variable_key,
          variable_value,
          created_at,
          updated_at
        FROM finance.financial_variables
        WHERE organization_id = $1
          AND plan_id = $2
          AND lower(variable_key) = ANY($3::text[])
        ORDER BY lower(variable_key) ASC
      `,
      [organization_id, plan_id, VARIABLE_KEYS]
    ),
  ]);

  return {
    plan,
    rows: result.rows.map(mapVariable).filter(Boolean),
  };
}

async function updatePlanConfig({ organization_id, plan_id, patch }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const current = await getPlanScoped({ organization_id, plan_id, client });

    const planName =
      patch.plan_name === undefined
        ? current.plan_name
        : trimOrNull(patch.plan_name, 180);

    if (!planName) {
      throw badRequest('plan_name is required');
    }

    const startYear =
      patch.start_year === undefined
        ? current.start_year
        : Number.parseInt(String(patch.start_year), 10);

    const endYear =
      patch.end_year === undefined
        ? current.end_year
        : Number.parseInt(String(patch.end_year), 10);

    validateYearRange(startYear, endYear);

    const taxRate =
      patch.tax_rate === undefined
        ? normalizePercentageField({
            field: 'tax_rate',
            value: current.tax_rate,
            min: 0,
            max: 100,
          })
        : normalizePercentageField({
            field: 'tax_rate',
            value: patch.tax_rate,
            min: 0,
            max: 100,
          });

    const inflation =
      patch.inflation === undefined
        ? normalizePercentageField({
            field: 'inflation',
            value: current.inflation,
            min: 0,
            max: 100,
          })
        : normalizePercentageField({
            field: 'inflation',
            value: patch.inflation,
            min: 0,
            max: 100,
          });

    const { rows } = await client.query(
      `
        UPDATE finance.financial_plans
        SET
          plan_name = $3,
          start_year = $4,
          end_year = $5,
          tax_rate = $6,
          inflation = $7,
          name = $3,
          year = $4,
          updated_at = now()
        WHERE organization_id = $1
          AND id = $2
        RETURNING
          id,
          organization_id,
          user_id,
          plan_name,
          start_year,
          end_year,
          tax_rate,
          inflation,
          name,
          created_at,
          updated_at
      `,
      [
        organization_id,
        plan_id,
        planName,
        startYear,
        endYear,
        taxRate,
        inflation,
      ]
    );

    await touchPlanUpdatedAt({ organization_id, plan_id, client });
    await client.query('COMMIT');

    const projectionInfo = await calculateProjectionSummary({
      organization_id,
      plan_id,
    });

    return {
      plan: mapPlan(rows[0]),
      years: projectionInfo.projection.years,
      projection: projectionInfo.projection,
      projection_summary: projectionInfo.summary,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createProduct({ organization_id, plan_id, payload }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await getPlanScoped({ organization_id, plan_id, client });
    const normalized = normalizeProductPayload(payload);

    const { rows } = await client.query(
      `
        INSERT INTO finance.financial_products (
          organization_id,
          plan_id,
          product_name,
          category,
          base_monthly_units,
          price,
          growth_percent_annual,
          cogs_percent,
          active,
          monthly_price,
          monthly_cost,
          growth_rate_percent,
          created_at,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12,
          now(), now()
        )
        RETURNING
          id,
          organization_id,
          plan_id,
          product_name,
          category,
          base_monthly_units,
          price,
          growth_percent_annual,
          cogs_percent,
          active,
          monthly_price,
          monthly_cost,
          growth_rate_percent,
          created_at,
          updated_at
      `,
      [
        organization_id,
        plan_id,
        normalized.product_name,
        normalized.category,
        normalized.base_monthly_units,
        normalized.price,
        normalized.growth_percent_annual,
        normalized.cogs_percent,
        normalized.active,
        normalized.monthly_price,
        normalized.monthly_cost,
        normalized.growth_rate_percent,
      ]
    );

    await touchPlanUpdatedAt({ organization_id, plan_id, client });
    await client.query('COMMIT');

    const projectionInfo = await calculateProjectionSummary({
      organization_id,
      plan_id,
    });

    return {
      row: mapProduct(rows[0]),
      projection_summary: projectionInfo.summary,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateProduct({ organization_id, plan_id, product_id, patch }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await getPlanScoped({ organization_id, plan_id, client });

    const currentResult = await client.query(
      `
        SELECT
          id,
          organization_id,
          plan_id,
          product_name,
          category,
          base_monthly_units,
          price,
          growth_percent_annual,
          cogs_percent,
          active,
          monthly_price,
          monthly_cost,
          growth_rate_percent,
          created_at,
          updated_at
        FROM finance.financial_products
        WHERE organization_id = $1
          AND plan_id = $2
          AND id = $3
        LIMIT 1
      `,
      [organization_id, plan_id, product_id]
    );

    if (!currentResult.rows[0]) {
      throw notFound(`Product not found: ${product_id}`);
    }

    const normalized = normalizeProductPayload(patch, mapProduct(currentResult.rows[0]));

    const { rows } = await client.query(
      `
        UPDATE finance.financial_products
        SET
          product_name = $4,
          category = $5,
          base_monthly_units = $6,
          price = $7,
          growth_percent_annual = $8,
          cogs_percent = $9,
          active = $10,
          monthly_price = $11,
          monthly_cost = $12,
          growth_rate_percent = $13,
          updated_at = now()
        WHERE organization_id = $1
          AND plan_id = $2
          AND id = $3
        RETURNING
          id,
          organization_id,
          plan_id,
          product_name,
          category,
          base_monthly_units,
          price,
          growth_percent_annual,
          cogs_percent,
          active,
          monthly_price,
          monthly_cost,
          growth_rate_percent,
          created_at,
          updated_at
      `,
      [
        organization_id,
        plan_id,
        product_id,
        normalized.product_name,
        normalized.category,
        normalized.base_monthly_units,
        normalized.price,
        normalized.growth_percent_annual,
        normalized.cogs_percent,
        normalized.active,
        normalized.monthly_price,
        normalized.monthly_cost,
        normalized.growth_rate_percent,
      ]
    );

    await touchPlanUpdatedAt({ organization_id, plan_id, client });
    await client.query('COMMIT');

    const projectionInfo = await calculateProjectionSummary({
      organization_id,
      plan_id,
    });

    return {
      row: mapProduct(rows[0]),
      projection_summary: projectionInfo.summary,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateProductById({ organization_id, product_id, patch }) {
  const product = await getProductScoped({ organization_id, product_id });

  return updateProduct({
    organization_id,
    plan_id: product.plan_id,
    product_id,
    patch,
  });
}

async function deleteProduct({ organization_id, plan_id, product_id }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await getPlanScoped({ organization_id, plan_id, client });

    const { rowCount } = await client.query(
      `
        DELETE FROM finance.financial_products
        WHERE organization_id = $1
          AND plan_id = $2
          AND id = $3
      `,
      [organization_id, plan_id, product_id]
    );

    if (rowCount === 0) {
      throw notFound(`Product not found: ${product_id}`);
    }

    await touchPlanUpdatedAt({ organization_id, plan_id, client });
    await client.query('COMMIT');

    const projectionInfo = await calculateProjectionSummary({
      organization_id,
      plan_id,
    });

    return {
      deleted: true,
      projection_summary: projectionInfo.summary,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createFixedCost({ organization_id, plan_id, payload }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await getPlanScoped({ organization_id, plan_id, client });
    const normalized = normalizeFixedCostPayload(payload);

    const { rows } = await client.query(
      `
        INSERT INTO finance.financial_fixed_costs (
          organization_id,
          plan_id,
          cost_name,
          category,
          monthly_amount,
          growth_percent_annual,
          annual_growth_percent,
          active,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
        RETURNING
          id,
          organization_id,
          plan_id,
          cost_name,
          category,
          monthly_amount,
          growth_percent_annual,
          annual_growth_percent,
          active,
          created_at,
          updated_at
      `,
      [
        organization_id,
        plan_id,
        normalized.cost_name,
        normalized.category,
        normalized.monthly_amount,
        normalized.growth_percent_annual,
        normalized.annual_growth_percent,
        normalized.active,
      ]
    );

    await touchPlanUpdatedAt({ organization_id, plan_id, client });
    await client.query('COMMIT');

    const projectionInfo = await calculateProjectionSummary({
      organization_id,
      plan_id,
    });

    return {
      row: mapFixedCost(rows[0]),
      projection_summary: projectionInfo.summary,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateFixedCost({ organization_id, plan_id, cost_id, patch }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await getPlanScoped({ organization_id, plan_id, client });

    const currentResult = await client.query(
      `
        SELECT
          id,
          organization_id,
          plan_id,
          cost_name,
          category,
          monthly_amount,
          growth_percent_annual,
          annual_growth_percent,
          active,
          created_at,
          updated_at
        FROM finance.financial_fixed_costs
        WHERE organization_id = $1
          AND plan_id = $2
          AND id = $3
        LIMIT 1
      `,
      [organization_id, plan_id, cost_id]
    );

    if (!currentResult.rows[0]) {
      throw notFound(`Fixed cost not found: ${cost_id}`);
    }

    const normalized = normalizeFixedCostPayload(patch, mapFixedCost(currentResult.rows[0]));

    const { rows } = await client.query(
      `
        UPDATE finance.financial_fixed_costs
        SET
          cost_name = $4,
          category = $5,
          monthly_amount = $6,
          growth_percent_annual = $7,
          annual_growth_percent = $8,
          active = $9,
          updated_at = now()
        WHERE organization_id = $1
          AND plan_id = $2
          AND id = $3
        RETURNING
          id,
          organization_id,
          plan_id,
          cost_name,
          category,
          monthly_amount,
          growth_percent_annual,
          annual_growth_percent,
          active,
          created_at,
          updated_at
      `,
      [
        organization_id,
        plan_id,
        cost_id,
        normalized.cost_name,
        normalized.category,
        normalized.monthly_amount,
        normalized.growth_percent_annual,
        normalized.annual_growth_percent,
        normalized.active,
      ]
    );

    await touchPlanUpdatedAt({ organization_id, plan_id, client });
    await client.query('COMMIT');

    const projectionInfo = await calculateProjectionSummary({
      organization_id,
      plan_id,
    });

    return {
      row: mapFixedCost(rows[0]),
      projection_summary: projectionInfo.summary,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateFixedCostById({ organization_id, cost_id, patch }) {
  const fixedCost = await getFixedCostScoped({ organization_id, cost_id });

  return updateFixedCost({
    organization_id,
    plan_id: fixedCost.plan_id,
    cost_id,
    patch,
  });
}

async function deleteFixedCost({ organization_id, plan_id, cost_id }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await getPlanScoped({ organization_id, plan_id, client });

    const { rowCount } = await client.query(
      `
        DELETE FROM finance.financial_fixed_costs
        WHERE organization_id = $1
          AND plan_id = $2
          AND id = $3
      `,
      [organization_id, plan_id, cost_id]
    );

    if (rowCount === 0) {
      throw notFound(`Fixed cost not found: ${cost_id}`);
    }

    await touchPlanUpdatedAt({ organization_id, plan_id, client });
    await client.query('COMMIT');

    const projectionInfo = await calculateProjectionSummary({
      organization_id,
      plan_id,
    });

    return {
      deleted: true,
      projection_summary: projectionInfo.summary,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function replaceVariables({ organization_id, plan_id, variables }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await getPlanScoped({ organization_id, plan_id, client });

    await client.query(
      `
        DELETE FROM finance.financial_variables
        WHERE organization_id = $1
          AND plan_id = $2
      `,
      [organization_id, plan_id]
    );

    const seenKeys = new Set();
    const rows = [];

    for (const entry of variables || []) {
      const normalized = normalizeVariablePayload(entry);

      if (seenKeys.has(normalized.variable_key)) {
        throw badRequest(`Duplicate variable key: ${normalized.variable_key}`);
      }

      seenKeys.add(normalized.variable_key);
      rows.push({
        organization_id,
        plan_id,
        variable_key: normalized.variable_key,
        variable_value: normalized.variable_value,
      });
    }

    const insertedCount = await insertRowsInChunks({
      client,
      table: 'finance.financial_variables',
      columns: ['organization_id', 'plan_id', 'variable_key', 'variable_value'],
      rows,
      chunkSize: 1000,
      jsonColumns: new Set(['variable_value']),
    });

    await touchPlanUpdatedAt({ organization_id, plan_id, client });
    await client.query('COMMIT');

    const [variablesResult, projectionInfo] = await Promise.all([
      getPlanVariables({ organization_id, plan_id }),
      calculateProjectionSummary({ organization_id, plan_id }),
    ]);

    return {
      rows: variablesResult.rows,
      inserted_count: insertedCount,
      projection_summary: projectionInfo.summary,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateVariableById({ organization_id, variable_id, patch }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const current = await getVariableScoped({
      organization_id,
      variable_id,
      client,
    });

    const normalized = normalizeVariablePayload(patch, current);

    const { rows } = await client.query(
      `
        UPDATE finance.financial_variables
        SET
          variable_key = $3,
          variable_value = $4::jsonb,
          updated_at = now()
        WHERE organization_id = $1
          AND id = $2
        RETURNING
          id,
          organization_id,
          plan_id,
          variable_key,
          variable_value,
          created_at,
          updated_at
      `,
      [
        organization_id,
        variable_id,
        normalized.variable_key,
        JSON.stringify(normalized.variable_value),
      ]
    );

    await touchPlanUpdatedAt({
      organization_id,
      plan_id: current.plan_id,
      client,
    });

    await client.query('COMMIT');

    const projectionInfo = await calculateProjectionSummary({
      organization_id,
      plan_id: current.plan_id,
    });

    return {
      row: mapVariable(rows[0]),
      projection_summary: projectionInfo.summary,
    };
  } catch (error) {
    await client.query('ROLLBACK');

    if (error?.code === '23505') {
      throw badRequest('variable key already exists for this plan');
    }

    throw error;
  } finally {
    client.release();
  }
}

async function recalculatePlan({ organization_id, plan_id }) {
  const [plan, projection] = await Promise.all([
    getPlanScoped({ organization_id, plan_id }),
    calculatePlan({ organization_id, plan_id }),
  ]);

  return {
    plan,
    rows: projection.rows,
    summary: projectionSummary(projection),
    years: projection.years,
    revenue: projection.revenue,
    gross_profit: projection.gross_profit,
    net_profit: projection.net_profit,
    cashflow: projection.cashflow,

    // Backward-compatible aliases
    revenue_by_year: projection.revenue,
    cost_by_year: projection.cost_by_year,
    gross_profit_by_year: projection.gross_profit,
    net_profit_by_year: projection.net_profit,
  };
}

module.exports = {
  importPlanningWorkbook,
  listPlans,
  getPlanOverview,
  getPlanResults,
  getPlanProducts,
  getPlanFixedCosts,
  getPlanVariables,
  updatePlanConfig,
  createProduct,
  updateProduct,
  updateProductById,
  deleteProduct,
  createFixedCost,
  updateFixedCost,
  updateFixedCostById,
  deleteFixedCost,
  replaceVariables,
  updateVariableById,
  recalculatePlan,
};
