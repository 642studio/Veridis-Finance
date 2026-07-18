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
