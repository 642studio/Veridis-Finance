const pool = require('../../db/pool');

const ALLOWED_VARIABLE_KEYS = new Set([
  'accounts_receivable',
  'accounts_payable',
  'discount_rate',
  'inventory',
]);

function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toYearsRange(startYear, endYear) {
  const years = [];

  for (let year = Number(startYear); year <= Number(endYear); year += 1) {
    years.push(year);
  }

  return years;
}

function growthFactor(ratePercent, yearsPassed) {
  const rate = toNumber(ratePercent, 0) / 100;
  return Math.pow(1 + rate, Math.max(0, yearsPassed));
}

function normalizeAppliesTo(appliesTo) {
  if (appliesTo === null || appliesTo === undefined) {
    return 'global';
  }

  const value = String(appliesTo).trim();
  if (!value) {
    return 'global';
  }

  if (value.toLowerCase() === 'global') {
    return 'global';
  }

  return value;
}

function normalizeVariableValue(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return null;
  }

  if (typeof rawValue !== 'object') {
    return null;
  }

  const key = String(rawValue.key || '').trim().toLowerCase();
  const type = String(rawValue.type || '').trim().toLowerCase();
  const value = toNumber(rawValue.value, NaN);

  if (!ALLOWED_VARIABLE_KEYS.has(key)) {
    return null;
  }

  if (type !== 'percentage' && type !== 'fixed') {
    return null;
  }

  if (!Number.isFinite(value)) {
    return null;
  }

  return {
    key,
    type,
    value,
    applies_to: normalizeAppliesTo(rawValue.applies_to),
  };
}

function normalizeVariableRow(row) {
  const key = String(row.variable_key || '').trim().toLowerCase();
  if (!ALLOWED_VARIABLE_KEYS.has(key)) {
    return null;
  }

  const normalizedValue = normalizeVariableValue(row.variable_value);
  if (!normalizedValue) {
    return null;
  }

  if (normalizedValue.key !== key) {
    return null;
  }

  return {
    id: row.id,
    key,
    type: normalizedValue.type,
    value: normalizedValue.value,
    applies_to: normalizedValue.applies_to,
  };
}

function variableAdjustmentAmount({ variables, key, totalRevenue, revenueByProduct }) {
  let adjustment = 0;

  for (const variable of variables || []) {
    if (variable.key !== key) {
      continue;
    }

    let baseAmount = totalRevenue;

    if (variable.applies_to !== 'global') {
      baseAmount = toNumber(revenueByProduct.get(variable.applies_to), 0);
    }

    if (variable.type === 'percentage') {
      adjustment += baseAmount * (variable.value / 100);
    } else {
      adjustment += variable.value;
    }
  }

  return adjustment;
}

