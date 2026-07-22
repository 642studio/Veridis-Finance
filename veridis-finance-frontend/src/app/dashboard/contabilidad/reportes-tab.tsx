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
  | "e-contabilidad"
  | "auditoria"
  | "diot"
  | "gastos-sin-cfdi";

const REPORTS: { key: ReportKey; label: string }[] = [
  { key: "balanza", label: "Balanza de comprobación" },
  { key: "estado-resultados", label: "Estado de Resultados" },
  { key: "balance-general", label: "Balance General" },
  { key: "mayor", label: "Libro mayor" },
  { key: "diario", label: "Libro diario" },
  { key: "e-contabilidad", label: "Contabilidad electrónica (SAT)" },
  { key: "auditoria", label: "Auditoría preventiva" },
  { key: "diot", label: "DIOT" },
  { key: "gastos-sin-cfdi", label: "Gastos sin CFDI" },
];

interface GastoFaltante {
  id: string;
  date: string;
  amount: number;
  concepto: string | null;
  categoria: string | null;
  motivo: string;
}
interface GastosSinCfdi {
  faltantes: GastoFaltante[];
  resumen: {
    con_riesgo: number;
    monto_en_riesgo: number;
    cfdi_del_banco: number;
    no_aplica: number;
  };
}

interface DiotRow {
  tipo_tercero: string;
  tipo_operacion: string;
  rfc: string;
  proveedor: string;
  valor_16: number;
  iva_16: number;
  valor_0: number;
  exentos: number;
  iva_retenido: number;
  count: number;
}
interface Diot {
  proveedores: DiotRow[];
  totales: {
    valor_16: number;
    iva_16: number;
    valor_0: number;
    exentos: number;
    iva_retenido: number;
    proveedores: number;
  };
  cfdis: number;
}

