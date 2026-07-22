const test = require('node:test');
const assert = require('node:assert');

const { findSubsetSum, amountClose } = require('../src/services/reconciliationService');

test('amountClose: tolerancia 2% y piso de $2', () => {
  assert.ok(amountClose(10254.0, 10254.4)); // 0.4 sobre 10254 < 2%
  assert.ok(amountClose(100, 101)); // 1% ok
  assert.ok(!amountClose(100, 110)); // 10% no
  assert.ok(!amountClose(1.5, 3)); // 50% sobre base 3 → no
});

test('findSubsetSum: pago en bolsa de 2 facturas', () => {
  const invoices = [
    { id: 'a', total: 9709.2 },
    { id: 'b', total: 10254.4 },
    { id: 'c', total: 5800.0 },
  ];
  // 9709.20 + 10254.40 = 19963.60
  const subset = findSubsetSum(invoices, 19963.6, 4);
  assert.ok(subset);
  assert.deepStrictEqual(subset.map((s) => s.id).sort(), ['a', 'b']);
});

test('findSubsetSum: sin combinación que sume', () => {
  const invoices = [
    { id: 'a', total: 9709.2 },
    { id: 'b', total: 10254.4 },
  ];
  assert.strictEqual(findSubsetSum(invoices, 12345.67, 4), null);
});

test('findSubsetSum: prefiere las más viejas (orden de entrada)', () => {
  const invoices = [
    { id: 'v1', total: 5000 },
    { id: 'v2', total: 5000 },
    { id: 'v3', total: 5000 },
  ];
  // 5000 + 5000 = 10000; debe tomar las dos primeras.
  const subset = findSubsetSum(invoices, 10000, 4);
  assert.deepStrictEqual(subset.map((s) => s.id), ['v1', 'v2']);
});
