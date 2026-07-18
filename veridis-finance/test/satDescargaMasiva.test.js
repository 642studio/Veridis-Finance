const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const { XMLParser } = require('fast-xml-parser');

const fiel = require('../src/services/sat/fiel');
const soap = require('../src/services/sat/soap');
const { readZipEntries } = require('../src/services/sat/zip');
const { extractFault } = require('../src/services/satDownloadService');

// ---------------------------------------------------------------------------
// Diagnostics — never surface a naked "HTTP 500"
// ---------------------------------------------------------------------------

test('extractFault prefers a SOAP faultstring', () => {
  const parsed = { Envelope: { Body: { Fault: { faultstring: 'Firma no válida' } } } };
  assert.equal(extractFault(parsed, '<xml/>', 500), 'Firma no válida');
});

test('extractFault falls back to a cleaned body snippet', () => {
  const msg = extractFault({}, '<html><body>Internal Server Error</body></html>', 500);
  assert.match(msg, /HTTP 500/);
  assert.match(msg, /Internal Server Error/);
});

// ---------------------------------------------------------------------------
// Metadata parsing — the SAT prepends a UTF-8 BOM and uses CRLF
// ---------------------------------------------------------------------------

const { parseMetadataRows } = require('../src/services/satDownloadService');
const { normalizeUuidSat } = require('../src/services/invoicesService');

const SAT_METADATA_SAMPLE =
  '﻿Uuid~RfcEmisor~NombreEmisor~RfcReceptor~NombreReceptor~RfcPac~FechaEmision~FechaCertificacionSat~Monto~EfectoComprobante~Estatus~FechaCancelacion\r\n' +
  'AAAABBBB-CCCC-DDDD-EEEE-FFFF00001111~XAXX010101000~PROVEEDOR UNO~SCD2507076C4~642 STUDIO~PAC010101AAA~2026-06-15T10:00:00~2026-06-15T10:01:00~1160.00~I~Vigente~\r\n' +
  '22223333-4444-5555-6666-777788889999~XEXX010101000~PROVEEDOR DOS~SCD2507076C4~642 STUDIO~PAC010101AAA~2026-06-20T12:00:00~2026-06-20T12:01:00~5015.50~I~Vigente~\r\n';

test('parseMetadataRows survives the SAT BOM + CRLF and reads every row', () => {
  const rows = parseMetadataRows(SAT_METADATA_SAMPLE);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].uuid, 'AAAABBBB-CCCC-DDDD-EEEE-FFFF00001111');
  assert.equal(rows[0].emitterRfc, 'XAXX010101000');
  assert.equal(rows[0].emitterName, 'PROVEEDOR UNO');
  assert.equal(rows[0].receiverRfc, 'SCD2507076C4');
  assert.equal(rows[0].monto, 1160);
  assert.equal(rows[1].monto, 5015.5);
});

test('parseMetadataRows without BOM also works, and garbage yields []', () => {
  assert.equal(parseMetadataRows(SAT_METADATA_SAMPLE.replace('﻿', '')).length, 2);
  assert.deepEqual(parseMetadataRows('no es un archivo de metadatos'), []);
  assert.deepEqual(parseMetadataRows(''), []);
});

test('normalizeUuidSat uppercases real UUIDs but leaves synthetic refs alone', () => {
  assert.equal(
    normalizeUuidSat('aaaabbbb-cccc-dddd-eeee-ffff00001111'),
    'AAAABBBB-CCCC-DDDD-EEEE-FFFF00001111'
  );
  assert.equal(normalizeUuidSat('crm:68c48920ac6bca0ecf50cc36'), 'crm:68c48920ac6bca0ecf50cc36');
  assert.equal(normalizeUuidSat('manual:123-456'), 'manual:123-456');
  assert.equal(normalizeUuidSat('  AAAABBBB-CCCC-DDDD-EEEE-FFFF00001111  '), 'AAAABBBB-CCCC-DDDD-EEEE-FFFF00001111');
});

// ---------------------------------------------------------------------------
// Pure FIEL helpers
// ---------------------------------------------------------------------------

test('extractRfc pulls a moral/física RFC out of a subject DN', () => {
  assert.equal(fiel.extractRfc('CN=EMPRESA\nserialNumber=XAXX010101000'), 'XAXX010101000');
  assert.equal(fiel.extractRfc('CN=Juan\nserialNumber=PEPE900101QW3'), 'PEPE900101QW3');
  assert.equal(fiel.extractRfc('CN=nada aquí'), null);
});

test('signSha1 + digestSha1 round-trip against the matching public key', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const payload = '<u:Timestamp>abc</u:Timestamp>';
  const sig = fiel.signSha1(privateKey, payload);
  assert.ok(crypto.verify('sha1', Buffer.from(payload), publicKey, Buffer.from(sig, 'base64')));
  // digest is stable base64 SHA-1
  assert.equal(fiel.digestSha1(payload), fiel.digestSha1(payload));
});

// ---------------------------------------------------------------------------
// SOAP envelopes — well-formed + internally consistent signature
// ---------------------------------------------------------------------------

function syntheticFiel() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privateKey,
    publicKey,
    rfc: 'XAXX010101000',
    serial: '30001000000400000001',
    certDerBase64: 'TUlJRkNlcnQ=',
    issuerName: 'CN=AC SAT',
    validFrom: new Date('2020-01-01'),
    validTo: new Date('2030-01-01'),
  };
}

