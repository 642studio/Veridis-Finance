"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { DataTable } from "@/components/data/data-table";
import { InvoiceUploadForm } from "@/components/finance/invoice-upload-form";
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
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [markPaidInvoice, setMarkPaidInvoice] = useState<Invoice | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [paymentReference, setPaymentReference] = useState("");

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

  const handleUpload = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await clientApiFetch<ApiEnvelope<Invoice>>(
        "/api/finance/invoices/upload",
        {
          method: "POST",
          body: formData,
        }
      );

      await loadInvoices();

      notify.success({
        title: "Invoice uploaded",
        description: `UUID ${response.data.uuid_sat} processed successfully.`,
      });
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not upload invoice";
      notify.error({
        title: "Invoice upload failed",
        description: message,
      });
      throw error;
    }
  };

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
        header: "Status",
        render: (row: Invoice) => (
          <Badge variant={row.status === "paid" ? "success" : "outline"}>{row.status}</Badge>
        ),
      },
      {
        key: "emitter",
        header: "Emitter",
        render: (row: Invoice) => row.emitter,
      },
      {
        key: "invoice_date",
        header: "Date",
        render: (row: Invoice) => formatDate(row.invoice_date),
      },
      {
        key: "actions",
        header: "Actions",
        render: (row: Invoice) =>
          row.status === "pending" ? (
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
    [statusUpdatingId, updateInvoiceStatus]
  );

  return (
    <div className="space-y-6">
      <InvoiceUploadForm onUpload={handleUpload} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Uploaded invoices</CardTitle>
          <div className="flex items-center gap-2">
            <CardDescription className="hidden md:block">
              Live query mode from backend.
            </CardDescription>
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
