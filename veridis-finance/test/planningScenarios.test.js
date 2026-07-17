const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computeProjection } = require('../src/services/planning/financialProjectionService');

const INPUT = {
  plan: {
    id: 'plan-1',
    organization_id: 'org-1',
    start_year: 2026,
    end_year: 2026,
    tax_rate: 0,
    inflation: 0,
  },
  products: [
    { id: 'p1', base_monthly_units: 100, price: 10, cogs_percent: 40, growth_percent_annual: 0, active: true },
  ],
  fixedCosts: [{ id: 'fc1', monthly_amount: 100, active: true }],
  variables: [],
};

test('base scenario is the untouched projection', () => {
  const r = computeProjection({ ...INPUT, scenario: 'base' });
  assert.equal(r.scenario, 'base');
  assert.equal(r.revenue[0], 1000); // units 100 * price 10
});

test('optimistic lifts revenue and trims costs vs base', () => {
  const base = computeProjection({ ...INPUT, scenario: 'base' });
  const opt = computeProjection({ ...INPUT, scenario: 'optimistic' });
  assert.equal(opt.scenario, 'optimistic');
  assert.equal(opt.revenue[0], 1100); // 1000 * 1.10
  assert.ok(opt.net_profit[0] > base.net_profit[0], 'optimistic net > base net');
});

test('conservative lowers revenue and raises costs vs base', () => {
  const base = computeProjection({ ...INPUT, scenario: 'base' });
  const con = computeProjection({ ...INPUT, scenario: 'conservative' });
  assert.equal(con.revenue[0], 900); // 1000 * 0.90
  assert.ok(con.net_profit[0] < base.net_profit[0], 'conservative net < base net');
});

test('unknown scenario falls back to base', () => {
  const r = computeProjection({ ...INPUT, scenario: 'wild-guess' });
  assert.equal(r.scenario, 'base');
});

test('scenario can be taken from the plan row', () => {
  const r = computeProjection({
    ...INPUT,
    plan: { ...INPUT.plan, scenario: 'optimistic' },
  });
  assert.equal(r.scenario, 'optimistic');
});
