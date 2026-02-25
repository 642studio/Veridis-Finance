"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { formatCurrency } from "@/lib/format";

import { ChartShell } from "./chart-shell";
import { chartTheme } from "./chart-theme";

export interface CategoryPieDatum {
  label: string;
  value: number;
}

interface CategoryPieChartProps {
  data: CategoryPieDatum[];
  title?: string;
  description?: string;
}

export function CategoryPieChart({
  data,
  title = "Category Distribution",
  description = "Category allocation of total movement.",
}: CategoryPieChartProps) {
  const hasData = data.some((item) => Math.abs(Number(item.value || 0)) > 0);

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
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius={62}
            outerRadius={104}
            stroke="transparent"
            paddingAngle={3}
          >
            {data.map((entry, index) => (
              <Cell
                key={`${entry.label}-${index}`}
                fill={chartTheme.categoryPalette[index % chartTheme.categoryPalette.length]}
              />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: chartTheme.tooltipBackground,
              border: `1px solid ${chartTheme.tooltipBorder}`,
              borderRadius: "12px",
              color: "#e2e8f0",
            }}
            formatter={(value) => formatCurrency(Number(value))}
            labelStyle={{ color: "#cbd5e1", fontWeight: 600 }}
          />
          <Legend
            layout="horizontal"
            verticalAlign="bottom"
            align="center"
            iconType="circle"
            wrapperStyle={{ color: "#cbd5e1", fontSize: 12, paddingTop: "12px" }}
          />
        </PieChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
