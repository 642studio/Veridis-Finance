"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";

import { useSession } from "@/components/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { useNotify } from "@/hooks/use-notify";
import { ApiClientError, clientApiFetch } from "@/lib/api-client";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface IvaTotals {
  count: number;
  excluded_count: number;
  base16: number;
  iva16: number;
  base8: number;
  iva8: number;
  base0: number;
  exento: number;
  iva_total: number;
  ret_iva: number;
  ret_isr: number;
  subtotal: number;
  estimated_count: number;
}

interface IvaRow {
  uuid: string;
  fecha: string;
  paid_at?: string | null;
  counterparty: string | null;
  counterparty_rfc: string | null;
  metodo_pago: string;
  total: number;
  subtotal: number | null;
  iva: number;
  base16: number;
  ret_iva: number;
  ret_isr: number;
  estimated: boolean;
  excluded: boolean;
  source?: string | null;
}

interface IvaData {
  periodo: { year: number; month: number };
  trasladado: IvaTotals;
  acreditable: IvaTotals;
  iva_a_cargo: number;
  isr: {
    ingresos_cobrados: number;
    deducciones_pagadas: number;
    base_estimada: number;
    isr_retenido: number;
    nota: string;
  };
  ppd_pendientes: {
    emitidas: { count: number; importe: number };
    recibidas: { count: number; importe: number };
  };
  detalle: { emitidas: IvaRow[]; recibidas: IvaRow[] };
}

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export default function ImpuestosPage() {
  const notify = useNotify();
  const { canWrite } = useSession();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<IvaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"emitidas" | "recibidas">("emitidas");
  const [togglingUuid, setTogglingUuid] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await clientApiFetch<{ data: IvaData }>(
        `/api/finance/fiscal/iva?year=${year}&month=${month}`
      );
      setData(res.data);
    } catch (error) {
      setData(null);
      notify.error({
        title: "No se pudo calcular el IVA",
        description: error instanceof ApiClientError ? error.message : "Error",
      });
    } finally {
      setLoading(false);
    }
  }, [year, month, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleOverride = async (row: IvaRow) => {
    setTogglingUuid(row.uuid);
    try {
      await clientApiFetch("/api/finance/fiscal/iva/override", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uuid: row.uuid, excluded: !row.excluded }),
      });
      await load();
    } catch (error) {
      notify.error({
        title: "No se pudo actualizar",
        description: error instanceof ApiClientError ? error.message : "Error",
      });
    } finally {
      setTogglingUuid(null);
    }
  };

  const rows = useMemo(
    () => (tab === "emitidas" ? data?.detalle.emitidas : data?.detalle.recibidas) || [],
    [data, tab]
  );

  const exportCsv = () => {
    if (!data) return;
    const header = [
      "Tipo", "UUID", "Fecha", "Pagada", "Contraparte", "RFC", "Método",
      "Subtotal", "IVA", "Ret IVA", "Ret ISR", "Total", "Estimado", "Excluido",
    ];
    const toLine = (tipo: string, r: IvaRow) =>
      [
        tipo, r.uuid, r.fecha?.slice(0, 10) || "", r.paid_at?.slice(0, 10) || "",
        `"${(r.counterparty || "").replace(/"/g, '""')}"`, r.counterparty_rfc || "",
        r.metodo_pago, r.subtotal ?? "", r.iva, r.ret_iva, r.ret_isr, r.total,
        r.estimated ? "sí" : "no", r.excluded ? "sí" : "no",
      ].join(",");
    const lines = [
      header.join(","),
      ...data.detalle.emitidas.map((r) => toLine("Emitida", r)),
      ...data.detalle.recibidas.map((r) => toLine("Recibida", r)),
      "",
      `Resumen ${MONTHS[month - 1]} ${year}`,
      `IVA trasladado (cobrado),${data.trasladado.iva_total}`,
      `IVA acreditable (pagado),${data.acreditable.iva_total}`,
      `IVA retenido,${data.trasladado.ret_iva}`,
      `IVA a cargo,${data.iva_a_cargo}`,
      `ISR base estimada,${data.isr.base_estimada}`,
    ];
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `iva-${year}-${String(month).padStart(2, "0")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    notify.success({ title: "CSV exportado", description: "Listo para tu contador." });
  };

  const bigCard = (
    label: string,
    value: number,
    sub: string,
    tone: "brand" | "good" | "neutral"
  ) => (
    <div
      className={cn(
        "rounded-xl border bg-card p-5 shadow-sm",
        tone === "brand" ? "border-primary/40" : "border-border"
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "tnum mt-1 text-2xl font-bold",
          tone === "good" ? "text-emerald-700" : tone === "brand" ? "text-primary" : "text-foreground"
        )}
      >
        {formatCurrency(value)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">
            Impuestos — IVA e ISR base flujo
          </h1>
          <p className="text-sm text-muted-foreground">
            Efectivamente cobrado y pagado: PUE al expedir, PPD al registrarse el pago.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Mes"
            className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
          <select
            aria-label="Año"
            className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear()].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <Button variant="outline" onClick={exportCsv} disabled={!data}>
            <Download className="mr-2 h-4 w-4" />
            Exportar
          </Button>
        </div>
      </div>

      {loading ? (
        <Card><CardContent className="py-8 text-sm text-muted-foreground">Calculando IVA del periodo…</CardContent></Card>
      ) : !data ? (
        <Card><CardContent className="py-8 text-sm text-muted-foreground">Sin datos para este periodo.</CardContent></Card>
      ) : (
        <>
          {/* Totales estilo Siigo */}
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {bigCard(
              "IVA trasladado (cobrado)",
              data.trasladado.iva_total,
              `${data.trasladado.count} CFDI · base 16%: ${formatCurrency(data.trasladado.base16)}`,
              "neutral"
            )}
            {bigCard(
              "IVA acreditable (pagado)",
              data.acreditable.iva_total,
              `${data.acreditable.count} CFDI · base 16%: ${formatCurrency(data.acreditable.base16)}`,
              "good"
            )}
            {bigCard(
              "IVA a cargo del periodo",
              data.iva_a_cargo,
              `trasladado − acreditable − retenido (${formatCurrency(data.trasladado.ret_iva)})`,
              "brand"
            )}
            {bigCard(
              "ISR base estimada",
              data.isr.base_estimada,
              `ingresos ${formatCurrency(data.isr.ingresos_cobrados)} − deducciones ${formatCurrency(data.isr.deducciones_pagadas)}`,
              "neutral"
            )}
          </section>

          {(data.ppd_pendientes.emitidas.count > 0 || data.ppd_pendientes.recibidas.count > 0) ? (
            <Card>
              <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-1 py-4 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">PPD sin pago (no causan IVA aún):</span>
                <span>
                  {data.ppd_pendientes.emitidas.count} emitidas por{" "}
                  {formatCurrency(data.ppd_pendientes.emitidas.importe)}
                </span>
                <span>
                  {data.ppd_pendientes.recibidas.count} recibidas por{" "}
                  {formatCurrency(data.ppd_pendientes.recibidas.importe)}
                </span>
              </CardContent>
            </Card>
          ) : null}

          {/* Detalle */}
          <Card>
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1 rounded-lg border border-border bg-muted p-1">
                  {(["emitidas", "recibidas"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTab(t)}
                      className={cn(
                        "rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors",
                        tab === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {t === "emitidas"
                        ? `Cobradas (${data.detalle.emitidas.length})`
                        : `Pagadas (${data.detalle.recibidas.length})`}
                    </button>
                  ))}
                </div>
                {data.trasladado.estimated_count + data.acreditable.estimated_count > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    * {data.trasladado.estimated_count + data.acreditable.estimated_count} CFDI sin
                    desglose de impuestos — IVA estimado a 16/116.
                  </p>
                ) : null}
              </div>
              <CardDescription>
                {tab === "emitidas"
                  ? "CFDI que causan IVA trasladado en el periodo."
                  : "CFDI que generan IVA acreditable en el periodo."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin CFDI en este periodo.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="py-2">Fecha</th>
                        <th className="py-2">Contraparte</th>
                        <th className="py-2">RFC</th>
                        <th className="py-2">Método</th>
                        <th className="py-2 text-right">Subtotal</th>
                        <th className="py-2 text-right">IVA</th>
                        <th className="py-2 text-right">Total</th>
                        <th className="py-2 text-right">Considerar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr
                          key={r.uuid}
                          className={cn("border-t border-border", r.excluded && "opacity-50")}
                        >
                          <td className="py-2 whitespace-nowrap">{formatDate(r.fecha)}</td>
                          <td className="max-w-[220px] truncate py-2">{r.counterparty || "—"}</td>
                          <td className="py-2 font-mono text-xs">{r.counterparty_rfc || "—"}</td>
                          <td className="py-2">
                            <Badge className={r.metodo_pago === "PPD" ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground"}>
                              {r.metodo_pago}
                            </Badge>
                          </td>
                          <td className="tnum py-2 text-right">
                            {r.subtotal != null ? formatCurrency(r.subtotal) : "—"}
                          </td>
                          <td className="tnum py-2 text-right">
                            {formatCurrency(r.iva)}
                            {r.estimated ? <span title="Estimado 16/116">*</span> : null}
                          </td>
                          <td className="tnum py-2 text-right font-medium">{formatCurrency(r.total)}</td>
                          <td className="py-2 text-right">
                            {canWrite ? (
                              <button
                                type="button"
                                onClick={() => toggleOverride(r)}
                                disabled={togglingUuid === r.uuid}
                                className={cn(
                                  "rounded-full px-2.5 py-1 text-xs font-semibold transition-colors",
                                  r.excluded
                                    ? "bg-muted text-muted-foreground hover:text-foreground"
                                    : "bg-emerald-100 text-emerald-700"
                                )}
                              >
                                {r.excluded ? "Excluido" : "Incluido"}
                              </button>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {r.excluded ? "Excluido" : "Incluido"}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">{data.isr.nota}</p>
        </>
      )}
    </div>
  );
}
