const test = require('node:test');
const assert = require('node:assert');

const { buildDiotRows, toBatchTxt, tipoTercero, tipoOperacion } = require('../src/services/diotService');

const ivaTax = (base, importe) => ({
  traslados: [{ impuesto: '002', tipo_factor: 'Tasa', tasa: 0.16, base, importe }],
  retenciones: [],
});

test('tipoTercero clasifica nacional / extranjero / global', () => {
  assert.strictEqual(tipoTercero('MEG160101AB1'), '04'); // moral nacional
  assert.strictEqual(tipoTercero('CACX7605101P8'), '04'); // física nacional (13)
  assert.strictEqual(tipoTercero('XEXX010101000'), '05'); // extranjero
  assert.strictEqual(tipoTercero('XAXX010101000'), '15'); // público en general
});

test('tipoOperacion mapea arrendamiento y servicios profesionales', () => {
  assert.strictEqual(tipoOperacion('WeWork arrendamiento oficina'), '06');
  assert.strictEqual(tipoOperacion('Despacho honorarios contables'), '03');
  assert.strictEqual(tipoOperacion('Meta Platforms'), '85');
});

test('agrega por proveedor y suma IVA acreditable a 16%', () => {
  const { rows, totales } = buildDiotRows([
    { emitter_rfc: 'MEG160101AB1', emitter: 'Meta', total: 1160, subtotal: 1000, taxes: ivaTax(1000, 160) },
    { emitter_rfc: 'MEG160101AB1', emitter: 'Meta', total: 580, subtotal: 500, taxes: ivaTax(500, 80) },
    { emitter_rfc: 'GOO980101AAA', emitter: 'Google', total: 2320, subtotal: 2000, taxes: ivaTax(2000, 320) },
  ]);
  assert.strictEqual(rows.length, 2); // dos proveedores
  const meta = rows.find((r) => r.rfc === 'MEG160101AB1');
  assert.strictEqual(meta.valor_16, 1500);
  assert.strictEqual(meta.iva_16, 240);
  assert.strictEqual(meta.count, 2);
  assert.strictEqual(totales.iva_16, 560); // 240 + 320
  assert.strictEqual(totales.proveedores, 2);
});

test('toBatchTxt genera renglones con RFC nacional y separador |', () => {
  const { rows } = buildDiotRows([
    { emitter_rfc: 'MEG160101AB1', emitter: 'Meta', total: 1160, subtotal: 1000, taxes: ivaTax(1000, 160) },
  ]);
  const txt = toBatchTxt({ rows });
  const cols = txt.split('\n')[0].split('|');
  assert.strictEqual(cols[0], '04');            // tipo tercero
  assert.strictEqual(cols[1], '85');            // tipo operación (otros)
  assert.strictEqual(cols[2], 'MEG160101AB1');  // RFC
  assert.strictEqual(cols[7], '1000');          // valor de actos a 16%
});

test('IVA retenido se acumula por proveedor', () => {
  const { rows } = buildDiotRows([
    {
      emitter_rfc: 'CACX7605101P8', emitter: 'Despacho', total: 1160, subtotal: 1000,
      taxes: {
        traslados: [{ impuesto: '002', tasa: 0.16, base: 1000, importe: 160 }],
        retenciones: [{ impuesto: '002', importe: 106.67 }],
      },
    },
  ]);
  assert.ok(Math.abs(rows[0].iva_retenido - 106.67) < 0.01);
});
