/**
 * Cierre contable (Sprint 13) — bloqueo de periodos y póliza de cierre anual.
 *
 *   - closePeriod: valida que la balanza cuadre y marca el periodo como cerrado;
 *     a partir de ahí accountingService.assertPeriodOpen rechaza nuevas pólizas.
 *   - reopenPeriod: reabre (solo owner/admin) para correcciones.
 *   - generateClosing: genera la póliza de cierre del ejercicio (dic 31) que
 *     traspasa el resultado (ingresos − costos − gastos del año) a la cuenta
 *     305.01 "Resultado del ejercicio". Idempotente por source_ref='cierre:<año>'.
 */

const pool = require('../db/pool');
const accounting = require('./accountingService');
const reportes = require('./reportesContablesService');
const { round } = require('../lib/money');

const num = (v) => Number(round(v));
const RESULT_ACCOUNT = '305.01';

/**
 * Construye las partidas de la póliza de cierre (puro). Recibe los saldos
 * acumulados del ejercicio (reportes.saldosAcumulados) y cierra ingresos,
 * costos y gastos contra 305.01. Devuelve { lines, resultado }.
 */
function buildClosingLines(saldos) {
  const lines = [];
  let resultado = 0;
  for (const s of saldos) {
    if (!['ingreso', 'costo', 'gasto'].includes(s.account_type)) continue;
    const ytd = num(s.ytd);
    if (ytd === 0) continue;
    if (s.account_type === 'ingreso') {
      // Naturaleza acreedora: para cerrarla se carga por su saldo.
      lines.push({ account_code: s.code, debit: ytd, description: 'Cierre de ingresos' });
      resultado += ytd;
    } else {
      // Costos/gastos (deudora): se abonan por su saldo.
      lines.push({ account_code: s.code, credit: ytd, description: 'Cierre de resultados' });
      resultado -= ytd;
    }
  }
  resultado = num(resultado);
  if (lines.length === 0) return { lines, resultado: 0 };
  if (resultado > 0) lines.push({ account_code: RESULT_ACCOUNT, credit: resultado, description: 'Utilidad del ejercicio' });
  else if (resultado < 0) lines.push({ account_code: RESULT_ACCOUNT, debit: -resultado, description: 'Pérdida del ejercicio' });
  return { lines, resultado };
}

async function listPeriods(organizationId) {
  const { rows } = await pool.query(
    `SELECT year, month, status, closed_at
       FROM finance.accounting_periods
      WHERE organization_id = $1
      ORDER BY year DESC, month DESC`,
    [organizationId]
  );
  return rows.map((r) => ({ year: r.year, month: r.month, status: r.status, closed_at: r.closed_at }));
}

/** Cierra un periodo. Exige que la balanza del mes cuadre. */
async function closePeriod(organizationId, { year, month }) {
  const bal = await reportes.balanzaComprobacion(organizationId, { year, month });
  if (!bal.cuadra) {
    const err = new Error(
      `No se puede cerrar: la balanza de ${month}/${year} no cuadra (cargos ${bal.total_cargos} ≠ abonos ${bal.total_abonos}).`
    );
    err.statusCode = 409;
    throw err;
  }
  await pool.query(
    `INSERT INTO finance.accounting_periods (organization_id, year, month, status, closed_at)
     VALUES ($1,$2,$3,'closed', now())
     ON CONFLICT (organization_id, year, month)
       DO UPDATE SET status = 'closed', closed_at = now()`,
    [organizationId, year, month]
  );
  return { year, month, status: 'closed' };
}

async function reopenPeriod(organizationId, { year, month }) {
  await pool.query(
    `INSERT INTO finance.accounting_periods (organization_id, year, month, status, closed_at)
     VALUES ($1,$2,$3,'open', NULL)
     ON CONFLICT (organization_id, year, month)
       DO UPDATE SET status = 'open', closed_at = NULL`,
    [organizationId, year, month]
  );
  return { year, month, status: 'open' };
}

/**
 * Genera la póliza de cierre del ejercicio: cierra ingresos, costos y gastos
 * contra 305.01. Devuelve {created, folio, resultado} o {skipped} si ya existe
 * o no hay resultado que cerrar.
 */
async function generateClosing(organizationId, { year, createdBy }) {
  const existing = await pool.query(
    `SELECT 1 FROM finance.journal_entries
      WHERE organization_id = $1 AND source = 'closing' AND source_ref = $2`,
    [organizationId, `cierre:${year}`]
  );
  if (existing.rowCount > 0) return { skipped: true, reason: 'ya_existe' };

  const saldos = await reportes.saldosAcumulados(organizationId, { year, month: 12 });
  const { lines, resultado } = buildClosingLines(saldos);
  if (lines.length === 0) return { skipped: true, reason: 'sin_movimientos' };

  const entry = await accounting.createEntry(organizationId, {
    entry_type: 'diario',
    entry_date: `${year}-12-31`,
    concept: `Póliza de cierre del ejercicio ${year}`,
    source: 'closing',
    source_ref: `cierre:${year}`,
    created_by: createdBy || null,
    lines,
  });
  return { created: true, folio: entry.folio, resultado };
}

module.exports = { listPeriods, closePeriod, reopenPeriod, generateClosing, buildClosingLines };
