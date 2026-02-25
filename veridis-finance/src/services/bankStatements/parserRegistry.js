const { parseSantanderStatement } = require('./parsers/parserSantander');
const { parseBBVAStatement } = require('./parsers/parserBBVA');
const { parseBanorteStatement } = require('./parsers/parserBanorte');

const BANK_PARSERS = new Map([
  ['santander', parseSantanderStatement],
  ['banco santander', parseSantanderStatement],
  ['santander mexico', parseSantanderStatement],
  ['bbva', parseBBVAStatement],
  ['bbva bancomer', parseBBVAStatement],
  ['banorte', parseBanorteStatement],
  ['banco banorte', parseBanorteStatement],
]);

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normalizeBankName(bank) {
  return String(bank || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function getSupportedBanks() {
  return ['santander', 'bbva', 'banorte'];
}

function parseStatementByBank(bank, rawText) {
  const normalizedBank = normalizeBankName(bank);
  const parser = BANK_PARSERS.get(normalizedBank);

  if (!parser) {
    throw badRequest(
      `Unsupported bank parser: ${bank}. Supported banks: ${getSupportedBanks().join(', ')}`
    );
  }

  return parser(rawText);
}

module.exports = {
  normalizeBankName,
  getSupportedBanks,
  parseStatementByBank,
};
