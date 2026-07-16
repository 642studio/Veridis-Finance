const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeString,
} = require('../src/modules/finance/intelligence/utils/string-normalizer');

test('normalizeString uppercases, strips accents and punctuation', () => {
  assert.deepEqual(normalizeString('Pagó Comisión!'), ['PAGO', 'COMISION']);
});

test('normalizeString removes common connector words', () => {
  assert.deepEqual(normalizeString('Banco de los Rios y La Paz'), [
    'BANCO',
    'RIOS',
    'PAZ',
  ]);
});

test('normalizeString returns an empty array for empty input', () => {
  assert.deepEqual(normalizeString(''), []);
  assert.deepEqual(normalizeString(null), []);
  assert.deepEqual(normalizeString('   '), []);
});
