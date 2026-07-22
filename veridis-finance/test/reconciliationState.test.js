const test = require('node:test');
const assert = require('node:assert');
const { reconciliationState, scoreMatch } = require('../src/services/reconciliationService');

test('estado sin_conciliar cuando no hay CFDI ligado', () => {
  assert.strictEqual(reconciliationState(1000, null), 'sin_conciliar');
});
test('estado conciliado cuando el monto coincide (dentro de tolerancia)', () => {
  assert.strictEqual(reconciliationState(1160, 1160), 'conciliado');
  assert.strictEqual(reconciliationState(1160, 1165), 'conciliado'); // <2%
});
test('estado parcial cuando el CFDI no cubre el movimiento', () => {
  assert.strictEqual(reconciliationState(5000, 1160), 'parcial');
});
test('scoreMatch premia RFC en la descripción del banco', () => {
  const m = scoreMatch(
    { amount: 6844, date: '2026-06-08', description: 'ABONO SPEI DEL CLIENTE GRUPO HOTELERO GVR RFC GHG1310047X1 CONCEPTO F 1' },
    { total: 6844, invoice_date: '2026-06-08', receiver: 'Grupo Hotelero GVR', receiver_rfc: 'GHG1310047X1' }
  );
  assert.strictEqual(m.rfc_match, true);
  assert.ok(m.score >= 0.9);
});

const { isStripePayout } = require('../src/services/reconciliationService');
test('payout Stripe se detecta y marca aparte', () => {
  assert.strictEqual(isStripePayout('ABONO POR TRANSFERENCIA STRIPE 642STUDIO', 'Depósito Stripe (payout)', 'income'), true);
  assert.strictEqual(isStripePayout('ABONO SPEI DEL CLIENTE STRIPE PAYMENTS MEXICO', null, 'income'), true);
  assert.strictEqual(isStripePayout('CONSUMO STRIPE', null, 'expense'), false);
  assert.strictEqual(isStripePayout('ABONO SPEI GRUPO HOTELERO', null, 'income'), false);
});
test('reconciliationState marca payout_stripe cuando no hay CFDI', () => {
  assert.strictEqual(reconciliationState(703.02, null, { descripcion: 'ABONO POR TRANSFERENCIA STRIPE', type: 'income' }), 'payout_stripe');
  assert.strictEqual(reconciliationState(500, null, { descripcion: 'ABONO SPEI CLIENTE X', type: 'income' }), 'sin_conciliar');
});

const { noRequiereFactura } = require('../src/services/reconciliationService');
test('traspasos (solo criterio estricto), nómina y comisiones de venta no requieren factura', () => {
  // "TRASPASO A OTROS BANCOS" puede ser un pago real de un tercero — NO se excluye por texto.
  assert.strictEqual(noRequiereFactura('TRASPASO A OTROS BANCOS INBURSA', null, 'transfer'), null);
  // Solo la categoría explícita o texto inequívoco de cuenta propia.
  assert.strictEqual(noRequiereFactura('x', null, 'Traspaso interno'), 'traspaso');
  assert.strictEqual(noRequiereFactura('TRASPASO ENTRE CUENTAS PROPIAS', null, null), 'traspaso');
  assert.strictEqual(noRequiereFactura('CARGO TRANSFERENCIA ENLACE Nomina 642 Carlos', null, null), 'nomina');
  assert.strictEqual(noRequiereFactura(null, 'Comision venta RIVI Rojas', null), 'comision_venta');
  assert.strictEqual(noRequiereFactura('ABONO SPEI CLIENTE X CONCEPTO F 1', null, 'sales'), null);
});
test('estado sin_factura_ok para movimientos que no llevan CFDI', () => {
  assert.strictEqual(reconciliationState(9500, null, { descripcion: 'CARGO ENLACE Nomina 642', type: 'expense' }), 'sin_factura_ok');
  // Traspaso de tercero: sigue siendo sin_conciliar (podría merecer CFDI).
  assert.strictEqual(reconciliationState(500, null, { descripcion: 'TRASPASO A OTROS BANCOS', type: 'income', categoria: 'transfer' }), 'sin_conciliar');
  assert.strictEqual(reconciliationState(500, null, { descripcion: 'x', type: 'income', categoria: 'Traspaso interno' }), 'sin_factura_ok');
});