interface Hallazgo {
  id: string;
  titulo: string;
  severidad: "ok" | "info" | "warning" | "error";
  detalle: string;
  cantidad?: number;
}
interface Auditoria {
  resumen: { ok: number; info: number; warning: number; error: number };
  hallazgos: Hallazgo[];
}

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
          : report === "auditoria"
          ? `/api/finance/accounting/auditoria?year=${year}&month=${month}`
          : report === "diot"
          ? `/api/finance/fiscal/diot?year=${year}&month=${month}`
          : report === "gastos-sin-cfdi"
          ? `/api/finance/accounting/gastos-sin-cfdi?year=${year}&month=${month}`
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
          {report === "diot" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                download(
                  `/api/finance/fiscal/diot/export?year=${year}&month=${month}`,
                  `DIOT_${year}${String(month).padStart(2, "0")}.txt`
                )
              }
              disabled={loading || !data}
            >
              ⬇ Exportar DIOT (.txt)
            </Button>
          ) : report !== "e-contabilidad" && report !== "auditoria" && report !== "gastos-sin-cfdi" ? (
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
          ) : report === "e-contabilidad" ? (
            <EContabilidadView d={data as Validacion} onDownload={downloadXml} />
          ) : report === "auditoria" ? (
            <AuditoriaView d={data as Auditoria} />
          ) : report === "diot" ? (
            <DiotView d={data as Diot} />
          ) : (
            <GastosSinCfdiView d={data as GastosSinCfdi} />
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

const TIPO_TERCERO: Record<string, string> = { "04": "Nacional", "05": "Extranjero", "15": "Global" };
const TIPO_OP: Record<string, string> = { "03": "Servicios prof.", "06": "Arrendamiento", "85": "Otros" };

function DiotView({ d }: { d: Diot }) {
  if (!d.proveedores.length) {
    return <p className="text-sm text-muted-foreground">Sin operaciones con proveedores en el periodo.</p>;
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {d.totales.proveedores} proveedor(es) · {d.cfdis} CFDI(s) recibidos. El archivo .txt sigue el layout de
        captura batch del SAT para la DIOT.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="py-2">RFC</th>
              <th className="py-2">Proveedor</th>
              <th className="py-2">Tercero</th>
              <th className="py-2">Operación</th>
              <th className="py-2 text-right">Actos 16%</th>
              <th className="py-2 text-right">IVA acred.</th>
              <th className="py-2 text-right">IVA ret.</th>
            </tr>
          </thead>
          <tbody>
            {d.proveedores.map((p) => (
              <tr key={`${p.rfc}-${p.tipo_operacion}`} className="border-t border-border">
                <td className="py-2 font-mono text-xs">{p.rfc}</td>
                <td className="max-w-[220px] truncate py-2">{p.proveedor}</td>
                <td className="py-2 text-xs">{TIPO_TERCERO[p.tipo_tercero] || p.tipo_tercero}</td>
                <td className="py-2 text-xs">{TIPO_OP[p.tipo_operacion] || p.tipo_operacion}</td>
                <td className="tnum py-2 text-right">{formatCurrency(p.valor_16)}</td>
                <td className="tnum py-2 text-right">{formatCurrency(p.iva_16)}</td>
                <td className="tnum py-2 text-right text-muted-foreground">
                  {p.iva_retenido ? formatCurrency(p.iva_retenido) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td className="py-2" colSpan={4}>Totales</td>
              <td className="tnum py-2 text-right">{formatCurrency(d.totales.valor_16)}</td>
              <td className="tnum py-2 text-right">{formatCurrency(d.totales.iva_16)}</td>
              <td className="tnum py-2 text-right">{formatCurrency(d.totales.iva_retenido)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function GastosSinCfdiView({ d }: { d: GastosSinCfdi }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-amber-700">Gastos sin CFDI</p>
          <p className="tnum mt-1 text-2xl font-bold text-amber-800">{formatCurrency(d.resumen.monto_en_riesgo)}</p>
          <p className="text-xs text-amber-700">{d.resumen.con_riesgo} gasto(s) por facturar</p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">CFDI del banco</p>
          <p className="tnum mt-1 text-2xl font-bold text-foreground">{d.resumen.cfdi_del_banco}</p>
          <p className="text-xs text-muted-foreground">comisiones (las emite el banco)</p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">No aplica</p>
          <p className="tnum mt-1 text-2xl font-bold text-foreground">{d.resumen.no_aplica}</p>
          <p className="text-xs text-muted-foreground">traspasos / nómina</p>
        </div>
      </div>
      {d.faltantes.length === 0 ? (
        <p className="text-sm text-emerald-700">Sin gastos deducibles pendientes de CFDI en el periodo. 🎉</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2">Fecha</th>
                <th className="py-2">Concepto</th>
                <th className="py-2">Categoría</th>
                <th className="py-2 text-right">Monto</th>
              </tr>
            </thead>
            <tbody>
              {d.faltantes.map((g) => (
                <tr key={g.id} className="border-t border-border">
                  <td className="py-2 whitespace-nowrap">{formatDate(g.date)}</td>
                  <td className="py-2">{g.concepto || "—"}</td>
                  <td className="py-2 text-muted-foreground">{g.categoria || "—"}</td>
                  <td className="tnum py-2 text-right font-medium">{formatCurrency(g.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Estos gastos se pagaron pero no tienen factura conciliada. Captura o descarga sus CFDIs (módulo Descarga SAT)
        para poder deducirlos.
      </p>
    </div>
  );
}

function AuditoriaView({ d }: { d: Auditoria }) {
  const style: Record<Hallazgo["severidad"], { dot: string; ring: string; text?: string }> = {
    error: { dot: "bg-red-500", ring: "border-red-200 bg-red-50", text: "text-red-700" },
    warning: { dot: "bg-amber-500", ring: "border-amber-200 bg-amber-50", text: "text-amber-800" },
    info: { dot: "bg-sky-500", ring: "border-sky-200 bg-sky-50", text: "text-sky-800" },
    ok: { dot: "bg-emerald-500", ring: "border-border bg-card" },
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-red-100 px-2.5 py-1 font-medium text-red-700">{d.resumen.error} errores</span>
        <span className="rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-800">{d.resumen.warning} avisos</span>
        <span className="rounded-full bg-sky-100 px-2.5 py-1 font-medium text-sky-800">{d.resumen.info} informativos</span>
        <span className="rounded-full bg-emerald-100 px-2.5 py-1 font-medium text-emerald-700">{d.resumen.ok} correctos</span>
      </div>
      <div className="space-y-2">
        {d.hallazgos.map((h) => {
          const s = style[h.severidad];
          return (
            <div key={h.id} className={cn("flex items-start gap-3 rounded-lg border px-3 py-2.5", s.ring)}>
              <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", s.dot)} />
              <div className="min-w-0">
                <p className={cn("text-sm font-medium", s.text)}>{h.titulo}</p>
                <p className="text-sm text-muted-foreground">{h.detalle}</p>
              </div>
            </div>
          );
        })}
      </div>
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
