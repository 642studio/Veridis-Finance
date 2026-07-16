const test = require('node:test');
const assert = require('node:assert/strict');

const { parseCfdi40 } = require('../src/services/cfdiParserService');

const VALID_UUID = 'A1B2C3D4-E5F6-4789-8ABC-DEF012345678';

function buildCfdi({ version = '4.0', total = '1160.00', uuid = VALID_UUID } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante Version="${version}" Total="${total}" Fecha="2025-01-15T10:00:00">
  <cfdi:Emisor Rfc="AAA010101AAA" Nombre="Proveedor SA"/>
  <cfdi:Receptor Rfc="XAXX010101000" Nombre="Cliente SA"/>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital UUID="${uuid}"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;
}

test('parseCfdi40 extracts uuid, total, emitter, receiver and date', () => {
  const result = parseCfdi40(buildCfdi());
  assert.equal(result.uuid_sat, VALID_UUID);
  assert.equal(result.total, 1160);
  assert.match(result.emitter, /AAA010101AAA/);
  assert.match(result.receiver, /XAXX010101000/);
  assert.ok(result.invoice_date instanceof Date);
  assert.equal(Number.isNaN(result.invoice_date.getTime()), false);
});

test('parseCfdi40 rejects a non-4.0 CFDI', () => {
  assert.throws(
    () => parseCfdi40(buildCfdi({ version: '3.3' })),
    (err) => err.statusCode === 400 && /Unsupported CFDI version/.test(err.message)
  );
});

test('parseCfdi40 rejects an invalid total', () => {
  assert.throws(
    () => parseCfdi40(buildCfdi({ total: '0' })),
    (err) => err.statusCode === 400
  );
});

test('parseCfdi40 rejects a malformed UUID', () => {
  assert.throws(
    () => parseCfdi40(buildCfdi({ uuid: 'not-a-uuid' })),
    (err) => err.statusCode === 400
  );
});

test('parseCfdi40 rejects empty input', () => {
  assert.throws(
    () => parseCfdi40('   '),
    (err) => err.statusCode === 400
  );
});
