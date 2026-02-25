const pino = require('pino');

const logger = pino({
  name: 'veridis-finance',
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-api-key"]',
      'headers.authorization',
      'headers["x-api-key"]',
      'api_key',
      'encrypted_api_key',
      'req.body.api_key',
      'body.api_key',
      'body.encrypted_api_key',
      'password',
      'password_hash',
    ],
    censor: '[Redacted]',
  },
});

module.exports = logger;
