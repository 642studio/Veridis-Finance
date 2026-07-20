const test = require('node:test');
const assert = require('node:assert');

const { linesForInvoice, expenseAccountFor } = require('../src/services/autoPolizaService');

function balanced(lines) {
  const d = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const c = lines.reduce((s, l) => s + (l.credit || 0), 0);
  return Math.abs(d - c) < 0.005;
}

test('CFDI emitido genera póliza balanceada (Cliente = Ingreso + IVA)', () => {
  const built = linesForInvoice({
    direction: 'issued', receiver: 'CLIENTE X', total: 1160, subtotal: 1000,
    metodo_pago: 'PUE', uuid_sat: 'A', invoice_date: '2026-07-01',
    taxes: { traslados: [{ impuesto: '002', tipo_factor: 'Tasa', tasa: 0.16, base: 1000, importe: 160 }], retenciones: [] },
  });
  assert.strictEqual(built.entry_type, 'ingreso');
  assert.ok(balanced(built.lines));
  assert.ok(built.lines.some((l) => l.account_code === '216.01' && l.credit === 160));
});

test('CFDI recibido de Meta genera gasto de publicidad (601.06) balanceado', () => {
  const built = linesForInvoice({
    direction: 'received', emitter: 'META PLATFORMS', total: 1160, subtotal: 1000,
    metodo_pago: 'PUE', uuid_sat: 'B', invoice_date: '2026-07-01',
    taxes: { traslados: [{ impuesto: '002', tipo_factor: 'Tasa', tasa: 0.16, base: 1000, importe: 160 }], retenciones: [] },
  });
  assert.strictEqual(built.entry_type, 'egreso');
  assert.ok(balanced(built.lines));
  assert.ok(built.lines.some((l) => l.account_code === '601.06'));
  assert.ok(built.lines.some((l) => l.account_code === '201.01' && l.credit === 1160));
});

test('PPD emitido usa IVA trasladado no cobrado (213.01)', () => {
  const built = linesForInvoice({
    direction: 'issued', receiver: 'C', total: 1160, subtotal: 1000, metodo_pago: 'PPD',
    uuid_sat: 'C', invoice_date: '2026-07-01',
    taxes: { traslados: [{ impuesto: '002', tasa: 0.16, base: 1000, importe: 160 }], retenciones: [] },
  });
  assert.ok(built.lines.some((l) => l.account_code === '213.01'));
});

test('expenseAccountFor mapea por palabra clave', () => {
  assert.strictEqual(expenseAccountFor('WeWork Reforma renta'), '601.10');
  assert.strictEqual(expenseAccountFor('Vercel software'), '601.24');
  assert.strictEqual(expenseAccountFor('Proveedor raro'), '601.84');
});
