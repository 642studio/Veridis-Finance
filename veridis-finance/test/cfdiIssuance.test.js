const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reserveIssuance } = require('../src/services/cfdiIssuanceService');
const input = { organization_id: 'org-a', source_ref: 'order-a', receiver: { rfc: 'AAA010101AAA', name: 'Cliente' }, items: [{ description: 'Servicio', unitPrice: 100 }] };
function dbFor(row, inserted = false) {
  let calls = 0;
  return { query: async (sql, args) => {
    calls++;
    assert.equal(args[0], 'org-a');
    if (sql.startsWith('INSERT')) return { rows: inserted ? [{ id: 'new' }] : [] };
    if (sql.startsWith('SELECT')) return { rows: [row] };
    return { rows: [{ id: row.id }] };
  }, calls: () => calls };
}
test('reserves a durable draft before calling the provider', async () => {
  assert.deepEqual(await reserveIssuance(dbFor(null, true), input), { id: 'new' });
});
test('a stamped invoice is replayed', async () => {
  const row = { id: 'old', status: 'stamped' };
  assert.deepEqual(await reserveIssuance(dbFor(row), input), { existing: row });
});
test('canceled invoice cannot be reissued under the same reference', async () => {
  const row = { id: 'old', status: 'canceled' };
  assert.deepEqual(await reserveIssuance(dbFor(row), input), { existing: row });
});
test('only a definite rejection can be claimed for retry', async () => {
  assert.deepEqual(await reserveIssuance(dbFor({ id: 'old', status: 'error', raw: { issuance_outcome: 'rejected' } }), input), { id: 'old' });
});
for (const row of [{ status: 'draft' }, { status: 'error' }, { status: 'error', raw: { issuance_outcome: 'unknown' } }]) {
  test(`blocks uncertain or legacy outcome: ${JSON.stringify(row)}`, async () => {
    await assert.rejects(reserveIssuance(dbFor(row), input), { statusCode: 409 });
  });
}
test('rejects reusing a reference with a changed payload', async () => {
  await assert.rejects(reserveIssuance(dbFor({ status: 'stamped', raw: { issuance_fingerprint: 'different' } }), input), { statusCode: 409 });
});
test('a competing retry cannot claim the same rejected attempt', async () => {
  const db = dbFor({ id: 'old', status: 'error', raw: { issuance_outcome: 'rejected' } });
  const original = db.query;
  db.query = (sql, args) => sql.startsWith('UPDATE') ? { rows: [] } : original(sql, args);
  await assert.rejects(reserveIssuance(db, input), { statusCode: 409 });
});