test('auth envelope: embedded Timestamp digest and SignedInfo signature are valid', () => {
  const f = syntheticFiel();
  const env = soap.buildAuthEnvelope(f, new Date('2026-07-18T12:00:00Z'));

  // Re-derive the canonical Timestamp from the embedded one and check the digest.
  const ts = env.match(/<u:Timestamp u:Id="_0">[\s\S]*?<\/u:Timestamp>/)[0];
  const canonTs = ts.replace(
    '<u:Timestamp u:Id="_0">',
    `<u:Timestamp xmlns:u="${soap.NS.u}" u:Id="_0">`
  );
  const embeddedDigest = env.match(/<DigestValue>([^<]+)<\/DigestValue>/)[1];
  assert.equal(fiel.digestSha1(canonTs), embeddedDigest, 'digest must match the signed timestamp');

  const signedInfo = env.match(/<SignedInfo xmlns="[^"]+">[\s\S]*?<\/SignedInfo>/)[0];
  const sigVal = env.match(/<SignatureValue>([^<]+)<\/SignatureValue>/)[1];
  assert.ok(
    crypto.verify('sha1', Buffer.from(signedInfo), f.publicKey, Buffer.from(sigVal, 'base64')),
    'SignatureValue must verify over the canonical SignedInfo'
  );
});

test('solicita/verifica/descarga envelopes are well-formed XML', () => {
  const f = syntheticFiel();
  const parser = new XMLParser({ ignoreAttributes: false });
  const envelopes = [
    soap.buildSolicitaEnvelope(f, {
      requestType: 'received',
      downloadType: 'Metadata',
      dateFrom: '2019-01-01',
      dateTo: '2026-06-30',
    }),
    soap.buildSolicitaEnvelope(f, {
      requestType: 'issued',
      downloadType: 'CFDI',
      dateFrom: '2024-01-01',
      dateTo: '2024-12-31',
    }),
    soap.buildVerificaEnvelope(f, 'REQ-123'),
    soap.buildDescargaEnvelope(f, 'PKG-1'),
  ];
  for (const env of envelopes) {
    assert.doesNotThrow(() => parser.parse(env), 'envelope should parse as XML');
    assert.match(env, /<Signature xmlns="http:\/\/www.w3.org\/2000\/09\/xmldsig#">/);
  }
});

test('solicita uses RfcReceptor for received and RfcEmisor for issued', () => {
  const f = syntheticFiel();
  const received = soap.buildSolicitaEnvelope(f, {
    requestType: 'received',
    downloadType: 'Metadata',
    dateFrom: '2019-01-01',
    dateTo: '2026-06-30',
  });
  const issued = soap.buildSolicitaEnvelope(f, {
    requestType: 'issued',
    downloadType: 'Metadata',
    dateFrom: '2019-01-01',
    dateTo: '2026-06-30',
  });
  assert.match(received, /RfcReceptor="XAXX010101000"/);
  assert.doesNotMatch(received, /RfcEmisor=/);
  assert.match(issued, /RfcEmisor="XAXX010101000"/);
  assert.doesNotMatch(issued, /RfcReceptor=/);
});

test('solicita uses the split operations + matching SOAPAction (SAT deprecated the single op)', () => {
  const f = syntheticFiel();
  const received = soap.buildSolicitaEnvelope(f, {
    requestType: 'received',
    downloadType: 'Metadata',
    dateFrom: '2019-01-01',
    dateTo: '2026-06-30',
  });
  const issued = soap.buildSolicitaEnvelope(f, {
    requestType: 'issued',
    downloadType: 'Metadata',
    dateFrom: '2019-01-01',
    dateTo: '2026-06-30',
  });
  assert.match(received, /<SolicitaDescargaRecibidos xmlns=/);
  assert.match(issued, /<SolicitaDescargaEmitidos xmlns=/);
  assert.doesNotMatch(received, /<SolicitaDescarga xmlns=/); // not the legacy single op
  assert.match(soap.solicitaAction('received'), /SolicitaDescargaRecibidos$/);
  assert.match(soap.solicitaAction('issued'), /SolicitaDescargaEmitidos$/);
});

// ---------------------------------------------------------------------------
// ZIP reader — both stored (method 0) and deflate (method 8)
// ---------------------------------------------------------------------------

function buildZip(files, { deflate = false } = {}) {
  const chunks = [];
  for (const [name, content] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.from(content, 'utf8');
    const data = deflate ? zlib.deflateRawSync(raw) : raw;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version
    header.writeUInt16LE(0, 6); // flags
    header.writeUInt16LE(deflate ? 8 : 0, 8); // method
    header.writeUInt32LE(0, 14); // crc (unchecked by reader)
    header.writeUInt32LE(data.length, 18); // compressed size
    header.writeUInt32LE(raw.length, 22); // uncompressed size
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28); // extra len
    chunks.push(header, nameBuf, data);
  }
  return Buffer.concat(chunks);
}

test('readZipEntries reads stored entries', () => {
  const zip = buildZip([
    ['meta.txt', 'UUID~RfcEmisor\nAAA~XAXX010101000'],
    ['a.xml', '<cfdi/>'],
  ]);
  const entries = readZipEntries(zip);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, 'meta.txt');
  assert.match(entries[0].data.toString('utf8'), /XAXX010101000/);
  assert.equal(entries[1].data.toString('utf8'), '<cfdi/>');
});

test('readZipEntries inflates deflated entries', () => {
  const big = 'RENGLON~'.repeat(500);
  const zip = buildZip([['data.txt', big]], { deflate: true });
  const entries = readZipEntries(zip);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].data.toString('utf8'), big);
});
