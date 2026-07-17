"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  Plug,
  Receipt,
  Rocket,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";

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
import { OnboardingChecklist } from "@/components/finance/onboarding-checklist";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNotify } from "@/hooks/use-notify";
import { clientApiFetch } from "@/lib/api-client";
import { onFinanceDataRefresh } from "@/lib/finance-events";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  ApiEnvelope,
  CashflowProjection,
  Invoice,
  MonthlySummary,
  RecurringAlertsPayload,
  RecurringRule,
  RecurringTransactionCandidate,
  Transaction,
} from "@/types/finance";

function currentMonthContext() {
  const now = new Date();
  return { month: now.getUTCMonth() + 1, year: now.getUTCFullYear() };
}

const monthLabelFormatter = new Intl.DateTimeFormat("es-MX", { month: "short" });

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

function periodKey(month: number, year: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------

function KpiCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  hint,
  loading,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: "neutral" | "up" | "down" | "brand";
  hint?: string;
  loading?: boolean;
}) {
  const iconWrap = {
    neutral: "bg-muted text-muted-foreground",
    up: "bg-emerald-100 text-emerald-700",
    down: "bg-red-100 text-red-700",
    brand: "bg-primary/10 text-primary",
  }[tone];

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <span className={cn("grid h-9 w-9 place-items-center rounded-lg", iconWrap)}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight tnum text-foreground">
        {loading ? "—" : value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const LAUNCHPAD_STEPS: Array<{
  n: string;
  title: string;
  body: string;
  cta: string;
  href: string;
}> = [
  {
    n: "Paso 1",
    title: "Registra tu primer cliente",
    body: "Da de alta un cliente con sus datos fiscales para empezar a facturar.",
    cta: "Ir a clientes",
    href: "/dashboard/clients",
  },
  {
    n: "Paso 2",
    title: "Conecta el 642 CRM",
    body: "Sincroniza facturas y contactos, y timbra al cobrar automáticamente.",
    cta: "Conectar CRM",
    href: "/dashboard/cfdi",
  },
  {
    n: "Paso 3",
    title: "Emite tu primer CFDI",
    body: "Sube la Constancia del cliente y genera un CFDI 4.0 en segundos.",
    cta: "Ir a CFDI",
    href: "/dashboard/cfdi",
  },
];

function Launchpad({ onDismiss }: { onDismiss: () => void }) {
  return (
    <Card className="relative overflow-hidden">
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Ocultar launchpad"
        className="absolute right-4 top-4 grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
      <CardHeader>
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
          <Rocket className="h-3.5 w-3.5" />
          Launchpad
        </div>
        <CardTitle className="text-xl">Activa Veridis en 10 minutos</CardTitle>
        <CardDescription>
          Completa estos pasos para dejar de ver paneles vacíos y empezar a operar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-3">
          {LAUNCHPAD_STEPS.map((step) => (
            <div key={step.n} className="rounded-xl border border-border bg-muted/40 p-4">
              <p className="text-xs font-semibold text-primary">{step.n}</p>
              <p className="mt-1 font-semibold text-foreground">{step.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
              <Link
                href={step.href}
                className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
              >
                {step.cta}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

export default function DashboardOverviewPage() {
  const notify = useNotify();
  const [selectedPeriod, setSelectedPeriod] = useState(currentMonthContext);
  const [activePeriod, setActivePeriod] = useState(currentMonthContext);
  const [summary, setSummary] = useState<MonthlySummary | null>(null);
  const [projection, setProjection] = useState<CashflowProjection | null>(null);
  const [recurringCandidates, setRecurringCandidates] = useState<
    RecurringTransactionCandidate[]
  >([]);
  const [recurringAlerts, setRecurringAlerts] = useState<RecurringAlertsPayload | null>(null);
  const [suppressedRules, setSuppressedRules] = useState<RecurringRule[]>([]);
  const [monthlyTrendData, setMonthlyTrendData] = useState<MonthlyIncomeExpenseDatum[]>([]);
  const [cashflowTrendData, setCashflowTrendData] = useState<CashflowLineDatum[]>([]);
  const [receivable, setReceivable] = useState<{ amount: number; count: number } | null>(null);
  const [topClients, setTopClients] = useState<Array<{ name: string; total: number }>>([]);
  const [showLaunchpad, setShowLaunchpad] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isProjectionLoading, setIsProjectionLoading] = useState(true);
  const [isRecurringLoading, setIsRecurringLoading] = useState(true);
  const [isRecurringAlertsLoading, setIsRecurringAlertsLoading] = useState(true);
  const [isSuppressedRulesLoading, setIsSuppressedRulesLoading] = useState(true);
  const [updatingCandidateKey, setUpdatingCandidateKey] = useState<string | null>(null);
  const [unsuppressingRuleId, setUnsuppressingRuleId] = useState<string | null>(null);
  const [isTrendLoading, setIsTrendLoading] = useState(true);

  useEffect(() => {
    setShowLaunchpad(localStorage.getItem("vf_launchpad_dismissed") !== "1");
  }, []);

  const loadSummary = useCallback(async () => {
    setIsLoading(true);
    setIsTrendLoading(true);
    try {
      const fetchedPeriods = buildRecentPeriods(18, selectedPeriod.month, selectedPeriod.year);
      const responses = await Promise.all(
        fetchedPeriods.map((period) =>
          clientApiFetch<ApiEnvelope<MonthlySummary>>(
            `/api/finance/reports/month?month=${period.month}&year=${period.year}`
          )
        )
      );

      const summaryByPeriod = new Map<string, MonthlySummary>();
      responses.forEach((response, index) => {
        const period = fetchedPeriods[index];
        summaryByPeriod.set(periodKey(period.month, period.year), response.data);
      });

      const selectedSummary =
        summaryByPeriod.get(periodKey(selectedPeriod.month, selectedPeriod.year)) || null;

      const fallbackPeriod = [...fetchedPeriods].reverse().find((period) => {
        const item = summaryByPeriod.get(periodKey(period.month, period.year));
        return Boolean(item && Number(item.transaction_count || 0) > 0);
      });

      const effectivePeriod =
        selectedSummary && Number(selectedSummary.transaction_count || 0) > 0
          ? { month: selectedPeriod.month, year: selectedPeriod.year }
          : fallbackPeriod
            ? { month: fallbackPeriod.month, year: fallbackPeriod.year }
            : { month: selectedPeriod.month, year: selectedPeriod.year };

      const effectiveSummary =
        summaryByPeriod.get(periodKey(effectivePeriod.month, effectivePeriod.year)) ||
        selectedSummary;

      setActivePeriod(effectivePeriod);
      setSummary(effectiveSummary || null);

      const trendPeriods = buildRecentPeriods(6, effectivePeriod.month, effectivePeriod.year);
      setMonthlyTrendData(
        trendPeriods.map((period) => {
          const s = summaryByPeriod.get(periodKey(period.month, period.year)) || null;
          return {
            label: `${period.label} ${String(period.year).slice(-2)}`,
            income: Number(s?.total_income || 0),
            expense: Number(s?.total_expense || 0),
          };
        })
      );
      setCashflowTrendData(
        trendPeriods.map((period) => {
          const s = summaryByPeriod.get(periodKey(period.month, period.year)) || null;
          return {
            label: `${period.label} ${String(period.year).slice(-2)}`,
            income: Number(s?.total_income || 0),
            expense: Number(s?.total_expense || 0),
            net: Number(s?.net_profit || 0),
          };
        })
      );
    } catch {
      setSummary(null);
      setActivePeriod(selectedPeriod);
      setMonthlyTrendData([]);
      setCashflowTrendData([]);
    } finally {
      setIsLoading(false);
      setIsTrendLoading(false);
    }
  }, [selectedPeriod]);

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

  const loadExtras = useCallback(async () => {
    // Receivables (facturas pendientes) + top clients by income — best-effort.
    try {
      const inv = await clientApiFetch<ApiEnvelope<Invoice[]>>("/api/finance/invoices?limit=200");
      const pending = (inv.data || []).filter((i) => i.status === "pending");
      setReceivable({
        amount: pending.reduce((sum, i) => sum + Number(i.total || 0), 0),
        count: pending.length,
      });
    } catch {
      setReceivable(null);
    }
    try {
      const txns = await clientApiFetch<ApiEnvelope<Transaction[]>>(
        "/api/finance/transactions?limit=500"
      );
      const byClient = new Map<string, number>();
      (txns.data || [])
        .filter((t) => t.type === "income")
        .forEach((t) => {
          const name = t.client_name || t.entity || "Sin asignar";
          byClient.set(name, (byClient.get(name) || 0) + Number(t.amount || 0));
        });
      setTopClients(
        Array.from(byClient.entries())
          .map(([name, total]) => ({ name, total }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 5)
      );
    } catch {
      setTopClients([]);
    }
  }, []);

  const loadRecurringCandidates = useCallback(async () => {
    setIsRecurringLoading(true);
    try {
      const response = await clientApiFetch<ApiEnvelope<RecurringTransactionCandidate[]>>(
        "/api/finance/transactions/recurring-candidates?limit=5"
      );
      setRecurringCandidates(response.data || []);
    } catch {
      setRecurringCandidates([]);
    } finally {
      setIsRecurringLoading(false);
    }
  }, []);

  const loadRecurringAlerts = useCallback(async () => {
    setIsRecurringAlertsLoading(true);
    try {
      const response = await clientApiFetch<ApiEnvelope<RecurringAlertsPayload>>(
        "/api/finance/transactions/recurring-alerts?limit=5"
      );
      setRecurringAlerts(response.data || null);
    } catch {
      setRecurringAlerts(null);
    } finally {
      setIsRecurringAlertsLoading(false);
    }
  }, []);

  const loadSuppressedRules = useCallback(async () => {
    setIsSuppressedRulesLoading(true);
    try {
      const response = await clientApiFetch<ApiEnvelope<RecurringRule[]>>(
        "/api/finance/transactions/recurring-rules?status=suppressed&limit=5"
      );
      setSuppressedRules(response.data || []);
    } catch {
      setSuppressedRules([]);
    } finally {
      setIsSuppressedRulesLoading(false);
    }
  }, []);

  const toRuleCandidatePayload = (candidate: RecurringTransactionCandidate) => ({
    key: candidate.key,
    type: candidate.type,
    amount: candidate.amount,
    category: candidate.category || null,
    normalized_description: candidate.normalized_description,
    frequency: candidate.frequency,
    average_interval_days: candidate.average_interval_days,
    next_expected_date: candidate.next_expected_date,
    confidence: candidate.confidence,
  });

  const refreshRecurringPanels = useCallback(async () => {
    await Promise.all([loadRecurringCandidates(), loadRecurringAlerts(), loadSuppressedRules()]);
  }, [loadRecurringAlerts, loadRecurringCandidates, loadSuppressedRules]);

  const approveCandidate = useCallback(
    async (candidate: RecurringTransactionCandidate) => {
      setUpdatingCandidateKey(candidate.key);
      try {
        await clientApiFetch("/api/finance/transactions/recurring-rules/approve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ candidate: toRuleCandidatePayload(candidate) }),
        });
        notify.success({ title: "Regla recurrente aprobada" });
        await refreshRecurringPanels();
      } catch {
        notify.error({ title: "No se pudo aprobar" });
      } finally {
        setUpdatingCandidateKey(null);
      }
    },
    [notify, refreshRecurringPanels]
  );

  const suppressCandidate = useCallback(
    async (candidate: RecurringTransactionCandidate) => {
      setUpdatingCandidateKey(candidate.key);
      try {
        await clientApiFetch("/api/finance/transactions/recurring-rules/suppress", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ candidate: toRuleCandidatePayload(candidate), suppress_days: 30 }),
        });
        notify.success({ title: "Alerta silenciada 30 días" });
        await refreshRecurringPanels();
      } catch {
        notify.error({ title: "No se pudo silenciar" });
      } finally {
        setUpdatingCandidateKey(null);
      }
    },
    [notify, refreshRecurringPanels]
  );

  const unsuppressRule = useCallback(
    async (ruleId: string) => {
      setUnsuppressingRuleId(ruleId);
      try {
        await clientApiFetch(`/api/finance/transactions/recurring-rules/${ruleId}/unsuppress`, {
          method: "POST",
        });
        notify.success({ title: "Regla reactivada" });
        await refreshRecurringPanels();
      } catch {
        notify.error({ title: "No se pudo reactivar" });
      } finally {
        setUnsuppressingRuleId(null);
      }
    },
    [notify, refreshRecurringPanels]
  );

  useEffect(() => {
    loadSummary();
    loadProjection();
    loadExtras();
    loadRecurringCandidates();
    loadRecurringAlerts();
    loadSuppressedRules();
  }, [
    loadExtras,
    loadProjection,
    loadRecurringAlerts,
    loadRecurringCandidates,
    loadSuppressedRules,
    loadSummary,
  ]);

  useEffect(() => {
    return onFinanceDataRefresh(() => {
      loadSummary();
      loadProjection();
      loadExtras();
      loadRecurringCandidates();
      loadRecurringAlerts();
      loadSuppressedRules();
    });
  }, [
    loadExtras,
    loadProjection,
    loadRecurringAlerts,
    loadRecurringCandidates,
    loadSuppressedRules,
    loadSummary,
  ]);

  const categoryChartData = useMemo(() => {
    if (!summary?.by_category?.length) return [];
    return summary.by_category
      .map((item) => ({
        label: item.category,
        value:
          Math.abs(Number(item.total_income || 0)) + Math.abs(Number(item.total_expense || 0)),
      }))
      .filter((item) => item.value > 0);
  }, [summary?.by_category]);

  const dismissLaunchpad = () => {
    setShowLaunchpad(false);
    localStorage.setItem("vf_launchpad_dismissed", "1");
  };

  const hasTransactions = (summary?.transaction_count || 0) > 0;
  const currentPeriod = currentMonthContext();
  const periodOptions = useMemo(() => {
    const options = buildRecentPeriods(24, currentPeriod.month, currentPeriod.year);
    return [...options].reverse();
  }, [currentPeriod.month, currentPeriod.year]);

  const selectedPeriodValue = periodKey(selectedPeriod.month, selectedPeriod.year);
  const activePeriodValue = periodKey(activePeriod.month, activePeriod.year);
  const isFallbackApplied = selectedPeriodValue !== activePeriodValue;
  const topClientMax = topClients.length ? topClients[0].total : 0;

  return (
    <div className="space-y-6">
      {/* Guided setup for new organizations (hides itself when complete) */}
      <OnboardingChecklist />

      {/* Header + period */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            Periodo activo: {String(activePeriod.month).padStart(2, "0")}/{activePeriod.year}
            {isFallbackApplied ? " · último mes con datos" : ""}
          </p>
        </div>
        <select
          aria-label="Seleccionar mes"
          className="h-10 min-w-[170px] rounded-lg border border-border bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={selectedPeriodValue}
          onChange={(event) => {
            const [year, month] = event.target.value.split("-");
            const parsedYear = Number(year);
            const parsedMonth = Number(month);
            if (!Number.isFinite(parsedYear) || !Number.isFinite(parsedMonth)) return;
            setSelectedPeriod({ month: parsedMonth, year: parsedYear });
          }}
        >
          {periodOptions.map((period) => (
            <option key={periodKey(period.month, period.year)} value={periodKey(period.month, period.year)}>
              {period.label} {period.year}
            </option>
          ))}
        </select>
      </div>

      {showLaunchpad ? <Launchpad onDismiss={dismissLaunchpad} /> : null}

      {/* KPI row */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          label="Ingresos del mes"
          value={formatCurrency(summary?.total_income ?? 0)}
          icon={TrendingUp}
          tone="up"
          loading={isLoading}
        />
        <KpiCard
          label="Gastos del mes"
          value={formatCurrency(summary?.total_expense ?? 0)}
          icon={TrendingDown}
          tone="down"
          loading={isLoading}
        />
        <KpiCard
          label="Utilidad neta"
          value={formatCurrency(summary?.net_profit ?? 0)}
          icon={Wallet}
          tone="brand"
          loading={isLoading}
        />
        <KpiCard
          label="Movimientos"
          value={String(summary?.transaction_count ?? 0)}
          icon={Building2}
          tone="neutral"
          loading={isLoading}
        />
        <KpiCard
          label="Facturas por cobrar"
          value={formatCurrency(receivable?.amount ?? 0)}
          icon={Receipt}
          tone="neutral"
          hint={receivable ? `${receivable.count} pendientes` : undefined}
          loading={!receivable && isLoading}
        />
      </section>

      {/* Charts */}
      {isTrendLoading ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">Cargando gráficas…</CardContent>
        </Card>
      ) : (
        <>
          <section className="grid gap-6 lg:grid-cols-2">
            <MonthlyIncomeExpenseBarChart
              data={monthlyTrendData}
              description="Ingresos y gastos de los últimos 6 meses."
            />
            <CategoryPieChart data={categoryChartData} description="Distribución por categoría del mes." />
          </section>
          <CashflowLineChart
            data={cashflowTrendData}
            description="Trayectoria de flujo neto de los últimos 6 meses."
          />
        </>
      )}

      {/* Top clients + projection */}
      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Top clientes por ingresos</CardTitle>
              <CardDescription>Suma de ingresos registrados por cliente.</CardDescription>
            </div>
            <Link href="/dashboard/clients" className="text-sm font-medium text-primary hover:underline">
              Ver todos
            </Link>
          </CardHeader>
          <CardContent>
            {topClients.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aún no hay ingresos por cliente.</p>
            ) : (
              <div className="space-y-3">
                {topClients.map((client) => (
                  <div key={client.name} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-foreground">{client.name}</span>
                      <span className="tnum font-semibold text-foreground">
                        {formatCurrency(client.total)}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{
                          width: `${topClientMax ? Math.max(6, (client.total / topClientMax) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <CashflowProjectionCard projection={projection} isLoading={isProjectionLoading} />
      </section>

      {/* Recurring intelligence */}
      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Movimientos recurrentes detectados</CardTitle>
            <CardDescription>Patrones recurrentes del historial reciente.</CardDescription>
          </CardHeader>
          <CardContent>
            {isRecurringLoading ? (
              <p className="text-sm text-muted-foreground">Detectando patrones…</p>
            ) : recurringCandidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aún no se detectan recurrencias.</p>
            ) : (
              <div className="space-y-3">
                {recurringCandidates.map((candidate) => (
                  <div key={candidate.key} className="rounded-xl border border-border px-3 py-2.5">
                    <p className="text-sm font-medium text-foreground">
                      {candidate.sample_descriptions[0] || candidate.normalized_description}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {candidate.frequency} · {candidate.occurrences} coincidencias ·{" "}
                      {formatCurrency(candidate.amount)} · confianza{" "}
                      {Math.round(candidate.confidence * 100)}%
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {candidate.rule_status === "approved" ? (
                        <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                          Aprobada
                        </span>
                      ) : candidate.rule_status === "suppressed" ? (
                        <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                          Silenciada
                        </span>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={updatingCandidateKey === candidate.key}
                        onClick={() => approveCandidate(candidate)}
                      >
                        Aprobar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={updatingCandidateKey === candidate.key}
                        onClick={() => suppressCandidate(candidate)}
                      >
                        Silenciar 30d
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Alertas de recurrencias</CardTitle>
            <CardDescription>Pagos recurrentes próximos y vencidos.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isRecurringAlertsLoading ? (
              <p className="text-sm text-muted-foreground">Cargando alertas…</p>
            ) : !recurringAlerts ? (
              <p className="text-sm text-muted-foreground">Motor de alertas no disponible.</p>
            ) : recurringAlerts.due_soon.length === 0 && recurringAlerts.overdue.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin recurrencias próximas ni vencidas.</p>
            ) : (
              <>
                {recurringAlerts.overdue.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-red-600">Vencidas</p>
                    {recurringAlerts.overdue.slice(0, 3).map((item) => (
                      <div
                        key={`overdue-${item.key}`}
                        className="rounded-xl border border-red-200 bg-red-50 px-3 py-2"
                      >
                        <p className="text-sm font-medium text-foreground">
                          {item.sample_descriptions[0] || item.normalized_description}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {Math.abs(Math.round(item.days_until_due))} días vencida ·{" "}
                          {formatCurrency(item.amount)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}

                {recurringAlerts.due_soon.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
                      Próximas
                    </p>
                    {recurringAlerts.due_soon.slice(0, 3).map((item) => (
                      <div
                        key={`soon-${item.key}`}
                        className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2"
                      >
                        <p className="text-sm font-medium text-foreground">
                          {item.sample_descriptions[0] || item.normalized_description}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Vence en {Math.max(0, Math.round(item.days_until_due))} días ·{" "}
                          {formatCurrency(item.amount)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            )}

            {!isSuppressedRulesLoading && suppressedRules.length > 0 ? (
              <div className="space-y-2 border-t border-border pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Reglas silenciadas
                </p>
                {suppressedRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">{rule.normalized_description}</p>
                      <p className="text-xs text-muted-foreground">
                        {rule.suppress_until
                          ? `Silenciada hasta ${new Date(rule.suppress_until).toLocaleDateString()}`
                          : "Silenciada indefinidamente"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={unsuppressingRuleId === rule.id}
                      onClick={() => unsuppressRule(rule.id)}
                    >
                      Reactivar
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>

      {!hasTransactions ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
            <Plug className="h-4 w-4" />
            No hay datos en este periodo. Agrega o importa movimientos para poblar KPIs y gráficas.
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
