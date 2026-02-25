const pool = require('../../../db/pool');

const LOOKBACK_DAYS = 90;
const DAYS_IN_MONTH = 30;
const STABLE_THRESHOLD_FLOOR = 250;
const MAX_NEGATIVE_ESTIMATE_DAYS = 365;

function toMoney(value) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Number(parsed.toFixed(2));
}

function assertOrganizationId(organizationId) {
  if (!organizationId || !String(organizationId).trim()) {
    throw new Error('organizationId is required');
  }
}

function getLookbackStart(now, lookbackDays = LOOKBACK_DAYS) {
  return new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
}

function getEndOfMonthUtc(now) {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() + 1,
      0,
      23,
      59,
      59,
      999
    )
  );
}

function getRemainingDays(now, target) {
  const msInDay = 24 * 60 * 60 * 1000;
  const diff = target.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / msInDay));
}

function getProjectedReceivables(pendingInvoices, horizonDays) {
  const ratio = Math.min(1, Math.max(0, horizonDays / DAYS_IN_MONTH));
  return toMoney(pendingInvoices * ratio);
}

function getMonthlyAverages(totals) {
  const lookbackMonths = LOOKBACK_DAYS / DAYS_IN_MONTH;
  const avgMonthlyIncome = toMoney(totals.income / lookbackMonths);
  const avgMonthlyExpenses = toMoney(totals.expenses / lookbackMonths);
  const avgMonthlyNet = toMoney(avgMonthlyIncome - avgMonthlyExpenses);

  return {
    avgMonthlyIncome,
    avgMonthlyExpenses,
    avgMonthlyNet,
  };
}

function getMonthlyRunRateNet(
  averageMonthlyNet,
  recurringIncomeMonthly,
  recurringExpenseMonthly
) {
  if (recurringIncomeMonthly === 0 && recurringExpenseMonthly === 0) {
    return averageMonthlyNet;
  }

  const recurringNet = recurringIncomeMonthly - recurringExpenseMonthly;
  return toMoney(averageMonthlyNet * 0.4 + recurringNet * 0.6);
}

function classifyTrend(monthlyRunRateNet, avgMonthlyExpenses) {
  const threshold = Math.max(STABLE_THRESHOLD_FLOOR, avgMonthlyExpenses * 0.05);

  if (monthlyRunRateNet > threshold) {
    return 'growing';
  }

  if (monthlyRunRateNet < -threshold) {
    return 'declining';
  }

  return 'stable';
}

function estimateNegativeBalanceDate(startBalance, monthlyRunRateNet, now) {
  if (startBalance < 0) {
    return now;
  }

  const dailyNet = monthlyRunRateNet / DAYS_IN_MONTH;
  if (dailyNet >= 0) {
    return null;
  }

  const daysUntilNegative = Math.ceil(startBalance / Math.abs(dailyNet));

  if (daysUntilNegative <= 0 || daysUntilNegative > MAX_NEGATIVE_ESTIMATE_DAYS) {
    return null;
  }

  return new Date(now.getTime() + daysUntilNegative * 24 * 60 * 60 * 1000);
}

async function fetchLookbackTotals(db, organizationId, lookbackStart) {
  const query = {
    text: `
      SELECT
        type,
        COALESCE(SUM(amount), 0) AS total
      FROM finance.transactions
      WHERE organization_id = $1
        AND transaction_date >= $2
        AND deleted_at IS NULL
      GROUP BY type
    `,
    values: [organizationId, lookbackStart],
  };

  const result = await db.query(query);

  return result.rows.reduce(
    (acc, row) => {
      if (row.type === 'income') {
        acc.income = toMoney(acc.income + toMoney(row.total));
      } else if (row.type === 'expense') {
        acc.expenses = toMoney(acc.expenses + toMoney(row.total));
      }
      return acc;
    },
    { income: 0, expenses: 0 }
  );
}

async function fetchCurrentBalance(db, organizationId) {
  const query = {
    text: `
      SELECT
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0) AS current_balance
      FROM finance.transactions
      WHERE organization_id = $1
        AND deleted_at IS NULL
    `,
    values: [organizationId],
  };

  const result = await db.query(query);
  const row = result.rows[0];
  return toMoney(row?.current_balance ?? 0);
}

