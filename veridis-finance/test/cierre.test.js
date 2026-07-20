const test = require('node:test');
const assert = require('node:assert');

const { buildClosingLines } = require('../src/services/cierreService');

function balanced(lines) {
  const d = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const c = lines.reduce((s, l) => s + (l.credit || 0), 0);
  return Math.abs(d - c) < 0.005;
}

test('póliza de cierre con utilidad: ingresos > gastos, cuadra y abona 305.01', () => {
  const { lines, resultado } = buildClosingLines([
    { code: '401.01', account_type: 'ingreso', ytd: 53000 },
    { code: '601.06', account_type: 'gasto', ytd: 42000 },
    { code: '501.01', account_type: 'costo', ytd: 1000 },
  ]);
  assert.strictEqual(resultado, 10000); // 53000 - 42000 - 1000
  assert.ok(balanced(lines));
  const res = lines.find((l) => l.account_code === '305.01');
  assert.ok(res && res.credit === 10000);
  // los ingresos se cierran con cargo
  assert.ok(lines.some((l) => l.account_code === '401.01' && l.debit === 53000));
});

test('póliza de cierre con pérdida: carga 305.01', () => {
  const { lines, resultado } = buildClosingLines([
    { code: '401.01', account_type: 'ingreso', ytd: 10000 },
    { code: '601.06', account_type: 'gasto', ytd: 25000 },
  ]);
  assert.strictEqual(resultado, -15000);
  assert.ok(balanced(lines));
  const res = lines.find((l) => l.account_code === '305.01');
  assert.ok(res && res.debit === 15000);
});

test('sin movimientos de resultado ⇒ sin partidas', () => {
  const { lines } = buildClosingLines([
    { code: '102.01', account_type: 'activo', ytd: 5000 },
  ]);
  assert.strictEqual(lines.length, 0);
});

test('resultado cero (ingresos = gastos) cuadra sin línea de 305.01', () => {
  const { lines, resultado } = buildClosingLines([
    { code: '401.01', account_type: 'ingreso', ytd: 8000 },
    { code: '601.06', account_type: 'gasto', ytd: 8000 },
  ]);
  assert.strictEqual(resultado, 0);
  assert.ok(balanced(lines));
  assert.ok(!lines.some((l) => l.account_code === '305.01'));
});
