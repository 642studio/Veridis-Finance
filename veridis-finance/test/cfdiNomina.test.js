const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildNominaPayload } = require('../src/services/pac/facturamaProvider');

const BASE_INPUT = {
  employee: {
    rfc: 'XAXX010101000',
    name: 'EMPLEADO DE PRUEBA',
    zip: '01000',
    dailySalary: 500,
    baseSalary: 500,
  },
  payroll: {
    paymentDate: '2026-07-15',
    initialPaymentDate: '2026-07-01',
    finalPaymentDate: '2026-07-15',
    daysPaid: 15,
  },
  perceptions: [
    { code: '001', description: 'Sueldo', taxedAmount: 7500, exemptedAmount: 0 },
  ],
  deductions: [
    { code: '002', description: 'ISR', amount: 800 },
    { code: '001', description: 'IMSS', amount: 200.5 },
  ],
};

test('nómina payload: tipo N, CN01 y régimen de sueldos', () => {
  const p = buildNominaPayload(BASE_INPUT);
  assert.equal(p.CfdiType, 'N');
  assert.equal(p.NameId, '15');
  assert.equal(p.PaymentForm, '99');
  assert.equal(p.Receiver.CfdiUse, 'CN01');
  assert.equal(p.Receiver.FiscalRegime, '605');
  assert.equal(p.Complemento.Payroll.Type, 'O');
  assert.equal(p.Complemento.Payroll.DaysPaid, 15);
});

test('nómina payload: neto = percepciones - deducciones con decimales exactos', () => {
  const p = buildNominaPayload(BASE_INPUT);
  assert.equal(p._computed.total_perceptions, 7500);
  assert.equal(p._computed.total_deductions, 1000.5);
  assert.equal(p._computed.net_pay, 6499.5);
  assert.equal(p.Complemento.Payroll.Perceptions.Details.length, 1);
  assert.equal(p.Complemento.Payroll.Deductions.Details.length, 2);
});

test('nómina payload: percepciones gravadas + exentas se suman', () => {
  const p = buildNominaPayload({
    ...BASE_INPUT,
    perceptions: [
      { code: '001', taxedAmount: 5000, exemptedAmount: 0 },
      { code: '021', description: 'Prima vacacional', taxedAmount: 100, exemptedAmount: 400 },
    ],
    deductions: [],
  });
  assert.equal(p._computed.total_perceptions, 5500);
  assert.equal(p._computed.net_pay, 5500);
});
