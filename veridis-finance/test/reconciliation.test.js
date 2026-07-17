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
