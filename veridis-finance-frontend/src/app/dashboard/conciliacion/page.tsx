"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useNotify } from "@/hooks/use-notify";
import { ApiClientError, clientApiFetch } from "@/lib/api-client";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type Estado = "conciliado" | "parcial" | "sin_conciliar" | "payout_stripe";

interface Cfdi {
  invoice_id: string;
  uuid_sat: string | null;
  emitter: string | null;
  receiver: string | null;
  total: number;
}
interface Item {
  id: string;
  date: string;
  type: "income" | "expense";
  amount: number;
  concepto: string | null;
  descripcion: string | null;
  categoria: string | null;
  estado: Estado;
  cfdi: Cfdi | null;
}
interface Review {
  resumen: {
    total: number;
    conciliados: number;
    sin_conciliar: number;
    payouts_stripe: number;
    monto_conciliado: number;
    monto_pendiente: number;
    monto_payout_stripe: number;
    pct_conciliado: number;
  };
  items: Item[];
}
interface Candidate {
  invoice_id: string;
  uuid_sat: string | null;
  emitter: string | null;
  receiver: string | null;
  total: number;
  invoice_date: string;
  match: { score: number; rfc_match: boolean; days_apart: number };
}

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i, 1).toLocaleDateString("es-MX", { month: "long" })
);

const ESTADO_PILL: Record<Estado, string> = {
  conciliado: "bg-emerald-100 text-emerald-700",
  parcial: "bg-amber-100 text-amber-800",
  sin_conciliar: "bg-muted text-muted-foreground",
  payout_stripe: "bg-violet-100 text-violet-700",
};
const ESTADO_LABEL: Record<Estado, string> = {
  conciliado: "Conciliado",
  parcial: "Parcial",
  sin_conciliar: "Sin conciliar",
  payout_stripe: "Payout Stripe",
};

