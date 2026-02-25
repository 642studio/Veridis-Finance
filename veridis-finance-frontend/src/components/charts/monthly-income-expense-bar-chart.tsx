"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatCurrency } from "@/lib/format";

import { ChartShell } from "./chart-shell";
import { chartTheme } from "./chart-theme";

export interface MonthlyIncomeExpenseDatum {
  label: string;
  income: number;
  expense: number;
}

interface MonthlyIncomeExpenseBarChartProps {
  data: MonthlyIncomeExpenseDatum[];
  title?: string;
  description?: string;
}

const compactFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function MonthlyIncomeExpenseBarChart({
  data,
  title = "Monthly Income vs Expense",
  description = "Monthly performance across recent periods.",
}: MonthlyIncomeExpenseBarChartProps) {
  const hasData = data.some(
    (item) => Math.abs(Number(item.income || 0)) + Math.abs(Number(item.expense || 0)) > 0
  );

  if (!hasData) {
    return (
      <ChartShell title={title} description={description}>
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          No data available
        </div>
      </ChartShell>
    );
  }

  return (
    <ChartShell title={title} description={description}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
          <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: chartTheme.axis, fontSize: 12 }}
            axisLine={{ stroke: chartTheme.grid }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: chartTheme.axis, fontSize: 12 }}
            tickFormatter={(value) => compactFormatter.format(Number(value))}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "rgba(148, 163, 184, 0.08)" }}
            contentStyle={{
              background: chartTheme.tooltipBackground,
              border: `1px solid ${chartTheme.tooltipBorder}`,
              borderRadius: "12px",
              color: "#e2e8f0",
            }}
            formatter={(value, name) => [
              formatCurrency(Number(value)),
              name === "income" ? "Income" : "Expense",
            ]}
            labelStyle={{ color: "#cbd5e1", fontWeight: 600 }}
          />
          <Legend wrapperStyle={{ color: "#cbd5e1", fontSize: 12 }} />
          <Bar
            dataKey="income"
            name="Income"
            fill={chartTheme.income}
            radius={[8, 8, 0, 0]}
            maxBarSize={28}
          />
          <Bar
            dataKey="expense"
            name="Expense"
            fill={chartTheme.expense}
            radius={[8, 8, 0, 0]}
            maxBarSize={28}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
