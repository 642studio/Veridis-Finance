/**
 * Symmetric encryption for secrets at rest (GHL refresh tokens, per-tenant PAC
 * keys, etc.). AES-256-GCM with a key derived from APP_ENCRYPTION_KEY (falls
 * back to AI_MASTER_KEY). Never store these values in plaintext.
 */

const crypto = require('node:crypto');

function getKey() {
  const raw = process.env.APP_ENCRYPTION_KEY || process.env.AI_MASTER_KEY;
  if (!raw) {
    const err = new Error('Missing APP_ENCRYPTION_KEY / AI_MASTER_KEY for encryption');
    err.statusCode = 500;
    throw err;
  }
  // Derive a stable 32-byte key from whatever secret length is configured.
  return crypto.createHash('sha256').update(String(raw)).digest();
}

/** Encrypt a string -> compact "v1:iv:tag:cipher" (base64 parts). */
function encrypt(plaintext) {
  if (plaintext == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

/** Decrypt a value produced by encrypt(). Returns null on empty input. */
function decrypt(payload) {
  if (!payload) return null;
  const [version, ivB64, tagB64, dataB64] = String(payload).split(':');
  if (version !== 'v1') {
    const err = new Error('Unrecognized ciphertext format');
    err.statusCode = 500;
    throw err;
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
