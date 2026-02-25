"use client";

import {
  type ColumnFiltersState,
  type ColumnDef,
  type PaginationState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useNotify } from "@/hooks/use-notify";
import { ApiClientError, clientApiFetch } from "@/lib/api-client";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  type ApiEnvelope,
  type BankStatementConfirmData,
  type BankStatementUploadData,
  type BankStatementPreviewTransaction,
  type Client,
  type Member,
} from "@/types/finance";

const BANK_OPTIONS = ["santander", "bbva", "banorte"] as const;
const TYPE_OPTIONS = ["income", "expense"] as const;
const CATEGORY_OPTIONS = [
  "sales",
  "services",
  "operations",
  "payroll",
  "marketing",
  "suppliers",
  "rent",
  "taxes",
  "bank_fees",
  "transfer",
  "other",
] as const;

const uploadSchema = z.object({
  bank: z.enum(BANK_OPTIONS),
  file: z
    .any()
    .refine(
      (value): value is File =>
        typeof File !== "undefined" && value instanceof File,
      "PDF file is required"
    )
    .refine(
      (file: File) =>
        file.type === "application/pdf" ||
        String(file.name || "")
          .toLowerCase()
          .endsWith(".pdf"),
      "File must be a PDF"
    ),
});

const previewRowSchema = z.object({
  transaction_date: z.string().min(10),
  concept: z.string().min(1).max(120),
  raw_description: z.string().min(1).max(500),
  folio: z.string().max(120),
  bank: z.string().min(1).max(80),
  type: z.enum(TYPE_OPTIONS),
  category: z.string().min(1).max(120),
  member_id: z.string().uuid().optional().nullable(),
  member_name: z.string().max(120).optional().nullable(),
  client_id: z.string().uuid().optional().nullable(),
  client_name: z.string().max(120).optional().nullable(),
  vendor_id: z.string().uuid().optional().nullable(),
  vendor_name: z.string().max(120).optional().nullable(),
  match_confidence: z.number().min(0).max(1).optional().nullable(),
  match_method: z.enum(["rule", "fuzzy", "manual"]).optional().nullable(),
  is_payroll_candidate: z.boolean().optional(),
  amount: z.number().positive(),
});

const previewSchema = z.object({
  import_id: z.string().uuid(),
  transactions: z.array(previewRowSchema).min(1),
});

type UploadFormValues = z.infer<typeof uploadSchema>;
type PreviewFormValues = z.infer<typeof previewSchema>;
type PreviewRow = PreviewFormValues["transactions"][number];

interface PreviewMeta {
  import_id: string;
  bank: string;
  account_number: string | null;
  period_start: string | null;
  period_end: string | null;
  preview_count: number;
}

interface DescriptionViewerState {
  concept: string;
  raw_description: string;
  transaction_date: string;
  folio: string;
}

interface BankStatementUploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportConfirmed?: () => Promise<void> | void;
  members?: Member[];
  clients?: Client[];
}

function inferCategory(transaction: BankStatementPreviewTransaction) {
  const classifiedCategory = String(transaction.category || "")
    .trim()
    .toLowerCase();

  if (classifiedCategory) {
    return classifiedCategory;
  }

  const concept = String(transaction.concept || "")
    .trim()
    .toLowerCase();

  if (!concept) {
    return transaction.type === "income" ? "sales" : "operations";
  }

  if ((CATEGORY_OPTIONS as readonly string[]).includes(concept)) {
    return concept;
  }

  if (concept.includes("comision")) {
    return "bank_fees";
  }

  if (concept.includes("nomina")) {
    return "payroll";
  }

  if (concept.includes("transfer") || concept.includes("spei")) {
    return "transfer";
  }

  if (concept.includes("deposito")) {
    return "sales";
  }

  return "other";
}

