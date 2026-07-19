/**
 * Conciliación de IVA (e ISR estimado) BASE FLUJO — paridad Siigo Fiscal.
 *
 * Criterio de flujo (efectivamente cobrado/pagado):
 *   - PUE  → causa/acredita en el mes de expedición (pago en una exhibición).
 *   - PPD  → causa/acredita en el mes en que se marcó pagada (REP/pago);
 *            sin pago aún, se lista como "pendiente" y NO entra al cálculo.
 *
 * Fuentes: finance.invoices (libro único: XML subidos, Descarga Masiva SAT,
 * timbrado propio, CRM), usando taxes JSONB del CFDI cuando existe y una
 * aproximación marcada `estimated` cuando no (total-subtotal o 16/116).
 *
 * Overrides: finance.fiscal_overrides permite excluir/incluir un UUID del
 * cálculo (como el "No considerar IVA" de Siigo).
 */

const pool = require('../db/pool');
const { money, round } = require('../lib/money');

function periodBounds(year, month) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  return { start };
}

/** IVA breakdown for one invoice row from its taxes JSONB (or estimate). */
function ivaOfRow(row) {
  const out = {
    base16: 0, iva16: 0, base8: 0, iva8: 0, base0: 0, exento: 0,
    iva: 0, ret_iva: 0, ret_isr: 0, estimated: false,
  };
  const taxes = row.taxes || null;
  const traslados = taxes && Array.isArray(taxes.traslados) ? taxes.traslados : [];
  const retenciones = taxes && Array.isArray(taxes.retenciones) ? taxes.retenciones : [];

  let sawIva = false;
  for (const t of traslados) {
    if (String(t.impuesto) !== '002') continue; // 002 = IVA
    sawIva = true;
    const base = Number(t.base || 0);
    const importe = Number(t.importe || 0);
    const tasa = t.tasa == null ? null : Number(t.tasa);
    if (String(t.tipo_factor || '').toLowerCase() === 'exento') out.exento += base;
    else if (tasa === 0.16) { out.base16 += base; out.iva16 += importe; }
    else if (tasa === 0.08) { out.base8 += base; out.iva8 += importe; }
    else if (tasa === 0) out.base0 += base;
    else { out.base16 += base; out.iva16 += importe; } // tasas raras → cubeta 16
    out.iva += importe;
  }
  for (const r of retenciones) {
    if (String(r.impuesto) === '002') out.ret_iva += Number(r.importe || 0);
    if (String(r.impuesto) === '001') out.ret_isr += Number(r.importe || 0);
  }

  if (!sawIva) {
    // Sin desglose → estimar. total-subtotal si hay ambos; si no, 16/116.
    const total = Number(row.total || 0);
    const subtotal = row.subtotal != null ? Number(row.subtotal) : null;
    const iva = subtotal != null && total >= subtotal
      ? round(money(total).minus(subtotal))
      : round(money(total).times(16).div(116));
    out.iva = Number(iva);
    out.iva16 = Number(iva);
    out.base16 = subtotal != null ? Number(subtotal) : Number(round(money(total).minus(iva)));
    out.estimated = true;
  }
  return out;
}

/** Rows that "cause" IVA in the period under cash-flow criteria. */
async function flowRows(organizationId, direction, start) {
  const { rows } = await pool.query(
    `SELECT uuid_sat, emitter, receiver, emitter_rfc, receiver_rfc, total, subtotal,
            COALESCE(metodo_pago, 'PUE') AS metodo_pago, status, paid_at, invoice_date, taxes,
            comprobante_type, source
       FROM finance.invoices
      WHERE organization_id = $1 AND direction = $2
        AND COALESCE(comprobante_type, 'I') NOT IN ('T', 'N', 'P')
        AND (
          (COALESCE(metodo_pago, 'PUE') <> 'PPD'
             AND invoice_date >= $3::date AND invoice_date < ($3::date + interval '1 month'))
          OR
          (COALESCE(metodo_pago, 'PUE') = 'PPD' AND status = 'paid' AND paid_at IS NOT NULL
             AND paid_at >= $3::date AND paid_at < ($3::date + interval '1 month'))
        )
      ORDER BY invoice_date ASC`,
    [organizationId, direction, start]
  );
  return rows;
}

