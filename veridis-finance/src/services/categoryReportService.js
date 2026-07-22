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

/**
 * Cartera por cliente (S36): facturas emitidas agrupadas por receptor. Separa
 * dos cosas que NO son lo mismo:
 *   - "por cobrar (con CFDI)": el cliente requiere factura y su factura tiene RFC.
 *   - "ventas sin factura": receptor sin RFC, o cliente marcado como que NO
 *     requiere factura (público en general, anticipos, cobros por CRM/Stripe).
 *     Eso NO es deuda por cobrar — es informativo.
 * Un receptor cuenta como "sin factura" si le falta RFC o su cliente tiene
 * requires_invoice = false (cruce por nombre normalizado con finance.clients).
 */
async function receivablesByClient({ organizationId }) {
  const { rows } = await pool.query(
    `WITH cli AS (
        SELECT lower(trim(coalesce(business_name, name))) AS key, bool_and(requires_invoice) AS requires_invoice
          FROM finance.clients
         WHERE organization_id = $1
         GROUP BY 1
     )
     SELECT
        COALESCE(NULLIF(TRIM(i.receiver), ''), 'Sin nombre') AS cliente,
        i.receiver_rfc AS rfc,
        COUNT(*)::int AS facturas,
        COUNT(*) FILTER (WHERE i.status = 'pending')::int AS pendientes,
        COUNT(*) FILTER (WHERE i.status = 'paid')::int AS pagadas,
        COALESCE(SUM(i.total) FILTER (WHERE i.status = 'pending'), 0)::numeric(14,2) AS por_cobrar,
        COALESCE(SUM(i.total) FILTER (WHERE i.status = 'paid'), 0)::numeric(14,2) AS cobrado,
        MIN(i.invoice_date) FILTER (WHERE i.status = 'pending') AS pendiente_desde,
        BOOL_OR(i.receiver_rfc IS NULL) AS falta_rfc,
        COALESCE(bool_and(c.requires_invoice), true) AS requiere_factura
       FROM finance.invoices i
       LEFT JOIN cli c ON c.key = lower(trim(i.receiver))
      WHERE i.organization_id = $1 AND i.direction = 'issued'
        AND COALESCE(i.sat_estado, '') <> 'Cancelado'
        AND i.status <> 'cancelled'
      GROUP BY 1, 2
      ORDER BY por_cobrar DESC`,
    [organizationId]
  );

  // "sin factura" = pendiente pero sin RFC o cliente que no requiere factura.
  const enriched = rows.map((r) => {
    const sinFactura = r.falta_rfc || r.requiere_factura === false;
    return { ...r, sin_factura: sinFactura };
  });

  const porCobrarCfdi = enriched
    .filter((r) => !r.sin_factura)
    .reduce((a, r) => a + Number(r.por_cobrar), 0);
  const sinFacturaTotal = enriched
    .filter((r) => r.sin_factura)
    .reduce((a, r) => a + Number(r.por_cobrar), 0);

  return {
    clientes: enriched,
    total_por_cobrar_cfdi: Number(porCobrarCfdi.toFixed(2)),
    total_sin_factura: Number(sinFacturaTotal.toFixed(2)),
    total_por_cobrar: Number((porCobrarCfdi + sinFacturaTotal).toFixed(2)),
    clientes_con_saldo: enriched.filter((r) => Number(r.por_cobrar) > 0 && !r.sin_factura).length,
    clientes_sin_factura: enriched.filter((r) => Number(r.por_cobrar) > 0 && r.sin_factura).length,
  };
}

module.exports = { catalog, monthlyBreakdown, exportCsv, receivablesByClient };
