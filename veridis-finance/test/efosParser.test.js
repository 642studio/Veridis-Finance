const test = require('node:test');
const assert = require('node:assert');

const { parseEfosCsv } = require('../src/services/efosService');

test('parseEfosCsv extracts RFC/name/situacion and skips junk headers', () => {
  const csv = Buffer.from(
    [
      'LISTADO COMPLETO ART 69-B',
      'No,RFC,"Nombre del Contribuyente","Situación del contribuyente",Fecha',
      '1,AAA010101AAA,"EMPRESA FANTASMA, SA DE CV",Definitivo,01/01/2024',
      '2,BBB020202BB2,"OTRA SA",Presunto,02/02/2024',
      ',,,',
    ].join('\n'),
    'latin1'
  );
  const rows = parseEfosCsv(csv);
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows[0], {
    rfc: 'AAA010101AAA',
    name: 'EMPRESA FANTASMA, SA DE CV',
    situacion: 'Definitivo',
  });
  assert.strictEqual(rows[1].situacion, 'Presunto');
});

test('parseEfosCsv dedupes repeated RFCs keeping the last status', () => {
  const csv = Buffer.from(
    [
      '1,DDD040404DD4,"EMPRESA X, SA",Presunto,a',
      '2,DDD040404DD4,"EMPRESA X, SA",Definitivo,b',
    ].join('\n'),
    'latin1'
  );
  const rows = parseEfosCsv(csv);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].situacion, 'Definitivo');
});

test('parseEfosCsv handles quoted commas and double quotes', () => {
  const csv = Buffer.from(
    '3,CCC030303CC3,"COMERCIALIZADORA ""X"", SA",Desvirtuado,x\n',
    'latin1'
  );
  const rows = parseEfosCsv(csv);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].name, 'COMERCIALIZADORA "X", SA');
});
