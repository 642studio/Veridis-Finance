const { parseGenericStatement } = require('./genericStatementParser');

/**
 * Banorte statements use the common MX layout:
 *   FECHA  DESCRIPCION / REFERENCIA  DEPOSITOS / CARGOS / ABONOS  SALDO
 * so we delegate to the generic running-balance parser with Banorte-oriented
 * header hints.
 */
function parseBanorteStatement(rawText) {
  return parseGenericStatement(rawText, {
    bank: 'banorte',
    headerTokens: ['fecha', 'descripcion', 'saldo'],
  });
}

module.exports = {
  parseBanorteStatement,
};
