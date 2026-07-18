"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { DataTable } from "@/components/data/data-table";
import { InvoiceUploadForm } from "@/components/finance/invoice-upload-form";
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
import type { ApiEnvelope, Invoice } from "@/types/finance";

/** Etiqueta legible del origen de la factura. */
const SOURCE_META: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "success" }> = {
  crm: { label: "CRM", variant: "secondary" },
  sat_download: { label: "SAT", variant: "success" },
  issued_cfdi: { label: "CFDI", variant: "default" },
  pac_received: { label: "PAC", variant: "default" },
  upload: { label: "XML", variant: "outline" },
  manual: { label: "Manual", variant: "outline" },
};

function sourceMeta(source?: string | null) {
  return SOURCE_META[source || "manual"] || SOURCE_META.manual;
}

/**
 * Referencia legible en vez del UUID crudo. Los folios internos del CRM llegan
 * como "crm:xxxx" — mostramos algo corto y humano, no el hash completo.
 */
function readableRef(row: Invoice): string {
  const uuid = row.uuid_sat || "";
  if (uuid.startsWith("crm:")) return `Venta CRM · ${uuid.slice(4, 12)}`;
  if (uuid.length >= 12) return `…${uuid.slice(-12)}`;
  return uuid || "—";
}

/** La contraparte útil: cliente si la emití, proveedor si la recibí. */
function counterparty(row: Invoice): string {
  return row.direction === "issued" ? row.receiver : row.emitter;
}

const PAGE_SIZE = 50;

