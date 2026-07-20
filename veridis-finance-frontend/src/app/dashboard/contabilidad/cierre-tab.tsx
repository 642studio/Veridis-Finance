"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useSession } from "@/components/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNotify } from "@/hooks/use-notify";
import { ApiClientError, clientApiFetch } from "@/lib/api-client";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Conciliacion {
  banco: {
    real: { ingresos: number; egresos: number; neto: number; movimientos: number };
    contable: { ingresos: number; egresos: number; neto: number; movimientos: number };
    diferencia: number;
    conciliado: boolean;
  };
  cfdi: { cfdis: number; polizas: number; sin_poliza: number; conciliado: boolean };
  conciliado: boolean;
}
interface Period {
  year: number;
  month: number;
  status: string;
  closed_at: string | null;
}

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i, 1).toLocaleDateString("es-MX", { month: "long" })
);

export function CierreTab() {
  const notify = useNotify();
  const { canWrite, canManageOrganization } = useSession();
  const now = useMemo(() => new Date(), []);
  const isAdmin = canManageOrganization;
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [conc, setConc] = useState<Conciliacion | null>(null);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, p] = await Promise.all([
        clientApiFetch<{ data: Conciliacion }>(`/api/finance/accounting/conciliacion?year=${year}&month=${month}`),
        clientApiFetch<{ data: Period[] }>("/api/finance/accounting/periods"),
      ]);
      setConc(c.data);
      setPeriods(p.data || []);
    } catch (error) {
      notify.error({
        title: "No se pudo cargar",
        description: error instanceof ApiClientError ? error.message : "Error",
      });
    } finally {
      setLoading(false);
    }
  }, [year, month, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const currentStatus = periods.find((p) => p.year === year && p.month === month)?.status || "open";

  const act = async (path: string, body: object, okTitle: string) => {
    setBusy(true);
    try {
      await clientApiFetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      notify.success({ title: okTitle });
      load();
    } catch (error) {
      notify.error({
        title: "No se pudo completar",
        description: error instanceof ApiClientError ? error.message : "Error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Concilia banco, pólizas y CFDIs; cierra el periodo para bloquear cambios.
        </p>
        <div className="flex items-center gap-2">
          <select
            aria-label="Mes"
            className="h-9 rounded-lg border border-border bg-card px-2 text-sm capitalize"
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
          >
            {MONTHS.map((m, i) => (
              <option key={i + 1} value={i + 1} className="capitalize">{m}</option>
            ))}
          </select>
          <select
            aria-label="Año"
            className="h-9 rounded-lg border border-border bg-card px-2 text-sm"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear()].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Banco ↔ Contabilidad</CardTitle>
            <CardDescription>Movimientos bancarios del mes contra la cuenta de Bancos en el mayor.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading || !conc ? (
              <p className="text-sm text-muted-foreground">Cargando…</p>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="text-left text-xs uppercase text-muted-foreground">
                      <tr><th className="py-1">Concepto</th><th className="py-1 text-right">Banco real</th><th className="py-1 text-right">Contable</th></tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-border"><td className="py-1.5">Ingresos</td><td className="tnum py-1.5 text-right">{formatCurrency(conc.banco.real.ingresos)}</td><td className="tnum py-1.5 text-right">{formatCurrency(conc.banco.contable.ingresos)}</td></tr>
                      <tr className="border-t border-border"><td className="py-1.5">Egresos</td><td className="tnum py-1.5 text-right">{formatCurrency(conc.banco.real.egresos)}</td><td className="tnum py-1.5 text-right">{formatCurrency(conc.banco.contable.egresos)}</td></tr>
                      <tr className="border-t border-border font-medium"><td className="py-1.5">Neto</td><td className="tnum py-1.5 text-right">{formatCurrency(conc.banco.real.neto)}</td><td className="tnum py-1.5 text-right">{formatCurrency(conc.banco.contable.neto)}</td></tr>
                    </tbody>
                  </table>
                </div>
                <div
                  className={cn(
                    "flex items-center justify-between rounded-lg border px-3 py-2",
                    conc.banco.conciliado ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
                  )}
                >
                  <span className="font-medium">
                    {conc.banco.conciliado ? "✓ Banco conciliado" : "Diferencia por conciliar"}
                  </span>
                  <span className="tnum">{formatCurrency(Math.abs(conc.banco.diferencia))}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">CFDI ↔ Pólizas</CardTitle>
            <CardDescription>CFDIs del periodo contabilizados en pólizas.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading || !conc ? (
              <p className="text-sm text-muted-foreground">Cargando…</p>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between"><span>CFDIs del periodo</span><span className="tnum font-medium">{conc.cfdi.cfdis}</span></div>
                <div className="flex items-center justify-between"><span>Pólizas desde CFDI</span><span className="tnum font-medium">{conc.cfdi.polizas}</span></div>
                <div
                  className={cn(
                    "flex items-center justify-between rounded-lg border px-3 py-2",
                    conc.cfdi.conciliado ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
                  )}
                >
                  <span className="font-medium">{conc.cfdi.conciliado ? "✓ Todos contabilizados" : "Sin póliza"}</span>
                  <span className="tnum">{conc.cfdi.sin_poliza}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">
              Cierre de {MONTHS[month - 1]} {year}{" "}
              <Badge className={currentStatus === "closed" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}>
                {currentStatus === "closed" ? "Cerrado" : "Abierto"}
              </Badge>
            </CardTitle>
            <CardDescription>
              Al cerrar, se bloquean nuevas pólizas del periodo. Requiere que la balanza cuadre.
            </CardDescription>
          </div>
          {isAdmin && canWrite ? (
            <div className="flex items-center gap-2">
              {currentStatus === "closed" ? (
                <Button
                  variant="outline"
                  onClick={() => act("/api/finance/accounting/periods/reopen", { year, month }, "Periodo reabierto")}
                  disabled={busy}
                >
                  Reabrir
                </Button>
              ) : (
                <Button
                  onClick={() => act("/api/finance/accounting/periods/close", { year, month }, "Periodo cerrado")}
                  disabled={busy}
                >
                  Cerrar periodo
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => act("/api/finance/accounting/closing", { year }, "Póliza de cierre generada")}
                disabled={busy}
                title="Genera la póliza de cierre del ejercicio (traspasa el resultado a 305.01)"
              >
                Póliza de cierre {year}
              </Button>
            </div>
          ) : null}
        </CardHeader>
        <CardContent>
          {periods.filter((p) => p.status === "closed").length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no hay periodos cerrados.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {periods
                .filter((p) => p.status === "closed")
                .map((p) => (
                  <Badge key={`${p.year}-${p.month}`} className="bg-muted text-muted-foreground">
                    {MONTHS[p.month - 1]} {p.year}
                  </Badge>
                ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
