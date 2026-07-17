"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useSession } from "@/components/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNotify } from "@/hooks/use-notify";
import { ApiClientError, clientApiFetch } from "@/lib/api-client";
import { formatCurrency, formatDate } from "@/lib/format";

interface Receiver {
  id: string;
  rfc: string;
  name: string;
  fiscal_regime: string;
  zip_code: string;
  cfdi_use: string;
  email?: string | null;
  source: string;
}

interface Cfdi {
  id: string;
  status: string;
  uuid: string | null;
  folio: string | null;
  receiver_rfc: string | null;
  receiver_name: string | null;
  total: number | null;
  metodo_pago: string | null;
  created_at: string;
  error_message?: string | null;
}

interface CrmStatus {
  connected: boolean;
  location_id: string | null;
  installed_at: string | null;
}

const emptyCsf = { rfc: "", name: "", fiscal_regime: "", zip_code: "", cfdi_use: "G03", email: "" };
const emptyItem = { description: "", quantity: "1", unitPrice: "" };

export default function CfdiPage() {
  const notify = useNotify();
  const { canWrite } = useSession();

  const [cfdis, setCfdis] = useState<Cfdi[]>([]);
  const [receivers, setReceivers] = useState<Receiver[]>([]);
  const [crm, setCrm] = useState<CrmStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // CSF upload / receiver form
  const [csfOpen, setCsfOpen] = useState(false);
  const [csfBusy, setCsfBusy] = useState(false);
  const [csfForm, setCsfForm] = useState({ ...emptyCsf });
  const fileRef = useRef<HTMLInputElement>(null);

  // Issue CFDI form
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueBusy, setIssueBusy] = useState(false);
  const [receiverId, setReceiverId] = useState("");
  const [items, setItems] = useState([{ ...emptyItem }]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, r, s] = await Promise.all([
        clientApiFetch<{ data: Cfdi[] }>("/api/finance/cfdi"),
        clientApiFetch<{ data: Receiver[] }>("/api/finance/receivers"),
        clientApiFetch<{ data: CrmStatus }>("/api/crm/status").catch(() => ({ data: null })),
      ]);
      setCfdis(c.data || []);
      setReceivers(r.data || []);
      setCrm((s as { data: CrmStatus | null }).data);
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

  const handleCsfFile = async (file: File) => {
    setCsfBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/finance/receivers/preview-csf", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "No se pudo leer el CSF");
      const d = body.data;
      setCsfForm({
        rfc: d.rfc || "",
        name: d.name || "",
        fiscal_regime: d.fiscal_regime || "",
        zip_code: d.zip_code || "",
        cfdi_use: "G03",
        email: "",
      });
      notify.success({
        title: "CSF leído",
        description: "Revisa y confirma los datos (especialmente la razón social).",
      });
    } catch (error) {
      notify.error({ title: "Error al leer CSF", description: (error as Error).message });
    } finally {
      setCsfBusy(false);
    }
  };

  const saveReceiver = async () => {
    setCsfBusy(true);
    try {
      await clientApiFetch("/api/finance/receivers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...csfForm, source: "csf", csf_uploaded: true }),
      });
      notify.success({ title: "Receptor guardado" });
      setCsfOpen(false);
      setCsfForm({ ...emptyCsf });
      load();
    } catch (error) {
      notify.error({
        title: "No se pudo guardar",
        description: error instanceof ApiClientError ? error.message : "Error",
      });
    } finally {
      setCsfBusy(false);
    }
  };

  const issueCfdi = async () => {
    setIssueBusy(true);
    try {
      await clientApiFetch("/api/finance/cfdi", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          receiver_id: receiverId,
          paymentMethod: "PUE",
          paymentForm: "03",
          items: items.map((it) => ({
            description: it.description,
            quantity: Number(it.quantity),
            unitPrice: Number(it.unitPrice),
            ivaRate: 0.16,
          })),
          source: "manual",
        }),
      });
      notify.success({ title: "CFDI timbrado ✅" });
      setIssueOpen(false);
      setItems([{ ...emptyItem }]);
      setReceiverId("");
      load();
    } catch (error) {
      notify.error({
        title: "No se pudo timbrar",
        description: error instanceof ApiClientError ? error.message : "Error",
      });
    } finally {
      setIssueBusy(false);
    }
  };

  const connectCrm = async () => {
    try {
      const res = await clientApiFetch<{ url: string }>("/api/crm/connect");
      if (res.url) window.location.href = res.url;
    } catch (error) {
      notify.error({
        title: "No se pudo conectar",
        description: error instanceof ApiClientError ? error.message : "Error",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Facturación (CFDI)</h1>
          <p className="text-sm text-muted-foreground">
            Emite CFDI 4.0, gestiona receptores desde su Constancia y conecta 642 CRM.
          </p>
        </div>
        {canWrite ? (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setCsfOpen(true)}>
              Subir CSF / Nuevo receptor
            </Button>
            <Button onClick={() => setIssueOpen(true)} disabled={!receivers.length}>
              Emitir CFDI
            </Button>
          </div>
        ) : null}
      </div>

      {/* 642 CRM connection */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">642 CRM</CardTitle>
            <CardDescription>
              Conecta tu CRM para timbrar automáticamente cuando se paga una factura.
            </CardDescription>
          </div>
          {crm?.connected ? (
            <Badge className="bg-emerald-100 text-emerald-700">Conectado</Badge>
          ) : (
            <Button size="sm" variant="outline" onClick={connectCrm}>
              Conectar 642 CRM
            </Button>
          )}
        </CardHeader>
      </Card>

      {/* Receivers */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Receptores ({receivers.length})</CardTitle>
          <CardDescription>Clientes con datos fiscales (extraídos de su CSF).</CardDescription>
        </CardHeader>
        <CardContent>
          {receivers.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2">RFC</th>
                    <th className="py-2">Razón social</th>
                    <th className="py-2">Régimen</th>
                    <th className="py-2">CP</th>
                  </tr>
                </thead>
                <tbody>
                  {receivers.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="py-2 font-mono text-xs">{r.rfc}</td>
                      <td className="py-2">{r.name}</td>
                      <td className="py-2">{r.fiscal_regime}</td>
                      <td className="py-2">{r.zip_code}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Aún no hay receptores. Sube el CSF de un cliente para empezar.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Issued CFDIs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">CFDIs emitidos ({cfdis.length})</CardTitle>
          <CardDescription>Comprobantes timbrados.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : cfdis.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2">Fecha</th>
                    <th className="py-2">Receptor</th>
                    <th className="py-2">Total</th>
                    <th className="py-2">Estatus</th>
                    <th className="py-2">UUID</th>
                    <th className="py-2 text-right">Descargar</th>
                  </tr>
                </thead>
                <tbody>
                  {cfdis.map((c) => (
                    <tr key={c.id} className="border-t border-border">
                      <td className="py-2 whitespace-nowrap">{formatDate(c.created_at)}</td>
                      <td className="py-2">{c.receiver_name}</td>
                      <td className="py-2">{c.total != null ? formatCurrency(c.total) : "—"}</td>
                      <td className="py-2">
                        <Badge
                          className={
                            c.status === "stamped"
                              ? "bg-emerald-100 text-emerald-700"
                              : c.status === "error"
                                ? "bg-red-100 text-red-700"
                                : "bg-amber-100 text-amber-700"
                          }
                        >
                          {c.status === "stamped" ? "timbrado" : c.status}
                        </Badge>
                      </td>
                      <td className="py-2 font-mono text-xs">{c.uuid?.slice(0, 18) || "—"}</td>
                      <td className="py-2 text-right">
                        {c.status === "stamped" ? (
                          <span className="flex justify-end gap-2">
                            <a className="text-primary hover:underline" href={`/api/finance/cfdi/${c.id}/pdf`}>
                              PDF
                            </a>
                            <a className="text-primary hover:underline" href={`/api/finance/cfdi/${c.id}/xml`}>
                              XML
                            </a>
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground" title={c.error_message || ""}>
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Aún no hay CFDIs emitidos.</p>
          )}
        </CardContent>
      </Card>

      {/* CSF / new receiver dialog */}
      <Dialog open={csfOpen} onOpenChange={setCsfOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo receptor</DialogTitle>
            <DialogDescription>
              Sube la Constancia de Situación Fiscal del cliente y confirma los datos.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleCsfFile(f);
                }}
              />
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => fileRef.current?.click()}
                disabled={csfBusy}
              >
                {csfBusy ? "Leyendo…" : "Subir CSF (PDF)"}
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="rfc">RFC</Label>
                <Input id="rfc" value={csfForm.rfc} onChange={(e) => setCsfForm({ ...csfForm, rfc: e.target.value.toUpperCase() })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cp">Código Postal</Label>
                <Input id="cp" value={csfForm.zip_code} onChange={(e) => setCsfForm({ ...csfForm, zip_code: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="name">Razón social (MAYÚSCULAS)</Label>
              <Input id="name" value={csfForm.name} onChange={(e) => setCsfForm({ ...csfForm, name: e.target.value.toUpperCase() })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="regime">Régimen fiscal</Label>
                <Input id="regime" value={csfForm.fiscal_regime} onChange={(e) => setCsfForm({ ...csfForm, fiscal_regime: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="use">Uso CFDI</Label>
                <Input id="use" value={csfForm.cfdi_use} onChange={(e) => setCsfForm({ ...csfForm, cfdi_use: e.target.value.toUpperCase() })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="email">Email (opcional)</Label>
              <Input id="email" value={csfForm.email} onChange={(e) => setCsfForm({ ...csfForm, email: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCsfOpen(false)}>Cancelar</Button>
            <Button onClick={saveReceiver} disabled={csfBusy || !csfForm.rfc || !csfForm.name}>
              Guardar receptor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Issue CFDI dialog */}
      <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Emitir CFDI</DialogTitle>
            <DialogDescription>Selecciona el receptor y los conceptos.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="receiver">Receptor</Label>
              <select
                id="receiver"
                className="flex h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                value={receiverId}
                onChange={(e) => setReceiverId(e.target.value)}
              >
                <option value="">Selecciona…</option>
                {receivers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} — {r.rfc}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Conceptos</Label>
              {items.map((it, i) => (
                <div key={i} className="grid grid-cols-[1fr_70px_100px] gap-2">
                  <Input
                    placeholder="Descripción"
                    value={it.description}
                    onChange={(e) => {
                      const next = [...items];
                      next[i] = { ...it, description: e.target.value };
                      setItems(next);
                    }}
                  />
                  <Input
                    placeholder="Cant."
                    value={it.quantity}
                    onChange={(e) => {
                      const next = [...items];
                      next[i] = { ...it, quantity: e.target.value };
                      setItems(next);
                    }}
                  />
                  <Input
                    placeholder="P. unit."
                    value={it.unitPrice}
                    onChange={(e) => {
                      const next = [...items];
                      next[i] = { ...it, unitPrice: e.target.value };
                      setItems(next);
                    }}
                  />
                </div>
              ))}
              <Button variant="ghost" size="sm" onClick={() => setItems([...items, { ...emptyItem }])}>
                + Agregar concepto
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Se agrega IVA 16% automáticamente.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIssueOpen(false)}>Cancelar</Button>
            <Button
              onClick={issueCfdi}
              disabled={issueBusy || !receiverId || items.some((it) => !it.description || !it.unitPrice)}
            >
              {issueBusy ? "Timbrando…" : "Timbrar CFDI"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
