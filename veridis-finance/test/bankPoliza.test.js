const test = require('node:test');
const assert = require('node:assert');
const { linesForBankMovement } = require('../src/services/bankPolizaService');

function balanced(lines){const d=lines.reduce((s,l)=>s+(l.debit||0),0);const c=lines.reduce((s,l)=>s+(l.credit||0),0);return Math.abs(d-c)<0.005;}

test('cobro de cliente: Cargo Bancos / Abono Clientes', () => {
  const b = linesForBankMovement({ type: 'income', amount: 6844 });
  assert.strictEqual(b.entry_type, 'ingreso');
  assert.ok(balanced(b.lines));
  assert.ok(b.lines.some(l => l.account_code === '102.01' && l.debit === 6844));
  assert.ok(b.lines.some(l => l.account_code === '105.01' && l.credit === 6844));
});

test('pago a proveedor: Cargo Proveedores / Abono Bancos', () => {
  const b = linesForBankMovement({ type: 'expense', amount: 11600 });
  assert.strictEqual(b.entry_type, 'egreso');
  assert.ok(balanced(b.lines));
  assert.ok(b.lines.some(l => l.account_code === '201.01' && l.debit === 11600));
  assert.ok(b.lines.some(l => l.account_code === '102.01' && l.credit === 11600));
});

test('monto no positivo se ignora', () => {
  assert.strictEqual(linesForBankMovement({ type: 'income', amount: 0 }), null);
});
