const test = require('node:test');
const assert = require('node:assert');

const {
  mapLegacyCategory,
  isCanonical,
  categoriesForType,
  REVIEW_CATEGORY,
} = require('../src/services/categoryTaxonomy');
const { applyRules } = require('../src/services/categoryReclassifyService');

test('mapeo determinista inglés → canónico, según tipo', () => {
  // Un abono "marketing" es un cliente pagando; un cargo "marketing" es gasto.
  assert.strictEqual(mapLegacyCategory('marketing', 'income'), 'Ventas y servicios');
  assert.strictEqual(mapLegacyCategory('marketing', 'expense'), 'Publicidad');
  assert.strictEqual(mapLegacyCategory('suppliers', 'expense'), 'Proveedores');
  assert.strictEqual(mapLegacyCategory('payroll', 'expense'), 'Nómina y freelancers');
  assert.strictEqual(mapLegacyCategory('bank_fees', 'income'), 'Reembolsos');
  assert.strictEqual(mapLegacyCategory('bank_fees', 'expense'), 'Comisiones bancarias');
});

test('transfer NUNCA se vuelve traspaso interno automáticamente', () => {
  // Un SPEI recibido casi siempre es un cliente → ingreso; un SPEI enviado es
  // ambiguo → Por revisar. Ninguno cae en "Traspaso interno".
  assert.strictEqual(mapLegacyCategory('transfer', 'income'), 'Ventas y servicios');
  assert.strictEqual(mapLegacyCategory('transfer', 'expense'), REVIEW_CATEGORY);
});

test('valores desconocidos o vacíos caen en Por revisar', () => {
  // Entrada vacía → Por revisar (el import aplica el default por tipo aparte).
  assert.strictEqual(mapLegacyCategory('', 'expense'), REVIEW_CATEGORY);
  assert.strictEqual(mapLegacyCategory(null, 'income'), REVIEW_CATEGORY);
  assert.strictEqual(mapLegacyCategory('gobbledygook', 'expense'), REVIEW_CATEGORY);
});

test('categorías canónicas se reconocen y se pasan sin cambio', () => {
  assert.ok(isCanonical('Nómina y freelancers'));
  assert.ok(isCanonical('Traspaso interno'));
  assert.ok(!isCanonical('payroll'));
  assert.strictEqual(mapLegacyCategory('Renta', 'expense'), 'Renta');
});

test('categoriesForType incluye neutral y Por revisar', () => {
  const exp = categoriesForType('expense');
  assert.ok(exp.includes('Nómina y freelancers'));
  assert.ok(exp.includes('Traspaso interno'));
  assert.ok(exp.includes(REVIEW_CATEGORY));
  assert.ok(!exp.includes('Ventas y servicios')); // esa es de ingreso
});

test('reglas deterministas de re-categorización', () => {
  const owner = ['Fernando Villa'];
  assert.strictEqual(applyRules('DISP ATM PROPIO TARJ DEB X99198 TERMINACION 4413', owner), 'Retiros de socio');
  assert.strictEqual(applyRules('Pago a Fernando — Transferencia A Fernando Villa Banregio', owner), 'Retiros de socio');
  assert.strictEqual(applyRules('PAGO DE CREDITO PERSONAL', owner), 'Pago de créditos');
  assert.strictEqual(applyRules('IVA POR COMISION', owner), 'Comisiones bancarias');
  // Un freelancer distinto que comparte el nombre "Fernando" NO es retiro de socio.
  assert.strictEqual(applyRules('Pago a Adrian Fernando — Live Etchojoa', owner), null);
});
