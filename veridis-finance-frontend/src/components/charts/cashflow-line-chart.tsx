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
import {
  chartTheme,
  legendWrapperStyle,
  tooltipContentStyle,
  tooltipLabelStyle,
} from "./chart-theme";

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
  title = "Flujo de efectivo",
  description = "Ingresos, gastos y resultado neto.",
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
          No hay datos
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
            contentStyle={tooltipContentStyle}
            labelStyle={tooltipLabelStyle}
            formatter={(value, name, item) => {
              const dataKey = String(
                (item as { dataKey?: string } | undefined)?.dataKey || name || ""
              ).toLowerCase();
              const label = dataKey.includes("net")
                ? "Utilidad neta"
                : dataKey.includes("income")
                  ? "Ingresos"
                  : "Gastos";
              return [formatCurrency(Number(value)), label];
            }}
          />
          <Legend wrapperStyle={legendWrapperStyle} />
          <Line
            type="monotone"
            dataKey="income"
            name="Ingresos"
            stroke={chartTheme.income}
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="expense"
            name="Gastos"
            stroke={chartTheme.expense}
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="net"
            name="Neto"
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
