const pool = require('../db/pool');

function toAmount(value) {
  return Number.parseFloat(value || '0');
}

async function getMonthlyReport({ organization_id, year, month }) {
  const periodStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const periodEnd = new Date(Date.UTC(year, month, 1, 0, 0, 0));

  const summaryQuery = {
    text: `
      SELECT
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS total_income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS total_expense,
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0) AS net_profit,
        COUNT(*)::int AS transaction_count
      FROM finance.transactions
      WHERE organization_id = $1
        AND transaction_date >= $2
        AND transaction_date < $3
        AND deleted_at IS NULL
    `,
    values: [organization_id, periodStart, periodEnd],
  };

  const byCategoryQuery = {
    text: `
      SELECT
        category,
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS total_income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS total_expense,
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0) AS net_profit,
        COUNT(*)::int AS transaction_count
      FROM finance.transactions
      WHERE organization_id = $1
        AND transaction_date >= $2
        AND transaction_date < $3
        AND deleted_at IS NULL
      GROUP BY category
      ORDER BY category ASC
    `,
    values: [organization_id, periodStart, periodEnd],
  };

  const [summaryResult, byCategoryResult] = await Promise.all([
    pool.query(summaryQuery),
    pool.query(byCategoryQuery),
  ]);

  const summary = summaryResult.rows[0];

  return {
    organization_id,
    year,
    month,
    total_income: toAmount(summary.total_income),
    total_expense: toAmount(summary.total_expense),
    net_profit: toAmount(summary.net_profit),
    transaction_count: summary.transaction_count,
    by_category: byCategoryResult.rows.map((row) => ({
      category: row.category,
      total_income: toAmount(row.total_income),
      total_expense: toAmount(row.total_expense),
      net_profit: toAmount(row.net_profit),
      transaction_count: row.transaction_count,
    })),
  };
}

/**
 * DIOT groundwork: monthly IVA by supplier RFC, from uploaded received CFDIs.
 * Aggregates the structured tax fields persisted since migration 007 —
 * invoices uploaded before it lack RFC/taxes and are reported under
 * `unclassified_count` so the accountant knows the coverage.
 */
async function getDiotReport({ organization_id, year, month }) {
  const { rows } = await pool.query(
    `
      SELECT
        emitter_rfc,
        max(emitter) AS emitter_name,
        count(*)::int AS invoice_count,
        COALESCE(SUM(subtotal), 0) AS base_total,
        COALESCE(SUM((taxes->>'total_trasladados')::numeric), 0) AS iva_trasladado,
        COALESCE(SUM((taxes->>'total_retenidos')::numeric), 0) AS iva_retenido,
        COALESCE(SUM(total), 0) AS total
      FROM finance.invoices
      WHERE organization_id = $1
        AND date_part('year', invoice_date) = $2
        AND date_part('month', invoice_date) = $3
        AND emitter_rfc IS NOT NULL
      GROUP BY emitter_rfc
      ORDER BY total DESC
    `,
    [organization_id, year, month]
  );

  const { rows: missing } = await pool.query(
    `
      SELECT count(*)::int AS unclassified_count
      FROM finance.invoices
      WHERE organization_id = $1
        AND date_part('year', invoice_date) = $2
        AND date_part('month', invoice_date) = $3
        AND emitter_rfc IS NULL
    `,
    [organization_id, year, month]
  );

  return {
    year,
    month,
    suppliers: rows.map((row) => ({
      rfc: row.emitter_rfc,
      name: row.emitter_name,
      invoice_count: row.invoice_count,
      base_total: Number(row.base_total),
      iva_trasladado: Number(row.iva_trasladado),
      iva_retenido: Number(row.iva_retenido),
      total: Number(row.total),
    })),
    // Invoices uploaded before the structured parser; re-upload to include them.
    unclassified_count: missing[0]?.unclassified_count || 0,
  };
}

module.exports = {
  getMonthlyReport,
  getDiotReport,
};
