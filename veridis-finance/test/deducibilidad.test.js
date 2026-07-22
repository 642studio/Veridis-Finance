const test = require('node:test');
const assert = require('node:assert');
const { clasificarEgreso } = require('../src/services/deducibilidadService');

test('consumo/software/renta requieren CFDI', () => {
  assert.strictEqual(clasificarEgreso('Software y suscripciones', 'Compra Adobe', '').clase, 'requiere_cfdi');
  assert.strictEqual(clasificarEgreso('Publicidad', 'Compra Facebook', '').clase, 'requiere_cfdi');
  assert.strictEqual(clasificarEgreso('Renta', 'Pago a Gini — Renta', '').clase, 'requiere_cfdi');
});
test('comisión bancaria: CFDI del banco', () => {
  assert.strictEqual(clasificarEgreso('Comisiones bancarias', 'Comisión de manejo', '').clase, 'cfdi_del_banco');
  assert.strictEqual(clasificarEgreso('Comisiones bancarias', 'IVA de comisión bancaria', '').clase, 'cfdi_del_banco');
});
test('traspaso / nómina / comisión venta: no aplica', () => {
  assert.strictEqual(clasificarEgreso('transfer', 'Traspaso A Otros Bancos Inbursa', '').clase, 'no_aplica');
  assert.strictEqual(clasificarEgreso('Nómina', 'Nomina 642 Carlos', '').clase, 'no_aplica');
  assert.strictEqual(clasificarEgreso('Comisiones sobre ventas', 'Comision venta RIVI', '').clase, 'no_aplica');
});
