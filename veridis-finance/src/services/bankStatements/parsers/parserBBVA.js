const { parseGenericStatement } = require('./genericStatementParser');

/**
 * BBVA (Bancomer) statements use the common MX layout:
 *   OPER  LIQ  COD  DESCRIPCION  CARGO / ABONO  SALDO
 * We delegate to the generic running-balance parser. BBVA's movement header
 * commonly contains "descripcion" and "saldo"; we keep the token set permissive.
 */
function parseBBVAStatement(rawText) {
  return parseGenericStatement(rawText, {
    bank: 'bbva',
    headerTokens: ['descripcion', 'saldo'],
  });
}

module.exports = {
  parseBBVAStatement,
};
