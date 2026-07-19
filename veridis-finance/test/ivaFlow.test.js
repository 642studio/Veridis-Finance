const test = require('node:test');
const assert = require('node:assert');

const { ivaOfRow } = require('../src/services/ivaFlowService');

test('ivaOfRow uses the CFDI taxes breakdown when present', () => {
  const row = {
    total: 1160,
    subtotal: 1000,
    taxes: {
      traslados: [{ impuesto: '002', tipo_factor: 'Tasa', tasa: 0.16, base: 1000, importe: 160 }],
      retenciones: [{ impuesto: '001', importe: 100 }, { impuesto: '002', importe: 106.67 }],
    },
  };
  const iva = ivaOfRow(row);
  assert.strictEqual(iva.iva, 160);
  assert.strictEqual(iva.base16, 1000);
  assert.strictEqual(iva.ret_isr, 100);
  assert.strictEqual(iva.ret_iva, 106.67);
  assert.strictEqual(iva.estimated, false);
});

test('ivaOfRow splits exempt and 0% bases', () => {
  const row = {
    total: 500,
    subtotal: 500,
    taxes: {
      traslados: [
        { impuesto: '002', tipo_factor: 'Exento', tasa: null, base: 300, importe: 0 },
        { impuesto: '002', tipo_factor: 'Tasa', tasa: 0, base: 200, importe: 0 },
      ],
      retenciones: [],
    },
  };
  const iva = ivaOfRow(row);
  assert.strictEqual(iva.exento, 300);
  assert.strictEqual(iva.base0, 200);
  assert.strictEqual(iva.iva, 0);
});

test('ivaOfRow estimates 16/116 when no breakdown exists', () => {
  const iva = ivaOfRow({ total: 1160, subtotal: null, taxes: null });
  assert.strictEqual(iva.estimated, true);
  assert.ok(Math.abs(iva.iva - 160) < 0.01);
});

test('ivaOfRow estimates total-subtotal when both present', () => {
  const iva = ivaOfRow({ total: 1160, subtotal: 1000, taxes: { traslados: [], retenciones: [] } });
  assert.strictEqual(iva.estimated, true);
  assert.strictEqual(iva.iva, 160);
});
