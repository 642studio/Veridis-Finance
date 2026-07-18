const { test } = require('node:test');
const assert = require('node:assert/strict');

const { scoreMatch } = require('../src/services/reconciliationService');

test('exact amount + same day + name match scores very high', () => {
  const r = scoreMatch(
    { amount: 1160, date: '2026-01-15', description: 'SPEI RECIBIDO DE ACME SA DE CV' },
    { total: 1160, invoice_date: '2026-01-15', receiver: 'ACME SA DE CV', emitter: 'Mi Empresa' }
  );
  assert.ok(r.score > 0.9, `expected >0.9, got ${r.score}`);
  assert.equal(r.amountScore, 1);
  assert.equal(r.dateScore, 1);
  assert.ok(r.nameScore > 0);
});

test('amount outside tolerance is not a candidate', () => {
  const r = scoreMatch(
    { amount: 1000, date: '2026-01-15' },
    { total: 1160, invoice_date: '2026-01-15' }
  );
  assert.equal(r.amountScore, 0);
  assert.equal(r.is_amount_candidate, false);
});

test('date proximity decays over the window', () => {
  const near = scoreMatch({ amount: 500, date: '2026-01-15' }, { total: 500, invoice_date: '2026-01-20' });
  const far = scoreMatch({ amount: 500, date: '2026-01-15' }, { total: 500, invoice_date: '2026-02-25' });
  assert.ok(near.dateScore > far.dateScore);
  assert.ok(near.score > far.score);
});

test('a closer amount within tolerance scores higher than a looser one', () => {
  const exact = scoreMatch({ amount: 1000, date: '2026-01-15' }, { total: 1000, invoice_date: '2026-01-15' });
  const loose = scoreMatch({ amount: 1000, date: '2026-01-15' }, { total: 1015, invoice_date: '2026-01-15' });
  assert.ok(exact.amountScore > loose.amountScore);
});

test('an RFC verbatim in the bank description sets rfc_match and boosts the score', () => {
  const txn = {
    amount: 5817.4,
    date: '2026-06-14',
    description:
      'ABONO TRANSFERENCIA SPEI RECIBIDO DE BBVA DEL CLIENTE HOTEL ISHA DEL NOROE STE SA DE CV REF 0150626 CONCEPTO FACT 4 RFC HIN120905SE4',
  };
  const withRfc = scoreMatch(txn, {
    total: 5817.4,
    invoice_date: '2026-06-06',
    receiver: 'HOTEL ISHA DEL NOROESTE',
    emitter: 'MI EMPRESA',
    receiver_rfc: 'HIN120905SE4',
  });
  const withoutRfc = scoreMatch(txn, {
    total: 5817.4,
    invoice_date: '2026-06-06',
    receiver: 'AUTO SERVICIO MAS',
    emitter: 'MI EMPRESA',
    receiver_rfc: 'ASM010101AAA',
  });
  assert.equal(withRfc.rfc_match, true);
  assert.equal(withoutRfc.rfc_match, false);
  assert.ok(withRfc.score > withoutRfc.score, 'RFC evidence must outrank same-amount rivals');
  // Same-party older invoice: date proximity must separate them enough for the
  // rfc-group auto rule (gap >= 0.05).
  const samePartyOlder = scoreMatch(txn, {
    total: 5817.4,
    invoice_date: '2026-05-22',
    receiver: 'HOTEL ISHA DEL NOROESTE',
    emitter: 'MI EMPRESA',
    receiver_rfc: 'HIN120905SE4',
  });
  assert.ok(withRfc.score - samePartyOlder.score >= 0.05);
});
