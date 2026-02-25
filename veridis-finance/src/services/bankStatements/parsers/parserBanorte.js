function notImplemented(message) {
  const error = new Error(message);
  error.statusCode = 501;
  return error;
}

function parseBanorteStatement() {
  throw notImplemented('Banorte statement parser is not implemented yet');
}

module.exports = {
  parseBanorteStatement,
};