/** PPD invoices still awaiting payment (no causan IVA todavía). */
async function ppdPending(organizationId, direction) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n, COALESCE(sum(total), 0) AS importe
       FROM finance.invoices
      WHERE organization_id = $1 AND direction = $2
        AND COALESCE(metodo_pago, 'PUE') = 'PPD' AND status <> 'paid'
        AND COALESCE(comprobante_type, 'I') NOT IN ('T', 'N', 'P')`,
    [organizationId, direction]
  );
  return { count: rows[0]?.n || 0, importe: Number(rows[0]?.importe || 0) };
}

async function getOverrides(organizationId) {
  const { rows } = await pool.query(
    `SELECT uuid, excluded, reason FROM finance.fiscal_overrides WHERE organization_id = $1`,
    [organizationId]
  );
  const map = new Map();
  for (const r of rows) map.set(String(r.uuid).toUpperCase(), r);
  return map;
}

function aggregate(rows, overrides, direction) {
  const totals = {
    count: 0, excluded_count: 0,
    base16: 0, iva16: 0, base8: 0, iva8: 0, base0: 0, exento: 0,
    iva_total: 0, ret_iva: 0, ret_isr: 0, subtotal: 0, estimated_count: 0,
  };
  const detalle = [];
  for (const row of rows) {
    const uuid = String(row.uuid_sat || '').toUpperCase();
    const ov = overrides.get(uuid);
    const excluded = Boolean(ov?.excluded);
    const iva = ivaOfRow(row);
    const item = {
      uuid: row.uuid_sat,
      fecha: row.invoice_date,
      paid_at: row.paid_at,
      counterparty: direction === 'issued' ? row.receiver : row.emitter,
      counterparty_rfc: direction === 'issued' ? row.receiver_rfc : row.emitter_rfc,
      metodo_pago: row.metodo_pago,
      total: Number(row.total || 0),
      subtotal: row.subtotal != null ? Number(row.subtotal) : null,
      iva: Number(round(iva.iva)),
      base16: Number(round(iva.base16)),
      ret_iva: Number(round(iva.ret_iva)),
      ret_isr: Number(round(iva.ret_isr)),
      estimated: iva.estimated,
      excluded,
      source: row.source || null,
    };
    detalle.push(item);
    if (excluded) { totals.excluded_count += 1; continue; }
    totals.count += 1;
    totals.base16 += iva.base16; totals.iva16 += iva.iva16;
    totals.base8 += iva.base8; totals.iva8 += iva.iva8;
    totals.base0 += iva.base0; totals.exento += iva.exento;
    totals.iva_total += iva.iva; totals.ret_iva += iva.ret_iva; totals.ret_isr += iva.ret_isr;
    totals.subtotal += item.subtotal != null ? item.subtotal : item.total - iva.iva;
    if (iva.estimated) totals.estimated_count += 1;
  }
  for (const k of Object.keys(totals)) {
    if (typeof totals[k] === 'number') totals[k] = Number(round(totals[k]));
  }
  return { totals, detalle };
}

/** Full IVA (and estimated ISR) cash-flow reconciliation for a period. */
async function compute({ organization_id, year, month }) {
  const { start } = periodBounds(year, month);
  const [issuedRows, receivedRows, overrides, ppdOutIssued, ppdOutReceived] = await Promise.all([
    flowRows(organization_id, 'issued', start),
    flowRows(organization_id, 'received', start),
    getOverrides(organization_id),
    ppdPending(organization_id, 'issued'),
    ppdPending(organization_id, 'received'),
  ]);

  const trasladado = aggregate(issuedRows, overrides, 'issued');
  const acreditable = aggregate(receivedRows, overrides, 'received');

  const ivaACargo = Number(round(
    money(trasladado.totals.iva_total)
      .minus(acreditable.totals.iva_total)
      .minus(trasladado.totals.ret_iva)
  ));

  // ISR estimado (flujo, aproximación transparente): ingresos cobrados −
  // deducciones pagadas del periodo; NO sustituye el cálculo del contador.
  const isrBase = Number(round(money(trasladado.totals.subtotal).minus(acreditable.totals.subtotal)));

  return {
    periodo: { year, month },
    trasladado: trasladado.totals,
    acreditable: acreditable.totals,
    iva_a_cargo: ivaACargo,
    isr: {
      ingresos_cobrados: trasladado.totals.subtotal,
      deducciones_pagadas: acreditable.totals.subtotal,
      base_estimada: isrBase,
      isr_retenido: trasladado.totals.ret_isr,
      nota: 'Estimación base flujo; el ISR definitivo depende de tu régimen y lo determina tu contador.',
    },
    ppd_pendientes: { emitidas: ppdOutIssued, recibidas: ppdOutReceived },
    detalle: { emitidas: trasladado.detalle, recibidas: acreditable.detalle },
  };
}

/** Include/exclude a CFDI (by UUID) from the calculation, like Siigo's toggle. */
async function setOverride({ organization_id, uuid, excluded, reason }) {
  await pool.query(
    `INSERT INTO finance.fiscal_overrides (organization_id, uuid, excluded, reason)
     VALUES ($1, upper($2), $3, $4)
     ON CONFLICT (organization_id, uuid)
     DO UPDATE SET excluded = EXCLUDED.excluded, reason = EXCLUDED.reason`,
    [organization_id, uuid, excluded, reason || null]
  );
  return { uuid: uuid.toUpperCase(), excluded };
}

module.exports = { compute, setOverride, ivaOfRow };
