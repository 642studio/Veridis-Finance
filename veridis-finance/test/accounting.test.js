const test = require('node:test');
const assert = require('node:assert');
const { money, round } = require('../src/lib/money');

// Validaciones puras del motor (sin BD): partida doble y saldo por naturaleza.

function assertBalanced(lines) {
  let d = money(0);
  let c = money(0);
  for (const l of lines) {
    const debit = round(l.debit || 0);
    const credit = round(l.credit || 0);
    if (debit > 0 && credit > 0) throw new Error('cargo XOR abono');
    if (debit === 0 && credit === 0) throw new Error('cero');
    d = d.plus(debit);
    c = c.plus(credit);
  }
  return d.equals(c);
}

test('póliza balanceada: cargos = abonos', () => {
  const ok = assertBalanced([
    { debit: 1160 },            // Bancos
    { credit: 1000 },           // Ingresos
    { credit: 160 },            // IVA trasladado
  ]);
  assert.strictEqual(ok, true);
});

test('póliza descuadrada se detecta', () => {
  const ok = assertBalanced([{ debit: 1160 }, { credit: 1000 }]);
  assert.strictEqual(ok, false);
});

test('una partida no puede ser cargo y abono a la vez', () => {
  assert.throws(() => assertBalanced([{ debit: 10, credit: 10 }, { credit: 10 }]));
});

test('saldo deudor y acreedor por naturaleza', () => {
  const saldoDeudora = (cargos, abonos) => Number(round(cargos - abonos));
  const saldoAcreedora = (cargos, abonos) => Number(round(abonos - cargos));
  assert.strictEqual(saldoDeudora(1160, 160), 1000);   // Bancos
  assert.strictEqual(saldoAcreedora(0, 160), 160);     // IVA trasladado
});
