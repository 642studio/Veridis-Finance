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

export default function DashboardInvoicesPage() {
  const notify = useNotify();
  const { canWrite } = useSession();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
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
  });

  const loadInvoices = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await clientApiFetch<ApiEnvelope<Invoice[]>>(
        "/api/finance/invoices?limit=100&offset=0"
      );
      setInvoices(response.data || []);
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "No se pudieron cargar las facturas";
      notify.error({ title: "Error al cargar", description: message });
      setInvoices([]);
    } finally {
      setIsLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

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
    setCreateForm({ emitter: "", receiver: "", total: "", invoice_date: "", status: "pending" });
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
          <DataTable
            rows={invoices}
            columns={columns}
            getRowId={(row) => row.id}
            emptyMessage={isLoading ? "Cargando facturas…" : "Aún no hay facturas."}
          />
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