export default function DashboardInvoicesPage() {
  const notify = useNotify();
  const { canWrite } = useSession();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [directionFilter, setDirectionFilter] = useState<"" | "issued" | "received">("");
  // Vista por defecto: los recibos/ventas del CRM (lo fiscal vive en CFDI).
  const [sourceFilter, setSourceFilter] = useState("crm");
  const [searchQ, setSearchQ] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [markPaidInvoice, setMarkPaidInvoice] = useState<Invoice | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("transferencia");
  const [paymentReference, setPaymentReference] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    emitter: "",
    receiver: "",
    total: "",
    invoice_date: "",
    status: "pending" as "pending" | "paid",
    direction: "issued" as "issued" | "received",
  });

  const buildQuery = useCallback(
    (limit: number, off: number) => {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      params.set("offset", String(off));
      if (directionFilter) params.set("direction", directionFilter);
      if (sourceFilter) params.set("source", sourceFilter);
      if (searchQ.trim()) params.set("q", searchQ.trim());
      return params.toString();
    },
    [directionFilter, sourceFilter, searchQ]
  );

  const loadInvoices = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await clientApiFetch<ApiEnvelope<Invoice[]> & { total?: number }>(
        `/api/finance/invoices?${buildQuery(PAGE_SIZE, offset)}`
      );
      setInvoices(response.data || []);
      setTotal(response.total ?? (response.data || []).length);
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "No se pudieron cargar las facturas";
      notify.error({ title: "Error al cargar", description: message });
      setInvoices([]);
    } finally {
      setIsLoading(false);
    }
  }, [notify, buildQuery, offset]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  // Cambiar filtros regresa a la primera página.
  useEffect(() => {
    setOffset(0);
  }, [directionFilter, sourceFilter, searchQ]);

  // Exporta el filtro actual a CSV (hasta 5000 filas), para el contador.
  const exportCsv = useCallback(async () => {
    setIsExporting(true);
    try {
      const all: Invoice[] = [];
      for (let off = 0; off < 5000; off += 500) {
        const res = await clientApiFetch<ApiEnvelope<Invoice[]>>(
          `/api/finance/invoices?${buildQuery(500, off)}`
        );
        const chunk = res.data || [];
        all.push(...chunk);
        if (chunk.length < 500) break;
      }
      const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const lines = [
        [
          "uuid",
          "tipo",
          "origen",
          "emisor",
          "rfc_emisor",
          "receptor",
          "rfc_receptor",
          "total",
          "estatus",
          "fecha",
        ].join(","),
        ...all.map((r) =>
          [
            esc(r.uuid_sat),
            esc(r.direction === "issued" ? "Emitida" : "Recibida"),
            esc(sourceMeta(r.source).label),
            esc(r.emitter),
            esc(r.emitter_rfc || ""),
            esc(r.receiver),
            esc(r.receiver_rfc || ""),
            esc(r.total),
            esc(r.status === "paid" ? "Pagada" : "Pendiente"),
            esc(r.invoice_date?.slice(0, 10) || ""),
          ].join(",")
        ),
      ];
      const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `facturas-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      notify.success({
        title: "CSV exportado",
        description: `${all.length} factura(s) — se abre directo en Excel.`,
      });
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : "No se pudo exportar";
      notify.error({ title: "Error al exportar", description: message });
    } finally {
      setIsExporting(false);
    }
  }, [buildQuery, notify]);

  const handleUpload = async (files: File[]) => {
    const formData = new FormData();
    for (const file of files) {
      formData.append("files", file);
    }

    try {
      const response = await clientApiFetch<
        ApiEnvelope<{ received: number; created: number; duplicates: number; errors: number }>
      >("/api/finance/invoices/upload-bulk", {
        method: "POST",
        body: formData,
      });

      await loadInvoices();

      const s = response.data;
      notify.success({
        title:
          s.created === 1 && s.received === 1
            ? "Factura subida"
            : `${s.created} de ${s.received} facturas importadas`,
        description:
          s.duplicates || s.errors
            ? `${s.duplicates} duplicada(s) omitida(s) · ${s.errors} con error`
            : "Procesadas correctamente.",
      });
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "No se pudieron subir las facturas";
      notify.error({ title: "Error al subir", description: message });
      throw error;
    }
  };

  const resetCreateForm = useCallback(() => {
    setCreateForm({
      emitter: "",
      receiver: "",
      total: "",
      invoice_date: "",
      status: "pending",
      direction: "issued",
    });
  }, []);

  const handleCreateInvoice = useCallback(async () => {
    const total = Number.parseFloat(createForm.total);
    if (!createForm.emitter.trim() || !createForm.receiver.trim()) {
      notify.error({
        title: "Faltan datos",
        description: "Emisor y receptor son obligatorios.",
      });
      return;
    }
    if (!Number.isFinite(total) || total <= 0) {
      notify.error({ title: "Total inválido", description: "El total debe ser mayor a 0." });
      return;
    }
    if (!createForm.invoice_date) {
      notify.error({ title: "Falta la fecha", description: "La fecha de la factura es obligatoria." });
      return;
    }

    setIsCreating(true);
    try {
      // UUID sintético para el registro manual (NO es un folio fiscal del SAT).
      const syntheticUuid = `manual:${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      await clientApiFetch<ApiEnvelope<Invoice>>("/api/finance/invoices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          uuid_sat: syntheticUuid,
          emitter: createForm.emitter.trim(),
          receiver: createForm.receiver.trim(),
          total,
          status: createForm.status,
          invoice_date: createForm.invoice_date,
          direction: createForm.direction,
        }),
      });

      await loadInvoices();
      setIsCreateOpen(false);
      resetCreateForm();
      notify.success({
        title: "Registro agregado",
        description: "Se anotó en tu libro (no genera ningún CFDI ante el SAT).",
      });
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "No se pudo agregar el registro";
      notify.error({ title: "Error al guardar", description: message });
    } finally {
      setIsCreating(false);
    }
  }, [createForm, loadInvoices, notify, resetCreateForm]);

  const updateInvoiceStatus = useCallback(
    async (
      invoice: Invoice,
      status: "pending" | "paid",
      options?: { payment_method?: string; payment_reference?: string }
    ) => {
      setStatusUpdatingId(invoice.id);
      try {
        await clientApiFetch<ApiEnvelope<Invoice>>(
          `/api/finance/invoices/${invoice.id}/status`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              status,
              payment_method: options?.payment_method || null,
              payment_reference: options?.payment_reference || null,
            }),
          }
        );

        await loadInvoices();

        notify.success({
          title: "Factura actualizada",
          description:
            status === "paid" ? "Marcada como pagada." : "Reabierta como pendiente.",
        });
      } catch (error) {
        const message =
          error instanceof ApiClientError ? error.message : "No se pudo actualizar la factura";
        notify.error({ title: "Error al actualizar", description: message });
      } finally {
        setStatusUpdatingId(null);
      }
    },
    [loadInvoices, notify]
  );

  const columns = useMemo(
    () => [
      {
        key: "reference",
        header: "Referencia",
        render: (row: Invoice) => {
          const meta = sourceMeta(row.source);
          return (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Badge variant={meta.variant}>{meta.label}</Badge>
                <Badge variant={row.direction === "issued" ? "default" : "secondary"}>
                  {row.direction === "issued" ? "Emitida" : "Recibida"}
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground">{readableRef(row)}</span>
            </div>
          );
        },
      },
      {
        key: "counterparty",
        header: "Cliente / Proveedor",
        render: (row: Invoice) => (
          <div className="flex flex-col">
            <span className="font-medium">{counterparty(row) || "—"}</span>
            <span className="text-xs text-muted-foreground">
              {row.direction === "issued"
                ? row.receiver_rfc || ""
                : row.emitter_rfc || ""}
            </span>
          </div>
        ),
      },
      {
        key: "total",
        header: "Total",
        render: (row: Invoice) => formatCurrency(row.total),
      },
      {
        key: "status",
        header: "Estatus",
        render: (row: Invoice) => (
          <Badge variant={row.status === "paid" ? "success" : "outline"}>
            {row.status === "paid" ? "Conciliada / pagada" : "Pendiente"}
          </Badge>
        ),
      },
      {
        key: "invoice_date",
        header: "Fecha",
        render: (row: Invoice) => formatDate(row.invoice_date),
      },
      {
        key: "comprobante",
        header: "Comprobante",
        render: (row: Invoice) =>
          row.cfdi_document_id ? (
            <div className="flex items-center gap-2">
              <a
                className="text-xs font-medium text-primary underline"
                href={`/api/finance/cfdi/${row.cfdi_document_id}/pdf`}
                target="_blank"
                rel="noreferrer"
              >
                PDF
              </a>
              <a
                className="text-xs font-medium text-primary underline"
                href={`/api/finance/cfdi/${row.cfdi_document_id}/xml`}
                target="_blank"
                rel="noreferrer"
              >
                XML
              </a>
            </div>
          ) : row.payment_reference?.startsWith("cfdi:") ? (
            <div className="flex flex-col">
              <Badge variant="success">Facturada</Badge>
              <span className="mt-1 font-mono text-[10px] text-muted-foreground">
                …{row.payment_reference.slice(-12)}
              </span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Sin CFDI</span>
          ),
      },
      {
        key: "actions",
        header: "Acciones",
        render: (row: Invoice) =>
          !canWrite ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : row.status === "pending" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setMarkPaidInvoice(row);
                setPaymentMethod("transferencia");
                setPaymentReference("");
              }}
              disabled={statusUpdatingId === row.id}
            >
              Marcar pagada
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void updateInvoiceStatus(row, "pending");
              }}
              disabled={statusUpdatingId === row.id}
            >
              Reabrir
            </Button>
          ),
      },
    ],
    [statusUpdatingId, updateInvoiceStatus, canWrite]
  );

  return (
    <div className="space-y-6">
      {canWrite ? <InvoiceUploadForm onUpload={handleUpload} /> : null}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Libro de facturas</CardTitle>
            <CardDescription>
              Todas tus facturas para conciliar: del CRM, del SAT (Descarga Masiva), XML subidos y
              CFDI timbrados. Este libro <strong>no emite</strong> comprobantes fiscales.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={exportCsv} disabled={isExporting}>
              {isExporting ? "Exportando…" : "Exportar CSV"}
            </Button>
            {canWrite ? (
              <Button
                variant="outline"
                onClick={() => {
                  resetCreateForm();
                  setIsCreateOpen(true);
                }}
              >
                Registro manual
              </Button>
            ) : null}
            <Button variant="outline" onClick={loadInvoices} disabled={isLoading}>
              {isLoading ? "Actualizando…" : "Actualizar"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <Input
              placeholder="Buscar por cliente, proveedor, RFC o folio…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
            />
            <select
              className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
              value={directionFilter}
              onChange={(e) => setDirectionFilter(e.target.value as "" | "issued" | "received")}
            >
              <option value="">Todas (emitidas y recibidas)</option>
              <option value="issued">Emitidas</option>
              <option value="received">Recibidas</option>
            </select>
            <select
              className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
            >
              <option value="">Todos los orígenes</option>
              <option value="sat_download">SAT (Descarga Masiva)</option>
              <option value="crm">CRM</option>
              <option value="upload">XML subidos</option>
              <option value="issued_cfdi">CFDI timbrados</option>
              <option value="pac_received">PAC recibidas</option>
            </select>
          </div>

          <DataTable
            rows={invoices}
            columns={columns}
            getRowId={(row) => row.id}
            emptyMessage={isLoading ? "Cargando facturas…" : "Aún no hay facturas."}
          />

          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {total > 0
                ? `${Math.min(offset + 1, total)}–${Math.min(offset + PAGE_SIZE, total)} de ${total}`
                : "Sin resultados"}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0 || isLoading}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + PAGE_SIZE >= total || isLoading}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Siguiente
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={isCreateOpen}
        onOpenChange={(nextOpen) => {
          setIsCreateOpen(nextOpen);
          if (!nextOpen) {
            resetCreateForm();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registro manual</DialogTitle>
            <DialogDescription>
              Anota una factura en tu libro para conciliar. <strong>No genera ningún CFDI ante el
              SAT</strong> — es sólo un apunte contable. Para timbrar usa la sección CFDI; para
              importar XML del SAT usa la carga de arriba.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="create_emitter">Emisor (quién factura)</Label>
                <Input
                  id="create_emitter"
                  value={createForm.emitter}
                  onChange={(event) =>
                    setCreateForm((prev) => ({ ...prev, emitter: event.target.value }))
                  }
                  placeholder="Nombre o RFC"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="create_receiver">Receptor (a quién)</Label>
                <Input
                  id="create_receiver"
                  value={createForm.receiver}
                  onChange={(event) =>
                    setCreateForm((prev) => ({ ...prev, receiver: event.target.value }))
                  }
                  placeholder="Nombre o RFC"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="create_total">Total</Label>
                <Input
                  id="create_total"
                  type="number"
                  min="0"
                  step="0.01"
                  value={createForm.total}
                  onChange={(event) =>
                    setCreateForm((prev) => ({ ...prev, total: event.target.value }))
                  }
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="create_invoice_date">Fecha</Label>
                <Input
                  id="create_invoice_date"
                  type="date"
                  value={createForm.invoice_date}
                  onChange={(event) =>
                    setCreateForm((prev) => ({ ...prev, invoice_date: event.target.value }))
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="create_direction">Tipo</Label>
              <select
                id="create_direction"
                className="flex h-10 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                value={createForm.direction}
                onChange={(event) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    direction: event.target.value === "received" ? "received" : "issued",
                  }))
                }
              >
                <option value="issued">Emitida (yo cobro — cliente)</option>
                <option value="received">Recibida (yo pago — proveedor)</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="create_status">Estatus</Label>
              <select
                id="create_status"
                className="flex h-10 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                value={createForm.status}
                onChange={(event) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    status: event.target.value === "paid" ? "paid" : "pending",
                  }))
                }
              >
                <option value="pending">Pendiente</option>
                <option value="paid">Pagada</option>
              </select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsCreateOpen(false);
                resetCreateForm();
              }}
              disabled={isCreating}
            >
              Cancelar
            </Button>
            <Button onClick={handleCreateInvoice} disabled={isCreating}>
              {isCreating ? "Guardando…" : "Agregar al libro"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(markPaidInvoice)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setMarkPaidInvoice(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar factura como pagada</DialogTitle>
            <DialogDescription>
              Agrega método y referencia de pago (opcional) para tu trazabilidad.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="invoice_payment_method">Método de pago</Label>
              <Input
                id="invoice_payment_method"
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value)}
                placeholder="transferencia"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoice_payment_reference">Referencia de pago</Label>
              <Input
                id="invoice_payment_reference"
                value={paymentReference}
                onChange={(event) => setPaymentReference(event.target.value)}
                placeholder="Opcional"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMarkPaidInvoice(null)}
              disabled={Boolean(statusUpdatingId)}
            >
              Cancelar
            </Button>
            <Button
              onClick={async () => {
                if (!markPaidInvoice) {
                  return;
                }
                await updateInvoiceStatus(markPaidInvoice, "paid", {
                  payment_method: paymentMethod.trim() || undefined,
                  payment_reference: paymentReference.trim() || undefined,
                });
                setMarkPaidInvoice(null);
              }}
              disabled={Boolean(statusUpdatingId)}
            >
              {statusUpdatingId ? "Guardando…" : "Confirmar pago"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
