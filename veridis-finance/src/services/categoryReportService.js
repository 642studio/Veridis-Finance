/**
 * Reportes por categoría (S32) y exportación (S33).
 * - catalog(): la taxonomía canónica para poblar selects en la UI.
 * - monthlyBreakdown(): totales por categoría del mes + conteo "Por revisar" +
 *   ingreso/gasto/neto de flujo (excluye "Traspaso interno"), para que el
 *   usuario vea de un vistazo si algo está mal categorizado.
 * - exportCsv(): todos los movimientos del rango en CSV (concepto limpio, texto
 *   crudo del banco, categoría, tipo, monto, estado de conciliación).
 */

const pool = require('../db/pool');
const { INCOME_CATEGORIES, EXPENSE_CATEGORIES, NEUTRAL_CATEGORIES, REVIEW_CATEGORY } = require('./categoryTaxonomy');

function catalog() {
  return {
    income: INCOME_CATEGORIES,
    expense: EXPENSE_CATEGORIES,
    neutral: NEUTRAL_CATEGORIES,
    review: REVIEW_CATEGORY,
  };
}

async function monthlyBreakdown({ organizationId, year, month }) {
  const y = Number(year);
  const m = Number(month);
  const { rows } = await pool.query(
    `SELECT type, category, COUNT(*)::int AS n, SUM(amount)::numeric(14,2) AS total
       FROM finance.transactions
      WHERE organization_id = $1 AND deleted_at IS NULL
        AND EXTRACT(YEAR FROM transaction_date) = $2
        AND EXTRACT(MONTH FROM transaction_date) = $3
      GROUP BY 1, 2
      ORDER BY 1, 4 DESC`,
    [organizationId, y, m]
  );

  const income = [];
  const expense = [];
  let incomeTotal = 0;
  let expenseTotal = 0;
  let transfersTotal = 0;
  let reviewCount = 0;
  let reviewTotal = 0;

  for (const r of rows) {
    const total = Number(r.total);
    const item = { category: r.category, count: r.n, total };
    const isTransfer = NEUTRAL_CATEGORIES.includes(r.category);
    if (r.category === REVIEW_CATEGORY) {
      reviewCount += r.n;
      reviewTotal += total;
    }
    if (isTransfer) {
      transfersTotal += total;
    } else if (r.type === 'income') {
      income.push(item);
      incomeTotal += total;
    } else {
      expense.push(item);
      expenseTotal += total;
    }
  }

  return {
    year: y,
    month: m,
    income,
    expense,
    income_total: Number(incomeTotal.toFixed(2)),
    expense_total: Number(expenseTotal.toFixed(2)),
    net: Number((incomeTotal - expenseTotal).toFixed(2)),
    transfers_total: Number(transfersTotal.toFixed(2)),
    review_count: reviewCount,
    review_total: Number(reviewTotal.toFixed(2)),
  };
}

function csvCell(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function exportCsv({ organizationId, from, to }) {
  const params = [organizationId];
  let where = 'organization_id = $1 AND deleted_at IS NULL';
  if (from) { params.push(from); where += ` AND transaction_date >= $${params.length}`; }
  if (to) { params.push(to); where += ` AND transaction_date <= $${params.length}`; }

  const { rows } = await pool.query(
    `SELECT t.transaction_date, t.type, t.amount, t.category,
            t.description, t.original_description,
            CASE WHEN EXISTS (
              SELECT 1 FROM finance.invoices i
               WHERE i.organization_id = t.organization_id
                 AND i.payment_reference = 'bank_txn:' || t.id::text
            ) THEN 'conciliado' ELSE 'sin conciliar' END AS estado_conciliacion
       FROM finance.transactions t
      WHERE ${where}
      ORDER BY t.transaction_date ASC, t.created_at ASC`,
    params
  );

  const header = ['Fecha', 'Tipo', 'Monto', 'Categoria', 'Concepto', 'Texto banco (crudo)', 'Conciliacion'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      csvCell(r.transaction_date instanceof Date ? r.transaction_date.toISOString().slice(0, 10) : r.transaction_date),
      csvCell(r.type === 'income' ? 'Ingreso' : 'Gasto'),
      csvCell(Number(r.amount).toFixed(2)),
      csvCell(r.category),
      csvCell(r.description),
      csvCell(r.original_description),
      csvCell(r.estado_conciliacion),
    ].join(','));
  }
  return { csv: lines.join('\n'), count: rows.length };
}

module.exports = { catalog, monthlyBreakdown, exportCsv };
