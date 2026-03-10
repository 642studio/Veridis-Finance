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
import { CashflowProjectionCard } from "@/components/finance/cashflow-projection-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNotify } from "@/hooks/use-notify";
import { clientApiFetch } from "@/lib/api-client";
import { onFinanceDataRefresh } from "@/lib/finance-events";
import { formatCurrency } from "@/lib/format";
import type {
  ApiEnvelope,
  CashflowProjection,
  MonthlySummary,
  RecurringAlertsPayload,
  RecurringRule,
  RecurringTransactionCandidate,
} from "@/types/finance";

function currentMonthContext() {
  const now = new Date();
  return {
    month: now.getUTCMonth() + 1,
    year: now.getUTCFullYear(),
  };
}

const monthLabelFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
});

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

export default function DashboardOverviewPage() {
  const notify = useNotify();
  const [selectedPeriod, setSelectedPeriod] = useState(currentMonthContext);
  const [activePeriod, setActivePeriod] = useState(currentMonthContext);
  const [summary, setSummary] = useState<MonthlySummary | null>(null);
  const [projection, setProjection] = useState<CashflowProjection | null>(null);
  const [recurringCandidates, setRecurringCandidates] = useState<
    RecurringTransactionCandidate[]
  >([]);
  const [recurringAlerts, setRecurringAlerts] = useState<RecurringAlertsPayload | null>(
    null
  );
  const [suppressedRules, setSuppressedRules] = useState<RecurringRule[]>([]);
  const [monthlyTrendData, setMonthlyTrendData] = useState<MonthlyIncomeExpenseDatum[]>([]);
  const [cashflowTrendData, setCashflowTrendData] = useState<CashflowLineDatum[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isProjectionLoading, setIsProjectionLoading] = useState(true);
  const [isRecurringLoading, setIsRecurringLoading] = useState(true);
  const [isRecurringAlertsLoading, setIsRecurringAlertsLoading] = useState(true);
  const [isSuppressedRulesLoading, setIsSuppressedRulesLoading] = useState(true);
  const [updatingCandidateKey, setUpdatingCandidateKey] = useState<string | null>(null);
  const [unsuppressingRuleId, setUnsuppressingRuleId] = useState<string | null>(null);
  const [isTrendLoading, setIsTrendLoading] = useState(true);

  const loadSummary = useCallback(async () => {
    setIsLoading(true);
    setIsTrendLoading(true);

    try {
      const fetchedPeriods = buildRecentPeriods(
        18,
        selectedPeriod.month,
        selectedPeriod.year
      );
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
        summaryByPeriod.get(periodKey(selectedPeriod.month, selectedPeriod.year)) ||
        null;

      const fallbackPeriod = [...fetchedPeriods]
        .reverse()
        .find((period) => {
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

      const trendPeriods = buildRecentPeriods(
        6,
        effectivePeriod.month,
        effectivePeriod.year
      );

      setMonthlyTrendData(
        trendPeriods.map((period) => {
          const monthlySummary =
            summaryByPeriod.get(periodKey(period.month, period.year)) || null;
          return {
            label: `${period.label} ${String(period.year).slice(-2)}`,
            income: Number(monthlySummary?.total_income || 0),
            expense: Number(monthlySummary?.total_expense || 0),
          };
        })
      );

      setCashflowTrendData(
        trendPeriods.map((period) => {
          const monthlySummary =
            summaryByPeriod.get(periodKey(period.month, period.year)) || null;
          return {
            label: `${period.label} ${String(period.year).slice(-2)}`,
            income: Number(monthlySummary?.total_income || 0),
            expense: Number(monthlySummary?.total_expense || 0),
            net: Number(monthlySummary?.net_profit || 0),
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

  const loadRecurringCandidates = useCallback(async () => {
    setIsRecurringLoading(true);
    try {
      const response = await clientApiFetch<
        ApiEnvelope<RecurringTransactionCandidate[]>
      >("/api/finance/transactions/recurring-candidates?limit=5");
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
    await Promise.all([
      loadRecurringCandidates(),
      loadRecurringAlerts(),
      loadSuppressedRules(),
    ]);
  }, [loadRecurringAlerts, loadRecurringCandidates, loadSuppressedRules]);

  const approveCandidate = useCallback(
    async (candidate: RecurringTransactionCandidate) => {
      setUpdatingCandidateKey(candidate.key);
      try {
        await clientApiFetch("/api/finance/transactions/recurring-rules/approve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            candidate: toRuleCandidatePayload(candidate),
          }),
        });
        notify.success({
          title: "Recurring rule approved",
          description: "Candidate is now pinned as approved rule.",
        });
        await refreshRecurringPanels();
      } catch {
        notify.error({
          title: "Approve failed",
          description: "Could not approve recurring rule.",
        });
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
          body: JSON.stringify({
            candidate: toRuleCandidatePayload(candidate),
            suppress_days: 30,
          }),
        });
        notify.success({
          title: "Recurring alert suppressed",
          description: "Candidate hidden from alerts for 30 days.",
        });
        await refreshRecurringPanels();
      } catch {
        notify.error({
          title: "Suppress failed",
          description: "Could not suppress recurring candidate.",
        });
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
        await clientApiFetch(
          `/api/finance/transactions/recurring-rules/${ruleId}/unsuppress`,
          {
            method: "POST",
          }
        );
        notify.success({
          title: "Recurring rule reactivated",
          description: "Suppression removed and alerts restored.",
        });
        await refreshRecurringPanels();
      } catch {
        notify.error({
          title: "Unsuppress failed",
          description: "Could not reactivate recurring rule.",
        });
      } finally {
        setUnsuppressingRuleId(null);
      }
    },
    [notify, refreshRecurringPanels]
  );

  useEffect(() => {
    loadSummary();
    loadProjection();
    loadRecurringCandidates();
    loadRecurringAlerts();
    loadSuppressedRules();
  }, [
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
      loadRecurringCandidates();
      loadRecurringAlerts();
      loadSuppressedRules();
    });
  }, [
    loadProjection,
    loadRecurringAlerts,
    loadRecurringCandidates,
    loadSuppressedRules,
    loadSummary,
  ]);

  const categoryChartData = useMemo(() => {
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

  const hasTransactions = (summary?.transaction_count || 0) > 0;
  const currentPeriod = currentMonthContext();
  const periodOptions = useMemo(() => {
    const options = buildRecentPeriods(24, currentPeriod.month, currentPeriod.year);
    return [...options].reverse();
  }, [currentPeriod.month, currentPeriod.year]);

  const selectedPeriodValue = periodKey(selectedPeriod.month, selectedPeriod.year);
  const activePeriodValue = periodKey(activePeriod.month, activePeriod.year);
  const isFallbackApplied = selectedPeriodValue !== activePeriodValue;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Reporting period</p>
            <p className="text-sm font-medium">
              Active: {String(activePeriod.month).padStart(2, "0")}/{activePeriod.year}
              {isFallbackApplied ? " (fallback to latest month with data)" : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="overview-period" className="text-sm text-muted-foreground">
              Select month
            </label>
            <select
              id="overview-period"
              className="h-10 min-w-[180px] rounded-xl border border-border bg-card px-3 text-sm"
              value={selectedPeriodValue}
              onChange={(event) => {
                const [year, month] = event.target.value.split("-");
                const parsedYear = Number(year);
                const parsedMonth = Number(month);
                if (!Number.isFinite(parsedYear) || !Number.isFinite(parsedMonth)) {
                  return;
                }
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
        </CardContent>
      </Card>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Income</CardDescription>
            <CardTitle className="text-2xl">
              {isLoading ? "..." : formatCurrency(summary?.total_income ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Expense</CardDescription>
            <CardTitle className="text-2xl text-red-600">
              {isLoading ? "..." : formatCurrency(summary?.total_expense ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Net Profit</CardDescription>
            <CardTitle className="text-2xl text-emerald-700">
              {isLoading ? "..." : formatCurrency(summary?.net_profit ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Transactions</CardDescription>
            <CardTitle className="text-2xl">
              {isLoading ? "..." : summary?.transaction_count ?? 0}
            </CardTitle>
          </CardHeader>
        </Card>
      </section>

      {isTrendLoading ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            Loading chart data...
          </CardContent>
        </Card>
      ) : (
        <>
          <section className="grid gap-6 lg:grid-cols-2">
            <MonthlyIncomeExpenseBarChart
              data={monthlyTrendData}
              description="Income and expense behavior for the last 6 months."
            />
            <CategoryPieChart
              data={categoryChartData}
              description="Current month category distribution."
            />
          </section>

          <CashflowLineChart
            data={cashflowTrendData}
            description="Net cashflow trajectory for the last 6 months."
          />
        </>
      )}

      <CashflowProjectionCard projection={projection} isLoading={isProjectionLoading} />

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recurring Candidates</CardTitle>
            <CardDescription>
              Detected recurring movements from recent transaction history.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isRecurringLoading ? (
              <p className="text-sm text-muted-foreground">
                Detecting recurring patterns...
              </p>
            ) : recurringCandidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No recurring candidates found yet.
              </p>
            ) : (
              <div className="space-y-3">
                {recurringCandidates.map((candidate) => (
                  <div
                    key={candidate.key}
                    className="rounded-xl border border-border px-3 py-2"
                  >
                    <p className="text-sm font-medium">
                      {candidate.sample_descriptions[0] ||
                        candidate.normalized_description}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {candidate.frequency} | {candidate.occurrences} matches |{" "}
                      {formatCurrency(candidate.amount)} | confidence{" "}
                      {Math.round(candidate.confidence * 100)}%
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {candidate.rule_status === "approved" ? (
                        <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                          Approved
                        </span>
                      ) : candidate.rule_status === "suppressed" ? (
                        <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                          Suppressed
                        </span>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={updatingCandidateKey === candidate.key}
                        onClick={() => approveCandidate(candidate)}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={updatingCandidateKey === candidate.key}
                        onClick={() => suppressCandidate(candidate)}
                      >
                        Suppress 30d
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
            <CardTitle>Recurring Alerts</CardTitle>
            <CardDescription>
              Due soon and overdue expected recurring transactions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isRecurringAlertsLoading ? (
              <p className="text-sm text-muted-foreground">Loading alerts...</p>
            ) : !recurringAlerts ? (
              <p className="text-sm text-muted-foreground">
                Alert engine unavailable for now.
              </p>
            ) : recurringAlerts.due_soon.length === 0 &&
              recurringAlerts.overdue.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No due-soon or overdue recurring items.
              </p>
            ) : (
              <>
                {recurringAlerts.overdue.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-red-400">
                      Overdue
                    </p>
                    {recurringAlerts.overdue.slice(0, 3).map((item) => (
                      <div
                        key={`overdue-${item.key}`}
                        className="rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2"
                      >
                        <p className="text-sm font-medium">
                          {item.sample_descriptions[0] || item.normalized_description}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {Math.abs(Math.round(item.days_until_due))} days overdue |{" "}
                          {formatCurrency(item.amount)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}

                {recurringAlerts.due_soon.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">
                      Due Soon
                    </p>
                    {recurringAlerts.due_soon.slice(0, 3).map((item) => (
                      <div
                        key={`soon-${item.key}`}
                        className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2"
                      >
                        <p className="text-sm font-medium">
                          {item.sample_descriptions[0] || item.normalized_description}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Due in {Math.max(0, Math.round(item.days_until_due))} days |{" "}
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
                  Suppressed Rules
                </p>
                {suppressedRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium">{rule.normalized_description}</p>
                      <p className="text-xs text-muted-foreground">
                        {rule.suppress_until
                          ? `Suppressed until ${new Date(rule.suppress_until).toLocaleDateString()}`
                          : "Suppressed indefinitely"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={unsuppressingRuleId === rule.id}
                      onClick={() => unsuppressRule(rule.id)}
                    >
                      Unsuppress
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Month Snapshot</CardTitle>
          <CardDescription>
            Current reporting period: {String(activePeriod.month).padStart(2, "0")}/
            {activePeriod.year}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {hasTransactions
              ? "This overview is powered by live backend data. Use Reports for deeper category and history analysis."
              : "No data available for this period yet. Add or import transactions to populate charts and KPIs."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
