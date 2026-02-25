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
import { DataTable } from "@/components/data/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNotify } from "@/hooks/use-notify";
import { ApiClientError, clientApiFetch } from "@/lib/api-client";
import { onFinanceDataRefresh } from "@/lib/finance-events";
import { formatCurrency } from "@/lib/format";
import type { ApiEnvelope, CategorySummary, MonthlySummary } from "@/types/finance";

function initialDateContext() {
  const now = new Date();
  return {
    month: String(now.getUTCMonth() + 1).padStart(2, "0"),
    year: String(now.getUTCFullYear()),
  };
}

const monthLabelFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
});

function buildPeriodsEnding(count: number, month: number, year: number) {
  const periods: Array<{ month: number; year: number; label: string }> = [];

  for (let index = count - 1; index >= 0; index -= 1) {
    const date = new Date(Date.UTC(year, month - 1 - index, 1));
    periods.push({
      month: date.getUTCMonth() + 1,
      year: date.getUTCFullYear(),
      label: monthLabelFormatter.format(date),
    });
  }

  return periods;
}

function normalizeMonth(rawMonth: string) {
  const parsed = Number.parseInt(rawMonth, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) {
    return null;
  }
  return parsed;
}

function normalizeYear(rawYear: string) {
  const parsed = Number.parseInt(rawYear, 10);
  if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) {
    return null;
  }
  return parsed;
}

export default function DashboardReportsPage() {
  const notify = useNotify();

  const defaults = initialDateContext();
  const [month, setMonth] = useState(defaults.month);
  const [year, setYear] = useState(defaults.year);
  const [summary, setSummary] = useState<MonthlySummary | null>(null);
  const [monthlyTrendData, setMonthlyTrendData] = useState<MonthlyIncomeExpenseDatum[]>([]);
  const [cashflowTrendData, setCashflowTrendData] = useState<CashflowLineDatum[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadReport = useCallback(async () => {
    const monthNumber = normalizeMonth(month);
    const yearNumber = normalizeYear(year);

    if (!monthNumber || !yearNumber) {
      notify.error({ title: "Validation", description: "Use a valid MM/YYYY period." });
      return;
    }

    setIsLoading(true);

    try {
      const periods = buildPeriodsEnding(6, monthNumber, yearNumber);
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

      const selectedSummary = mapped[mapped.length - 1]?.summary || null;
      setSummary(selectedSummary);

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
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not load report";
      notify.error({ title: "Report failed", description: message });
      setSummary(null);
      setMonthlyTrendData([]);
      setCashflowTrendData([]);
    } finally {
      setIsLoading(false);
    }
  }, [month, year, notify]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  useEffect(() => {
    return onFinanceDataRefresh(() => {
      loadReport();
    });
  }, [loadReport]);

  const columns = useMemo(
    () => [
      {
        key: "category",
        header: "Category",
        render: (row: CategorySummary) => row.category,
      },
      {
        key: "income",
        header: "Income",
        render: (row: CategorySummary) => formatCurrency(row.total_income),
      },
      {
        key: "expense",
        header: "Expense",
        render: (row: CategorySummary) => formatCurrency(row.total_expense),
      },
      {
        key: "net",
        header: "Net",
        render: (row: CategorySummary) => formatCurrency(row.net_profit),
      },
      {
        key: "count",
        header: "Count",
        render: (row: CategorySummary) => row.transaction_count,
      },
    ],
    []
  );

  const categoryPieData = useMemo(() => {
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Monthly report</CardTitle>
          <CardDescription>
            Select period to get income, expense, net profit and category grouping.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault();
              loadReport();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="month">Month (MM)</Label>
              <Input
                id="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
                pattern="^(0[1-9]|1[0-2])$"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="year">Year (YYYY)</Label>
              <Input
                id="year"
                value={year}
                onChange={(event) => setYear(event.target.value)}
                pattern="^\\d{4}$"
                required
              />
            </div>

            <div className="flex items-end">
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Loading..." : "Run report"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Income</CardDescription>
            <CardTitle>{formatCurrency(summary?.total_income ?? 0)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Expense</CardDescription>
            <CardTitle>{formatCurrency(summary?.total_expense ?? 0)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Net Profit</CardDescription>
            <CardTitle>{formatCurrency(summary?.net_profit ?? 0)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Transactions</CardDescription>
            <CardTitle>{summary?.transaction_count ?? 0}</CardTitle>
          </CardHeader>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <MonthlyIncomeExpenseBarChart
          data={monthlyTrendData}
          description="Income and expense behavior ending on selected month."
        />
        <CategoryPieChart
          data={categoryPieData}
          description="Category distribution for selected month."
        />
      </section>

      <CashflowLineChart
        data={cashflowTrendData}
        description="Net cashflow trend ending on selected month."
      />

      <Card>
        <CardHeader>
          <CardTitle>By category</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={summary?.by_category ?? []}
            columns={columns}
            getRowId={(row, index) => `${row.category}-${index}`}
            emptyMessage="No category data for selected period."
          />
        </CardContent>
      </Card>
    </div>
  );
}
