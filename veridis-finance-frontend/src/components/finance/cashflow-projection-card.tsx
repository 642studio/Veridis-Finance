"use client";

import { useMemo } from "react";
import { AlertTriangle, Minus, TrendingDown, TrendingUp } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import type { CashflowProjection, CashflowTrend } from "@/types/finance";

interface CashflowProjectionCardProps {
  projection: CashflowProjection | null;
  isLoading?: boolean;
}

interface ProjectionPoint {
  day: number;
  label: string;
  projected_balance: number;
}

function toLabelDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toLocaleDateString("es-MX", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function buildProjectionCurve(
  currentBalance: number,
  projectedThirtyDays: number,
  trend: CashflowTrend
): ProjectionPoint[] {
  const totalDelta = projectedThirtyDays - currentBalance;

  return Array.from({ length: 31 }, (_, day) => {
    const progress = day / 30;
    const easedProgress =
      trend === "growing"
        ? Math.pow(progress, 0.9)
        : trend === "declining"
          ? Math.pow(progress, 1.1)
          : progress;

    const projectedBalance = currentBalance + totalDelta * easedProgress;

    return {
      day,
      label: `D${day}`,
      projected_balance: Number(projectedBalance.toFixed(2)),
    };
  });
}

function trendMeta(trend: CashflowTrend): {
  label: string;
  icon: typeof TrendingUp;
  badgeClassName: string;
  lineColor: string;
} {
  if (trend === "growing") {
    return {
      label: "Growing",
      icon: TrendingUp,
      badgeClassName: "border-emerald-400/40 bg-emerald-500/20 text-emerald-200",
      lineColor: "#34d399",
    };
  }

  if (trend === "declining") {
    return {
      label: "Declining",
      icon: TrendingDown,
      badgeClassName: "border-rose-400/40 bg-rose-500/20 text-rose-200",
      lineColor: "#fb7185",
    };
  }

  return {
    label: "Stable",
    icon: Minus,
    badgeClassName: "border-amber-300/40 bg-amber-500/20 text-amber-100",
    lineColor: "#facc15",
  };
}

function StatBlock({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: "positive" | "negative";
}) {
  const valueClassName =
    emphasize === "positive"
      ? "text-emerald-200"
      : emphasize === "negative"
        ? "text-rose-200"
        : "text-slate-100";

  return (
    <div className="rounded-xl border border-slate-800/70 bg-slate-950/50 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-2 text-lg font-semibold ${valueClassName}`}>{value}</p>
    </div>
  );
}

export function CashflowProjectionCard({
  projection,
  isLoading = false,
}: CashflowProjectionCardProps) {
  const safeProjection: CashflowProjection = projection ?? {
    current_balance: 0,
    avg_monthly_income: 0,
    avg_monthly_expenses: 0,
    projected_30_days: 0,
    projected_end_month: 0,
    estimated_negative_date: null,
    trend: "stable",
  };

  const trend = trendMeta(safeProjection.trend);
  const TrendIcon = trend.icon;
  const negativeDateLabel = toLabelDate(safeProjection.estimated_negative_date);
  const chartData = useMemo(
    () =>
      buildProjectionCurve(
        safeProjection.current_balance,
        safeProjection.projected_30_days,
        safeProjection.trend
      ),
    [
      safeProjection.current_balance,
      safeProjection.projected_30_days,
      safeProjection.trend,
    ]
  );

  return (
    <Card className="border-slate-800/90 bg-slate-950/70 text-slate-100">
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-slate-100">Cashflow Projection</CardTitle>
            <CardDescription className="text-slate-400">
              Rule-based forecast based on recent transactions and pending invoices.
            </CardDescription>
          </div>
          <Badge variant="outline" className={trend.badgeClassName}>
            <TrendIcon className="mr-1.5 h-3.5 w-3.5" />
            {trend.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-3">
          <StatBlock
            label="Current Balance"
            value={isLoading ? "..." : formatCurrency(safeProjection.current_balance)}
          />
          <StatBlock
            label="Projected 30 Days"
            value={isLoading ? "..." : formatCurrency(safeProjection.projected_30_days)}
            emphasize={
              safeProjection.projected_30_days >= safeProjection.current_balance
                ? "positive"
                : "negative"
            }
          />
          <StatBlock
            label="Projected End Of Month"
            value={isLoading ? "..." : formatCurrency(safeProjection.projected_end_month)}
            emphasize={safeProjection.projected_end_month >= 0 ? "positive" : "negative"}
          />
        </div>

        {negativeDateLabel ? (
          <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-amber-100">
            <p className="flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Estimated negative balance date: <strong>{negativeDateLabel}</strong>
            </p>
          </div>
        ) : null}

        <div className="h-64 rounded-xl border border-slate-800/80 bg-slate-950/50 p-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
              <CartesianGrid
                stroke="rgba(148, 163, 184, 0.18)"
                strokeDasharray="3 3"
                vertical={false}
              />
              <XAxis
                dataKey="label"
                interval={4}
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                axisLine={{ stroke: "rgba(148, 163, 184, 0.3)" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                tickFormatter={(value) =>
                  new Intl.NumberFormat("es-MX", {
                    style: "currency",
                    currency: "MXN",
                    notation: "compact",
                    maximumFractionDigits: 1,
                  }).format(Number(value))
                }
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: "rgba(15, 23, 42, 0.96)",
                  border: "1px solid rgba(71, 85, 105, 0.72)",
                  borderRadius: "12px",
                  color: "#e2e8f0",
                }}
                formatter={(value) => [formatCurrency(Number(value)), "Projected Balance"]}
                labelFormatter={(label) => `Day ${String(label).replace("D", "")}`}
              />
              <Line
                type="monotone"
                dataKey="projected_balance"
                stroke={trend.lineColor}
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
