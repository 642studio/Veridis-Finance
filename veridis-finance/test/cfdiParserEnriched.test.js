const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseCfdi40 } = require('../src/services/cfdiParserService');

// Minimal but structurally real CFDI 4.0 with Impuestos + Conceptos so we can
// assert the enriched extraction (structured RFCs, taxes, line items) that DIOT
// and reconciliation depend on.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante Version="4.0" SubTotal="1000.00" Total="1160.00" Moneda="MXN"
  TipoDeComprobante="I" FormaPago="03" MetodoPago="PUE" Fecha="2026-01-15T10:00:00">
  <cfdi:Emisor Rfc="EKU9003173C9" Nombre="ESCUELA KEMPER URGATE" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="XAXX010101000" Nombre="PUBLICO EN GENERAL" RegimenFiscalReceptor="616"
    UsoCFDI="G03" DomicilioFiscalReceptor="01000"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="01010101" Cantidad="2" ValorUnitario="500.00"
      Descripcion="Servicio de consultoria" Importe="1000.00"/>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="160.00">
    <cfdi:Traslados>
      <cfdi:Traslado Base="1000.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="160.00"/>
    </cfdi:Traslados>
  </cfdi:Impuestos>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital UUID="ad662d33-6934-459c-a128-bdf0393e0f44"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;

test('parseCfdi40 keeps backward-compatible fields', () => {
  const r = parseCfdi40(XML);
  assert.equal(r.uuid_sat, 'AD662D33-6934-459C-A128-BDF0393E0F44');
  assert.equal(r.total, 1160);
  assert.match(r.emitter, /EKU9003173C9/);
});

test('parseCfdi40 extracts structured emitter/receiver fiscal fields', () => {
  const r = parseCfdi40(XML);
  assert.equal(r.emitter_rfc, 'EKU9003173C9');
  assert.equal(r.emitter_fiscal_regime, '601');
  assert.equal(r.receiver_rfc, 'XAXX010101000');
  assert.equal(r.receiver_cfdi_use, 'G03');
  assert.equal(r.receiver_zip_code, '01000');
  assert.equal(r.forma_pago, '03');
  assert.equal(r.metodo_pago, 'PUE');
  assert.equal(r.comprobante_type, 'I');
  assert.equal(r.subtotal, 1000);
});

test('parseCfdi40 extracts taxes and concepts', () => {
  const r = parseCfdi40(XML);
  assert.equal(r.taxes.total_trasladados, 160);
  assert.equal(r.taxes.traslados.length, 1);
  assert.equal(r.taxes.traslados[0].impuesto, '002');
  assert.equal(r.taxes.traslados[0].importe, 160);
  assert.equal(r.concepts.length, 1);
  assert.equal(r.concepts[0].description, 'Servicio de consultoria');
  assert.equal(r.concepts[0].amount, 1000);
});
