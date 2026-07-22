/**
 * Gastos sin CFDI (deducibilidad) — Sprint 24.
 *
 * Cruza los EGRESOS del banco contra los CFDIs conciliados y lista los que NO
 * tienen comprobante. No todo gasto sin CFDI es un problema: los traspasos entre
 * cuentas propias, la nómina o las comisiones sobre ventas no requieren una
 * factura de proveedor. El resto SÍ — y ahí está el riesgo de no deducir.
 *
 * Clasifica cada egreso sin CFDI en:
 *   - requiere_cfdi: gasto deducible que debería tener factura (falta capturarla).
 *   - cfdi_del_banco: comisiones bancarias (el banco emite el CFDI).
 *   - no_aplica: traspaso interno / nómina / comisión de venta.
 */

const pool = require('../db/pool');
const { round } = require('../lib/money');

const num = (v) => Number(round(v));

/** Clasifica un egreso sin CFDI (puro). Devuelve {clase, motivo}. */
function clasificarEgreso(category, concepto, descripcion) {
  const cat = String(category || '').toLowerCase();
  const txt = `${concepto || ''} ${descripcion || ''}`.toLowerCase();

  if (/comision(es)? bancaria|manejo de cuenta|iva de comision|membresia/.test(`${cat} ${txt}`)) {
    return { clase: 'cfdi_del_banco', motivo: 'El banco emite el CFDI de la comisión' };
  }
  if (/traspaso|entre cuentas|inbursa|a otros bancos|cuenta propia/.test(txt)) {
    return { clase: 'no_aplica', motivo: 'Traspaso entre cuentas propias' };
  }
  if (/nomina|n[oó]mina|sueldo|salario/.test(`${cat} ${txt}`)) {
    return { clase: 'no_aplica', motivo: 'Nómina (CFDI de nómina aparte)' };
  }
  if (/comision(es)? (sobre )?venta|comision venta/.test(`${cat} ${txt}`)) {
    return { clase: 'no_aplica', motivo: 'Comisión sobre ventas' };
  }
  return { clase: 'requiere_cfdi', motivo: 'Gasto deducible sin factura — capturar CFDI' };
}

async function gastosSinCfdi(organizationId, { year, month }) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const { rows } = await pool.query(
    `SELECT t.id, t.transaction_date, t.amount, t.description, t.original_description, t.category
       FROM finance.transactions t
      WHERE t.organization_id = $1 AND t.deleted_at IS NULL AND t.type = 'expense'
        AND t.transaction_date >= $2::date AND t.transaction_date < ($2::date + interval '1 month')
        AND NOT EXISTS (
          SELECT 1 FROM finance.invoices i
           WHERE i.organization_id = t.organization_id
             AND i.payment_reference = 'bank_txn:' || t.id::text
        )
      ORDER BY t.amount DESC`,
    [organizationId, start]
  );

  const items = [];
  const totales = { requiere_cfdi: 0, cfdi_del_banco: 0, no_aplica: 0 };
  let montoRequiere = 0;
  for (const r of rows) {
    const { clase, motivo } = clasificarEgreso(r.category, r.description, r.original_description);
    const amount = Number(r.amount);
    totales[clase] += 1;
    if (clase === 'requiere_cfdi') {
      montoRequiere += amount;
      items.push({
        id: r.id, date: r.transaction_date, amount: num(amount),
        concepto: r.description || null, categoria: r.category || null, motivo,
      });
    }
  }

  return {
    year, month,
    // Solo devolvemos el detalle de los que REQUIEREN CFDI (los accionables).
    faltantes: items,
    resumen: {
      con_riesgo: totales.requiere_cfdi,
      monto_en_riesgo: num(montoRequiere),
      cfdi_del_banco: totales.cfdi_del_banco,
      no_aplica: totales.no_aplica,
    },
  };
}

module.exports = { gastosSinCfdi, clasificarEgreso };
