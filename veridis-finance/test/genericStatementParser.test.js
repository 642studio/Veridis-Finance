const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseGenericStatement,
  parseMexicanDate,
  parseMoney,
  inferType,
} = require('../src/services/bankStatements/parsers/genericStatementParser');
const {
  parseBanorteStatement,
} = require('../src/services/bankStatements/parsers/parserBanorte');

test('parseMexicanDate handles dd/mm/yyyy and dd/MON/yy', () => {
  const a = parseMexicanDate('05/01/2025');
  assert.equal(a.getUTCFullYear(), 2025);
  assert.equal(a.getUTCMonth(), 0);
  assert.equal(a.getUTCDate(), 5);

  const b = parseMexicanDate('15/AGO/24');
  assert.equal(b.getUTCFullYear(), 2024);
  assert.equal(b.getUTCMonth(), 7);
  assert.equal(b.getUTCDate(), 15);
});

test('parseMexicanDate rejects invalid dates', () => {
  assert.equal(parseMexicanDate('32/01/2025'), null);
  assert.equal(parseMexicanDate('01/13/2025'), null);
  assert.equal(parseMexicanDate('not-a-date'), null);
});

test('parseMoney strips currency and thousands separators', () => {
  assert.equal(parseMoney('$1,234.56'), 1234.56);
  assert.equal(parseMoney('-500.00'), 500);
  assert.equal(parseMoney('--'), 0);
  assert.equal(parseMoney(''), 0);
});

test('inferType uses running-balance delta first', () => {
  assert.equal(inferType('pago', 100, 1000, 1100), 'income');
  assert.equal(inferType('pago', 100, 1000, 900), 'expense');
  // falls back to description keywords when balances are unknown
  assert.equal(inferType('DEPOSITO EN EFECTIVO', 50, null, null), 'income');
  assert.equal(inferType('PAGO DE COMISION', 50, null, null), 'expense');
});

test('parseGenericStatement extracts movements from a common MX layout', () => {
  const statement = [
    'ESTADO DE CUENTA',
    'PERIODO DEL 01/01/2025 AL 31/01/2025',
    'CUENTA CLABE: 012345678901234567',
    'FECHA DESCRIPCION DEPOSITO RETIRO SALDO',
    '02/01/2025 000123 DEPOSITO SPEI RECIBIDO 1,000.00 6,000.00',
    '05/01/2025 000124 PAGO CFE COMISION 250.00 5,750.00',
    'SALDO FINAL DEL PERIODO 5,750.00',
  ].join('\n');

  const result = parseGenericStatement(statement, {
    bank: 'banorte',
    headerTokens: ['fecha', 'descripcion', 'saldo'],
  });

  assert.equal(result.bank, 'banorte');
  assert.equal(result.account_number, '012345678901234567');
  assert.ok(result.period_start instanceof Date);
  assert.equal(result.transactions.length, 2);

  const [first, second] = result.transactions;
  assert.equal(first.amount, 1000);
  assert.equal(first.type, 'income'); // balance rose 5000 -> 6000
  assert.equal(second.amount, 250);
  assert.equal(second.type, 'expense'); // balance fell 6000 -> 5750
});

test('parseBanorteStatement delegates to the generic parser (no longer a stub)', () => {
  const statement = [
    'FECHA DESCRIPCION DEPOSITO RETIRO SALDO',
    '10/02/2025 111222 TRANSFERENCIA RECIBIDA 2,000.00 12,000.00',
    'TOTAL',
  ].join('\n');

  const result = parseBanorteStatement(statement);
  assert.equal(result.bank, 'banorte');
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].amount, 2000);
});

test('parseGenericStatement throws 400 when the table header is missing', () => {
  assert.throws(
    () => parseGenericStatement('random text with no table', { bank: 'bbva' }),
    (err) => err.statusCode === 400
  );
});
