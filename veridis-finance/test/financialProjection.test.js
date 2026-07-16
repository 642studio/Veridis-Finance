const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeProjection,
} = require('../src/services/planning/financialProjectionService');

test('computeProjection produces deterministic revenue/gross/net per year', () => {
  const result = computeProjection({
    plan: {
      id: 'plan-1',
      organization_id: 'org-1',
      start_year: 2024,
      end_year: 2025,
      tax_rate: 30,
      inflation: 0,
    },
    products: [
      {
        id: 'prod-1',
        base_monthly_units: 100,
        price: 10,
        cogs_percent: 40,
        growth_percent_annual: 0,
        active: true,
      },
    ],
    fixedCosts: [{ id: 'fc-1', monthly_amount: 200, active: true }],
    variables: [],
  });

  assert.deepEqual(result.years, [2024, 2025]);
  assert.equal(result.revenue.length, 2);

  // Year 2024 (yearsPassed 0, growth factor 1):
  //   revenue = 100 * 10 = 1000
  //   cogs    = 1000 * 40% = 400  -> gross = 600
  //   fixed   = 200 * 12 = 2400   -> ebit = 600 - 2400 = -1800 (no tax when < 0)
  assert.equal(result.revenue[0], 1000);
  assert.equal(result.gross_profit[0], 600);
  assert.equal(result.net_profit[0], -1800);

  assert.equal(result.summary.years_count, 2);
  assert.equal(result.summary.total_revenue, 2000);
  assert.equal(result.rows[0].year, 2024);
});

test('computeProjection ignores inactive products and costs', () => {
  const result = computeProjection({
    plan: { id: 'p', organization_id: 'o', start_year: 2024, end_year: 2024, tax_rate: 0, inflation: 0 },
    products: [{ id: 'x', base_monthly_units: 100, price: 10, cogs_percent: 0, active: false }],
    fixedCosts: [{ id: 'y', monthly_amount: 500, active: false }],
    variables: [],
  });

  assert.equal(result.revenue[0], 0);
  assert.equal(result.net_profit[0], 0);
});
