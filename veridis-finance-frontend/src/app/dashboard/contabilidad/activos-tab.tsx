"use client";

import { useCallback, useEffect, useState } from "react";

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

interface Asset {
  id: string;
  name: string;
  category: string | null;
  acquisition_date: string;
  cost: number;
  salvage_value: number;
  annual_rate: number;
  status: string;
  asset_account_code: string;
}

const STATUS_LABELS: Record<string, string> = {
  activo: "Activo",
  baja: "Baja",
  totalmente_depreciado: "Depreciado",
};

// Tasas SAT típicas (art. 34/35 LISR) para arranque rápido.
const RATE_PRESETS: { label: string; rate: number; category: string }[] = [
  { label: "Mobiliario y equipo (10%)", rate: 0.1, category: "mobiliario" },
  { label: "Equipo de cómputo (30%)", rate: 0.3, category: "equipo_computo" },
  { label: "Automóviles (25%)", rate: 0.25, category: "automoviles" },
  { label: "Construcciones (5%)", rate: 0.05, category: "construcciones" },
];

const now = new Date();

export function ActivosTab() {
  const notify = useNotify();
  const { canWrite } = useSession();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [depBusy, setDepBusy] = useState(false);
  const [genYear, setGenYear] = useState(now.getFullYear());
  const [genMonth, setGenMonth] = useState(now.getMonth() + 1);

  const [name, setName] = useState("");
  const [cost, setCost] = useState("");
  const [salvage, setSalvage] = useState("0");
  const [rate, setRate] = useState(0.1);
  const [category, setCategory] = useState("mobiliario");
  const [acqDate, setAcqDate] = useState(new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await clientApiFetch<{ data: Asset[] }>("/api/finance/accounting/assets");
      setAssets(res.data || []);
    } catch (error) {
      notify.error({
        title: "No se pudieron cargar los activos",
        description: error instanceof ApiClientError ? error.message : "Error",
      });
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    setBusy(true);
    try {
      await clientApiFetch("/api/finance/accounting/assets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          category,
          acquisition_date: acqDate,
          cost: Number(cost) || 0,
          salvage_value: Number(salvage) || 0,
          annual_rate: rate,
        }),
      });
      notify.success({ title: "Activo registrado" });
      setOpen(false);
      setName("");
      setCost("");
      setSalvage("0");
      load();
    } catch (error) {
      notify.error({
        title: "No se pudo registrar",
        description: error instanceof ApiClientError ? error.message : "Error",
      });
    } finally {
      setBusy(false);
    }
  };

  const depreciate = async () => {
    setDepBusy(true);
    try {
      const res = await clientApiFetch<{ data: { assets: number; posted: number; skipped: number } }>(
        "/api/finance/accounting/assets/depreciate",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ year: genYear, month: genMonth }),
        }
      );
      const d = res.data;
      notify.success({
        title: "Depreciación registrada",
        description: `${d.posted} póliza(s) de ${d.assets} activo(s); ${d.skipped} sin depreciación o ya registradas.`,
      });
    } catch (error) {
      notify.error({
        title: "No se pudo depreciar",
        description: error instanceof ApiClientError ? error.message : "Error",
      });
    } finally {
      setDepBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {canWrite ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <select
            aria-label="Mes"
            className="h-9 rounded-lg border border-border bg-card px-2 text-sm"
            value={genMonth}
            onChange={(e) => setGenMonth(Number(e.target.value))}
          >
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {new Date(2000, i, 1).toLocaleDateString("es-MX", { month: "long" })}
              </option>
            ))}
          </select>
          <select
            aria-label="Año"
            className="h-9 rounded-lg border border-border bg-card px-2 text-sm"
            value={genYear}
            onChange={(e) => setGenYear(Number(e.target.value))}
          >
            {[now.getFullYear() - 1, now.getFullYear()].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <Button variant="outline" onClick={depreciate} disabled={depBusy}>
            {depBusy ? "Depreciando…" : "⚙️ Depreciar periodo"}
          </Button>
          <Button onClick={() => setOpen(true)}>Nuevo activo</Button>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activos fijos ({assets.length})</CardTitle>
          <CardDescription>
            Depreciación en línea recta. “Depreciar periodo” genera la póliza mensual (cargo gasto / abono
            depreciación acumulada), idempotente por mes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : assets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aún no hay activos. Registra tus equipos, mobiliario y automóviles para depreciarlos.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2">Activo</th>
                    <th className="py-2">Adquisición</th>
                    <th className="py-2 text-right">Costo</th>
                    <th className="py-2 text-right">Rescate</th>
                    <th className="py-2 text-right">Tasa anual</th>
                    <th className="py-2">Estatus</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map((a) => (
                    <tr key={a.id} className="border-t border-border">
                      <td className="py-2">
                        {a.name}
                        {a.category ? (
                          <span className="ml-2 text-xs text-muted-foreground">{a.category}</span>
                        ) : null}
                      </td>
                      <td className="py-2 whitespace-nowrap">{formatDate(a.acquisition_date)}</td>
                      <td className="tnum py-2 text-right">{formatCurrency(a.cost)}</td>
                      <td className="tnum py-2 text-right text-muted-foreground">{formatCurrency(a.salvage_value)}</td>
                      <td className="tnum py-2 text-right">{(a.annual_rate * 100).toFixed(0)}%</td>
                      <td className="py-2">
                        <Badge className="bg-muted text-muted-foreground">{STATUS_LABELS[a.status] || a.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Nuevo activo fijo</DialogTitle>
            <DialogDescription>La depreciación empieza el mes siguiente a la adquisición.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="af_name">Nombre</Label>
              <Input id="af_name" value={name} onChange={(e) => setName(e.target.value)} placeholder="MacBook Pro" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="af_cat">Tipo (tasa SAT)</Label>
              <select
                id="af_cat"
                className="flex h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                value={category}
                onChange={(e) => {
                  const preset = RATE_PRESETS.find((p) => p.category === e.target.value);
                  setCategory(e.target.value);
                  if (preset) setRate(preset.rate);
                }}
              >
                {RATE_PRESETS.map((p) => (
                  <option key={p.category} value={p.category}>{p.label}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="af_cost">Costo</Label>
                <Input id="af_cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="af_salv">Valor de rescate</Label>
                <Input id="af_salv" inputMode="decimal" value={salvage} onChange={(e) => setSalvage(e.target.value)} placeholder="0.00" />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="af_date">Fecha de adquisición</Label>
              <Input id="af_date" type="date" value={acqDate} onChange={(e) => setAcqDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={busy || !name.trim() || !(Number(cost) > 0)}>
              {busy ? "Guardando…" : "Registrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
