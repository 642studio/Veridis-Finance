"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  CashflowLineChart,
  type CashflowLineDatum,
} from "@/components/charts/cashflow-line-chart";
import { CategoryPieChart } from "@/components/charts/category-pie-chart";
import {
  MonthlyIncomeExpenseBarChart,
  type MonthlyIncomeExpenseDatum,
} from "@/components/charts/monthly-income-expense-bar-chart";
import { CashflowProjectionCard } from "@/components/finance/cashflow-projection-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { clientApiFetch } from "@/lib/api-client";
import { onFinanceDataRefresh } from "@/lib/finance-events";
import { formatCurrency } from "@/lib/format";
import type { ApiEnvelope, CashflowProjection, MonthlySummary } from "@/types/finance";

function currentMonthContext() {
  const now = new Date();
  return {
    month: now.getUTCMonth() + 1,
    year: now.getUTCFullYear(),
  };
}

const monthLabelFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
});

function buildRecentPeriods(count: number, endMonth: number, endYear: number) {
  const periods: Array<{ month: number; year: number; label: string }> = [];

  for (let index = count - 1; index >= 0; index -= 1) {
    const date = new Date(Date.UTC(endYear, endMonth - 1 - index, 1));
    periods.push({
      month: date.getUTCMonth() + 1,
      year: date.getUTCFullYear(),
      label: monthLabelFormatter.format(date),
    });
  }

  return periods;
}

export default function DashboardOverviewPage() {
  const [{ month, year }] = useState(currentMonthContext);
  const [summary, setSummary] = useState<MonthlySummary | null>(null);
  const [projection, setProjection] = useState<CashflowProjection | null>(null);
  const [monthlyTrendData, setMonthlyTrendData] = useState<MonthlyIncomeExpenseDatum[]>([]);
  const [cashflowTrendData, setCashflowTrendData] = useState<CashflowLineDatum[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isProjectionLoading, setIsProjectionLoading] = useState(true);
  const [isTrendLoading, setIsTrendLoading] = useState(true);

  const loadSummary = useCallback(async () => {
    setIsLoading(true);
    setIsTrendLoading(true);

    try {
      const periods = buildRecentPeriods(6, month, year);
      const responses = await Promise.all(
        periods.map((period) =>
          clientApiFetch<ApiEnvelope<MonthlySummary>>(
            `/api/finance/reports/month?month=${period.month}&year=${period.year}`
          )
        )
      );

      const mapped = responses.map((response, index) => {
        const period = periods[index];
        return {
          period,
          summary: response.data,
        };
      });

      const current = mapped[mapped.length - 1]?.summary || null;
      setSummary(current);

      setMonthlyTrendData(
        mapped.map(({ period, summary: monthlySummary }) => ({
          label: `${period.label} ${String(period.year).slice(-2)}`,
          income: Number(monthlySummary.total_income || 0),
          expense: Number(monthlySummary.total_expense || 0),
        }))
      );

      setCashflowTrendData(
        mapped.map(({ period, summary: monthlySummary }) => ({
          label: `${period.label} ${String(period.year).slice(-2)}`,
          income: Number(monthlySummary.total_income || 0),
          expense: Number(monthlySummary.total_expense || 0),
          net: Number(monthlySummary.net_profit || 0),
        }))
      );
    } catch {
      setSummary(null);
      setMonthlyTrendData([]);
      setCashflowTrendData([]);
    } finally {
      setIsLoading(false);
      setIsTrendLoading(false);
    }
  }, [month, year]);

  const loadProjection = useCallback(async () => {
    setIsProjectionLoading(true);
    try {
      const response = await clientApiFetch<ApiEnvelope<CashflowProjection>>(
        "/api/finance/intelligence/projection"
      );
      setProjection(response.data);
    } catch {
      setProjection(null);
    } finally {
      setIsProjectionLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSummary();
    loadProjection();
  }, [loadProjection, loadSummary]);

  useEffect(() => {
    return onFinanceDataRefresh(() => {
      loadSummary();
      loadProjection();
    });
  }, [loadProjection, loadSummary]);

  const categoryChartData = useMemo(() => {
    if (!summary?.by_category?.length) {
      return [];
    }

    return summary.by_category
      .map((item) => ({
        label: item.category,
        value: Math.abs(Number(item.total_income || 0)) + Math.abs(Number(item.total_expense || 0)),
      }))
      .filter((item) => item.value > 0);
  }, [summary?.by_category]);

  const hasTransactions = (summary?.transaction_count || 0) > 0;

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Income</CardDescription>
            <CardTitle className="text-2xl">
              {isLoading ? "..." : formatCurrency(summary?.total_income ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Expense</CardDescription>
            <CardTitle className="text-2xl text-red-600">
              {isLoading ? "..." : formatCurrency(summary?.total_expense ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Net Profit</CardDescription>
            <CardTitle className="text-2xl text-emerald-700">
              {isLoading ? "..." : formatCurrency(summary?.net_profit ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Transactions</CardDescription>
            <CardTitle className="text-2xl">
              {isLoading ? "..." : summary?.transaction_count ?? 0}
            </CardTitle>
          </CardHeader>
        </Card>
      </section>

      {isTrendLoading ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            Loading chart data...
          </CardContent>
        </Card>
      ) : (
        <>
          <section className="grid gap-6 lg:grid-cols-2">
            <MonthlyIncomeExpenseBarChart
              data={monthlyTrendData}
              description="Income and expense behavior for the last 6 months."
            />
            <CategoryPieChart
              data={categoryChartData}
              description="Current month category distribution."
            />
          </section>

          <CashflowLineChart
            data={cashflowTrendData}
            description="Net cashflow trajectory for the last 6 months."
          />
        </>
      )}

      <CashflowProjectionCard projection={projection} isLoading={isProjectionLoading} />

      <Card>
        <CardHeader>
          <CardTitle>Month Snapshot</CardTitle>
          <CardDescription>
            Current reporting period: {month.toString().padStart(2, "0")}/{year}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {hasTransactions
              ? "This overview is powered by live backend data. Use Reports for deeper category and history analysis."
              : "No data available for this period yet. Add or import transactions to populate charts and KPIs."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
