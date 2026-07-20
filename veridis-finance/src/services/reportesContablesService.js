/**
 * Reportes contables (Sprint 10) — se apoyan en el mayor real (journal_lines /
 * journal_entries). Paridad con COI/Contpaqi/Aspel:
 *
 *   - Balanza de comprobación formal: saldo inicial, cargos, abonos, saldo final
 *     por cuenta (con totales que cuadran).
 *   - Libro mayor: movimientos por cuenta con saldo corriente.
 *   - Libro diario: pólizas en orden cronológico con sus partidas.
 *   - Balance General: activo = pasivo + capital + resultado del ejercicio.
 *   - Estado de Resultados: ingresos − costos − gastos = utilidad (del mes y del
 *     ejercicio acumulado).
 *
 * Todos los saldos se derivan por naturaleza de la cuenta (deudora/acreedora),
 * nunca se almacenan: el reporte siempre refleja las pólizas vigentes (posted).
 */

const pool = require('../db/pool');
const { round } = require('../lib/money');

const num = (v) => Number(round(v));

function monthRange(year, month) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  return { start };
}

/**
 * Balanza de comprobación formal del periodo.
 * saldo_inicial = neto acumulado antes del inicio del mes.
 * cargos/abonos = movimientos del mes.
 * saldo_final = saldo_inicial ± movimientos (por naturaleza).
 */
async function balanzaComprobacion(organizationId, { year, month }) {
  const { start } = monthRange(year, month);
  const { rows } = await pool.query(
    `SELECT a.code, a.name, a.account_type, a.nature,
            COALESCE(SUM(CASE WHEN e.entry_date <  $2::date THEN l.debit  ELSE 0 END), 0) AS prev_debit,
            COALESCE(SUM(CASE WHEN e.entry_date <  $2::date THEN l.credit ELSE 0 END), 0) AS prev_credit,
            COALESCE(SUM(CASE WHEN e.entry_date >= $2::date AND e.entry_date < ($2::date + interval '1 month') THEN l.debit  ELSE 0 END), 0) AS per_debit,
            COALESCE(SUM(CASE WHEN e.entry_date >= $2::date AND e.entry_date < ($2::date + interval '1 month') THEN l.credit ELSE 0 END), 0) AS per_credit
       FROM finance.chart_of_accounts a
       LEFT JOIN finance.journal_lines l ON l.account_id = a.id
       LEFT JOIN finance.journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
      WHERE a.organization_id = $1
      GROUP BY a.id
      ORDER BY a.code`,
    [organizationId, start]
  );

  let tIni = 0;
  let tCargos = 0;
  let tAbonos = 0;
  let tFin = 0;
  const cuentas = [];
  for (const r of rows) {
    const prevDebit = Number(r.prev_debit);
    const prevCredit = Number(r.prev_credit);
    const cargos = Number(r.per_debit);
    const abonos = Number(r.per_credit);
    // Solo cuentas con saldo inicial o movimiento en el mes.
    if (prevDebit === 0 && prevCredit === 0 && cargos === 0 && abonos === 0) continue;
    const deudora = r.nature === 'deudora';
    const saldoInicial = deudora ? prevDebit - prevCredit : prevCredit - prevDebit;
    const totDebit = prevDebit + cargos;
    const totCredit = prevCredit + abonos;
    const saldoFinal = deudora ? totDebit - totCredit : totCredit - totDebit;
    cuentas.push({
      code: r.code, name: r.name, account_type: r.account_type, nature: r.nature,
      saldo_inicial: num(saldoInicial), cargos: num(cargos), abonos: num(abonos),
      saldo_final: num(saldoFinal),
    });
    // Totales columnares: para que "cuadre" se suman los saldos por su signo
    // absoluto según naturaleza (deudoras positivas, acreedoras positivas en su
    // columna). Reportamos la suma directa de columnas de movimiento.
    tIni += saldoInicial >= 0 ? saldoInicial : 0;
    tCargos += cargos;
    tAbonos += abonos;
    tFin += saldoFinal >= 0 ? saldoFinal : 0;
  }
  return {
    year, month,
    cuentas,
    total_cargos: num(tCargos),
    total_abonos: num(tAbonos),
    cuadra: num(tCargos) === num(tAbonos),
  };
}

