/**
 * DIOT — Declaración Informativa de Operaciones con Terceros (Sprint 15).
 *
 * Obligación mensual del SAT: informar el IVA de las operaciones con proveedores.
 * Se construye desde los CFDIs recibidos del periodo, agrupando por proveedor
 * (RFC) con su tipo de tercero, tipo de operación y los valores de actos e IVA
 * acreditable por tasa, más el IVA retenido.
 *
 * Salida:
 *   - resumen por proveedor (para el panel) y totales.
 *   - archivo batch (.txt) con el layout de captura del SAT (campos separados
 *     por "|"), listo para subir en el formulario DIOT.
 *
 * Paridad COI/Contpaqi/Aspel. Reutiliza el desglose de IVA (ivaFlowService).
 */

const pool = require('../db/pool');
const { round } = require('../lib/money');
const { ivaOfRow } = require('./ivaFlowService');

const num = (v) => Number(round(v));

// Tipo de tercero SAT: 04 proveedor nacional, 05 extranjero, 15 global.
function tipoTercero(rfc) {
  const r = String(rfc || '').toUpperCase().trim();
  if (!r || r === 'XEXX010101000') return '05';           // extranjero
  if (r === 'XAXX010101000') return '15';                 // público en general
  if (r.length === 12 || r.length === 13) return '04';    // nacional (moral/física)
  return '05';
}

// Tipo de operación SAT: 03 servicios profesionales, 06 arrendamiento, 85 otros.
const OP_KEYWORDS = [
  [/renta|arrendamiento|inmueble|oficina|local/i, '06'],
  [/honorario|servicios profesionales|consultor|asesor|despacho|contad|legal|abogad/i, '03'],
];
function tipoOperacion(name) {
  const s = String(name || '');
  for (const [re, code] of OP_KEYWORDS) if (re.test(s)) return code;
  return '85';
}

/**
 * Agrega CFDIs recibidos en renglones DIOT por (RFC, tipo tercero, tipo op).
 * Función pura y testeable. `invoices` = filas con {emitter_rfc, emitter,
 * total, subtotal, taxes, ...}.
 */
function buildDiotRows(invoices) {
  const map = new Map();
  for (const inv of invoices) {
    const rfc = String(inv.emitter_rfc || '').toUpperCase().trim();
    const tercero = tipoTercero(rfc);
    const operacion = tipoOperacion(inv.emitter);
    const key = `${rfc}|${tercero}|${operacion}`;
    const iva = ivaOfRow(inv);
    let row = map.get(key);
    if (!row) {
      row = {
        tipo_tercero: tercero, tipo_operacion: operacion, rfc,
        proveedor: inv.emitter || '',
        valor_16: 0, iva_16: 0, valor_8: 0, iva_8: 0,
        valor_0: 0, exentos: 0, iva_retenido: 0, count: 0,
      };
      map.set(key, row);
    }
    row.valor_16 += iva.base16;
    row.iva_16 += iva.iva16;
    row.valor_8 += iva.base8;
    row.iva_8 += iva.iva8;
    row.valor_0 += iva.base0;
    row.exentos += iva.exento;
    row.iva_retenido += iva.ret_iva;
    row.count += 1;
  }
  const rows = Array.from(map.values()).map((r) => ({
    ...r,
    valor_16: num(r.valor_16), iva_16: num(r.iva_16),
    valor_8: num(r.valor_8), iva_8: num(r.iva_8),
    valor_0: num(r.valor_0), exentos: num(r.exentos),
    iva_retenido: num(r.iva_retenido),
  }));
  rows.sort((a, b) => a.rfc.localeCompare(b.rfc));
  const totales = rows.reduce((t, r) => ({
    valor_16: num(t.valor_16 + r.valor_16), iva_16: num(t.iva_16 + r.iva_16),
    valor_8: num(t.valor_8 + r.valor_8), iva_8: num(t.iva_8 + r.iva_8),
    valor_0: num(t.valor_0 + r.valor_0), exentos: num(t.exentos + r.exentos),
    iva_retenido: num(t.iva_retenido + r.iva_retenido), proveedores: t.proveedores + 1,
  }), { valor_16: 0, iva_16: 0, valor_8: 0, iva_8: 0, valor_0: 0, exentos: 0, iva_retenido: 0, proveedores: 0 });
  return { rows, totales };
}

/**
 * Layout de captura batch del SAT (campos separados por "|"). Un renglón por
 * proveedor. Se incluyen los campos usados por operaciones nacionales; los de
 * proveedor extranjero (ID fiscal, nombre, país) van vacíos salvo el tipo.
 * Campos: tipoTercero|tipoOperacion|RFC|idFiscal|nombreExt|paisExt|nacionalidad|
 *         valor16|valor16NA|valorImport16|IVAImport16|valor0|exentos|
 *         IVARetenido|IVADevoluciones|
 */
function toBatchTxt({ rows }) {
  const lines = rows.map((r) => [
    r.tipo_tercero, r.tipo_operacion, r.tipo_tercero === '04' ? r.rfc : '',
    '', '', '', '',                              // ID fiscal / nombre / país / nacionalidad (extranjero)
    r.valor_16 ? r.valor_16.toFixed(0) : '0',    // valor de actos a 16% (pagados)
    '0',                                          // 16% no acreditable
    '0', '0',                                     // importación 16% (valor / IVA)
    r.valor_0 ? r.valor_0.toFixed(0) : '0',      // valor de actos a 0%
    r.exentos ? r.exentos.toFixed(0) : '0',      // exentos
    r.iva_retenido ? r.iva_retenido.toFixed(0) : '0', // IVA retenido
    '0',                                          // IVA por devoluciones/descuentos
  ].join('|'));
  return lines.join('\n');
}

async function generate(organizationId, { year, month }) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const { rows: invoices } = await pool.query(
    `SELECT emitter_rfc, emitter, total, subtotal, taxes, metodo_pago, comprobante_type
       FROM finance.invoices
      WHERE organization_id = $1 AND direction = 'received'
        AND invoice_date >= $2::date AND invoice_date < ($2::date + interval '1 month')
        AND COALESCE(comprobante_type, 'I') NOT IN ('P', 'N')
        AND emitter_rfc IS NOT NULL`,
    [organizationId, start]
  );
  const { rows, totales } = buildDiotRows(invoices);
  return { year, month, proveedores: rows, totales, cfdis: invoices.length };
}

async function exportBatch(organizationId, { year, month }) {
  const data = await generate(organizationId, { year, month });
  return {
    txt: toBatchTxt({ rows: data.proveedores }),
    filename: `DIOT_${year}${String(month).padStart(2, '0')}.txt`,
  };
}

module.exports = { generate, exportBatch, buildDiotRows, toBatchTxt, tipoTercero, tipoOperacion };
