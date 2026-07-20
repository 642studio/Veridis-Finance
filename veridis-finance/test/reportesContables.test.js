const test = require('node:test');
const assert = require('node:assert');

const {
  computeEstadoResultados,
  computeBalanceGeneral,
} = require('../src/services/reportesContablesService');

test('Estado de Resultados: utilidad = ingresos − costos − gastos', () => {
  const er = computeEstadoResultados({
    year: 2026, month: 7,
    rows: [
      { account_type: 'ingreso', nature: 'acreedora', m_credit: 53000, m_debit: 0, y_credit: 53000, y_debit: 0 },
      { account_type: 'gasto', nature: 'deudora', m_debit: 42000, m_credit: 0, y_debit: 42000, y_credit: 0 },
      { account_type: 'gasto', nature: 'deudora', m_debit: 5000, m_credit: 0, y_debit: 5000, y_credit: 0 },
      { account_type: 'costo', nature: 'deudora', m_debit: 1000, m_credit: 0, y_debit: 1000, y_credit: 0 },
    ],
  });
  assert.strictEqual(er.ingresos.mes, 53000);
  assert.strictEqual(er.gastos.mes, 47000);
  assert.strictEqual(er.costos.mes, 1000);
  assert.strictEqual(er.utilidad.mes, 5000); // 53000 - 1000 - 47000
  assert.strictEqual(er.utilidad.ejercicio, 5000);
});

test('Estado de Resultados: nota de crédito de ingreso (cargo) resta', () => {
  const er = computeEstadoResultados({
    year: 2026, month: 7,
    rows: [
      { account_type: 'ingreso', nature: 'acreedora', m_credit: 10000, m_debit: 2000, y_credit: 10000, y_debit: 2000 },
    ],
  });
  assert.strictEqual(er.ingresos.mes, 8000); // 10000 - 2000
});

test('Balance General cuadra: activo = pasivo + capital + resultado', () => {
  const bg = computeBalanceGeneral({
    year: 2026, month: 7,
    saldos: [
      { code: '102.01', name: 'Bancos', account_type: 'activo', nature: 'deudora', saldo: 60000, ytd: 60000 },
      { code: '201.01', name: 'Proveedores', account_type: 'pasivo', nature: 'acreedora', saldo: 40000, ytd: 40000 },
      { code: '301.01', name: 'Capital social', account_type: 'capital', nature: 'acreedora', saldo: 15000, ytd: 15000 },
      { code: '401.01', name: 'Ingresos', account_type: 'ingreso', nature: 'acreedora', saldo: 0, ytd: 20000 },
      { code: '601.06', name: 'Publicidad', account_type: 'gasto', nature: 'deudora', saldo: 0, ytd: 15000 },
    ],
  });
  // resultado = 20000 - 15000 = 5000; capital+result = 15000+5000 = 20000; pasivo 40000 → 60000
  assert.strictEqual(bg.resultado_ejercicio, 5000);
  assert.strictEqual(bg.total_activo, 60000);
  assert.strictEqual(bg.total_pasivo_capital, 60000);
  assert.strictEqual(bg.cuadra, true);
});

test('Balance General cuadra con contra-activo (depreciación acumulada)', () => {
  const bg = computeBalanceGeneral({
    year: 2026, month: 12,
    saldos: [
      // Equipo de cómputo (activo deudora) y su depreciación acumulada
      // (activo pero naturaleza ACREEDORA: contra-activo).
      { code: '156.01', name: 'Equipo de cómputo', account_type: 'activo', nature: 'deudora', saldo: 36000, ytd: 0 },
      { code: '172.01', name: 'Depreciación acumulada', account_type: 'activo', nature: 'acreedora', saldo: 900, ytd: 0 },
      { code: '301.01', name: 'Capital social', account_type: 'capital', nature: 'acreedora', saldo: 35100, ytd: 0 },
    ],
  });
  // activo neto = 36000 - 900 = 35100; capital 35100 → cuadra.
  assert.strictEqual(bg.total_activo, 35100);
  assert.strictEqual(bg.cuadra, true);
  // el contra-activo se reporta como negativo dentro del activo.
  assert.ok(bg.activo.some((a) => a.code === '172.01' && a.saldo === -900));
});

test('Balance General reporta descuadre cuando el activo no coincide', () => {
  const bg = computeBalanceGeneral({
    year: 2026, month: 7,
    saldos: [
      { code: '102.01', name: 'Bancos', account_type: 'activo', nature: 'deudora', saldo: 100, ytd: 0 },
      { code: '201.01', name: 'Proveedores', account_type: 'pasivo', nature: 'acreedora', saldo: 50, ytd: 0 },
    ],
  });
  assert.strictEqual(bg.cuadra, false);
});