/** Libro mayor: movimientos por cuenta con saldo corriente. Opcional: una cuenta. */
async function libroMayor(organizationId, { year, month, accountCode = null }) {
  const { start } = monthRange(year, month);
  const params = [organizationId, start];
  let accFilter = '';
  if (accountCode) { params.push(accountCode); accFilter = ` AND a.code = $${params.length}`; }

  // Saldo inicial por cuenta (neto acumulado ANTES del mes). El filtro de fecha
  // va DENTRO del CASE: con LEFT JOIN, si el asiento no cae antes del mes, e es
  // NULL y `e.entry_date < $2` es NULL (falso) ⇒ 0. Ponerlo en el ON sumaría de
  // más las partidas del propio mes.
  const { rows: iniRows } = await pool.query(
    `SELECT a.code, a.name, a.nature,
            COALESCE(SUM(CASE WHEN e.entry_date < $2::date THEN
              (CASE WHEN a.nature = 'deudora' THEN l.debit - l.credit ELSE l.credit - l.debit END)
              ELSE 0 END), 0) AS saldo_inicial
       FROM finance.chart_of_accounts a
       LEFT JOIN finance.journal_lines l ON l.account_id = a.id
       LEFT JOIN finance.journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
      WHERE a.organization_id = $1${accFilter}
      GROUP BY a.id`,
    params
  );
  const ini = new Map(iniRows.map((r) => [r.code, r]));

  // Movimientos del mes.
  const { rows: movRows } = await pool.query(
    `SELECT a.code, e.folio, e.entry_date, e.concept, l.description,
            l.debit, l.credit, e.id AS entry_id
       FROM finance.journal_lines l
       JOIN finance.chart_of_accounts a ON a.id = l.account_id
       JOIN finance.journal_entries e ON e.id = l.entry_id
      WHERE l.organization_id = $1 AND e.status = 'posted'
        AND e.entry_date >= $2::date AND e.entry_date < ($2::date + interval '1 month')${accFilter}
      ORDER BY a.code, e.entry_date, e.folio`,
    params
  );

  const byAccount = new Map();
  for (const [code, r] of ini) {
    if (Number(r.saldo_inicial) === 0 && !movRows.some((m) => m.code === code)) continue;
    byAccount.set(code, {
      code, name: r.name, nature: r.nature,
      saldo_inicial: num(r.saldo_inicial),
      movimientos: [],
      saldo_final: num(r.saldo_inicial),
    });
  }
  for (const m of movRows) {
    let acc = byAccount.get(m.code);
    if (!acc) {
      const meta = ini.get(m.code) || { name: '', nature: 'deudora', saldo_inicial: 0 };
      acc = { code: m.code, name: meta.name, nature: meta.nature,
              saldo_inicial: num(meta.saldo_inicial), movimientos: [], saldo_final: num(meta.saldo_inicial) };
      byAccount.set(m.code, acc);
    }
    const debit = Number(m.debit);
    const credit = Number(m.credit);
    const delta = acc.nature === 'deudora' ? debit - credit : credit - debit;
    acc.saldo_final = num(acc.saldo_final + delta);
    acc.movimientos.push({
      folio: m.folio, fecha: m.entry_date, concepto: m.concept, descripcion: m.description,
      cargo: num(debit), abono: num(credit), saldo: acc.saldo_final,
    });
  }
  return { year, month, cuentas: Array.from(byAccount.values()).sort((a, b) => a.code.localeCompare(b.code)) };
}

