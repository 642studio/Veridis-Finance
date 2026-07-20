const test = require('node:test');
const assert = require('node:assert');

const {
  catalogoXmlFromTree,
  balanzaXmlFromReport,
  xmlEscape,
} = require('../src/services/contabilidadElectronicaService');

test('Catálogo XML: encabezado 1.3, RFC, Mes/Anio y cuentas con Natur', () => {
  const xml = catalogoXmlFromTree({
    rfc: 'XAXX010101000', year: 2026, month: 7,
    cuentas: [
      { numCta: '102', codAgrup: '102', desc: 'Bancos', nivel: 1, natur: 'D', subCtaDe: null },
      { numCta: '102.01', codAgrup: '102.01', desc: 'Bancos nacionales', nivel: 2, natur: 'D', subCtaDe: '102' },
    ],
  });
  assert.ok(xml.includes('Version="1.3"'));
  assert.ok(xml.includes('RFC="XAXX010101000"'));
  assert.ok(xml.includes('Mes="07"'));
  assert.ok(xml.includes('Anio="2026"'));
  assert.ok(xml.includes('NumCta="102.01"'));
  assert.ok(xml.includes('SubCtaDe="102"'));
  assert.ok(xml.includes('Natur="D"'));
  assert.ok(xml.trim().endsWith('</catalogocuentas:Catalogo>'));
});

test('Balanza XML: SaldoIni/Debe/Haber/SaldoFin con 2 decimales y TipoEnvio', () => {
  const xml = balanzaXmlFromReport({
    rfc: 'XAXX010101000', year: 2026, month: 7, tipoEnvio: 'N',
    cuentas: [
      { code: '102.01', saldo_inicial: 0, cargos: 1160, abonos: 0, saldo_final: 1160 },
      { code: '401.01', saldo_inicial: 0, cargos: 0, abonos: 53000, saldo_final: 53000 },
    ],
  });
  assert.ok(xml.includes('TipoEnvio="N"'));
  assert.ok(xml.includes('NumCta="102.01" SaldoIni="0.00" Debe="1160.00" Haber="0.00" SaldoFin="1160.00"'));
  assert.ok(xml.includes('NumCta="401.01" SaldoIni="0.00" Debe="0.00" Haber="53000.00" SaldoFin="53000.00"'));
});

test('Balanza XML: saldos negativos (contra) se emiten en valor absoluto', () => {
  const xml = balanzaXmlFromReport({
    rfc: 'XAXX010101000', year: 2026, month: 7,
    cuentas: [{ code: '305.01', saldo_inicial: -100, cargos: 0, abonos: 0, saldo_final: -100 }],
  });
  assert.ok(xml.includes('SaldoIni="100.00"'));
  assert.ok(xml.includes('SaldoFin="100.00"'));
});

test('xmlEscape neutraliza caracteres reservados', () => {
  assert.strictEqual(xmlEscape('A & B <x> "q"'), 'A &amp; B &lt;x&gt; &quot;q&quot;');
});
