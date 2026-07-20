const test = require('node:test');
const assert = require('node:assert');

const { buildExpresion } = require('../src/services/cfdiStatusService');

test('buildExpresion formats the SAT query with 6-decimal total', () => {
  const e = buildExpresion({
    emisorRfc: 'SCD2507076C4',
    receptorRfc: 'EKU9003173C9',
    total: 1160.5,
    uuid: '9293B228-0000-0000-0000-000000000000',
  });
  assert.strictEqual(
    e,
    '?re=SCD2507076C4&rr=EKU9003173C9&tt=1160.500000&id=9293B228-0000-0000-0000-000000000000'
  );
});

test('buildExpresion tolerates zero/absent totals', () => {
  const e = buildExpresion({ emisorRfc: 'A', receptorRfc: 'B', total: null, uuid: 'U' });
  assert.ok(e.includes('tt=0.000000'));
});
