"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useSession } from "@/components/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNotify } from "@/hooks/use-notify";
import { ApiClientError, clientApiFetch } from "@/lib/api-client";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Account {
  id: string;
  code: string;
  name: string;
  account_type: string;
  nature: string;
  balance?: number;
}

interface Entry {
  id: string;
  folio: number;
  entry_type: string;
  entry_date: string;
  concept: string;
  status: string;
  source: string;
  total_debit: number;
  total_credit: number;
}

interface Line {
  account_code: string;
  debit: string;
  credit: string;
}

const TYPE_LABELS: Record<string, string> = {
  activo: "Activo", pasivo: "Pasivo", capital: "Capital",
  ingreso: "Ingreso", costo: "Costo", gasto: "Gasto", orden: "Orden",
};

const emptyLine: Line = { account_code: "", debit: "", credit: "" };

export default function ContabilidadPage() {
  const notify = useNotify();
  const { canWrite } = useSession();
  const [tab, setTab] = useState<"catalogo" | "polizas">("polizas");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  // Nueva póliza
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [entryType, setEntryType] = useState<"ingreso" | "egreso" | "diario">("diario");
  const [concept, setConcept] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine }, { ...emptyLine }]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, e] = await Promise.all([
        clientApiFetch<{ data: Account[] }>("/api/finance/accounting/accounts?with_balance=true"),
        clientApiFetch<{ data: Entry[] }>("/api/finance/accounting/entries"),
      ]);
      setAccounts(a.data || []);
      setEntries(e.data || []);
    } catch (error) {
      notify.error({
        title: "No se pudo cargar",
        description: error instanceof ApiClientError ? error.message : "Error",
      });
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(() => {
    let d = 0;
    let c = 0;
    for (const l of lines) {
      d += Number(l.debit) || 0;
      c += Number(l.credit) || 0;
    }
    return { debit: d, credit: c, balanced: Math.abs(d - c) < 0.005 && d > 0 };
  }, [lines]);

  const postableAccounts = accounts;

  const submitEntry = async () => {
    setBusy(true);
    try {
      await clientApiFetch("/api/finance/accounting/entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entry_type: entryType,
          entry_date: entryDate,
          concept,
          lines: lines
            .filter((l) => l.account_code && (Number(l.debit) || Number(l.credit)))
            .map((l) => ({
              account_code: l.account_code,
              debit: Number(l.debit) || 0,
              credit: Number(l.credit) || 0,
            })),
        }),
      });
      notify.success({ title: "Póliza registrada" });
      setOpen(false);
      setConcept("");
      setLines([{ ...emptyLine }, { ...emptyLine }]);
      load();
    } catch (error) {
      notify.error({
        title: "No se pudo registrar la póliza",
        description: error instanceof ApiClientError ? error.message : "Error",
      });
    } finally {
      setBusy(false);
    }
  };

  const setLine = (i: number, patch: Partial<Line>) => {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Contabilidad</h1>
          <p className="text-sm text-muted-foreground">
            Partida doble: catálogo de cuentas con código agrupador SAT y pólizas balanceadas.
          </p>
        </div>
        {canWrite ? <Button onClick={() => setOpen(true)}>Nueva póliza</Button> : null}
      </div>

      <div className="flex items-center gap-1 rounded-lg border border-border bg-muted p-1 w-fit">
        {(["polizas", "catalogo"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors",
              tab === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "polizas" ? "Pólizas" : "Catálogo de cuentas"}
          </button>
        ))}
      </div>

      {tab === "catalogo" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Catálogo de cuentas ({accounts.length})</CardTitle>
            <CardDescription>Saldos calculados de las pólizas registradas.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Cargando…</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-2">Código</th>
                      <th className="py-2">Cuenta</th>
                      <th className="py-2">Tipo</th>
                      <th className="py-2">Naturaleza</th>
                      <th className="py-2 text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((a) => (
                      <tr key={a.id} className="border-t border-border">
                        <td className="py-2 font-mono text-xs">{a.code}</td>
                        <td className="py-2">{a.name}</td>
                        <td className="py-2">{TYPE_LABELS[a.account_type] || a.account_type}</td>
                        <td className="py-2 capitalize text-muted-foreground">{a.nature}</td>
                        <td className="tnum py-2 text-right font-medium">
                          {a.balance ? formatCurrency(a.balance) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pólizas ({entries.length})</CardTitle>
            <CardDescription>Asientos contables registrados.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Cargando…</p>
            ) : entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aún no hay pólizas. Crea una manual, o cuando conectemos las pólizas automáticas se generarán
                desde tus CFDIs y movimientos.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-2">Folio</th>
                      <th className="py-2">Fecha</th>
                      <th className="py-2">Tipo</th>
                      <th className="py-2">Concepto</th>
                      <th className="py-2">Origen</th>
                      <th className="py-2 text-right">Cargos</th>
                      <th className="py-2 text-right">Abonos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.id} className="border-t border-border">
                        <td className="py-2 font-mono text-xs">{e.folio}</td>
                        <td className="py-2 whitespace-nowrap">{formatDate(e.entry_date)}</td>
                        <td className="py-2 capitalize">{e.entry_type}</td>
                        <td className="max-w-[280px] truncate py-2">{e.concept}</td>
                        <td className="py-2">
                          <Badge className="bg-muted text-muted-foreground">{e.source}</Badge>
                        </td>
                        <td className="tnum py-2 text-right">{formatCurrency(e.total_debit)}</td>
                        <td className="tnum py-2 text-right">{formatCurrency(e.total_credit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Nueva póliza */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Nueva póliza</DialogTitle>
            <DialogDescription>El asiento debe cuadrar: la suma de cargos debe igualar la de abonos.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label htmlFor="pol_fecha">Fecha</Label>
                <Input id="pol_fecha" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pol_tipo">Tipo</Label>
                <select
                  id="pol_tipo"
                  className="flex h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                  value={entryType}
                  onChange={(e) => setEntryType(e.target.value as typeof entryType)}
                >
                  <option value="diario">Diario</option>
                  <option value="ingreso">Ingreso</option>
                  <option value="egreso">Egreso</option>
                </select>
              </div>
              <div className="space-y-1 col-span-1">
                <Label htmlFor="pol_concepto">Concepto</Label>
                <Input id="pol_concepto" value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Descripción" />
              </div>
            </div>

            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_120px_120px_32px] gap-2 text-xs font-semibold uppercase text-muted-foreground">
                <span>Cuenta</span><span className="text-right">Cargo</span><span className="text-right">Abono</span><span />
              </div>
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_120px_120px_32px] items-center gap-2">
                  <select
                    className="h-9 w-full rounded-lg border border-border bg-card px-2 text-sm"
                    value={l.account_code}
                    onChange={(e) => setLine(i, { account_code: e.target.value })}
                  >
                    <option value="">Selecciona cuenta…</option>
                    {postableAccounts.map((a) => (
                      <option key={a.id} value={a.code}>{a.code} · {a.name}</option>
                    ))}
                  </select>
                  <Input
                    className="h-9 text-right"
                    inputMode="decimal"
                    value={l.debit}
                    onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })}
                    placeholder="0.00"
                  />
                  <Input
                    className="h-9 text-right"
                    inputMode="decimal"
                    value={l.credit}
                    onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })}
                    placeholder="0.00"
                  />
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-red-600"
                    onClick={() => setLines((prev) => (prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev))}
                    aria-label="Quitar partida"
                  >
                    ×
                  </button>
                </div>
              ))}
              <Button variant="ghost" size="sm" onClick={() => setLines((prev) => [...prev, { ...emptyLine }])}>
                + Agregar partida
              </Button>
            </div>

            <div
              className={cn(
                "flex items-center justify-between rounded-lg border px-4 py-2.5 text-sm",
                totals.balanced ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"
              )}
            >
              <span className="font-medium">
                {totals.balanced ? "✓ La póliza cuadra" : "La póliza no cuadra"}
              </span>
              <span className="tnum text-muted-foreground">
                Cargos {formatCurrency(totals.debit)} · Abonos {formatCurrency(totals.credit)} · Dif{" "}
                {formatCurrency(Math.abs(totals.debit - totals.credit))}
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submitEntry} disabled={busy || !totals.balanced || !concept.trim()}>
              {busy ? "Registrando…" : "Registrar póliza"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
