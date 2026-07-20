"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNotify } from "@/hooks/use-notify";
import { ApiClientError, clientApiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface ValidationSummary {
  con_uuid: number;
  vigentes: number;
  cancelados: number;
  no_encontrados: number;
  sin_verificar: number;
  last_checked_at: string | null;
}

/**
 * Validación de comprobantes ante el SAT (vigente/cancelado), estilo Siigo.
 * Autocontenida; el cron diario también verifica en segundo plano.
 */
export function ValidacionCard({ canWrite }: { canWrite: boolean }) {
  const notify = useNotify();
  const [summary, setSummary] = useState<ValidationSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await clientApiFetch<{ data: ValidationSummary }>(
        "/api/finance/fiscal/validate/status"
      );
      setSummary(res.data);
    } catch {
      // queda vacío
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async () => {
    setBusy(true);
    try {
      const res = await clientApiFetch<{
        data: { checked: number; cancelados: number; nuevos_cancelados: number; errors: number };
      }>("/api/finance/fiscal/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 25 }),
      });
      notify.success({
        title: `${res.data.checked} CFDI verificados ante el SAT`,
        description: res.data.nuevos_cancelados
          ? `⚠️ ${res.data.nuevos_cancelados} cancelación(es) nueva(s) detectada(s)`
          : "Sin cancelaciones nuevas.",
      });
      load();
    } catch (error) {
      notify.error({
        title: "No se pudo validar",
        description: error instanceof ApiClientError ? error.message : "Error",
      });
    } finally {
      setBusy(false);
    }
  };

  const chips: Array<{ label: string; value: number; tone: string }> = summary
    ? [
        { label: "Vigentes", value: summary.vigentes, tone: "text-emerald-700" },
        { label: "Cancelados", value: summary.cancelados, tone: "text-red-700" },
        { label: "Sin verificar", value: summary.sin_verificar, tone: "text-muted-foreground" },
        { label: "No encontrados", value: summary.no_encontrados, tone: "text-amber-700" },
      ]
    : [];

  return (
    <Card className={summary?.cancelados ? "border-red-300" : undefined}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">
            Validación SAT{summary?.cancelados ? ` — ⚠️ ${summary.cancelados} cancelado(s)` : ""}
          </CardTitle>
          <CardDescription>
            Verifica que tus CFDI sigan vigentes ante el SAT y detecta cancelaciones posteriores.
            {summary?.last_checked_at
              ? ` Última verificación: ${new Date(summary.last_checked_at).toLocaleDateString("es-MX")}.`
              : ""}
          </CardDescription>
        </div>
        {canWrite ? (
          <Button size="sm" variant="outline" onClick={run} disabled={busy}>
            {busy ? "Consultando SAT…" : "Validar ahora"}
          </Button>
        ) : null}
      </CardHeader>
      {summary && summary.con_uuid > 0 ? (
        <CardContent className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {chips.map((c) => (
            <span key={c.label} className="text-muted-foreground">
              {c.label}: <b className={cn("tnum", c.tone)}>{c.value}</b>
            </span>
          ))}
        </CardContent>
      ) : null}
    </Card>
  );
}
