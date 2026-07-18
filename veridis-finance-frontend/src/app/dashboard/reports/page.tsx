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

const monthLabelFormatter = new Intl.DateTimeFormat("es-MX", {
  month: "short",
});

interface DiotSupplier {
  rfc: string;
  name: string;
  invoice_count: number;
  base_total: number;
  iva_trasladado: number;
  iva_retenido: number;
  total: number;
}

interface DiotReport {
  year: number;
  month: number;
  suppliers: DiotSupplier[];
  unclassified_count: number;
}

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
  const [diot, setDiot] = useState<DiotReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadReport = useCallback(async () => {
    const monthNumber = normalizeMonth(month);
    const yearNumber = normalizeYear(year);

    if (!monthNumber || !yearNumber) {
      notify.error({ title: "Validación", description: "Usa un periodo MM/AAAA válido." });
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
      // DIOT (IVA por proveedor) — best-effort: si falla, el resto del reporte vive.
      try {
        const diotResponse = await clientApiFetch<ApiEnvelope<DiotReport>>(
          `/api/finance/reports/diot?month=${String(monthNumber).padStart(2, "0")}&year=${yearNumber}`
        );
        setDiot(diotResponse.data);
      } catch {
        setDiot(null);
      }
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "No se pudo cargar el reporte";
      notify.error({ title: "Error en el reporte", description: message });
      setSummary(null);
      setMonthlyTrendData([]);
      setCashflowTrendData([]);
      setDiot(null);
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
        header: "Categoría",
        render: (row: CategorySummary) => row.category,
      },
      {
        key: "income",
        header: "Ingresos",
        render: (row: CategorySummary) => formatCurrency(row.total_income),
      },
      {
        key: "expense",
        header: "Egresos",
        render: (row: CategorySummary) => formatCurrency(row.total_expense),
      },
      {
        key: "net",
        header: "Neto",
        render: (row: CategorySummary) => formatCurrency(row.net_profit),
      },
      {
        key: "count",
        header: "Movimientos",
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
          <CardTitle>Reporte mensual</CardTitle>
          <CardDescription>
            Elige el periodo para ver ingresos, egresos, utilidad neta y desglose por categoría.
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
              <Label htmlFor="month">Mes (MM)</Label>
              <Input
                id="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
                pattern="^(0[1-9]|1[0-2])$"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="year">Año (AAAA)</Label>
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
                {isLoading ? "Cargando…" : "Generar reporte"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Ingresos totales</CardDescription>
            <CardTitle>{formatCurrency(summary?.total_income ?? 0)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Egresos totales</CardDescription>
            <CardTitle>{formatCurrency(summary?.total_expense ?? 0)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Utilidad neta</CardDescription>
            <CardTitle>{formatCurrency(summary?.net_profit ?? 0)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Movimientos</CardDescription>
            <CardTitle>{summary?.transaction_count ?? 0}</CardTitle>
          </CardHeader>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <MonthlyIncomeExpenseBarChart
          data={monthlyTrendData}
          description="Comportamiento de ingresos y egresos al mes seleccionado."
        />
        <CategoryPieChart
          data={categoryPieData}
          description="Distribución por categoría del mes seleccionado."
        />
      </section>

      <CashflowLineChart
        data={cashflowTrendData}
        description="Tendencia de flujo neto al mes seleccionado."
      />

      <Card>
        <CardHeader>
          <CardTitle>Por categoría</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={summary?.by_category ?? []}
            columns={columns}
            getRowId={(row, index) => `${row.category}-${index}`}
            emptyMessage="Sin datos por categoría en el periodo seleccionado."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>IVA por proveedor (base DIOT)</CardTitle>
            <CardDescription>
              Calculado desde los CFDI recibidos del mes seleccionado (subidos o del SAT).
              {diot && diot.unclassified_count > 0
                ? ` ${diot.unclassified_count} factura(s) sin datos fiscales estructurados — vuelve a subir su XML para incluirlas.`
                : ""}
            </CardDescription>
          </div>
          <a
            href={`/api/finance/report/diot/batch?month=${String(normalizeMonth(month) || 1).padStart(2, "0")}&year=${normalizeYear(year) || new Date().getFullYear()}`}
            download
            className="inline-flex h-10 items-center rounded-xl border border-border bg-card px-4 text-sm font-medium hover:bg-muted"
          >
            Descargar DIOT (.txt)
          </a>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={diot?.suppliers ?? []}
            columns={[
              {
                key: "rfc",
                header: "RFC proveedor",
                render: (row: DiotSupplier) => (
                  <span className="font-mono text-xs">{row.rfc}</span>
                ),
              },
              {
                key: "name",
                header: "Proveedor",
                render: (row: DiotSupplier) => row.name,
              },
              {
                key: "invoices",
                header: "Facturas",
                render: (row: DiotSupplier) => row.invoice_count,
              },
              {
                key: "base",
                header: "Base",
                render: (row: DiotSupplier) => formatCurrency(row.base_total),
              },
              {
                key: "iva",
                header: "IVA trasladado",
                render: (row: DiotSupplier) => formatCurrency(row.iva_trasladado),
              },
              {
                key: "ret",
                header: "IVA retenido",
                render: (row: DiotSupplier) => formatCurrency(row.iva_retenido),
              },
              {
                key: "total",
                header: "Total",
                render: (row: DiotSupplier) => formatCurrency(row.total),
              },
            ]}
            getRowId={(row) => row.rfc}
            emptyMessage="Sin CFDI recibidos con datos fiscales en el periodo."
          />
        </CardContent>
      </Card>
    </div>
  );
}
