"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNotify } from "@/hooks/use-notify";
import { ApiClientError, clientApiFetch } from "@/lib/api-client";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type ReportKey =
  | "balanza"
  | "estado-resultados"
  | "balance-general"
  | "mayor"
  | "diario"
  | "e-contabilidad";

const REPORTS: { key: ReportKey; label: string }[] = [
  { key: "balanza", label: "Balanza de comprobación" },
  { key: "estado-resultados", label: "Estado de Resultados" },
  { key: "balance-general", label: "Balance General" },
  { key: "mayor", label: "Libro mayor" },
  { key: "diario", label: "Libro diario" },
  { key: "e-contabilidad", label: "Contabilidad electrónica (SAT)" },
];

interface CheckRow {
  id: string;
  ok: boolean;
  level: "ok" | "warning" | "error";
  message: string;
}
interface Validacion {
  ok: boolean;
  checks: CheckRow[];
  cfdi_link: {
    polizas_total: number;
    polizas_desde_cfdi: number;
    cfdis_periodo: number;
    cfdis_sin_poliza: number;
  };
}

interface BalanzaRow {
  code: string;
  name: string;
  saldo_inicial: number;
  cargos: number;
  abonos: number;
  saldo_final: number;
}
interface Balanza {
  cuentas: BalanzaRow[];
  total_cargos: number;
  total_abonos: number;
  cuadra: boolean;
}
interface EstadoResultados {
  ingresos: { mes: number; ejercicio: number };
  costos: { mes: number; ejercicio: number };
  gastos: { mes: number; ejercicio: number };
  utilidad: { mes: number; ejercicio: number };
}
interface BgRow { code: string; name: string; saldo: number }
interface BalanceGeneral {
  activo: BgRow[];
  pasivo: BgRow[];
  capital: BgRow[];
  resultado_ejercicio: number;
  total_activo: number;
  total_pasivo: number;
  total_capital: number;
  total_pasivo_capital: number;
  cuadra: boolean;
}
interface MayorMov {
  folio: number;
  fecha: string;
  concepto: string;
  descripcion: string | null;
  cargo: number;
  abono: number;
  saldo: number;
}
interface MayorCuenta {
  code: string;
  name: string;
  saldo_inicial: number;
  saldo_final: number;
  movimientos: MayorMov[];
}
interface DiarioPartida {
  account_code: string;
  account_name: string;
  cargo: number;
  abono: number;
  descripcion: string | null;
}
interface DiarioPoliza {
  folio: number;
  tipo: string;
  fecha: string;
  concepto: string;
  total_cargos: number;
  total_abonos: number;
  partidas: DiarioPartida[];
}

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i, 1).toLocaleDateString("es-MX", { month: "long" })
);

