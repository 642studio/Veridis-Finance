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

module.exports = {
  getMonthlyReport,
};