function computeProjection({ plan, products, fixedCosts, variables }) {
  const years = toYearsRange(plan.start_year, plan.end_year);
  const taxRate = toNumber(plan.tax_rate, 0);
  const inflationRate = toNumber(plan.inflation, 0);

  const normalizedVariables = (variables || [])
    .map(normalizeVariableRow)
    .filter(Boolean);

  const revenue = [];
  const grossProfit = [];
  const netProfit = [];
  const cashflow = [];
  const costByYear = [];
  const rows = [];

  for (const year of years) {
    const yearsPassed = year - Number(plan.start_year);

    let totalRevenue = 0;
    let totalCogs = 0;
    const revenueByProduct = new Map();

    for (const product of products || []) {
      if (product.active === false) {
        continue;
      }

      const baseUnits = toNumber(product.base_monthly_units, 0);
      const annualUnitGrowth = toNumber(
        product.growth_percent_annual ?? product.growth_rate_percent,
        0
      );
      const unitsYearN = baseUnits * growthFactor(annualUnitGrowth, yearsPassed);

      const price = toNumber(product.price ?? product.monthly_price, 0);
      const revenueYearN = unitsYearN * price;
      const cogsPercent = toNumber(product.cogs_percent, 0);
      const cogsYearN = revenueYearN * (cogsPercent / 100);

      totalRevenue += revenueYearN;
      totalCogs += cogsYearN;
      revenueByProduct.set(product.id, revenueYearN);
    }

    let fixedCostsYear = 0;
    for (const fixedCost of fixedCosts || []) {
      if (fixedCost.active === false) {
        continue;
      }

      const monthlyAmount = toNumber(fixedCost.monthly_amount, 0);
      const annualFixedCost = monthlyAmount * 12 * growthFactor(inflationRate, yearsPassed);
      fixedCostsYear += annualFixedCost;
    }

    const grossProfitYear = totalRevenue - totalCogs;
    const ebit = grossProfitYear - fixedCostsYear;
    const taxYear = ebit > 0 ? ebit * (taxRate / 100) : 0;
    const netProfitYear = ebit - taxYear;

    const accountsReceivableAdj = variableAdjustmentAmount({
      variables: normalizedVariables,
      key: 'accounts_receivable',
      totalRevenue,
      revenueByProduct,
    });

    const accountsPayableAdj = variableAdjustmentAmount({
      variables: normalizedVariables,
      key: 'accounts_payable',
      totalRevenue,
      revenueByProduct,
    });

    const inventoryAdj = variableAdjustmentAmount({
      variables: normalizedVariables,
      key: 'inventory',
      totalRevenue,
      revenueByProduct,
    });

    const cashflowYear =
      netProfitYear - accountsReceivableAdj + accountsPayableAdj - inventoryAdj;

    const revenueRounded = round2(totalRevenue);
    const grossRounded = round2(grossProfitYear);
    const netRounded = round2(netProfitYear);
    const cashflowRounded = round2(cashflowYear);
    const totalCostRounded = round2(totalCogs + fixedCostsYear + taxYear);
    const marginPercent =
      revenueRounded > 0
        ? Number(((netRounded / revenueRounded) * 100).toFixed(4))
        : 0;

    revenue.push(revenueRounded);
    grossProfit.push(grossRounded);
    netProfit.push(netRounded);
    cashflow.push(cashflowRounded);
    costByYear.push(totalCostRounded);

    rows.push({
      id: `${plan.id}:${year}`,
      organization_id: plan.organization_id,
      plan_id: plan.id,
      year,
      total_revenue: revenueRounded,
      total_cost: totalCostRounded,
      gross_profit: grossRounded,
      net_profit: netRounded,
      cashflow: cashflowRounded,
      margin_percent: marginPercent,
      tax_amount: round2(taxYear),
      ebit: round2(ebit),
    });
  }

  const totalRevenueAllYears = revenue.reduce((sum, value) => sum + value, 0);
  const totalCostAllYears = costByYear.reduce((sum, value) => sum + value, 0);
  const totalNetAllYears = netProfit.reduce((sum, value) => sum + value, 0);
  const totalCashflowAllYears = cashflow.reduce((sum, value) => sum + value, 0);

  return {
    years,
    revenue,
    gross_profit: grossProfit,
    net_profit: netProfit,
    cashflow,

    // Backward-compatible keys.
    revenue_by_year: revenue,
    gross_profit_by_year: grossProfit,
    net_profit_by_year: netProfit,
    cost_by_year: costByYear,

    rows,
    summary: {
      years_count: years.length,
      total_revenue: round2(totalRevenueAllYears),
      total_cost: round2(totalCostAllYears),
      total_net_profit: round2(totalNetAllYears),
      total_cashflow: round2(totalCashflowAllYears),
      average_margin_percent:
        years.length > 0
          ? Number(
              (
                rows.reduce((sum, row) => sum + Number(row.margin_percent || 0), 0) /
                years.length
              ).toFixed(4)
            )
          : 0,
      net_profit_year_1: rows[0] ? round2(rows[0].net_profit) : 0,
    },
  };
}

async function fetchPlanInputs({ organization_id, plan_id, client }) {
  const db = client || pool;

  const [planResult, productsResult, fixedCostsResult, variablesResult] =
    await Promise.all([
      db.query(
        `
          SELECT
            id,
            organization_id,
            plan_name,
            start_year,
            end_year,
            tax_rate,
            inflation,
            created_at,
            updated_at
          FROM finance.financial_plans
          WHERE organization_id = $1
            AND id = $2
          LIMIT 1
        `,
        [organization_id, plan_id]
      ),
      db.query(
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
      db.query(
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
      db.query(
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
          ORDER BY lower(variable_key) ASC
        `,
        [organization_id, plan_id]
      ),
    ]);

  const plan = planResult.rows[0];

  if (!plan) {
    const error = new Error(`Financial plan not found: ${plan_id}`);
    error.statusCode = 404;
    throw error;
  }

  return {
    plan,
    products: productsResult.rows,
    fixed_costs: fixedCostsResult.rows,
    variables: variablesResult.rows,
  };
}

async function calculatePlan(planOrOptions, options = {}) {
  const input =
    typeof planOrOptions === 'string'
      ? {
          organization_id: options.organization_id,
          plan_id: planOrOptions,
          client: options.client,
        }
      : {
          organization_id: planOrOptions.organization_id,
          plan_id: planOrOptions.plan_id,
          client: planOrOptions.client,
        };

  if (!input.organization_id) {
    const error = new Error('organization_id is required to calculate a plan');
    error.statusCode = 400;
    throw error;
  }

  if (!input.plan_id) {
    const error = new Error('plan_id is required to calculate a plan');
    error.statusCode = 400;
    throw error;
  }

  const data = await fetchPlanInputs(input);

  return computeProjection({
    plan: data.plan,
    products: data.products,
    fixedCosts: data.fixed_costs,
    variables: data.variables,
  });
}

module.exports = {
  computeProjection,
  fetchPlanInputs,
  calculatePlan,
  ALLOWED_VARIABLE_KEYS,
};
