const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildEgresoPayload,
  buildPagoPayload,
} = require('../src/services/pac/facturamaProvider');

const RECEIVER = {
  rfc: 'XAXX010101000',
  name: 'PUBLICO EN GENERAL',
  fiscalRegime: '616',
  zip: '01000',
};

const RELATED_UUID = 'AD662D33-6934-459C-A128-BDF0393E0F44';

test('Egreso payload: nota de crédito relacionada al CFDI original', () => {
  const p = buildEgresoPayload({
    receiver: { ...RECEIVER, use: 'G02' },
    items: [{ description: 'Devolución parcial', quantity: 1, unitPrice: 500, ivaRate: 0.16 }],
    relatedUuid: RELATED_UUID,
    relationType: '01',
    paymentForm: '03',
    expeditionPlace: '64000',
  });
  assert.equal(p.CfdiType, 'E');
  assert.equal(p.NameId, '2');
  assert.equal(p.PaymentMethod, 'PUE');
  assert.equal(p.Receiver.CfdiUse, 'G02');
  assert.equal(p.Relations.Type, '01');
  assert.deepEqual(p.Relations.Cfdis, [{ Uuid: RELATED_UUID }]);
  assert.equal(p.ExpeditionPlace, '64000');
  // items keep the corrected tax model: 500 + 16% = 580
  assert.equal(p.Items[0].Total, 580);
});

test('Egreso payload: relación 03 (devolución) y forma de pago heredable', () => {
  const p = buildEgresoPayload({
    receiver: RECEIVER,
    items: [{ description: 'Devolución', quantity: 1, unitPrice: 100, ivaRate: 0 }],
    relatedUuid: RELATED_UUID,
    relationType: '03',
  });
  assert.equal(p.Relations.Type, '03');
  assert.equal(p.PaymentForm, '03'); // default
  // IVA tasa 0% sigue siendo objeto de impuesto (no exento)
  assert.equal(p.Items[0].TaxObject, '02');
});

test('Pago (REP) payload: CP01, parcialidad y saldos con decimales exactos', () => {
  const p = buildPagoPayload({
    receiver: RECEIVER,
    relatedUuid: RELATED_UUID,
    expeditionPlace: '64000',
    payment: {
      date: '2026-07-17',
      paymentForm: '03',
      amount: 386.67,
      previousBalance: 1160,
      partialityNumber: 1,
    },
  });
  assert.equal(p.CfdiType, 'P');
  assert.equal(p.NameId, '14');
  assert.equal(p.Receiver.CfdiUse, 'CP01');
  const pay = p.Complemento.Payments[0];
  assert.equal(pay.Date, '2026-07-17');
  assert.equal(pay.Amount, 386.67);
  const rel = pay.RelatedDocuments[0];
  assert.equal(rel.Uuid, RELATED_UUID);
  assert.equal(rel.PaymentMethod, 'PPD');
  assert.equal(rel.PartialityNumber, 1);
  assert.equal(rel.PreviousBalanceAmount, 1160);
  assert.equal(rel.AmountPaid, 386.67);
  // 1160 - 386.67 computed with decimal.js, no float dust
  assert.equal(rel.RemainingBalance, 773.33);
});

test('Pago (REP) payload: pago total deja saldo insoluto en cero', () => {
  const p = buildPagoPayload({
    receiver: RECEIVER,
    relatedUuid: RELATED_UUID,
    payment: { date: '2026-07-17', amount: 1160, previousBalance: 1160 },
  });
  const rel = p.Complemento.Payments[0].RelatedDocuments[0];
  assert.equal(rel.RemainingBalance, 0);
  assert.equal(rel.PartialityNumber, 1);
});
