function notImplemented(message) {
  const error = new Error(message);
  error.statusCode = 501;
  return error;
}

function parseBBVAStatement() {
  throw notImplemented('BBVA statement parser is not implemented yet');
}

module.exports = {
  parseBBVAStatement,
};
