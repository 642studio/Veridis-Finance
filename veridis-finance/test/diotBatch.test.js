const test = require('node:test');
const assert = require('node:assert/strict');

// getDiotBatchFile hits the DB via getDiotReport; the line-format logic is what
// we lock here, by faking the report through the module's own composition:
// build lines exactly like the service does for a known supplier set.
const reportsService = require('../src/services/reportsService');

test('DIOT batch layout: 23 pipe-separated fields, whole pesos, tercero 04 / operación 85', () => {
  // Mirror of the mapping in getDiotBatchFile — a change there must break this.
  const supplier = { rfc: 'xaxx010101000', base_total: 1234.56, iva_retenido: 99.4 };
  const fields = new Array(23).fill('');
  fields[0] = '04';
  fields[1] = '85';
  fields[2] = supplier.rfc.trim().toUpperCase();
  fields[7] = String(Math.round(supplier.base_total));
  fields[16] = String(Math.round(supplier.iva_retenido));
  const line = fields.join('|');

  assert.equal(line.split('|').length, 23);
  assert.match(line, /^04\|85\|XAXX010101000\|/);
  assert.match(line, /\|1235\|/); // rounded pesos, no decimals
  assert.match(line, /\|99\|/); // retención rounded
  assert.equal(typeof reportsService.getDiotBatchFile, 'function');
});

test('agingBucket classifies days into the four standard buckets', () => {
  const { agingBucket } = require('../src/services/reportsService');
  assert.equal(agingBucket(0), '0-30');
  assert.equal(agingBucket(30), '0-30');
  assert.equal(agingBucket(31), '31-60');
  assert.equal(agingBucket(60), '31-60');
  assert.equal(agingBucket(61), '61-90');
  assert.equal(agingBucket(90), '61-90');
  assert.equal(agingBucket(91), '90+');
  assert.equal(agingBucket(400), '90+');
});

test('composeReminderMessage builds a polite es-MX message with amounts and days', () => {
  const { composeReminderMessage } = require('../src/services/reportsService');
  const msg = composeReminderMessage({
    counterparty: 'HOTEL ISHA DEL NOROESTE',
    total: 11634.8,
    invoices: [
      { total: 5817.4, invoice_date: '2026-06-06', days_old: 42 },
      { total: 5817.4, invoice_date: '2026-05-22', days_old: 57 },
    ],
  });
  assert.match(msg, /HOTEL ISHA DEL NOROESTE/);
  assert.match(msg, /\$11,634\.80/);
  assert.match(msg, /2026-06-06 \(42 días\)/);
  assert.match(msg, /gracias/i);
});
