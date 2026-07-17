"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { formatCurrency } from "@/lib/format";

import { ChartShell } from "./chart-shell";
import { chartTheme, legendWrapperStyle, tooltipContentStyle, tooltipLabelStyle } from "./chart-theme";

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
  title = "Distribución por categoría",
  description = "Asignación del movimiento total.",
}: CategoryPieChartProps) {
  const hasData = data.some((item) => Math.abs(Number(item.value || 0)) > 0);

  if (!hasData) {
    return (
      <ChartShell title={title} description={description}>
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          No hay datos
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
            stroke="hsl(var(--card))"
            strokeWidth={2}
            paddingAngle={2}
          >
            {data.map((entry, index) => (
              <Cell
                key={`${entry.label}-${index}`}
                fill={chartTheme.categoryPalette[index % chartTheme.categoryPalette.length]}
              />
            ))}
          </Pie>
          <Tooltip
            contentStyle={tooltipContentStyle}
            labelStyle={tooltipLabelStyle}
            formatter={(value) => formatCurrency(Number(value))}
          />
          <Legend
            layout="horizontal"
            verticalAlign="bottom"
            align="center"
            iconType="circle"
            wrapperStyle={{ ...legendWrapperStyle, paddingTop: "12px" }}
          />
        </PieChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