async function fetchPendingInvoicesTotal(db, organizationId) {
  const query = {
    text: `
      SELECT
        COALESCE(SUM(total), 0) AS pending_total
      FROM finance.invoices
      WHERE organization_id = $1
        AND status = 'pending'
    `,
    values: [organizationId],
  };

  const result = await db.query(query);
  return toMoney(result.rows[0]?.pending_total ?? 0);
}

async function fetchRecurringMonthlyTotals(db, organizationId, lookbackStart) {
  const query = {
    text: `
      WITH recurring_candidates AS (
        SELECT
          type,
          category,
          COALESCE(entity, '') AS entity,
          COALESCE(NULLIF(BTRIM(description), ''), '') AS description,
          COUNT(*)::int AS occurrences,
          COUNT(DISTINCT date_trunc('month', transaction_date))::int AS active_months,
          AVG(amount) AS avg_amount
        FROM finance.transactions
        WHERE organization_id = $1
          AND transaction_date >= $2
          AND deleted_at IS NULL
        GROUP BY
          type,
          category,
          COALESCE(entity, ''),
          COALESCE(NULLIF(BTRIM(description), ''), '')
        HAVING COUNT(*) >= 2
          AND COUNT(DISTINCT date_trunc('month', transaction_date)) >= 2
      )
      SELECT
        type,
        COALESCE(
          SUM(avg_amount * (occurrences::numeric / NULLIF(active_months::numeric, 0))),
          0
        ) AS monthly_total
      FROM recurring_candidates
      GROUP BY type
    `,
    values: [organizationId, lookbackStart],
  };

  const result = await db.query(query);

  let recurringIncomeMonthly = 0;
  let recurringExpenseMonthly = 0;

  for (const row of result.rows) {
    if (row.type === 'income') {
      recurringIncomeMonthly = toMoney(row.monthly_total);
    }

    if (row.type === 'expense') {
      recurringExpenseMonthly = toMoney(row.monthly_total);
    }
  }

  return { recurringIncomeMonthly, recurringExpenseMonthly };
}

async function calculateCashflowProjection(organizationId, dependencies = {}) {
  assertOrganizationId(organizationId);

  const db = dependencies.db ?? pool;
  const now = dependencies.now ? dependencies.now() : new Date();
  const lookbackStart = getLookbackStart(now);

  const [lookbackTotals, currentBalance, pendingInvoicesTotal, recurringTotals] =
    await Promise.all([
      fetchLookbackTotals(db, organizationId, lookbackStart),
      fetchCurrentBalance(db, organizationId),
      fetchPendingInvoicesTotal(db, organizationId),
      fetchRecurringMonthlyTotals(db, organizationId, lookbackStart),
    ]);

  const monthlyAverages = getMonthlyAverages(lookbackTotals);
  const monthlyRunRateNet = getMonthlyRunRateNet(
    monthlyAverages.avgMonthlyNet,
    recurringTotals.recurringIncomeMonthly,
    recurringTotals.recurringExpenseMonthly
  );

  const endOfMonth = getEndOfMonthUtc(now);
  const remainingDaysToMonthEnd = getRemainingDays(now, endOfMonth);
  const projectedReceivables30 = getProjectedReceivables(pendingInvoicesTotal, 30);
  const projectedReceivablesEndMonth = getProjectedReceivables(
    pendingInvoicesTotal,
    remainingDaysToMonthEnd
  );

  const projected30Days = toMoney(
    currentBalance + monthlyRunRateNet + projectedReceivables30
  );
  const projectedEndMonth = toMoney(
    currentBalance +
      (monthlyRunRateNet / DAYS_IN_MONTH) * remainingDaysToMonthEnd +
      projectedReceivablesEndMonth
  );

  const trend = classifyTrend(monthlyRunRateNet, monthlyAverages.avgMonthlyExpenses);
  const estimatedNegativeDate = estimateNegativeBalanceDate(
    currentBalance + projectedReceivables30,
    monthlyRunRateNet,
    now
  );

  return {
    current_balance: currentBalance,
    avg_monthly_income: monthlyAverages.avgMonthlyIncome,
    avg_monthly_expenses: monthlyAverages.avgMonthlyExpenses,
    projected_30_days: projected30Days,
    projected_end_month: projectedEndMonth,
    estimated_negative_date: estimatedNegativeDate,
    trend,
  };
}

module.exports = {
  calculateCashflowProjection,
};