/** Libro diario: pólizas del periodo en orden cronológico con sus partidas. */
async function libroDiario(organizationId, { year, month }) {
  const { start } = monthRange(year, month);
  const { rows: entries } = await pool.query(
    `SELECT id, folio, entry_type, entry_date, concept, total_debit, total_credit
       FROM finance.journal_entries
      WHERE organization_id = $1 AND status = 'posted'
        AND entry_date >= $2::date AND entry_date < ($2::date + interval '1 month')
      ORDER BY entry_date, folio`,
    [organizationId, start]
  );
  if (entries.length === 0) return { year, month, polizas: [] };
  const ids = entries.map((e) => e.id);
  const { rows: lines } = await pool.query(
    `SELECT l.entry_id, a.code AS account_code, a.name AS account_name,
            l.debit, l.credit, l.description, l.line_no
       FROM finance.journal_lines l
       JOIN finance.chart_of_accounts a ON a.id = l.account_id
      WHERE l.organization_id = $1 AND l.entry_id = ANY($2)
      ORDER BY l.entry_id, l.line_no`,
    [organizationId, ids]
  );
  const linesByEntry = new Map();
  for (const l of lines) {
    if (!linesByEntry.has(l.entry_id)) linesByEntry.set(l.entry_id, []);
    linesByEntry.get(l.entry_id).push({
      account_code: l.account_code, account_name: l.account_name,
      cargo: num(l.debit), abono: num(l.credit), descripcion: l.description,
    });
  }
  const polizas = entries.map((e) => ({
    folio: e.folio, tipo: e.entry_type, fecha: e.entry_date, concepto: e.concept,
    total_cargos: Number(e.total_debit), total_abonos: Number(e.total_credit),
    partidas: linesByEntry.get(e.id) || [],
  }));
  return { year, month, polizas };
}

/**
 * Saldos acumulados por tipo hasta el fin del periodo (para BG) y del ejercicio
 * (para resultado). Devuelve mapas por tipo de cuenta.
 */
async function saldosAcumulados(organizationId, { year, month }) {
  // Fin del periodo (exclusivo): primer día del mes siguiente.
  const endExclusive = `${year}-${String(month).padStart(2, '0')}-01`;
  const yearStart = `${year}-01-01`;
  const { rows } = await pool.query(
    `SELECT a.code, a.name, a.account_type, a.nature,
            COALESCE(SUM(CASE WHEN e.entry_date < ($2::date + interval '1 month') THEN l.debit  ELSE 0 END), 0) AS acc_debit,
            COALESCE(SUM(CASE WHEN e.entry_date < ($2::date + interval '1 month') THEN l.credit ELSE 0 END), 0) AS acc_credit,
            COALESCE(SUM(CASE WHEN e.entry_date >= $3::date AND e.entry_date < ($2::date + interval '1 month') THEN l.debit  ELSE 0 END), 0) AS ytd_debit,
            COALESCE(SUM(CASE WHEN e.entry_date >= $3::date AND e.entry_date < ($2::date + interval '1 month') THEN l.credit ELSE 0 END), 0) AS ytd_credit
       FROM finance.chart_of_accounts a
       LEFT JOIN finance.journal_lines l ON l.account_id = a.id
       LEFT JOIN finance.journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
      WHERE a.organization_id = $1
      GROUP BY a.id
      ORDER BY a.code`,
    [organizationId, endExclusive, yearStart]
  );
  return rows.map((r) => {
    const deudora = r.nature === 'deudora';
    const saldo = deudora ? Number(r.acc_debit) - Number(r.acc_credit) : Number(r.acc_credit) - Number(r.acc_debit);
    const ytd = deudora ? Number(r.ytd_debit) - Number(r.ytd_credit) : Number(r.ytd_credit) - Number(r.ytd_debit);
    return { code: r.code, name: r.name, account_type: r.account_type, nature: r.nature,
             saldo, ytd };
  });
}

/**
 * Reductor puro del Estado de Resultados. `rows` = [{account_type, nature,
 * m_debit, m_credit, y_debit, y_credit}]. Devuelve ingresos/costos/gastos y la
 * utilidad, tanto del mes como del ejercicio.
 */
function computeEstadoResultados({ year, month, rows }) {
  const acc = { ingreso: { mes: 0, ejercicio: 0 }, costo: { mes: 0, ejercicio: 0 }, gasto: { mes: 0, ejercicio: 0 } };
  for (const r of rows) {
    const mes = r.nature === 'acreedora' ? Number(r.m_credit) - Number(r.m_debit) : Number(r.m_debit) - Number(r.m_credit);
    const ejercicio = r.nature === 'acreedora' ? Number(r.y_credit) - Number(r.y_debit) : Number(r.y_debit) - Number(r.y_credit);
    acc[r.account_type].mes += mes;
    acc[r.account_type].ejercicio += ejercicio;
  }
  const utilidadMes = acc.ingreso.mes - acc.costo.mes - acc.gasto.mes;
  const utilidadEjercicio = acc.ingreso.ejercicio - acc.costo.ejercicio - acc.gasto.ejercicio;
  return {
    year, month,
    ingresos: { mes: num(acc.ingreso.mes), ejercicio: num(acc.ingreso.ejercicio) },
    costos: { mes: num(acc.costo.mes), ejercicio: num(acc.costo.ejercicio) },
    gastos: { mes: num(acc.gasto.mes), ejercicio: num(acc.gasto.ejercicio) },
    utilidad: { mes: num(utilidadMes), ejercicio: num(utilidadEjercicio) },
  };
}

