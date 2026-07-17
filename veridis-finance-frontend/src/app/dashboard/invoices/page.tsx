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

export default function DashboardInvoicesPage() {
  const notify = useNotify();
  const { canWrite } = useSession();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [markPaidInvoice, setMarkPaidInvoice] = useState<Invoice | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [paymentReference, setPaymentReference] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    uuid_sat: "",
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
        error instanceof ApiClientError ? error.message : "Could not load invoices";
      notify.error({ title: "Load failed", description: message });
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
      notify.error({
        title: "Error al subir",
        description: message,
      });
      throw error;
    }
  };

  const resetCreateForm = useCallback(() => {
    setCreateForm({
      uuid_sat: "",
      emitter: "",
      receiver: "",
      total: "",
      invoice_date: "",
      status: "pending",
    });
  }, []);

  const handleCreateInvoice = useCallback(async () => {
    const total = Number.parseFloat(createForm.total);
    if (!createForm.uuid_sat.trim()) {
      notify.error({ title: "Missing UUID", description: "UUID (SAT) is required." });
      return;
    }
    if (!createForm.emitter.trim() || !createForm.receiver.trim()) {
      notify.error({
        title: "Missing data",
        description: "Emitter and receiver are required.",
      });
      return;
    }
    if (!Number.isFinite(total) || total <= 0) {
      notify.error({ title: "Invalid total", description: "Total must be greater than 0." });
      return;
    }
    if (!createForm.invoice_date) {
      notify.error({ title: "Missing date", description: "Invoice date is required." });
      return;
    }

    setIsCreating(true);
    try {
      await clientApiFetch<ApiEnvelope<Invoice>>("/api/finance/invoices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          uuid_sat: createForm.uuid_sat.trim(),
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
        title: "Invoice created",
        description: "Manual invoice added successfully.",
      });
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not create invoice";
      notify.error({ title: "Create failed", description: message });
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
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              status,
              payment_method: options?.payment_method || null,
              payment_reference: options?.payment_reference || null,
            }),
          }
        );

        await loadInvoices();

        notify.success({
          title: "Invoice updated",
          description:
            status === "paid"
              ? "Invoice marked as paid."
              : "Invoice reopened as pending.",
        });
      } catch (error) {
        const message =
          error instanceof ApiClientError ? error.message : "Could not update invoice";
        notify.error({
          title: "Update failed",
          description: message,
        });
      } finally {
        setStatusUpdatingId(null);
      }
    },
    [loadInvoices, notify]
  );

  const columns = useMemo(
    () => [
      {
        key: "uuid_sat",
        header: "UUID",
        render: (row: Invoice) => row.uuid_sat,
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
            {row.status === "paid" ? "pagada" : "pendiente"}
          </Badge>
        ),
      },
      {
        key: "direction",
        header: "Tipo",
        render: (row: Invoice) => (
          <Badge variant={row.direction === "issued" ? "default" : "secondary"}>
            {row.direction === "issued" ? "Emitida" : "Recibida"}
          </Badge>
        ),
      },
      {
        key: "emitter",
        header: "Emisor",
        render: (row: Invoice) => row.emitter,
      },
      {
        key: "invoice_date",
        header: "Fecha",
        render: (row: Invoice) => formatDate(row.invoice_date),
      },
      {
        key: "actions",
        header: "Actions",
        render: (row: Invoice) =>
          !canWrite ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : row.status === "pending" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setMarkPaidInvoice(row);
                setPaymentMethod("bank_transfer");
                setPaymentReference("");
              }}
              disabled={statusUpdatingId === row.id}
            >
              Mark as paid
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
              Reopen
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
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Uploaded invoices</CardTitle>
          <div className="flex items-center gap-2">
            <CardDescription className="hidden md:block">
              Live query mode from backend.
            </CardDescription>
            {canWrite ? (
              <Button
                onClick={() => {
                  resetCreateForm();
                  setIsCreateOpen(true);
                }}
              >
                New invoice
              </Button>
            ) : null}
            <Button variant="outline" onClick={loadInvoices} disabled={isLoading}>
              {isLoading ? "Refreshing..." : "Refresh"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={invoices}
            columns={columns}
            getRowId={(row) => row.id}
            emptyMessage={isLoading ? "Loading invoices..." : "No invoices yet."}
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
            <DialogTitle>New invoice (manual)</DialogTitle>
            <DialogDescription>
              Register an invoice manually. For SAT CFDI 4.0 XML files, use the
              upload form instead.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="create_uuid_sat">UUID (SAT)</Label>
              <Input
                id="create_uuid_sat"
                value={createForm.uuid_sat}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, uuid_sat: event.target.value }))
                }
                placeholder="A1B2C3D4-E5F6-4789-8ABC-DEF012345678"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="create_emitter">Emitter</Label>
                <Input
                  id="create_emitter"
                  value={createForm.emitter}
                  onChange={(event) =>
                    setCreateForm((prev) => ({ ...prev, emitter: event.target.value }))
                  }
                  placeholder="RFC / name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="create_receiver">Receiver</Label>
                <Input
                  id="create_receiver"
                  value={createForm.receiver}
                  onChange={(event) =>
                    setCreateForm((prev) => ({ ...prev, receiver: event.target.value }))
                  }
                  placeholder="RFC / name"
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
                <Label htmlFor="create_invoice_date">Invoice date</Label>
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
              <Label htmlFor="create_status">Status</Label>
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
                <option value="pending">pending</option>
                <option value="paid">paid</option>
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
              Cancel
            </Button>
            <Button onClick={handleCreateInvoice} disabled={isCreating}>
              {isCreating ? "Saving..." : "Create invoice"}
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
            <DialogTitle>Mark invoice as paid</DialogTitle>
            <DialogDescription>
              Add optional payment method/reference for traceability.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="invoice_payment_method">Payment method</Label>
              <Input
                id="invoice_payment_method"
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value)}
                placeholder="bank_transfer"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoice_payment_reference">Payment reference</Label>
              <Input
                id="invoice_payment_reference"
                value={paymentReference}
                onChange={(event) => setPaymentReference(event.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMarkPaidInvoice(null)}
              disabled={Boolean(statusUpdatingId)}
            >
              Cancel
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
              {statusUpdatingId ? "Saving..." : "Confirm paid"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
