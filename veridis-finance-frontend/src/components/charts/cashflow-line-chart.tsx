"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatCurrency } from "@/lib/format";

import { ChartShell } from "./chart-shell";
import { chartTheme } from "./chart-theme";

export interface CashflowLineDatum {
  label: string;
  income: number;
  expense: number;
  net: number;
}

interface CashflowLineChartProps {
  data: CashflowLineDatum[];
  title?: string;
  description?: string;
}

const compactFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function CashflowLineChart({
  data,
  title = "Cashflow Trend",
  description = "Cashflow trend for income, expense and net result.",
}: CashflowLineChartProps) {
  const hasData = data.some(
    (item) =>
      Math.abs(Number(item.income || 0)) +
        Math.abs(Number(item.expense || 0)) +
        Math.abs(Number(item.net || 0)) >
      0
  );

  if (!hasData) {
    return (
      <ChartShell title={title} description={description} contentClassName="h-96">
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          No data available
        </div>
      </ChartShell>
    );
  }

  return (
    <ChartShell title={title} description={description} contentClassName="h-96">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
          <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: chartTheme.axis, fontSize: 12 }}
            axisLine={{ stroke: chartTheme.grid }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(value) => compactFormatter.format(Number(value))}
            tick={{ fill: chartTheme.axis, fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              background: chartTheme.tooltipBackground,
              border: `1px solid ${chartTheme.tooltipBorder}`,
              borderRadius: "12px",
              color: "#e2e8f0",
            }}
            formatter={(value, name, item) => {
              const dataKey = String(
                (item as { dataKey?: string } | undefined)?.dataKey || name || ""
              ).toLowerCase();

              const label = dataKey.includes("net")
                ? "Net Profit"
                : dataKey.includes("income")
                  ? "Income"
                  : "Expense";

              return [formatCurrency(Number(value)), label];
            }}
            labelStyle={{ color: "#cbd5e1", fontWeight: 600 }}
          />
          <Legend wrapperStyle={{ color: "#cbd5e1", fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey="income"
            name="Income"
            stroke={chartTheme.income}
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="expense"
            name="Expense"
            stroke={chartTheme.expense}
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="net"
            name="Net"
            stroke={chartTheme.net}
            strokeWidth={3}
            dot={{ r: 2.5, fill: chartTheme.net, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
