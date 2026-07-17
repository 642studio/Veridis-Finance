// Theme-aware chart palette. Colors reference CSS custom properties so the
// charts follow the light/dark tokens defined in globals.css (SVG fill/stroke
// resolve `hsl(var(--x))` at paint time).
const v = (name: string) => `hsl(var(--${name}))`;

export const chartTheme = {
  axis: v("chart-axis"),
  grid: v("chart-grid"),
  tooltipBackground: v("card"),
  tooltipBorder: v("border"),
  tooltipText: v("foreground"),
  legendText: v("muted-foreground"),
  cursor: "hsl(var(--accent) / 0.6)",
  income: v("chart-income"),
  expense: v("chart-expense"),
  net: v("chart-net"),
  categoryPalette: [
    v("chart-1"),
    v("chart-2"),
    v("chart-3"),
    v("chart-4"),
    v("chart-5"),
    v("chart-6"),
    v("chart-7"),
    v("chart-8"),
  ],
} as const;

// Shared tooltip style so all charts match the surface tokens.
export const tooltipContentStyle = {
  background: chartTheme.tooltipBackground,
  border: `1px solid ${chartTheme.tooltipBorder}`,
  borderRadius: "12px",
  color: chartTheme.tooltipText,
  boxShadow: "0 8px 24px -18px rgba(0,0,0,.35)",
  fontSize: "13px",
} as const;

export const tooltipLabelStyle = {
  color: chartTheme.tooltipText,
  fontWeight: 600,
} as const;

export const legendWrapperStyle = {
  color: chartTheme.legendText,
  fontSize: 12,
} as const;
