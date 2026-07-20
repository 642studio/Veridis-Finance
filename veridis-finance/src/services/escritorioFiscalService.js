/**
 * Escritorio fiscal (Sprint 17) — el "cockpit" del mes. Consolida en una sola
 * vista lo que el dueño y el contador necesitan ver de un vistazo:
 *
 *   - IVA a cargo / a favor e ISR estimado (base flujo) del periodo.
 *   - Si la balanza cuadra y cuántas pólizas hay.
 *   - CFDIs del periodo sin póliza (pendientes de contabilizar).
 *   - Coincidencias con la lista negra EFOS (69-B).
 *   - Próximas obligaciones con su fecha límite y días restantes.
 *
 * Es de solo lectura y agrega servicios existentes (IVA flujo, balanza,
 * conciliación, EFOS); no recalcula nada por su cuenta.
 */

const ivaFlowService = require('./ivaFlowService');
const reportes = require('./reportesContablesService');
const conciliacion = require('./conciliacionContableService');
const efos = require('./efosService');

const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** Último día (número) del mes dado. */
function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Obligaciones del periodo (puro). Vencen el mes siguiente: los pagos
 * provisionales de ISR e IVA el día 17; la DIOT el último día del mes.
 * Devuelve fechas ISO (YYYY-MM-DD).
 */
function obligacionesForPeriod(year, month) {
  let ny = year;
  let nm = month + 1;
  if (nm > 12) { nm = 1; ny += 1; }
  const mm = String(nm).padStart(2, '0');
  const last = lastDayOfMonth(ny, nm);
  return [
    { clave: 'iva', nombre: `Pago definitivo de IVA (${MONTH_NAMES[month - 1]})`, vence: `${ny}-${mm}-17` },
    { clave: 'isr', nombre: `Pago provisional de ISR (${MONTH_NAMES[month - 1]})`, vence: `${ny}-${mm}-17` },
    { clave: 'diot', nombre: `DIOT (${MONTH_NAMES[month - 1]})`, vence: `${ny}-${mm}-${String(last).padStart(2, '0')}` },
  ];
}

/** Días entre hoy y la fecha de vencimiento (pura). Negativo = vencida. */
function diasRestantes(venceIso, todayIso) {
  const a = Date.parse(`${venceIso}T00:00:00Z`);
  const b = Date.parse(`${todayIso}T00:00:00Z`);
  return Math.round((a - b) / 86400000);
}

/** Estado de la obligación a partir de los días restantes. */
function estadoObligacion(dias) {
  if (dias < 0) return 'vencida';
  if (dias <= 7) return 'proxima';
  return 'ok';
}

/** Enriquecer obligaciones con días restantes y estado (puro). */
function obligacionesConEstado(year, month, todayIso) {
  return obligacionesForPeriod(year, month).map((o) => {
    const dias = diasRestantes(o.vence, todayIso);
    return { ...o, dias_restantes: dias, estado: estadoObligacion(dias) };
  });
}

async function compute(organizationId, { year, month }) {
  const [iva, balanza, conc, efosHits] = await Promise.all([
    ivaFlowService.compute({ organization_id: organizationId, year, month }),
    reportes.balanzaComprobacion(organizationId, { year, month }),
    conciliacion.run(organizationId, { year, month }),
    efos.hits(organizationId).catch(() => []),
  ]);

  const today = new Date();
  const todayIso = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`;
  const obligaciones = obligacionesConEstado(year, month, todayIso);

  const efosDefinitivos = efosHits.filter((h) => /definitiv/i.test(h.situacion || '')).length;

  return {
    periodo: { year, month },
    iva: {
      trasladado: iva.trasladado.iva_total,
      acreditable: iva.acreditable.iva_total,
      a_cargo: iva.iva_a_cargo,
    },
    isr: {
      base_estimada: iva.isr.base_estimada,
      retenido: iva.isr.isr_retenido,
    },
    contabilidad: {
      balanza_cuadra: balanza.cuadra,
      total_cargos: balanza.total_cargos,
      cfdis: conc.cfdi.cfdis,
      polizas: conc.cfdi.polizas,
      cfdis_sin_poliza: conc.cfdi.sin_poliza,
      banco_conciliado: conc.banco.conciliado,
      banco_diferencia: conc.banco.diferencia,
    },
    efos: { coincidencias: efosHits.length, definitivos: efosDefinitivos },
    obligaciones,
    alertas: buildAlertas({ balanza, conc, efosDefinitivos, obligaciones }),
  };
}

/** Resumen de focos rojos para encabezar el escritorio (puro). */
function buildAlertas({ balanza, conc, efosDefinitivos, obligaciones }) {
  const alertas = [];
  if (!balanza.cuadra) alertas.push({ nivel: 'error', texto: 'La balanza del periodo no cuadra.' });
  if (conc.cfdi.sin_poliza > 0) alertas.push({ nivel: 'warning', texto: `${conc.cfdi.sin_poliza} CFDI(s) sin póliza.` });
  if (efosDefinitivos > 0) alertas.push({ nivel: 'error', texto: `${efosDefinitivos} proveedor(es) EFOS definitivo.` });
  const vencidas = obligaciones.filter((o) => o.estado === 'vencida').length;
  const proximas = obligaciones.filter((o) => o.estado === 'proxima').length;
  if (vencidas > 0) alertas.push({ nivel: 'error', texto: `${vencidas} obligación(es) vencida(s).` });
  else if (proximas > 0) alertas.push({ nivel: 'warning', texto: `${proximas} obligación(es) por vencer.` });
  return alertas;
}

module.exports = {
  compute,
  obligacionesForPeriod,
  obligacionesConEstado,
  diasRestantes,
  estadoObligacion,
  buildAlertas,
};