function toPreviewRows(data: BankStatementUploadData): PreviewRow[] {
  return data.transactions_preview.map((transaction) => ({
    transaction_date: transaction.transaction_date,
    type: transaction.type,
    amount: Number(transaction.amount),
    concept: String(transaction.concept || "bank_movement"),
    raw_description: String(transaction.raw_description || transaction.concept || ""),
    folio: String(transaction.folio || ""),
    bank: String(transaction.bank || data.bank || ""),
    category: inferCategory(transaction),
    member_id: transaction.member_id || undefined,
    member_name: transaction.member_name || undefined,
    client_id: transaction.client_id || undefined,
    client_name: transaction.client_name || undefined,
    vendor_id: transaction.vendor_id || undefined,
    vendor_name: transaction.vendor_name || undefined,
    match_confidence: transaction.match_confidence ?? undefined,
    match_method: transaction.match_method ?? undefined,
    is_payroll_candidate: Boolean(transaction.is_payroll_candidate),
  }));
}

function isPayrollKeyword(input: string) {
  const normalized = String(input || "").toLowerCase();
  return (
    normalized.includes("nomina") ||
    normalized.includes("payroll") ||
    normalized.includes("sueldo") ||
    normalized.includes("salary") ||
    normalized.includes("quincena") ||
    normalized.includes("aguinaldo")
  );
}

function isPayrollTransaction(transaction: PreviewRow) {
  if (transaction.is_payroll_candidate) {
    return true;
  }

  return (
    isPayrollKeyword(transaction.category) ||
    isPayrollKeyword(transaction.concept) ||
    isPayrollKeyword(transaction.raw_description)
  );
}

