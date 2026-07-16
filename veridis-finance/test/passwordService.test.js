const test = require('node:test');
const assert = require('node:assert/strict');

const { hashPassword, verifyPassword } = require('../src/services/passwordService');

test('hashPassword produces a scrypt-formatted hash', () => {
  const hash = hashPassword('SuperSecret123!');
  const parts = hash.split(':');
  assert.equal(parts.length, 3);
  assert.equal(parts[0], 'scrypt');
  assert.ok(parts[1].length >= 16, 'salt should be present');
  assert.ok(parts[2].length > 0, 'derived key should be present');
});

test('hashPassword salts each hash (no two hashes equal)', () => {
  const a = hashPassword('same-password');
  const b = hashPassword('same-password');
  assert.notEqual(a, b);
});

test('verifyPassword accepts the correct password', () => {
  const hash = hashPassword('correct horse battery staple');
  assert.equal(verifyPassword('correct horse battery staple', hash), true);
});

test('verifyPassword rejects an incorrect password', () => {
  const hash = hashPassword('correct horse battery staple');
  assert.equal(verifyPassword('wrong password', hash), false);
});

test('verifyPassword rejects malformed / tampered hashes', () => {
  assert.equal(verifyPassword('x', ''), false);
  assert.equal(verifyPassword('x', 'not-a-hash'), false);
  assert.equal(verifyPassword('x', 'md5:abc:def'), false);
  assert.equal(verifyPassword('x', 'scrypt::'), false);
});
