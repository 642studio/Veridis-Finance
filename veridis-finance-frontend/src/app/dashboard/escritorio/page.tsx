"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNotify } from "@/hooks/use-notify";
import { ApiClientError, clientApiFetch } from "@/lib/api-client";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Obligacion {
  clave: string;
  nombre: string;
  vence: string;
  dias_restantes: number;
  estado: "vencida" | "proxima" | "ok";
}
interface Escritorio {
  iva: { trasladado: number; acreditable: number; a_cargo: number };
  isr: { base_estimada: number; retenido: number };
  contabilidad: {
    balanza_cuadra: boolean;
    cfdis: number;
    polizas: number;
    cfdis_sin_poliza: number;
    banco_conciliado: boolean;
    banco_diferencia: number;
  };
  efos: { coincidencias: number; definitivos: number };
  obligaciones: Obligacion[];
  alertas: { nivel: "error" | "warning"; texto: string }[];
}

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i, 1).toLocaleDateString("es-MX", { month: "long" })
);

export default function EscritorioFiscalPage() {
  const notify = useNotify();
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<Escritorio | null>(null);
  const [loading, setLoading] = useState(true);

  // Abre en el último mes con movimientos.
  useEffect(() => {
    let alive = true;
    clientApiFetch<{ data: { year: number; month: number; has_data: boolean } }>(
      "/api/finance/reconciliation/latest-period"
    )
      .then((r) => { if (alive && r.data?.has_data) { setYear(r.data.year); setMonth(r.data.month); } })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await clientApiFetch<{ data: Escritorio }>(
        `/api/finance/fiscal/escritorio?year=${year}&month=${month}`
      );
      setData(res.data);
    } catch (error) {
      notify.error({
        title: "No se pudo cargar el escritorio",
        description: error instanceof ApiClientError ? error.message : "Error",
      });
    } finally {
      setLoading(false);
    }
  }, [year, month, notify]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Escritorio fiscal</h1>
          <p className="text-sm text-muted-foreground">
            Todo lo del mes de un vistazo: impuestos, contabilidad, riesgos y fechas límite.
          </p>
        </div>
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

      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">Sin datos para este periodo.</p>
      ) : (
        <>
          {data.alertas.length > 0 ? (
            <div className="space-y-2">
              {data.alertas.map((a, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                    a.nivel === "error"
                      ? "border-red-200 bg-red-50 text-red-700"
                      : "border-amber-200 bg-amber-50 text-amber-800"
                  )}
                >
                  <span className={cn("h-2 w-2 rounded-full", a.nivel === "error" ? "bg-red-500" : "bg-amber-500")} />
                  {a.texto}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> Todo en orden este mes.
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              title="IVA a cargo"
              value={formatCurrency(Math.abs(data.iva.a_cargo))}
              hint={data.iva.a_cargo >= 0 ? "a pagar" : "a favor"}
              tone={data.iva.a_cargo > 0 ? "red" : "green"}
            />
            <Kpi
              title="ISR estimado (base)"
              value={formatCurrency(data.isr.base_estimada)}
              hint="base flujo — lo afina tu contador"
              tone="neutral"
            />
            <Kpi
              title="Balanza"
              value={data.contabilidad.balanza_cuadra ? "Cuadra" : "No cuadra"}
              hint={`${data.contabilidad.polizas} pólizas`}
              tone={data.contabilidad.balanza_cuadra ? "green" : "red"}
            />
            <Kpi
              title="CFDIs sin póliza"
              value={String(data.contabilidad.cfdis_sin_poliza)}
              hint={`de ${data.contabilidad.cfdis} CFDIs`}
              tone={data.contabilidad.cfdis_sin_poliza > 0 ? "amber" : "green"}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Próximas obligaciones</CardTitle>
                <CardDescription>Fechas límite del SAT para este periodo.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data.obligaciones.map((o) => (
                    <div key={o.clave} className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-0">
                      <div>
                        <p className="text-sm font-medium">{o.nombre}</p>
                        <p className="text-xs text-muted-foreground">Vence {formatDate(o.vence)}</p>
                      </div>
                      <span
                        className={cn(
                          "whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium",
                          o.estado === "vencida"
                            ? "bg-red-100 text-red-700"
                            : o.estado === "proxima"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {o.estado === "vencida"
                          ? `Vencida hace ${Math.abs(o.dias_restantes)}d`
                          : o.dias_restantes === 0
                          ? "Vence hoy"
                          : `En ${o.dias_restantes}d`}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Riesgos y conciliación</CardTitle>
                <CardDescription>Focos a revisar antes de declarar.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="space-y-2 text-sm">
                  <Row label="EFOS (69-B)" value={data.efos.coincidencias === 0 ? "Sin coincidencias" : `${data.efos.coincidencias} (${data.efos.definitivos} definitivo/s)`} bad={data.efos.definitivos > 0} warn={data.efos.coincidencias > 0} />
                  <Row label="IVA trasladado (cobrado)" value={formatCurrency(data.iva.trasladado)} />
                  <Row label="IVA acreditable (pagado)" value={formatCurrency(data.iva.acreditable)} />
                  <Row label="ISR retenido" value={formatCurrency(data.isr.retenido)} />
                  <Row label="Banco ↔ contabilidad" value={data.contabilidad.banco_conciliado ? "Conciliado" : `Dif. ${formatCurrency(Math.abs(data.contabilidad.banco_diferencia))}`} warn={!data.contabilidad.banco_conciliado} />
                </dl>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ title, value, hint, tone }: {
  title: string; value: string; hint?: string; tone: "red" | "green" | "amber" | "neutral";
}) {
  const toneClass =
    tone === "red" ? "text-red-600" : tone === "green" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-foreground";
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
        <p className={cn("mt-1 text-2xl font-bold tnum", toneClass)}>{value}</p>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

function Row({ label, value, bad, warn }: { label: string; value: string; bad?: boolean; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-1.5 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("tnum font-medium", bad ? "text-red-600" : warn ? "text-amber-700" : "text-foreground")}>{value}</dd>
    </div>
  );
}
