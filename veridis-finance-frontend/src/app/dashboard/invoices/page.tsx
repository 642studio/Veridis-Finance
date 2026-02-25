"use client";

import { useEffect, useMemo, useState } from "react";

import { DataTable } from "@/components/data/data-table";
import { InvoiceUploadForm } from "@/components/finance/invoice-upload-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNotify } from "@/hooks/use-notify";
import { ApiClientError, clientApiFetch } from "@/lib/api-client";
import { formatCurrency, formatDate } from "@/lib/format";
import type { ApiEnvelope, Invoice } from "@/types/finance";

const STORAGE_KEY = "vf_invoice_uploads";

export default function DashboardInvoicesPage() {
  const notify = useNotify();
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Invoice[];
      setInvoices(parsed);
    } catch {
      setInvoices([]);
    }
  }, []);

  const persistInvoices = (nextInvoices: Invoice[]) => {
    setInvoices(nextInvoices);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextInvoices));
    }
  };

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

      const next = [response.data, ...invoices].slice(0, 50);
      persistInvoices(next);

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
    ],
    []
  );

  return (
    <div className="space-y-6">
      <InvoiceUploadForm onUpload={handleUpload} />

      <Card>
        <CardHeader>
          <CardTitle>Uploaded invoices</CardTitle>
          <CardDescription>
            This table currently stores uploaded results in browser storage. Once backend
            exposes invoice listing, it can be swapped to live query mode.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={invoices}
            columns={columns}
            getRowId={(row) => row.id}
            emptyMessage="No uploaded invoices yet."
          />
        </CardContent>
      </Card>
    </div>
  );
}