/** Estado de Resultados: ingresos − costos − gastos (del mes y del ejercicio). */
async function estadoResultados(organizationId, { year, month }) {
  const { start } = monthRange(year, month);
  const yearStart = `${year}-01-01`;
  const { rows } = await pool.query(
    `SELECT a.account_type, a.nature,
            COALESCE(SUM(CASE WHEN e.entry_date >= $2::date AND e.entry_date < ($2::date + interval '1 month') THEN l.debit  ELSE 0 END), 0) AS m_debit,
            COALESCE(SUM(CASE WHEN e.entry_date >= $2::date AND e.entry_date < ($2::date + interval '1 month') THEN l.credit ELSE 0 END), 0) AS m_credit,
            COALESCE(SUM(CASE WHEN e.entry_date >= $3::date AND e.entry_date < ($2::date + interval '1 month') THEN l.debit  ELSE 0 END), 0) AS y_debit,
            COALESCE(SUM(CASE WHEN e.entry_date >= $3::date AND e.entry_date < ($2::date + interval '1 month') THEN l.credit ELSE 0 END), 0) AS y_credit
       FROM finance.chart_of_accounts a
       LEFT JOIN finance.journal_lines l ON l.account_id = a.id
       LEFT JOIN finance.journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
      WHERE a.organization_id = $1 AND a.account_type IN ('ingreso', 'costo', 'gasto')
      GROUP BY a.id`,
    [organizationId, start, yearStart]
  );
  return computeEstadoResultados({ year, month, rows });
}

/**
 * Reductor puro del Balance General a partir de saldos acumulados
 * (`saldosAcumulados`). Verifica activo = pasivo + capital + resultado.
 */
function computeBalanceGeneral({ year, month, saldos }) {
  const activo = [];
  const pasivo = [];
  const capital = [];
  let totalActivo = 0;
  let totalPasivo = 0;
  let totalCapital = 0;
  let resultado = 0; // utilidad del ejercicio = ingresos - costos - gastos (YTD)
  for (const s of saldos) {
    if (['ingreso'].includes(s.account_type)) resultado += s.ytd;
    else if (['costo', 'gasto'].includes(s.account_type)) resultado -= s.ytd;
    if (s.account_type === 'activo') {
      if (num(s.saldo) !== 0) activo.push({ code: s.code, name: s.name, saldo: num(s.saldo) });
      totalActivo += s.saldo;
    } else if (s.account_type === 'pasivo') {
      if (num(s.saldo) !== 0) pasivo.push({ code: s.code, name: s.name, saldo: num(s.saldo) });
      totalPasivo += s.saldo;
    } else if (s.account_type === 'capital') {
      if (num(s.saldo) !== 0) capital.push({ code: s.code, name: s.name, saldo: num(s.saldo) });
      totalCapital += s.saldo;
    }
  }
  const capitalConResultado = totalCapital + resultado;
  return {
    year, month,
    activo, pasivo, capital,
    resultado_ejercicio: num(resultado),
    total_activo: num(totalActivo),
    total_pasivo: num(totalPasivo),
    total_capital: num(totalCapital),
    total_pasivo_capital: num(totalPasivo + capitalConResultado),
    cuadra: num(totalActivo) === num(totalPasivo + capitalConResultado),
  };
}

/** Balance General a fin de periodo: activo = pasivo + capital + resultado. */
async function balanceGeneral(organizationId, { year, month }) {
  const saldos = await saldosAcumulados(organizationId, { year, month });
  return computeBalanceGeneral({ year, month, saldos });
}

module.exports = {
  balanzaComprobacion,
  libroMayor,
  libroDiario,
  estadoResultados,
  balanceGeneral,
  saldosAcumulados,
  computeEstadoResultados,
  computeBalanceGeneral,
};