export function BankStatementUploadModal({
  open,
  onOpenChange,
  onImportConfirmed,
  members = [],
  clients = [],
}: BankStatementUploadModalProps) {
  const notify = useNotify();

  const [isUploading, setIsUploading] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [previewMeta, setPreviewMeta] = useState<PreviewMeta | null>(null);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });
  const [descriptionViewer, setDescriptionViewer] = useState<DescriptionViewerState | null>(
    null
  );

  const uploadForm = useForm<UploadFormValues>({
    resolver: zodResolver(uploadSchema),
    defaultValues: {
      bank: "santander",
      file: undefined,
    },
    mode: "onSubmit",
  });

  const previewForm = useForm<PreviewFormValues>({
    resolver: zodResolver(previewSchema),
    defaultValues: {
      import_id: "",
      transactions: [],
    },
  });

  const previewRows = previewForm.watch("transactions");

  useEffect(() => {
    if (!open || isUploading || isConfirming) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, isUploading, isConfirming, onOpenChange]);

  const resetAll = () => {
    uploadForm.reset({ bank: "santander", file: undefined });
    previewForm.reset({ import_id: "", transactions: [] });
    setPreviewMeta(null);
    setGlobalFilter("");
    setColumnFilters([]);
    setPagination({ pageIndex: 0, pageSize: 10 });
    setDescriptionViewer(null);
  };

  const closeModal = () => {
    if (isUploading || isConfirming) {
      return;
    }

    resetAll();
    onOpenChange(false);
  };

  const submitUpload = uploadForm.handleSubmit(async (values) => {
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append("bank", values.bank);
      formData.append("file", values.file);

      const response = await clientApiFetch<ApiEnvelope<BankStatementUploadData>>(
        "/api/finance/bank-statements/upload",
        {
          method: "POST",
          body: formData,
        }
      );

      previewForm.reset({
        import_id: response.data.import_id,
        transactions: toPreviewRows(response.data),
      });
      setGlobalFilter("");
      setColumnFilters([]);
      setPagination({ pageIndex: 0, pageSize: 10 });

      setPreviewMeta({
        import_id: response.data.import_id,
        bank: response.data.bank,
        account_number: response.data.account_number,
        period_start: response.data.period_start,
        period_end: response.data.period_end,
        preview_count: response.data.preview_count,
      });

      notify.success({
        title: "Statement parsed",
        description: `${response.data.preview_count} transactions ready for confirmation.`,
      });
    } catch (error) {
      const message =
        error instanceof ApiClientError
          ? error.message
          : "Could not process bank statement";

      notify.error({
        title: "Upload failed",
        description: message,
      });
    } finally {
      setIsUploading(false);
    }
  });

  const confirmImport = previewForm.handleSubmit(async (values) => {
    setIsConfirming(true);

    try {
      const response = await clientApiFetch<ApiEnvelope<BankStatementConfirmData>>(
        `/api/finance/bank-statements/confirm/${values.import_id}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            transactions: values.transactions,
          }),
        }
      );

      notify.success({
        title: "Import confirmed",
        description: `${response.data.inserted_count} inserted, ${response.data.skipped_duplicates} duplicates skipped.`,
      });

      await onImportConfirmed?.();
      closeModal();
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not confirm import";

      notify.error({
        title: "Confirm failed",
        description: message,
      });
    } finally {
      setIsConfirming(false);
    }
  });

  const columns = useMemo<ColumnDef<PreviewRow>[]>(
    () => [
      {
        accessorKey: "transaction_date",
        header: "Date",
        cell: ({ row }) => (
          <span className="text-xs sm:text-sm">
            {formatDate(row.original.transaction_date)}
          </span>
        ),
      },
      {
        accessorFn: (row) =>
          `${row.concept} ${row.raw_description} ${row.folio}`.trim(),
        id: "concept",
        header: "Concept",
        cell: ({ row }) => {
          const rawDescription = row.original.raw_description || "";
          const canExpand = rawDescription.length > 100;

          return (
            <div className="space-y-1">
              <p className="text-xs font-medium sm:text-sm">{row.original.concept}</p>
              <p className="line-clamp-2 text-xs text-muted-foreground">
                {rawDescription}
              </p>
              {canExpand ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1 text-xs text-cyan-300 hover:text-cyan-200"
                  onClick={() =>
                    setDescriptionViewer({
                      concept: row.original.concept,
                      raw_description: rawDescription,
                      transaction_date: row.original.transaction_date,
                      folio: row.original.folio || "-",
                    })
                  }
                >
                  Ver más
                </Button>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "type",
        id: "type",
        header: "Type",
        filterFn: "equalsString",
        cell: ({ row }) => {
          const fieldPath = `transactions.${row.index}.type` as const;
          const currentType = previewForm.watch(fieldPath);

          return (
            <select
              className="h-8 rounded-md border border-border bg-background px-2 text-xs sm:text-sm"
              value={currentType}
              onChange={(event) => {
                const nextType = event.target.value as "income" | "expense";
                previewForm.setValue(fieldPath, nextType, { shouldDirty: true });

                if (nextType === "income") {
                  previewForm.setValue(`transactions.${row.index}.member_id` as const, undefined, {
                    shouldDirty: true,
                  });
                  previewForm.setValue(`transactions.${row.index}.vendor_id` as const, undefined, {
                    shouldDirty: true,
                  });
                  return;
                }

                previewForm.setValue(`transactions.${row.index}.client_id` as const, undefined, {
                  shouldDirty: true,
                });
              }}
            >
              <option value="income">income</option>
              <option value="expense">expense</option>
            </select>
          );
        },
      },
      {
        accessorKey: "category",
        id: "category",
        header: "Category",
        filterFn: "equalsString",
        cell: ({ row }) => {
          const fieldPath = `transactions.${row.index}.category` as const;
          const currentValue = previewForm.getValues(fieldPath);
          const categoryOptions = (CATEGORY_OPTIONS as readonly string[]).includes(
            currentValue
          )
            ? CATEGORY_OPTIONS
            : ([currentValue, ...CATEGORY_OPTIONS] as const);

          return (
            <select
              className="h-8 min-w-[130px] rounded-md border border-border bg-background px-2 text-xs sm:text-sm"
              {...previewForm.register(fieldPath)}
            >
              {categoryOptions.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          );
        },
      },
      {
        accessorKey: "amount",
        header: "Amount",
        cell: ({ row }) => (
          <span className="text-xs font-semibold sm:text-sm">
            {formatCurrency(Number(row.original.amount || 0))}
          </span>
        ),
      },
      {
        accessorKey: "member_id",
        id: "member_id",
        header: "Member",
        cell: ({ row }) => {
          const fieldPath = `transactions.${row.index}.member_id` as const;
          const isPayroll = isPayrollTransaction(row.original);

          if (!isPayroll) {
            return <span className="text-xs text-muted-foreground">-</span>;
          }

          if (!members.length) {
            return (
              <span className="text-xs text-amber-500">
                Add members first
              </span>
            );
          }

          const selectedMemberId = previewForm.watch(fieldPath) || "";

          return (
            <select
              className="h-8 min-w-[170px] rounded-md border border-border bg-background px-2 text-xs sm:text-sm"
              value={selectedMemberId}
              onChange={(event) => {
                const nextValue = event.target.value.trim();
                previewForm.setValue(fieldPath, nextValue || undefined, {
                  shouldDirty: true,
                });
                if (nextValue) {
                  const clientField = `transactions.${row.index}.client_id` as const;
                  const vendorField = `transactions.${row.index}.vendor_id` as const;
                  const methodField = `transactions.${row.index}.match_method` as const;
                  const confidenceField =
                    `transactions.${row.index}.match_confidence` as const;
                  previewForm.setValue(clientField, undefined, {
                    shouldDirty: true,
                  });
                  previewForm.setValue(vendorField, undefined, {
                    shouldDirty: true,
                  });
                  previewForm.setValue(methodField, "manual", {
                    shouldDirty: true,
                  });
                  previewForm.setValue(confidenceField, 1, {
                    shouldDirty: true,
                  });
                }
              }}
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.full_name}
                </option>
              ))}
            </select>
          );
        },
      },
      {
        accessorKey: "client_id",
        id: "client_id",
        header: "Client",
        cell: ({ row }) => {
          const isIncome = row.original.type === "income";
          if (!isIncome) {
            return <span className="text-xs text-muted-foreground">-</span>;
          }

          if (!clients.length) {
            return <span className="text-xs text-amber-500">Add clients first</span>;
          }

          const fieldPath = `transactions.${row.index}.client_id` as const;
          const selectedClientId = previewForm.watch(fieldPath) || "";

          return (
            <select
              className="h-8 min-w-[170px] rounded-md border border-border bg-background px-2 text-xs sm:text-sm"
              value={selectedClientId}
              onChange={(event) => {
                const nextValue = event.target.value.trim();
                previewForm.setValue(fieldPath, nextValue || undefined, {
                  shouldDirty: true,
                });

                if (nextValue) {
                  previewForm.setValue(`transactions.${row.index}.member_id` as const, undefined, {
                    shouldDirty: true,
                  });
                  previewForm.setValue(`transactions.${row.index}.vendor_id` as const, undefined, {
                    shouldDirty: true,
                  });
                  previewForm.setValue(`transactions.${row.index}.match_method` as const, "manual", {
                    shouldDirty: true,
                  });
                  previewForm.setValue(
                    `transactions.${row.index}.match_confidence` as const,
                    1,
                    { shouldDirty: true }
                  );
                }
              }}
            >
              <option value="">Unassigned</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.business_name || client.name}
                  {client.business_name ? ` (${client.name})` : ""}
                </option>
              ))}
            </select>
          );
        },
      },
    ],
    [clients, members, previewForm]
  );

  const previewTable = useReactTable({
    data: previewRows,
    columns,
    state: {
      globalFilter,
      columnFilters,
      pagination,
    },
    onGlobalFilterChange: (value) => {
      setGlobalFilter(String(value || ""));
      setPagination((current) => ({ ...current, pageIndex: 0 }));
    },
    onColumnFiltersChange: (updater) => {
      setColumnFilters((current) => {
        const next =
          typeof updater === "function" ? updater(current) : updater;
        return next;
      });
      setPagination((current) => ({ ...current, pageIndex: 0 }));
    },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn: (row, _columnId, filterValue) => {
      const query = String(filterValue || "")
        .trim()
        .toLowerCase();

      if (!query) {
        return true;
      }

      const searchable = [
        row.original.concept,
        row.original.raw_description,
        row.original.folio,
        row.original.bank,
      ]
        .join(" ")
        .toLowerCase();

      return searchable.includes(query);
    },
  });

  const previewCategoryFilters = useMemo(() => {
    const values = new Set<string>(CATEGORY_OPTIONS as readonly string[]);
    for (const row of previewRows) {
      const category = String(row.category || "").trim();
      if (category) {
        values.add(category);
      }
    }
    return Array.from(values);
  }, [previewRows]);

  const typeFilterValue =
    (columnFilters.find((item) => item.id === "type")?.value as string) || "all";
  const categoryFilterValue =
    (columnFilters.find((item) => item.id === "category")?.value as string) ||
    "all";

  const setExactFilter = (id: "type" | "category", value: string) => {
    setColumnFilters((current) => {
      const remaining = current.filter((item) => item.id !== id);
      if (!value || value === "all") {
        return remaining;
      }
      return [...remaining, { id, value }];
    });
    setPagination((current) => ({ ...current, pageIndex: 0 }));
  };

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-foreground/30 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeModal();
        }
      }}
    >
      <div className="mx-auto mt-4 flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl animate-fade-in">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="font-heading text-lg font-semibold">Upload Bank Statement</h3>
            <p className="text-xs text-muted-foreground sm:text-sm">
              Upload PDF, review parsed rows, and confirm import.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={closeModal}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-6 overflow-y-auto p-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">1. Upload PDF</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-4 sm:grid-cols-[220px_1fr_auto]"
                onSubmit={submitUpload}
              >
                <div className="space-y-2">
                  <Label htmlFor="statement_bank">Bank</Label>
                  <select
                    id="statement_bank"
                    className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                    {...uploadForm.register("bank")}
                  >
                    {BANK_OPTIONS.map((bank) => (
                      <option key={bank} value={bank}>
                        {bank.toUpperCase()}
                      </option>
                    ))}
                  </select>
                  {uploadForm.formState.errors.bank ? (
                    <p className="text-xs text-destructive">
                      {uploadForm.formState.errors.bank.message}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="statement_file">PDF file</Label>
                  <Input
                    id="statement_file"
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      uploadForm.setValue("file", file, {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                    }}
                  />
                  {uploadForm.formState.errors.file ? (
                    <p className="text-xs text-destructive">
                      {uploadForm.formState.errors.file.message as string}
                    </p>
                  ) : null}
                </div>

                <div className="flex items-end">
                  <Button type="submit" disabled={isUploading || isConfirming}>
                    {isUploading ? "Parsing..." : "Upload"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {previewRows.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">2. Review Preview</CardTitle>
                {previewMeta ? (
                  <p className="text-xs text-muted-foreground sm:text-sm">
                    Bank: {previewMeta.bank.toUpperCase()} | Account: {previewMeta.account_number || "N/A"} | Period: {previewMeta.period_start || "N/A"} to {previewMeta.period_end || "N/A"} | Rows: {previewMeta.preview_count}
                  </p>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-[1fr_180px_220px_auto]">
                  <Input
                    value={globalFilter}
                    onChange={(event) => {
                      setGlobalFilter(event.target.value);
                      setPagination((current) => ({ ...current, pageIndex: 0 }));
                    }}
                    placeholder="Search concept, description, folio..."
                  />

                  <select
                    className="h-10 rounded-xl border border-border bg-card px-3 text-sm"
                    value={typeFilterValue}
                    onChange={(event) => setExactFilter("type", event.target.value)}
                  >
                    <option value="all">All types</option>
                    <option value="income">income</option>
                    <option value="expense">expense</option>
                  </select>

                  <select
                    className="h-10 rounded-xl border border-border bg-card px-3 text-sm"
                    value={categoryFilterValue}
                    onChange={(event) => setExactFilter("category", event.target.value)}
                  >
                    <option value="all">All categories</option>
                    {previewCategoryFilters.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>

                  <Button
                    variant="outline"
                    onClick={() => {
                      setGlobalFilter("");
                      setColumnFilters([]);
                    }}
                  >
                    Clear filters
                  </Button>
                </div>

                <Table>
                  <TableHeader>
                    {previewTable.getHeaderGroups().map((headerGroup) => (
                      <TableRow key={headerGroup.id}>
                        {headerGroup.headers.map((header) => (
                          <TableHead key={header.id}>
                            {header.isPlaceholder
                              ? null
                              : flexRender(
                                  header.column.columnDef.header,
                                  header.getContext()
                                )}
                          </TableHead>
                        ))}
                      </TableRow>
                    ))}
                  </TableHeader>

                  <TableBody>
                    {previewTable.getRowModel().rows.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={columns.length}
                          className="text-center text-sm text-muted-foreground"
                        >
                          No rows match current filters.
                        </TableCell>
                      </TableRow>
                    ) : (
                      previewTable.getRowModel().rows.map((row) => (
                        <TableRow key={row.id}>
                          {row.getVisibleCells().map((cell) => (
                            <TableCell key={cell.id}>
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:text-sm">
                    <span>
                      Showing {previewTable.getRowModel().rows.length} of{" "}
                      {previewTable.getFilteredRowModel().rows.length} filtered rows
                    </span>
                    <span>•</span>
                    <span>Total preview rows: {previewRows.length}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="h-9 rounded-lg border border-border bg-card px-2 text-xs sm:text-sm"
                      value={previewTable.getState().pagination.pageSize}
                      onChange={(event) =>
                        previewTable.setPageSize(Number(event.target.value))
                      }
                    >
                      {[5, 10, 20, 50].map((size) => (
                        <option key={size} value={size}>
                          {size} / page
                        </option>
                      ))}
                    </select>

                    <Button
                      variant="outline"
                      onClick={() => previewTable.previousPage()}
                      disabled={!previewTable.getCanPreviousPage()}
                    >
                      Previous
                    </Button>
                    <span className="text-xs text-muted-foreground sm:text-sm">
                      Page {previewTable.getState().pagination.pageIndex + 1} of{" "}
                      {Math.max(previewTable.getPageCount(), 1)}
                    </span>
                    <Button
                      variant="outline"
                      onClick={() => previewTable.nextPage()}
                      disabled={!previewTable.getCanNextPage()}
                    >
                      Next
                    </Button>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={confirmImport}
                    disabled={
                      isUploading ||
                      isConfirming ||
                      previewRows.length === 0
                    }
                  >
                    {isConfirming ? "Confirming..." : "Confirm Import"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <Dialog
        open={Boolean(descriptionViewer)}
        onOpenChange={(openState) => {
          if (!openState) {
            setDescriptionViewer(null);
          }
        }}
      >
        <DialogContent className="max-w-xl border-slate-700 bg-slate-950 text-slate-100">
          <DialogHeader>
            <DialogTitle className="text-slate-100">
              {descriptionViewer?.concept || "Transaction detail"}
            </DialogTitle>
            <DialogDescription className="text-slate-300">
              Date:{" "}
              {descriptionViewer?.transaction_date
                ? formatDate(descriptionViewer.transaction_date)
                : "-"}{" "}
              | Folio: {descriptionViewer?.folio || "-"}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-auto rounded-xl border border-border/70 bg-slate-900/50 p-3 text-sm text-slate-100">
            {descriptionViewer?.raw_description || "-"}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
