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
