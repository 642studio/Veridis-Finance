const crypto = require('node:crypto');

const SCRYPT_KEY_LENGTH = 64;

function hashPassword(plainPassword) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto
    .scryptSync(plainPassword, salt, SCRYPT_KEY_LENGTH)
    .toString('hex');

  return `scrypt:${salt}:${derivedKey}`;
}

function verifyPassword(plainPassword, storedHash) {
  const [algorithm, salt, expectedHex] = String(storedHash || '').split(':');

  if (algorithm !== 'scrypt' || !salt || !expectedHex) {
    return false;
  }

  const actual = crypto.scryptSync(plainPassword, salt, SCRYPT_KEY_LENGTH);
  const expected = Buffer.from(expectedHex, 'hex');

  if (actual.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(actual, expected);
}

module.exports = {
  hashPassword,
  verifyPassword,
};
