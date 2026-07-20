"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Landmark, ShieldCheck } from "lucide-react";

import { clientApiFetch } from "@/lib/api-client";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Pulse {
  ivaACargo: number | null;
  cancelados: number;
  sinVerificar: number;
  efosHits: number;
}

/**
 * Pulso fiscal del mes en el Dashboard: IVA a cargo, CFDIs cancelados y
 * coincidencias EFOS de un vistazo, con liga a Impuestos y CFDI.
 * Autocontenido y tolerante a fallos (se oculta si nada carga).
 */
export function FiscalPulse() {
  const [pulse, setPulse] = useState<Pulse | null>(null);

  useEffect(() => {
    const now = new Date();
    Promise.all([
      clientApiFetch<{ data: { iva_a_cargo: number } }>(
        `/api/finance/fiscal/iva?year=${now.getFullYear()}&month=${now.getMonth() + 1}`
      ).catch(() => null),
      clientApiFetch<{ data: { cancelados: number; sin_verificar: number } }>(
        "/api/finance/fiscal/validate/status"
      ).catch(() => null),
      clientApiFetch<{ data: unknown[] }>("/api/finance/fiscal/efos/hits").catch(() => null),
    ]).then(([iva, val, efos]) => {
      if (!iva && !val && !efos) return;
      setPulse({
        ivaACargo: iva ? iva.data.iva_a_cargo : null,
        cancelados: val ? val.data.cancelados : 0,
        sinVerificar: val ? val.data.sin_verificar : 0,
        efosHits: efos ? (efos.data || []).length : 0,
      });
    });
  }, []);

  if (!pulse) return null;

  const hasRisk = pulse.cancelados > 0 || pulse.efosHits > 0;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-card px-4 py-3 shadow-sm",
        hasRisk ? "border-red-300" : "border-border"
      )}
    >
      <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Landmark className="h-4 w-4 text-primary" />
        Pulso fiscal
      </span>
      <Link href="/dashboard/impuestos" className="text-sm text-muted-foreground hover:text-foreground">
        IVA a cargo del mes:{" "}
        <b className={cn("tnum", (pulse.ivaACargo ?? 0) > 0 ? "text-primary" : "text-emerald-700")}>
          {pulse.ivaACargo != null ? formatCurrency(pulse.ivaACargo) : "—"}
        </b>
      </Link>
      <Link href="/dashboard/cfdi" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        {pulse.cancelados > 0 ? (
          <>
            <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
            <b className="text-red-700">{pulse.cancelados} CFDI cancelado(s)</b>
          </>
        ) : (
          <>
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            Sin cancelaciones{pulse.sinVerificar > 0 ? ` · ${pulse.sinVerificar} sin verificar` : ""}
          </>
        )}
      </Link>
      <Link href="/dashboard/cfdi" className="text-sm text-muted-foreground hover:text-foreground">
        EFOS:{" "}
        {pulse.efosHits > 0 ? (
          <b className="text-red-700">⚠️ {pulse.efosHits} coincidencia(s)</b>
        ) : (
          <b className="text-emerald-700">limpio</b>
        )}
      </Link>
    </div>
  );
}
