/**
 * Provider-agnostic CFDI 4.0 tax computation for a line item.
 *
 * This exists because the previous inline logic conflated three fiscally
 * distinct cases and only ever emitted IVA 16%:
 *   - IVA a tasa > 0  (e.g. 0.16 / 0.08): traslado IVA, TipoFactor "Tasa".
 *   - IVA a tasa 0%   (alimentos, medicinas, exportación): STILL a traslado at
 *     rate 0.000000 — it is "sí objeto de impuesto", NOT exento.
 *   - Exento          (no obligado a trasladar): TipoFactor "Exento", no importe.
 * Plus it could not express retenciones (ISR/IVA — honorarios, arrendamiento)
 * nor IEPS, both extremely common in Mexico.
 *
 * SAT catalog codes: IVA=002, ISR=001, IEPS=003. ObjetoImp: 01=no objeto,
 * 02=sí objeto, 03=sí objeto sin desglose.
 *
 * All math uses decimal.js; amounts come back as canonical 2-decimal strings.
 */

const { money, round, sum } = require('../../lib/money');

const IMPUESTO = Object.freeze({ ISR: '001', IVA: '002', IEPS: '003' });
const IMPUESTO_NAME = Object.freeze({ '001': 'ISR', '002': 'IVA', '003': 'IEPS' });

function rate(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = money(value);
  return n;
}

/**
 * @param {object} it line item
 * @param {number} [it.quantity=1]
 * @param {number} it.unitPrice
 * @param {number} [it.ivaRate=0.16]  IVA rate (0 = tasa 0%). Ignored if ivaExempt.
 * @param {boolean} [it.ivaExempt=false]  IVA exento (no traslado importe).
 * @param {boolean} [it.noTaxObject=false]  ObjetoImp 01 (no objeto de impuesto).
 * @param {number} [it.iepsRate]  IEPS traslado rate.
 * @param {number} [it.retIvaRate]  IVA retenido rate (e.g. 0.106667).
 * @param {number} [it.retIsrRate]  ISR retenido rate (e.g. 0.10).
 * @returns {{objetoImp, base, traslados, retenciones, taxTotal, retentionTotal, total}}
 */
function computeItemTax(it) {
  const quantity = money(it.quantity ?? 1);
  const unitPrice = money(it.unitPrice);
  const base = quantity.times(unitPrice);
  const baseStr = round(base, 2);

  const traslados = [];
  const retenciones = [];

  if (it.noTaxObject) {
    return {
      objetoImp: '01',
      base: baseStr,
      traslados,
      retenciones,
      taxTotal: '0.00',
      retentionTotal: '0.00',
      total: baseStr,
    };
  }

  // --- IVA ---
  if (it.ivaExempt) {
    traslados.push({
      impuesto: IMPUESTO.IVA,
      tipoFactor: 'Exento',
      tasa: null,
      base: baseStr,
      importe: null,
    });
  } else {
    const ivaRate = rate(it.ivaRate, money(0.16));
    const importe = base.times(ivaRate);
    traslados.push({
      impuesto: IMPUESTO.IVA,
      tipoFactor: 'Tasa',
      tasa: ivaRate.toString(),
      base: baseStr,
      importe: round(importe, 2),
    });
  }

  // --- IEPS traslado (optional) ---
  const iepsRate = rate(it.iepsRate);
  if (iepsRate && iepsRate.greaterThan(0)) {
    traslados.push({
      impuesto: IMPUESTO.IEPS,
      tipoFactor: 'Tasa',
      tasa: iepsRate.toString(),
      base: baseStr,
      importe: round(base.times(iepsRate), 2),
    });
  }

  // --- Retenciones (optional) ---
  const retIva = rate(it.retIvaRate);
  if (retIva && retIva.greaterThan(0)) {
    retenciones.push({
      impuesto: IMPUESTO.IVA,
      tipoFactor: 'Tasa',
      tasa: retIva.toString(),
      base: baseStr,
      importe: round(base.times(retIva), 2),
    });
  }
  const retIsr = rate(it.retIsrRate);
  if (retIsr && retIsr.greaterThan(0)) {
    retenciones.push({
      impuesto: IMPUESTO.ISR,
      tipoFactor: 'Tasa',
      tasa: retIsr.toString(),
      base: baseStr,
      importe: round(base.times(retIsr), 2),
    });
  }

  const taxTotal = sum(traslados.map((t) => t.importe || 0));
  const retentionTotal = sum(retenciones.map((r) => r.importe || 0));
  const total = base.plus(taxTotal).minus(retentionTotal);

  return {
    objetoImp: '02',
    base: baseStr,
    traslados,
    retenciones,
    taxTotal: round(taxTotal, 2),
    retentionTotal: round(retentionTotal, 2),
    total: round(total, 2),
  };
}

module.exports = { computeItemTax, IMPUESTO, IMPUESTO_NAME };