export default function ConciliacionPage() {
  const notify = useNotify();
  const { canWrite } = useSession();
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candLoading, setCandLoading] = useState(false);
  const [filter, setFilter] = useState<"todos" | Estado>("todos");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await clientApiFetch<{ data: Review }>(
        `/api/finance/reconciliation/review?year=${year}&month=${month}`
      );
      setData(res.data);
    } catch (error) {
      notify.error({
        title: "No se pudo cargar la conciliación",
        description: error instanceof ApiClientError ? error.message : "Error",
      });
    } finally {
      setLoading(false);
    }
  }, [year, month, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const autoReconcile = async () => {
    setBusy(true);
    try {
      const res = await clientApiFetch<{ data: { matched: number; scanned: number; ambiguous: number } }>(
        "/api/finance/reconciliation/auto",
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ max_transactions: 200 }) }
      );
      notify.success({
        title: "Conciliación automática",
        description: `${res.data.matched} conciliado(s) de ${res.data.scanned} revisados; ${res.data.ambiguous} ambiguos para revisar a mano.`,
      });
      load();
    } catch (error) {
      notify.error({ title: "No se pudo auto-conciliar", description: error instanceof ApiClientError ? error.message : "Error" });
    } finally {
      setBusy(false);
    }
  };

  const openCandidates = async (id: string) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    setCandidates([]);
    setCandLoading(true);
    try {
      const res = await clientApiFetch<{ data: { candidates: Candidate[] } }>(
        `/api/finance/transactions/${id}/reconciliation-candidates?limit=6`
      );
      setCandidates(res.data.candidates || []);
    } catch {
      setCandidates([]);
    } finally {
      setCandLoading(false);
    }
  };

  const confirm = async (transactionId: string, invoiceId: string) => {
    try {
      await clientApiFetch(`/api/finance/transactions/${transactionId}/reconcile`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ invoice_id: invoiceId }),
      });
      notify.success({ title: "Movimiento conciliado" });
      setExpanded(null);
      load();
    } catch (error) {
      notify.error({ title: "No se pudo conciliar", description: error instanceof ApiClientError ? error.message : "Error" });
    }
  };

  const undo = async (transactionId: string) => {
    try {
      await clientApiFetch(`/api/finance/transactions/${transactionId}/unreconcile`, { method: "POST" });
      notify.success({ title: "Conciliación deshecha" });
      load();
    } catch (error) {
      notify.error({ title: "No se pudo deshacer", description: error instanceof ApiClientError ? error.message : "Error" });
    }
  };

  const items = (data?.items || []).filter((i) => filter === "todos" || i.estado === filter);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Conciliación bancaria</h1>
          <p className="text-sm text-muted-foreground">
            Casa cada movimiento del banco con su factura. Un ingreso se cuenta una vez.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select aria-label="Mes" className="h-9 rounded-lg border border-border bg-card px-2 text-sm capitalize"
            value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => <option key={i + 1} value={i + 1} className="capitalize">{m}</option>)}
          </select>
          <select aria-label="Año" className="h-9 rounded-lg border border-border bg-card px-2 text-sm"
            value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear()].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          {canWrite ? (
            <Button onClick={autoReconcile} disabled={busy || loading}>
              {busy ? "Conciliando…" : "✨ Conciliar automáticamente"}
            </Button>
          ) : null}
        </div>
      </div>

      {data ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card><CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Avance</p>
            <p className="mt-1 text-2xl font-bold tnum">{data.resumen.pct_conciliado}%</p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${data.resumen.pct_conciliado}%` }} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{data.resumen.conciliados} de {data.resumen.total} movimientos</p>
          </CardContent></Card>
          <Card><CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Sin conciliar</p>
            <p className="mt-1 text-2xl font-bold tnum text-amber-600">{data.resumen.sin_conciliar}</p>
            <p className="mt-1 text-xs text-muted-foreground">{formatCurrency(Math.abs(data.resumen.monto_pendiente))} pendiente</p>
          </CardContent></Card>
          <Card><CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Conciliado</p>
            <p className="mt-1 text-2xl font-bold tnum text-emerald-600">{formatCurrency(Math.abs(data.resumen.monto_conciliado))}</p>
            {data.resumen.payouts_stripe > 0 ? (
              <p className="mt-1 text-xs text-violet-700">
                + {data.resumen.payouts_stripe} payout(s) Stripe · {formatCurrency(Math.abs(data.resumen.monto_payout_stripe))}
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">ligado a facturas</p>
            )}
          </CardContent></Card>
        </div>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Movimientos</CardTitle>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-muted p-0.5 text-xs">
            {(["todos", "sin_conciliar", "conciliado"] as const).map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)}
                className={cn("rounded-md px-2.5 py-1 font-medium capitalize transition-colors",
                  filter === f ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                {f === "todos" ? "Todos" : f === "sin_conciliar" ? "Sin conciliar" : "Conciliados"}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin movimientos en este filtro.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2">Fecha</th>
                    <th className="py-2">Concepto</th>
                    <th className="py-2 text-right">Monto</th>
                    <th className="py-2">Estado</th>
                    <th className="py-2 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <Fragment key={it.id}>
                      <tr className="border-t border-border align-top">
                        <td className="py-2.5 whitespace-nowrap">{formatDate(it.date)}</td>
                        <td className="max-w-[360px] py-2.5">
                          <div className="font-medium">{it.concepto || "—"}</div>
                          <div className="truncate text-xs text-muted-foreground" title={it.descripcion || ""}>
                            {it.descripcion}
                          </div>
                          {it.cfdi ? (
                            <div className="mt-0.5 text-xs text-emerald-700">
                              ↳ {it.type === "income" ? it.cfdi.receiver : it.cfdi.emitter} · {formatCurrency(it.cfdi.total)}
                            </div>
                          ) : null}
                        </td>
                        <td className={cn("tnum py-2.5 text-right font-medium", it.type === "income" ? "text-emerald-600" : "")}>
                          {it.type === "income" ? "+" : "−"}{formatCurrency(Math.abs(it.amount))}
                        </td>
                        <td className="py-2.5">
                          <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", ESTADO_PILL[it.estado])}>
                            {ESTADO_LABEL[it.estado]}
                          </span>
                        </td>
                        <td className="py-2.5 text-right">
                          {!canWrite ? null : it.estado === "sin_conciliar" ? (
                            <Button variant="outline" size="sm" onClick={() => openCandidates(it.id)}>
                              {expanded === it.id ? "Cerrar" : "Buscar CFDI"}
                            </Button>
                          ) : (
                            <Button variant="ghost" size="sm" onClick={() => undo(it.id)}>Deshacer</Button>
                          )}
                        </td>
                      </tr>
                      {expanded === it.id ? (
                        <tr className="border-t border-border bg-muted/30">
                          <td colSpan={5} className="px-3 py-3">
                            {candLoading ? (
                              <p className="text-xs text-muted-foreground">Buscando facturas candidatas…</p>
                            ) : candidates.length === 0 ? (
                              <p className="text-xs text-muted-foreground">No hay facturas candidatas con monto y fecha cercanos.</p>
                            ) : (
                              <div className="space-y-1.5">
                                {candidates.map((c) => (
                                  <div key={c.invoice_id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
                                    <div className="min-w-0">
                                      <div className="text-sm font-medium">
                                        {it.type === "income" ? c.receiver : c.emitter} · {formatCurrency(c.total)}
                                        {c.match.rfc_match ? <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">RFC ✓</span> : null}
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        {formatDate(c.invoice_date)} · {c.match.days_apart}d · confianza {Math.round(c.match.score * 100)}%
                                      </div>
                                    </div>
                                    <Button size="sm" onClick={() => confirm(it.id, c.invoice_id)}>Conciliar</Button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
