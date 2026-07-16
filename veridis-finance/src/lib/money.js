/**
 * Money helpers.
 *
 * Financial math must never touch JS floats (0.1 + 0.2 !== 0.3). We store
 * amounts as Postgres NUMERIC and compute with decimal.js. Amounts flow through
 * the app as strings or Decimal instances, never as native floats.
 */

const Decimal = require('decimal.js');

// Bankers-safe config: plenty of precision, round half-up at the boundary.
Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

/** @param {string|number|Decimal} value */
function money(value) {
  return new Decimal(value ?? 0);
}

/** Sum a list of amounts. */
function sum(values) {
  return values.reduce((acc, v) => acc.plus(money(v)), new Decimal(0));
}

/** Round to N decimal places (default 2) and return a fixed string, e.g. "1160.00". */
function round(value, dp = 2) {
  return money(value).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toFixed(dp);
}

/** Compare two amounts within an absolute tolerance (default exact). */
function equals(a, b, tolerance = 0) {
  return money(a).minus(money(b)).abs().lessThanOrEqualTo(money(tolerance));
}

/** Format for display, e.g. formatMXN("1160") -> "$1,160.00". */
function formatMXN(value) {
  const n = money(value).toNumber();
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
  }).format(n);
}

module.exports = { Decimal, money, sum, round, equals, formatMXN };