export function ReportesTab() {
  const notify = useNotify();
  const now = useMemo(() => new Date(), []);
  const [report, setReport] = useState<ReportKey>("balanza");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setData(null);
    try {
      const path =
        report === "e-contabilidad"
          ? `/api/finance/accounting/e-contabilidad/validate?year=${year}&month=${month}`
          : `/api/finance/accounting/reports/${report}?year=${year}&month=${month}`;
      const res = await clientApiFetch<{ data: unknown }>(path);
      setData(res.data);
    } catch (error) {
      notify.error({
        title: "No se pudo cargar el reporte",
        description: error instanceof ApiClientError ? error.message : "Error",
      });
    } finally {
      setLoading(false);
    }
  }, [report, year, month, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const download = (href: string, fallbackName: string) => {
    const a = document.createElement("a");
    a.href = href;
    a.rel = "noopener";
    a.download = fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const exportCsv = () => {
    download(
      `/api/finance/accounting/reports/export?report=${report}&year=${year}&month=${month}`,
      `${report}-${year}-${String(month).padStart(2, "0")}.csv`
    );
  };

  // Descarga un XML SAT; si el backend responde JSON (p. ej. falta RFC), avisa.
  const downloadXml = async (doc: "catalogo" | "balanza") => {
    try {
      const r = await fetch(
        `/api/finance/accounting/e-contabilidad/xml?doc=${doc}&year=${year}&month=${month}`,
        { cache: "no-store" }
      );
      const ct = r.headers.get("content-type") || "";
      if (!r.ok || !ct.includes("xml")) {
        let msg = "No se pudo generar el XML";
        try { msg = (await r.json()).error || msg; } catch { /* noop */ }
        notify.error({ title: "XML no generado", description: msg });
        return;
      }
      const blob = await r.blob();
      const cd = r.headers.get("content-disposition") || "";
      const m = cd.match(/filename="?([^"]+)"?/);
      const name = m?.[1] || `${doc}-${year}-${String(month).padStart(2, "0")}.xml`;
      const objUrl = URL.createObjectURL(blob);
      download(objUrl, name);
      URL.revokeObjectURL(objUrl);
    } catch {
      notify.error({ title: "XML no generado", description: "Error de red" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-muted p-1">
          {REPORTS.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setReport(r.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                report === r.key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Mes"
            className="h-9 rounded-lg border border-border bg-card px-2 text-sm capitalize"
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
          >
            {MONTHS.map((m, i) => (
              <option key={i + 1} value={i + 1} className="capitalize">
                {m}
              </option>
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
          {report !== "e-contabilidad" ? (
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={loading || !data}>
              ⬇ Exportar CSV
            </Button>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">
              {REPORTS.find((r) => r.key === report)?.label}
            </CardTitle>
            <CardDescription className="capitalize">
              {MONTHS[month - 1]} {year}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : !data ? (
            <p className="text-sm text-muted-foreground">Sin datos para este periodo.</p>
          ) : report === "balanza" ? (
            <BalanzaView d={data as Balanza} />
          ) : report === "estado-resultados" ? (
            <EstadoResultadosView d={data as EstadoResultados} />
          ) : report === "balance-general" ? (
            <BalanceGeneralView d={data as BalanceGeneral} />
          ) : report === "mayor" ? (
            <MayorView d={data as { cuentas: MayorCuenta[] }} />
          ) : report === "diario" ? (
            <DiarioView d={data as { polizas: DiarioPoliza[] }} />
          ) : (
            <EContabilidadView d={data as Validacion} onDownload={downloadXml} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CuadraBadge({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
      )}
    >
      {ok ? "✓ Cuadra" : "⚠ No cuadra"}
    </span>
  );
}

function BalanzaView({ d }: { d: Balanza }) {
  if (!d.cuentas.length) return <p className="text-sm text-muted-foreground">Sin movimientos.</p>;
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><CuadraBadge ok={d.cuadra} /></div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="py-2">Código</th>
              <th className="py-2">Cuenta</th>
              <th className="py-2 text-right">Saldo inicial</th>
              <th className="py-2 text-right">Cargos</th>
              <th className="py-2 text-right">Abonos</th>
              <th className="py-2 text-right">Saldo final</th>
            </tr>
          </thead>
          <tbody>
            {d.cuentas.map((c) => (
              <tr key={c.code} className="border-t border-border">
                <td className="py-2 font-mono text-xs">{c.code}</td>
                <td className="py-2">{c.name}</td>
                <td className="tnum py-2 text-right text-muted-foreground">{formatCurrency(c.saldo_inicial)}</td>
                <td className="tnum py-2 text-right">{formatCurrency(c.cargos)}</td>
                <td className="tnum py-2 text-right">{formatCurrency(c.abonos)}</td>
                <td className="tnum py-2 text-right font-medium">{formatCurrency(c.saldo_final)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td className="py-2" colSpan={3}>Totales</td>
              <td className="tnum py-2 text-right">{formatCurrency(d.total_cargos)}</td>
              <td className="tnum py-2 text-right">{formatCurrency(d.total_abonos)}</td>
              <td className="py-2" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function ErRow({ label, mes, ejercicio, strong }: { label: string; mes: number; ejercicio: number; strong?: boolean }) {
  return (
    <tr className={cn("border-t border-border", strong && "border-t-2 font-semibold")}>
      <td className="py-2">{label}</td>
      <td className="tnum py-2 text-right">{formatCurrency(mes)}</td>
      <td className="tnum py-2 text-right">{formatCurrency(ejercicio)}</td>
    </tr>
  );
}

function EstadoResultadosView({ d }: { d: EstadoResultados }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full max-w-2xl text-sm">
        <thead className="text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="py-2">Concepto</th>
            <th className="py-2 text-right">Del mes</th>
            <th className="py-2 text-right">Del ejercicio</th>
          </tr>
        </thead>
        <tbody>
          <ErRow label="Ingresos" mes={d.ingresos.mes} ejercicio={d.ingresos.ejercicio} />
          <ErRow label="(−) Costos" mes={d.costos.mes} ejercicio={d.costos.ejercicio} />
          <ErRow label="(−) Gastos" mes={d.gastos.mes} ejercicio={d.gastos.ejercicio} />
          <ErRow label="Utilidad (pérdida)" mes={d.utilidad.mes} ejercicio={d.utilidad.ejercicio} strong />
        </tbody>
      </table>
    </div>
  );
}

function BgColumn({ title, rows, total, totalLabel }: {
  title: string; rows: BgRow[]; total: number; totalLabel: string;
}) {
  return (
    <div className="min-w-[240px] flex-1">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <table className="w-full text-sm">
        <tbody>
          {rows.length === 0 ? (
            <tr><td className="py-2 text-muted-foreground">Sin saldos</td></tr>
          ) : (
            rows.map((r) => (
              <tr key={r.code} className="border-t border-border">
                <td className="py-1.5">
                  <span className="font-mono text-xs text-muted-foreground">{r.code}</span> {r.name}
                </td>
                <td className="tnum py-1.5 text-right">{formatCurrency(r.saldo)}</td>
              </tr>
            ))
          )}
          <tr className="border-t-2 border-border font-semibold">
            <td className="py-2">{totalLabel}</td>
            <td className="tnum py-2 text-right">{formatCurrency(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function BalanceGeneralView({ d }: { d: BalanceGeneral }) {
  const pasivoCapitalRows: BgRow[] = [
    ...d.pasivo,
    ...d.capital,
    { code: "—", name: "Resultado del ejercicio", saldo: d.resultado_ejercicio },
  ];
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><CuadraBadge ok={d.cuadra} /></div>
      <div className="flex flex-wrap gap-8">
        <BgColumn title="Activo" rows={d.activo} total={d.total_activo} totalLabel="Total activo" />
        <BgColumn
          title="Pasivo + Capital"
          rows={pasivoCapitalRows}
          total={d.total_pasivo_capital}
          totalLabel="Total pasivo + capital"
        />
      </div>
    </div>
  );
}

function MayorView({ d }: { d: { cuentas: MayorCuenta[] } }) {
  if (!d.cuentas.length) return <p className="text-sm text-muted-foreground">Sin movimientos.</p>;
  return (
    <div className="space-y-6">
      {d.cuentas.map((c) => (
        <div key={c.code}>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              <span className="font-mono text-xs text-muted-foreground">{c.code}</span> {c.name}
            </h3>
            <span className="text-xs text-muted-foreground">
              Inicial {formatCurrency(c.saldo_inicial)} · Final{" "}
              <span className="font-medium text-foreground">{formatCurrency(c.saldo_final)}</span>
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-1.5">Folio</th>
                  <th className="py-1.5">Fecha</th>
                  <th className="py-1.5">Concepto</th>
                  <th className="py-1.5 text-right">Cargo</th>
                  <th className="py-1.5 text-right">Abono</th>
                  <th className="py-1.5 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {c.movimientos.map((m, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="py-1.5 font-mono text-xs">{m.folio}</td>
                    <td className="py-1.5 whitespace-nowrap">{formatDate(m.fecha)}</td>
                    <td className="max-w-[280px] truncate py-1.5">{m.descripcion || m.concepto}</td>
                    <td className="tnum py-1.5 text-right">{m.cargo ? formatCurrency(m.cargo) : "—"}</td>
                    <td className="tnum py-1.5 text-right">{m.abono ? formatCurrency(m.abono) : "—"}</td>
                    <td className="tnum py-1.5 text-right font-medium">{formatCurrency(m.saldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function EContabilidadView({
  d,
  onDownload,
}: {
  d: Validacion;
  onDownload: (doc: "catalogo" | "balanza") => void;
}) {
  const dot = (lvl: CheckRow["level"]) =>
    lvl === "ok" ? "bg-emerald-500" : lvl === "warning" ? "bg-amber-500" : "bg-red-500";
  const blockingError = d.checks.some((c) => c.level === "error");
  const l = d.cfdi_link;
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        {d.checks.map((c) => (
          <div key={c.id} className="flex items-start gap-2 text-sm">
            <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", dot(c.level))} />
            <span className={cn(c.level === "error" && "text-red-600", c.level === "warning" && "text-amber-700")}>
              {c.message}
            </span>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
        <p className="mb-1 font-medium">Enlace póliza ↔ CFDI</p>
        <p className="text-muted-foreground">
          {l.polizas_desde_cfdi} de {l.polizas_total} póliza(s) provienen de CFDIs ·{" "}
          {l.cfdis_periodo} CFDI(s) en el periodo ·{" "}
          {l.cfdis_sin_poliza === 0 ? (
            <span className="text-emerald-600">sin CFDIs pendientes de póliza</span>
          ) : (
            <span className="text-amber-700">{l.cfdis_sin_poliza} CFDI(s) sin póliza</span>
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => onDownload("catalogo")}>
          ⬇ Catálogo de cuentas (XML)
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onDownload("balanza")}
          disabled={blockingError}
          title={blockingError ? "Corrige los errores antes de generar la balanza" : undefined}
        >
          ⬇ Balanza mensual (XML)
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        XML conforme al Anexo 24 del SAT (Contabilidad Electrónica 1.3). El nombre del archivo sigue el formato
        RFC + año + mes que exige el buzón tributario.
      </p>
    </div>
  );
}

function DiarioView({ d }: { d: { polizas: DiarioPoliza[] } }) {
  if (!d.polizas.length) return <p className="text-sm text-muted-foreground">Sin pólizas en el periodo.</p>;
  return (
    <div className="space-y-5">
      {d.polizas.map((p) => (
        <div key={p.folio} className="rounded-lg border border-border">
          <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/50 px-3 py-2">
            <span className="text-sm font-medium">
              <span className="font-mono text-xs text-muted-foreground">#{p.folio}</span>{" "}
              <span className="capitalize">{p.tipo}</span> · {p.concepto}
            </span>
            <span className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(p.fecha)}</span>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {p.partidas.map((l, i) => (
                <tr key={i} className="border-t border-border first:border-t-0">
                  <td className="py-1.5 pl-3">
                    <span className="font-mono text-xs text-muted-foreground">{l.account_code}</span> {l.account_name}
                  </td>
                  <td className="tnum w-32 py-1.5 pr-3 text-right">{l.cargo ? formatCurrency(l.cargo) : ""}</td>
                  <td className="tnum w-32 py-1.5 pr-3 text-right">{l.abono ? formatCurrency(l.abono) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
