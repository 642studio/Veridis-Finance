const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computeItemTax } = require('../src/services/pac/cfdiTax');

test('IVA 16% traslado on a $1000 base', () => {
  const r = computeItemTax({ quantity: 1, unitPrice: 1000, ivaRate: 0.16 });
  assert.equal(r.objetoImp, '02');
  assert.equal(r.base, '1000.00');
  assert.equal(r.traslados.length, 1);
  assert.equal(r.traslados[0].tipoFactor, 'Tasa');
  assert.equal(r.traslados[0].importe, '160.00');
  assert.equal(r.total, '1160.00');
});

test('IVA tasa 0% is a traslado at 0, NOT exento', () => {
  const r = computeItemTax({ quantity: 1, unitPrice: 500, ivaRate: 0 });
  assert.equal(r.objetoImp, '02');
  assert.equal(r.traslados.length, 1);
  assert.equal(r.traslados[0].tipoFactor, 'Tasa');
  assert.equal(r.traslados[0].tasa, '0');
  assert.equal(r.traslados[0].importe, '0.00');
  assert.equal(r.total, '500.00');
});

test('Exento carries a traslado with TipoFactor Exento and no importe', () => {
  const r = computeItemTax({ quantity: 1, unitPrice: 500, ivaExempt: true });
  assert.equal(r.objetoImp, '02');
  assert.equal(r.traslados[0].tipoFactor, 'Exento');
  assert.equal(r.traslados[0].importe, null);
  assert.equal(r.total, '500.00');
});

test('No objeto de impuesto → ObjetoImp 01, no taxes', () => {
  const r = computeItemTax({ quantity: 1, unitPrice: 500, noTaxObject: true });
  assert.equal(r.objetoImp, '01');
  assert.equal(r.traslados.length, 0);
  assert.equal(r.total, '500.00');
});

test('Honorarios: IVA 16% trasladado + retenciones ISR 10% e IVA 10.6667%', () => {
  const r = computeItemTax({
    quantity: 1,
    unitPrice: 10000,
    ivaRate: 0.16,
    retIsrRate: 0.10,
    retIvaRate: 0.106667,
  });
  // traslado IVA 1600; retenciones ISR 1000 + IVA 1066.67
  assert.equal(r.taxTotal, '1600.00');
  assert.equal(r.retentionTotal, '2066.67');
  // 10000 + 1600 - 2066.67
  assert.equal(r.total, '9533.33');
  assert.equal(r.retenciones.length, 2);
});

test('IEPS traslado stacks with IVA', () => {
  const r = computeItemTax({ quantity: 1, unitPrice: 1000, ivaRate: 0.16, iepsRate: 0.08 });
  // IEPS 80 + IVA 160
  assert.equal(r.taxTotal, '240.00');
  assert.equal(r.total, '1240.00');
});
