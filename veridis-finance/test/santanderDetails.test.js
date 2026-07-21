const test = require('node:test');
const assert = require('node:assert');
const { extractSantanderDetails, cleanConceptFrom } = require('../src/services/bankStatements/parsers/parserSantander');

test('SPEI de cliente: extrae nombre, RFC y concepto', () => {
  const raw = 'ABONO TRANSFERENCIA SPEI HORA 18:15:37 RECIBIDO DE BBVA MEXICO DE LA CUENTA 012777001196508228 DEL CLIENTE GRUPO HOTELERO GVR S A DE CV CLAVE DE RASTREO 002601002606090000341007 REF 0806268 CONCEPTO F 1 RFC GHG1310047X1';
  const d = extractSantanderDetails(raw);
  assert.strictEqual(d.counterparty_rfc, 'GHG1310047X1');
  assert.ok(/Grupo Hotelero Gvr/i.test(d.counterparty_name));
  assert.strictEqual(d.payment_concept, 'F 1');
  assert.strictEqual(d.tracking_key, '002601002606090000341007');
  assert.strictEqual(cleanConceptFrom(raw, 'income', d).startsWith('Pago de'), true);
});

test('consumo internacional: extrae merchant y USD', () => {
  const raw = 'CONSUMO INTERNACIONAL MC TERMINACION 3058 08JUN26 0000000000000 HIGHLEVEL INC. DALLAS (MONEDA EXTRANJERA) 20.87 USD';
  const d = extractSantanderDetails(raw);
  assert.strictEqual(d.usd_amount, 20.87);
  assert.ok(/Highlevel Inc/i.test(d.merchant));
  assert.ok(/Compra/i.test(cleanConceptFrom(raw, 'expense', d)));
});

test('payout Stripe y comisiones se nombran bien', () => {
  assert.strictEqual(cleanConceptFrom('ABONO POR TRANSFERENCIA STRIPE 642STUDIO', 'income', extractSantanderDetails('ABONO POR TRANSFERENCIA STRIPE 642STUDIO')), 'Depósito Stripe (payout)');
  assert.strictEqual(cleanConceptFrom('ADMINISTRACION RENTA MEMBRESIA', 'expense', {}), 'Comisión de manejo de cuenta');
  assert.strictEqual(cleanConceptFrom('I V A POR COMISION MEMBRESIA', 'expense', {}), 'IVA de comisión bancaria');
});

test('SPEI saliente: ENVIADO A + concepto renta', () => {
  const raw = 'PAGO TRANSFERENCIA SPEI HORA 23:18:01 ENVIADO A STP A LA CUENTA 646180401200016269 AL CLIENTE GINI MOBILIARIA S DE RL DE CV ( 1 ) CLAVE DE RASTREO 20260529400140BET0000497006700 REF 9700670 CONCEPTO Renta 642studio Junio';
  const d = extractSantanderDetails(raw);
  assert.ok(/Gini Mobiliaria/i.test(d.counterparty_name));
  assert.ok(/Renta/i.test(d.payment_concept));
  assert.ok(/Pago a Gini/i.test(cleanConceptFrom(raw, 'expense', d)));
});

const { deriveCategoryFrom } = require('../src/services/bankStatements/parsers/parserSantander');
test('categoría base por merchant/concepto', () => {
  assert.strictEqual(deriveCategoryFrom('CONSUMO INTERNACIONAL', { merchant: 'Highlevel Inc' }), 'Software y suscripciones');
  assert.strictEqual(deriveCategoryFrom('CONSUMO LOCAL', { merchant: 'Facebook Mexico' }), 'Publicidad');
  assert.strictEqual(deriveCategoryFrom('CARGO TRANSFERENCIA ENLACE Nomina 642', {}), 'Nómina');
  assert.strictEqual(deriveCategoryFrom('ADMINISTRACION RENTA MEMBRESIA', {}), 'Comisiones bancarias');
  assert.strictEqual(deriveCategoryFrom('PAGO SPEI', { payment_concept: 'Renta oficina' }), 'Renta');
});
