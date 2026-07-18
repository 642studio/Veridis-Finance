/**
 * FIEL (e.firma) primitives for the SAT Descarga Masiva web service.
 *
 * The e.firma is a standard X.509 identity issued by the SAT:
 *   - .cer  → DER-encoded X.509 certificate (public)
 *   - .key  → DER-encoded, PASSWORD-ENCRYPTED PKCS#8 private key
 *   - password → decrypts the .key
 *
 * This module never touches the database or the network. It only:
 *   1. validates the cert/key pair (does the password open the key? does the
 *      key match the cert?),
 *   2. extracts the non-secret identity (RFC, serial "NoCertificado", validity),
 *   3. signs bytes with the private key (RSA-SHA1, as WS-Security / xmldsig
 *      require), and produces the base64 DER cert for the BinarySecurityToken.
 *
 * Everything here uses only node:crypto — no third-party crypto.
 */

const crypto = require('node:crypto');

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

/**
 * The SAT "número de certificado" (NoCertificado) is a 20-digit string. The
 * X.509 serialNumber stores it as the ASCII bytes of those digits, so decoding
 * the serial's hex as ASCII recovers the 20-digit number. Falls back to the raw
 * serial when the ASCII decode doesn't look like the expected 20 digits.
 */
function certificateNumber(x509) {
  const rawHex = String(x509.serialNumber || '').replace(/[^0-9a-fA-F]/g, '');
  try {
    const ascii = Buffer.from(rawHex, 'hex').toString('ascii');
    if (/^\d{20}$/.test(ascii)) return ascii;
  } catch {
    /* ignore, fall through */
  }
  return rawHex;
}

/** Pull the RFC out of an X.509 subject. SAT stores it in the subject DN. */
function extractRfc(subject) {
  if (!subject) return null;
  // Mexican RFC: 3-4 letters + 6 digits + 3 alphanumerics (moral vs física).
  const match = String(subject)
    .toUpperCase()
    .match(/\b([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})\b/);
  return match ? match[1] : null;
}

/** Pull a human-friendly legal name (CN / "razón social") from the subject. */
function extractLegalName(subject) {
  if (!subject) return null;
  // X509Certificate.subject is newline-separated "KEY=VALUE" lines.
  for (const line of String(subject).split('\n')) {
    const [key, ...rest] = line.split('=');
    if (['O', 'CN', 'name', 'organizationName'].includes((key || '').trim())) {
      const val = rest.join('=').trim();
      if (val) return val;
    }
  }
  return null;
}

/**
 * Load and validate an e.firma. Throws a 400 with a clear Spanish message when
 * the files or password are wrong — this is user-facing feedback on upload.
 *
 * @param {Buffer} cerDer  raw .cer bytes (DER)
 * @param {Buffer} keyDer  raw .key bytes (DER, encrypted PKCS#8)
 * @param {string} password
 * @returns {{ x509, privateKey, rfc, legalName, serial, validFrom, validTo,
 *             certPemBody, certDerBase64 }}
 */
function loadFiel(cerDer, keyDer, password) {
  if (!cerDer || !cerDer.length) throw badRequest('Falta el archivo .cer');
  if (!keyDer || !keyDer.length) throw badRequest('Falta el archivo .key');
  if (!password) throw badRequest('Falta la contraseña de la e.firma');

  let x509;
  try {
    x509 = new crypto.X509Certificate(cerDer);
  } catch {
    throw badRequest('El archivo .cer no es un certificado válido (debe ser el .cer de tu e.firma)');
  }

  let privateKey;
  try {
    privateKey = crypto.createPrivateKey({
      key: keyDer,
      format: 'der',
      type: 'pkcs8',
      passphrase: password,
    });
  } catch {
    throw badRequest('No se pudo abrir la .key: contraseña incorrecta o archivo .key inválido');
  }

  // The private key must actually belong to this certificate.
  try {
    const probe = crypto.randomBytes(32);
    const sig = crypto.sign('sha256', probe, privateKey);
    const ok = crypto.verify('sha256', probe, x509.publicKey, sig);
    if (!ok) throw new Error('mismatch');
  } catch {
    throw badRequest('La .key no corresponde al .cer (no son del mismo e.firma)');
  }

  const validFrom = new Date(x509.validFrom);
  const validTo = new Date(x509.validTo);
  const rfc = extractRfc(x509.subject);
  if (!rfc) {
    throw badRequest('No se pudo leer el RFC del certificado. ¿Es un CSD en lugar de la e.firma?');
  }

  const certDerBase64 = Buffer.isBuffer(cerDer)
    ? cerDer.toString('base64')
    : Buffer.from(cerDer).toString('base64');

  return {
    x509,
    privateKey,
    rfc,
    legalName: extractLegalName(x509.subject),
    issuerName: String(x509.issuer || '').split('\n').reverse().join(',').replace(/=/g, '='),
    serial: certificateNumber(x509),
    validFrom,
    validTo,
    // Body of the PEM (base64, no headers) — used inside BinarySecurityToken.
    certDerBase64,
  };
}

/** True when the certificate is currently within its validity window. */
function isCurrentlyValid(fiel, now = new Date()) {
  return fiel.validFrom <= now && now <= fiel.validTo;
}

/** RSA-SHA1 signature over `data`, base64-encoded (xmldsig / WS-Security). */
function signSha1(privateKey, data) {
  return crypto.sign('sha1', Buffer.from(data, 'utf8'), privateKey).toString('base64');
}

/** SHA-1 digest of `data`, base64-encoded (xmldsig DigestValue). */
function digestSha1(data) {
  return crypto.createHash('sha1').update(Buffer.from(data, 'utf8')).digest('base64');
}

module.exports = {
  loadFiel,
  isCurrentlyValid,
  signSha1,
  digestSha1,
  extractRfc,
  certificateNumber,
};
