/**
 * Auditoría preventiva (Sprint 12) — estilo Contpaqi Anticipa / Aspel revisión.
 *
 * Corre un panel de verificaciones sobre un periodo contable y devuelve
 * hallazgos priorizados por severidad, para detectar problemas ANTES de declarar:
 *
 *   - Balanza que no cuadra.
 *   - Pólizas descuadradas (cargos ≠ abonos).
 *   - CFDIs del periodo sin póliza contable.
 *   - Contrapartes o CFDIs contra la lista negra EFOS (69-B).
 *   - CFDIs cancelados que siguen con póliza (deducción/ingreso indebido).
 *   - Periodo aún abierto (recordatorio de cierre).
 *
 * No modifica nada: es de solo lectura y agrega los resultados de otros servicios.
 */

const pool = require('../db/pool');
const reportes = require('./reportesContablesService');
const efos = require('./efosService');

function finding(id, titulo, severidad, detalle, extra = {}) {
  return { id, titulo, severidad, detalle, ...extra };
}

async function run(organizationId, { year, month }) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const hallazgos = [];

  // 1) Balanza cuadra.
  const bal = await reportes.balanzaComprobacion(organizationId, { year, month });
  hallazgos.push(
    bal.cuadra
      ? finding('balanza', 'Balanza de comprobación', 'ok',
          `Cuadra: cargos ${bal.total_cargos} = abonos ${bal.total_abonos}.`)
      : finding('balanza', 'Balanza de comprobación', 'error',
          `No cuadra: cargos ${bal.total_cargos} ≠ abonos ${bal.total_abonos}. Revisa las pólizas del periodo.`)
  );

  // 2) Pólizas descuadradas.
  const { rows: descuadre } = await pool.query(
    `SELECT id, folio, total_debit, total_credit
       FROM finance.journal_entries
      WHERE organization_id = $1 AND status = 'posted'
        AND period_year = $2 AND period_month = $3
        AND round(total_debit, 2) <> round(total_credit, 2)`,
    [organizationId, year, month]
  );
  hallazgos.push(
    descuadre.length === 0
      ? finding('polizas_descuadradas', 'Pólizas balanceadas', 'ok', 'Todas las pólizas del periodo cuadran.')
      : finding('polizas_descuadradas', 'Pólizas descuadradas', 'error',
          `${descuadre.length} póliza(s) con cargos ≠ abonos.`,
          { cantidad: descuadre.length, folios: descuadre.map((d) => d.folio) })
  );

  // 3) CFDIs del periodo sin póliza.
  const { rows: cfdiRows } = await pool.query(
    `SELECT count(*)::int AS n FROM finance.invoices
      WHERE organization_id = $1 AND uuid_sat IS NOT NULL
        AND invoice_date >= $2::date AND invoice_date < ($2::date + interval '1 month')
        AND COALESCE(comprobante_type, 'I') NOT IN ('P', 'N')`,
    [organizationId, start]
  );
  const { rows: linkRows } = await pool.query(
    `SELECT count(*)::int AS n FROM finance.journal_entries
      WHERE organization_id = $1 AND status = 'posted' AND source = 'cfdi'
        AND entry_date >= $2::date AND entry_date < ($2::date + interval '1 month')`,
    [organizationId, start]
  );
  const sinPoliza = Math.max(0, cfdiRows[0].n - linkRows[0].n);
  hallazgos.push(
    sinPoliza === 0
      ? finding('cfdi_sin_poliza', 'CFDIs contabilizados', 'ok',
          `Los ${cfdiRows[0].n} CFDI(s) del periodo tienen póliza.`)
      : finding('cfdi_sin_poliza', 'CFDIs sin póliza', 'warning',
          `${sinPoliza} CFDI(s) del periodo sin póliza. Usa “Generar desde CFDIs”.`,
          { cantidad: sinPoliza })
  );

  // 4) EFOS (69-B).
  let efosHits = [];
  try { efosHits = await efos.hits(organizationId); } catch { efosHits = []; }
  const definitivos = efosHits.filter((h) => /definitiv/i.test(h.situacion || ''));
  if (efosHits.length === 0) {
    hallazgos.push(finding('efos', 'Lista negra EFOS (69-B)', 'ok', 'Sin coincidencias con la lista del SAT.'));
  } else {
    hallazgos.push(finding('efos',
      definitivos.length ? 'EFOS definitivo detectado' : 'Coincidencias EFOS',
      definitivos.length ? 'error' : 'warning',
      `${efosHits.length} contraparte(s) en la lista 69-B (${definitivos.length} definitivo/s).`,
      { cantidad: efosHits.length, rfcs: efosHits.slice(0, 20).map((h) => h.rfc) }));
  }

  // 5) CFDIs cancelados que siguen con póliza.
  const { rows: canceladas } = await pool.query(
    `SELECT i.uuid_sat, i.emitter, i.receiver, i.direction
       FROM finance.invoices i
       JOIN finance.journal_entries e
         ON e.organization_id = i.organization_id AND e.source = 'cfdi' AND e.source_ref = i.uuid_sat
      WHERE i.organization_id = $1 AND i.sat_estado = 'Cancelado'
        AND i.invoice_date >= $2::date AND i.invoice_date < ($2::date + interval '1 month')
        AND e.status = 'posted'`,
    [organizationId, start]
  );
  hallazgos.push(
    canceladas.length === 0
      ? finding('cfdi_cancelado_poliza', 'CFDIs cancelados', 'ok', 'Ningún CFDI cancelado permanece contabilizado.')
      : finding('cfdi_cancelado_poliza', 'CFDI cancelado con póliza', 'error',
          `${canceladas.length} CFDI(s) cancelado(s) siguen con póliza. Cancela o ajusta la póliza.`,
          { cantidad: canceladas.length, uuids: canceladas.map((c) => c.uuid_sat) })
  );

  // 6) Periodo abierto (recordatorio de cierre).
  const { rows: per } = await pool.query(
    `SELECT status FROM finance.accounting_periods
      WHERE organization_id = $1 AND year = $2 AND month = $3`,
    [organizationId, year, month]
  );
  const estado = per[0]?.status || 'abierto';
  hallazgos.push(
    estado === 'closed'
      ? finding('periodo', 'Periodo contable', 'ok', 'El periodo está cerrado.')
      : finding('periodo', 'Periodo abierto', 'info',
          'El periodo sigue abierto; ciérralo cuando termines para bloquear cambios.')
  );

  const resumen = {
    ok: hallazgos.filter((h) => h.severidad === 'ok').length,
    info: hallazgos.filter((h) => h.severidad === 'info').length,
    warning: hallazgos.filter((h) => h.severidad === 'warning').length,
    error: hallazgos.filter((h) => h.severidad === 'error').length,
  };
  const orden = { error: 0, warning: 1, info: 2, ok: 3 };
  hallazgos.sort((a, b) => orden[a.severidad] - orden[b.severidad]);
  return { year, month, resumen, hallazgos };
}

module.exports = { run };
