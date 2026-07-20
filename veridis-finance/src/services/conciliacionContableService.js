/**
 * Conciliación contable (Sprint 13) — banco ↔ pólizas ↔ CFDI.
 *
 * Cruza tres fuentes de un periodo y reporta diferencias:
 *
 *   - Banco real (finance.transactions) vs. movimiento de la cuenta de Bancos
 *     en el mayor (102.01): ingresos, egresos y neto de cada lado.
 *   - CFDIs del periodo vs. pólizas generadas desde CFDI (enlace uuid).
 *
 * Es de solo lectura; su salida alimenta el panel de conciliación para que el
 * contador vea qué falta contabilizar antes de cerrar el mes.
 */

const pool = require('../db/pool');
const { round } = require('../lib/money');

const num = (v) => Number(round(v));
const BANK_ACCOUNT = '102.01';

async function run(organizationId, { year, month, bankAccount = BANK_ACCOUNT }) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;

  // --- Banco real: movimientos bancarios del periodo ---
  const { rows: bankRows } = await pool.query(
    `SELECT
        COALESCE(SUM(amount) FILTER (WHERE type::text = 'income'), 0)  AS ingresos,
        COALESCE(SUM(amount) FILTER (WHERE type::text = 'expense'), 0) AS egresos,
        count(*)::int AS n
       FROM finance.transactions
      WHERE organization_id = $1
        AND transaction_date >= $2::date AND transaction_date < ($2::date + interval '1 month')`,
    [organizationId, start]
  );
  const bankIn = num(bankRows[0].ingresos);
  const bankOut = num(bankRows[0].egresos);

  // --- Banco contable: movimiento de la cuenta de Bancos en el mayor ---
  const { rows: ledgerRows } = await pool.query(
    `SELECT COALESCE(SUM(l.debit), 0) AS cargos, COALESCE(SUM(l.credit), 0) AS abonos, count(*)::int AS n
       FROM finance.journal_lines l
       JOIN finance.chart_of_accounts a ON a.id = l.account_id
       JOIN finance.journal_entries e ON e.id = l.entry_id
      WHERE l.organization_id = $1 AND a.code = $3 AND e.status = 'posted'
        AND e.entry_date >= $2::date AND e.entry_date < ($2::date + interval '1 month')`,
    [organizationId, start, bankAccount]
  );
  const ledgerIn = num(ledgerRows[0].cargos);   // cargos a bancos = entradas
  const ledgerOut = num(ledgerRows[0].abonos);  // abonos a bancos = salidas

  const banco = {
    real: { ingresos: bankIn, egresos: bankOut, neto: num(bankIn - bankOut), movimientos: bankRows[0].n },
    contable: { ingresos: ledgerIn, egresos: ledgerOut, neto: num(ledgerIn - ledgerOut), movimientos: ledgerRows[0].n },
    diferencia: num((bankIn - bankOut) - (ledgerIn - ledgerOut)),
    conciliado: num((bankIn - bankOut) - (ledgerIn - ledgerOut)) === 0,
  };

  // --- CFDI ↔ póliza ---
  const { rows: cfdiRows } = await pool.query(
    `SELECT count(*)::int AS n FROM finance.invoices
      WHERE organization_id = $1 AND uuid_sat IS NOT NULL
        AND invoice_date >= $2::date AND invoice_date < ($2::date + interval '1 month')
        AND COALESCE(comprobante_type, 'I') NOT IN ('P', 'N')`,
    [organizationId, start]
  );
  const { rows: polRows } = await pool.query(
    `SELECT count(*)::int AS n FROM finance.journal_entries
      WHERE organization_id = $1 AND status = 'posted' AND source = 'cfdi'
        AND entry_date >= $2::date AND entry_date < ($2::date + interval '1 month')`,
    [organizationId, start]
  );
  const cfdi = {
    cfdis: cfdiRows[0].n,
    polizas: polRows[0].n,
    sin_poliza: Math.max(0, cfdiRows[0].n - polRows[0].n),
    conciliado: Math.max(0, cfdiRows[0].n - polRows[0].n) === 0,
  };

  return {
    year, month, bank_account: bankAccount,
    banco, cfdi,
    conciliado: banco.conciliado && cfdi.conciliado,
  };
}

module.exports = { run };
