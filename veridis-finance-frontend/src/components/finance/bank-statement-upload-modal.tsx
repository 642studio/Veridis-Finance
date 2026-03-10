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
  DialogFooter,
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
  type BankStatementPreviewTransaction,
  type BankStatementUploadData,
  type Category,
  type Client,
  type Contact,
  type ContactType,
  type Member,
} from "@/types/finance";

const BANK_OPTIONS = ["santander", "bbva", "banorte"] as const;
const TYPE_OPTIONS = ["income", "expense"] as const;
const FALLBACK_CATEGORY_OPTIONS = [
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
const CREATE_CONTACT_OPTION = "__create_contact__";
const CREATE_CATEGORY_OPTION = "__create_category__";

const uploadSchema = z.object({
  bank: z.enum(BANK_OPTIONS),
  files: z
    .array(
      z
        .any()
        .refine(
          (value): value is File =>
            typeof File !== "undefined" && value instanceof File,
          "Invalid file"
        )
        .refine(
          (file: File) =>
            file.type === "application/pdf" ||
            String(file.name || "")
              .toLowerCase()
              .endsWith(".pdf"),
          "Each file must be a PDF"
        )
    )
    .min(1, "Select at least one PDF")
    .max(10, "Maximum 10 PDFs per batch"),
});

const previewRowSchema = z.object({
  import_id: z.string().uuid(),
  source_file_name: z.string().max(255),
  transaction_date: z.string().min(10),
  concept: z.string().min(1).max(120),
  raw_description: z.string().min(1).max(500),
  folio: z.string().max(120),
  bank: z.string().min(1).max(80),
  type: z.enum(TYPE_OPTIONS),
  category: z.string().min(1).max(120),
  contact_id: z.string().uuid().optional().nullable(),
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
  transactions: z.array(previewRowSchema).min(1),
});

type UploadFormValues = z.infer<typeof uploadSchema>;
type PreviewFormValues = z.infer<typeof previewSchema>;
type PreviewRow = PreviewFormValues["transactions"][number];

interface PreviewMeta {
  import_id: string;
  file_name: string;
  bank: string;
  account_number: string | null;
  period_start: string | null;
  period_end: string | null;
  preview_count: number;
}

interface ConfirmSummary {
  imports_total: number;
  imports_confirmed: number;
  imports_failed: number;
  inserted_count: number;
  skipped_duplicates: number;
  skipped_invalid: number;
  failed_imports: string[];
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
  contacts?: Contact[];
  categories?: Category[];
  onContactCreated?: (contact: Contact) => void;
  onCategoryCreated?: (category: Category) => void;
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

  if ((FALLBACK_CATEGORY_OPTIONS as readonly string[]).includes(concept)) {
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

function toPreviewRows(data: BankStatementUploadData, sourceFileName: string): PreviewRow[] {
  return data.transactions_preview.map((transaction) => ({
    import_id: data.import_id,
    source_file_name: sourceFileName,
    transaction_date: transaction.transaction_date,
    type: transaction.type,
    amount: Number(transaction.amount),
    concept: String(transaction.concept || "bank_movement"),
    raw_description: String(transaction.raw_description || transaction.concept || ""),
    folio: String(transaction.folio || ""),
    bank: String(transaction.bank || data.bank || ""),
    category: inferCategory(transaction),
    contact_id: undefined,
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

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function defaultContactTypeForRow(type: "income" | "expense"): ContactType {
  return type === "income" ? "customer" : "vendor";
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
  contacts = [],
  categories = [],
  onContactCreated,
  onCategoryCreated,
}: BankStatementUploadModalProps) {
  const notify = useNotify();

  const [isUploading, setIsUploading] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [previewImports, setPreviewImports] = useState<PreviewMeta[]>([]);
  const [confirmSummary, setConfirmSummary] = useState<ConfirmSummary | null>(null);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });
  const [descriptionViewer, setDescriptionViewer] = useState<DescriptionViewerState | null>(
    null
  );

  const [localContacts, setLocalContacts] = useState<Contact[]>(contacts);
  const [localCategories, setLocalCategories] = useState<Category[]>(categories);
  const [pendingContactRowIndex, setPendingContactRowIndex] = useState<number | null>(
    null
  );
  const [pendingCategoryRowIndex, setPendingCategoryRowIndex] = useState<number | null>(
    null
  );
  const [isCreateContactOpen, setIsCreateContactOpen] = useState(false);
  const [newContactName, setNewContactName] = useState("");
  const [newContactType, setNewContactType] = useState<ContactType>("vendor");
  const [isCreatingContact, setIsCreatingContact] = useState(false);
  const [isCreateCategoryOpen, setIsCreateCategoryOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);

  useEffect(() => {
    setLocalContacts(contacts);
  }, [contacts]);

  useEffect(() => {
    setLocalCategories(categories);
  }, [categories]);

  const uploadForm = useForm<UploadFormValues>({
    resolver: zodResolver(uploadSchema),
    defaultValues: {
      bank: "santander",
      files: [],
    },
    mode: "onSubmit",
  });

  const previewForm = useForm<PreviewFormValues>({
    resolver: zodResolver(previewSchema),
    defaultValues: {
      transactions: [],
    },
  });

  const previewRows = previewForm.watch("transactions");

  const resetAll = () => {
    uploadForm.reset({ bank: "santander", files: [] });
    previewForm.reset({ transactions: [] });
    setPreviewImports([]);
    setConfirmSummary(null);
    setGlobalFilter("");
    setColumnFilters([]);
    setPagination({ pageIndex: 0, pageSize: 10 });
    setDescriptionViewer(null);
    setPendingContactRowIndex(null);
    setPendingCategoryRowIndex(null);
    setIsCreateContactOpen(false);
    setIsCreateCategoryOpen(false);
    setNewContactName("");
    setNewCategoryName("");
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
    setConfirmSummary(null);

    try {
      const nextPreviewImports: PreviewMeta[] = [];
      const nextPreviewRows: PreviewRow[] = [];
      const failedUploads: Array<{ fileName: string; reason: string }> = [];

      for (const file of values.files) {
        try {
          const formData = new FormData();
          formData.append("bank", values.bank);
          formData.append("file", file);

          const response = await clientApiFetch<ApiEnvelope<BankStatementUploadData>>(
            "/api/finance/bank-statements/upload",
            {
              method: "POST",
              body: formData,
            }
          );

          nextPreviewImports.push({
            import_id: response.data.import_id,
            file_name: file.name,
            bank: response.data.bank,
            account_number: response.data.account_number,
            period_start: response.data.period_start,
            period_end: response.data.period_end,
            preview_count: response.data.preview_count,
          });
          nextPreviewRows.push(...toPreviewRows(response.data, file.name));
        } catch (error) {
          const reason =
            error instanceof ApiClientError ? error.message : "Upload failed";
          failedUploads.push({ fileName: file.name, reason });
        }
      }

      if (nextPreviewRows.length > 0) {
        previewForm.reset({ transactions: nextPreviewRows });
        setPreviewImports(nextPreviewImports);
        setGlobalFilter("");
        setColumnFilters([]);
        setPagination({ pageIndex: 0, pageSize: 10 });
      } else {
        previewForm.reset({ transactions: [] });
        setPreviewImports([]);
      }

      if (failedUploads.length === 0) {
        notify.success({
          title: "Statements parsed",
          description: `${nextPreviewImports.length} file(s) ready for confirmation.`,
        });
      } else if (nextPreviewImports.length > 0) {
        notify.warning({
          title: "Partial upload",
          description: `${nextPreviewImports.length} file(s) parsed, ${failedUploads.length} failed.`,
        });
      } else {
        notify.error({
          title: "Upload failed",
          description: failedUploads[0]?.reason || "Could not process statements.",
        });
      }
    } finally {
      setIsUploading(false);
    }
  });

  const confirmImport = previewForm.handleSubmit(async (values) => {
    setIsConfirming(true);
    setConfirmSummary(null);

    try {
      const rowsByImportId = new Map<string, PreviewRow[]>();
      for (const row of values.transactions) {
        if (!rowsByImportId.has(row.import_id)) {
          rowsByImportId.set(row.import_id, []);
        }
        rowsByImportId.get(row.import_id)?.push(row);
      }

      let insertedCount = 0;
      let skippedDuplicates = 0;
      let skippedInvalid = 0;
      let importsConfirmed = 0;
      const failedImports: string[] = [];

      for (const [importId, rows] of Array.from(rowsByImportId.entries())) {
        try {
          const response = await clientApiFetch<ApiEnvelope<BankStatementConfirmData>>(
            `/api/finance/bank-statements/confirm/${importId}`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
              },
              body: JSON.stringify({
                transactions: rows.map((row: PreviewRow) => ({
                  transaction_date: row.transaction_date,
                  type: row.type,
                  amount: Number(row.amount),
                  concept: row.concept,
                  category: row.category,
                  contact_id: row.contact_id || undefined,
                  member_id: row.member_id || undefined,
                  client_id: row.client_id || undefined,
                  vendor_id: row.vendor_id || undefined,
                  raw_description: row.raw_description,
                  folio: row.folio,
                  bank: row.bank,
                  match_confidence: row.match_confidence ?? undefined,
                  match_method: row.match_method ?? undefined,
                })),
              }),
            }
          );

          insertedCount += Number(response.data.inserted_count || 0);
          skippedDuplicates += Number(response.data.skipped_duplicates || 0);
          skippedInvalid += Number(response.data.skipped_invalid || 0);
          importsConfirmed += 1;
        } catch {
          failedImports.push(importId);
        }
      }

      const summary: ConfirmSummary = {
        imports_total: rowsByImportId.size,
        imports_confirmed: importsConfirmed,
        imports_failed: failedImports.length,
        inserted_count: insertedCount,
        skipped_duplicates: skippedDuplicates,
        skipped_invalid: skippedInvalid,
        failed_imports: failedImports,
      };
      setConfirmSummary(summary);

      if (importsConfirmed > 0) {
        await onImportConfirmed?.();
      }

      if (failedImports.length > 0) {
        const failedSet = new Set(failedImports);
        const remainingRows = values.transactions.filter((row) =>
          failedSet.has(row.import_id)
        );
        previewForm.reset({ transactions: remainingRows });
        setPreviewImports((current) =>
          current.filter((item) => failedSet.has(item.import_id))
        );

        notify.warning({
          title: "Partial confirm",
          description: `${importsConfirmed} import(s) confirmed, ${failedImports.length} failed.`,
        });
      } else {
        notify.success({
          title: "Imports confirmed",
          description: `${insertedCount} inserted, ${skippedDuplicates} duplicates, ${skippedInvalid} invalid.`,
        });
        closeModal();
      }
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

  const createContact = async () => {
    const trimmedName = newContactName.trim();
    if (!trimmedName || pendingContactRowIndex === null) {
      return;
    }

    const normalizedName = normalizeText(trimmedName);
    const duplicate = localContacts.find((contact) => {
      const nameMatch = normalizeText(contact.name) === normalizedName;
      const businessMatch =
        normalizeText(contact.business_name || "") === normalizedName;
      return nameMatch || businessMatch;
    });

    if (duplicate) {
      const contactField = `transactions.${pendingContactRowIndex}.contact_id` as const;
      previewForm.setValue(contactField, duplicate.id, { shouldDirty: true });
      previewForm.setValue(`transactions.${pendingContactRowIndex}.member_id` as const, undefined, {
        shouldDirty: true,
      });
      previewForm.setValue(`transactions.${pendingContactRowIndex}.client_id` as const, undefined, {
        shouldDirty: true,
      });
      previewForm.setValue(`transactions.${pendingContactRowIndex}.vendor_id` as const, undefined, {
        shouldDirty: true,
      });
      previewForm.setValue(`transactions.${pendingContactRowIndex}.match_method` as const, "manual", {
        shouldDirty: true,
      });
      previewForm.setValue(`transactions.${pendingContactRowIndex}.match_confidence` as const, 1, {
        shouldDirty: true,
      });
      setIsCreateContactOpen(false);
      setPendingContactRowIndex(null);
      setNewContactName("");
      notify.info({
        title: "Contact reused",
        description: "An existing contact with that name was selected.",
      });
      return;
    }

    setIsCreatingContact(true);
    try {
      const response = await clientApiFetch<ApiEnvelope<Contact>>("/api/finance/contacts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: trimmedName,
          type: newContactType,
          status: "active",
        }),
      });

      const created = response.data;
      setLocalContacts((current) => [created, ...current]);
      onContactCreated?.(created);

      const contactField = `transactions.${pendingContactRowIndex}.contact_id` as const;
      previewForm.setValue(contactField, created.id, { shouldDirty: true });
      previewForm.setValue(`transactions.${pendingContactRowIndex}.member_id` as const, undefined, {
        shouldDirty: true,
      });
      previewForm.setValue(`transactions.${pendingContactRowIndex}.client_id` as const, undefined, {
        shouldDirty: true,
      });
      previewForm.setValue(`transactions.${pendingContactRowIndex}.vendor_id` as const, undefined, {
        shouldDirty: true,
      });
      previewForm.setValue(`transactions.${pendingContactRowIndex}.match_method` as const, "manual", {
        shouldDirty: true,
      });
      previewForm.setValue(`transactions.${pendingContactRowIndex}.match_confidence` as const, 1, {
        shouldDirty: true,
      });

      setIsCreateContactOpen(false);
      setPendingContactRowIndex(null);
      setNewContactName("");
      notify.success({
        title: "Contact created",
        description: "Contact was created and assigned.",
      });
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not create contact";
      notify.error({
        title: "Create contact failed",
        description: message,
      });
    } finally {
      setIsCreatingContact(false);
    }
  };

  const createCategory = async () => {
    const trimmedName = newCategoryName.trim();
    if (!trimmedName || pendingCategoryRowIndex === null) {
      return;
    }

    const normalizedName = normalizeText(trimmedName);
    const duplicate = localCategories.find(
      (category) => normalizeText(category.name) === normalizedName
    );

    if (duplicate) {
      previewForm.setValue(
        `transactions.${pendingCategoryRowIndex}.category` as const,
        duplicate.name,
        { shouldDirty: true }
      );
      setIsCreateCategoryOpen(false);
      setPendingCategoryRowIndex(null);
      setNewCategoryName("");
      notify.info({
        title: "Category reused",
        description: "An existing category with that name was selected.",
      });
      return;
    }

    setIsCreatingCategory(true);
    try {
      const response = await clientApiFetch<ApiEnvelope<Category>>(
        "/api/finance/categories",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: trimmedName,
            active: true,
          }),
        }
      );
      const created = response.data;
      setLocalCategories((current) => [created, ...current]);
      onCategoryCreated?.(created);
      previewForm.setValue(
        `transactions.${pendingCategoryRowIndex}.category` as const,
        created.name,
        { shouldDirty: true }
      );
      setIsCreateCategoryOpen(false);
      setPendingCategoryRowIndex(null);
      setNewCategoryName("");
      notify.success({
        title: "Category created",
        description: "Category was created and assigned.",
      });
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not create category";
      notify.error({
        title: "Create category failed",
        description: message,
      });
    } finally {
      setIsCreatingCategory(false);
    }
  };

  const columns = useMemo<ColumnDef<PreviewRow>[]>(
    () => [
      {
        accessorKey: "source_file_name",
        id: "source_file_name",
        header: "File",
        cell: ({ row }) => (
          <div>
            <p className="text-xs font-medium">{row.original.source_file_name}</p>
            <p className="text-[10px] text-muted-foreground">
              {row.original.import_id.slice(0, 8)}...
            </p>
          </div>
        ),
      },
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
          const knownNames = new Set<string>([
            ...localCategories.map((item) => item.name),
            ...FALLBACK_CATEGORY_OPTIONS,
            currentValue,
          ]);
          const options = Array.from(knownNames).filter(Boolean).sort((left, right) =>
            left.localeCompare(right, "en", { sensitivity: "base" })
          );

          return (
            <select
              className="h-8 min-w-[160px] rounded-md border border-border bg-background px-2 text-xs sm:text-sm"
              value={currentValue}
              onChange={(event) => {
                const nextValue = event.target.value;
                if (nextValue === CREATE_CATEGORY_OPTION) {
                  setPendingCategoryRowIndex(row.index);
                  setIsCreateCategoryOpen(true);
                  return;
                }
                previewForm.setValue(fieldPath, nextValue, {
                  shouldDirty: true,
                });
              }}
            >
              {options.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
              <option value={CREATE_CATEGORY_OPTION}>+ Create new category</option>
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
        accessorKey: "contact_id",
        id: "contact_id",
        header: "Contact",
        cell: ({ row }) => {
          const fieldPath = `transactions.${row.index}.contact_id` as const;
          const selectedContactId = previewForm.watch(fieldPath) || "";
          const contactOptions = localContacts.filter((contact) => {
            if (row.original.type === "income") {
              return contact.type === "customer" || contact.type === "internal";
            }
            return contact.type !== "customer";
          });

          return (
            <select
              className="h-8 min-w-[180px] rounded-md border border-border bg-background px-2 text-xs sm:text-sm"
              value={selectedContactId}
              onChange={(event) => {
                const nextValue = event.target.value.trim();
                if (nextValue === CREATE_CONTACT_OPTION) {
                  setPendingContactRowIndex(row.index);
                  setNewContactType(defaultContactTypeForRow(row.original.type));
                  setIsCreateContactOpen(true);
                  return;
                }

                previewForm.setValue(fieldPath, nextValue || undefined, {
                  shouldDirty: true,
                });
                if (nextValue) {
                  previewForm.setValue(`transactions.${row.index}.member_id` as const, undefined, {
                    shouldDirty: true,
                  });
                  previewForm.setValue(`transactions.${row.index}.client_id` as const, undefined, {
                    shouldDirty: true,
                  });
                  previewForm.setValue(`transactions.${row.index}.vendor_id` as const, undefined, {
                    shouldDirty: true,
                  });
                  previewForm.setValue(`transactions.${row.index}.match_method` as const, "manual", {
                    shouldDirty: true,
                  });
                  previewForm.setValue(`transactions.${row.index}.match_confidence` as const, 1, {
                    shouldDirty: true,
                  });
                }
              }}
            >
              <option value="">Unassigned</option>
              {contactOptions.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.business_name || contact.name}
                  {contact.business_name ? ` (${contact.name})` : ""}
                  {` [${contact.type}]`}
                </option>
              ))}
              <option value={CREATE_CONTACT_OPTION}>+ Create new contact</option>
            </select>
          );
        },
      },
      {
        accessorKey: "member_id",
        id: "member_id",
        header: "Member",
        cell: ({ row }) => {
          const fieldPath = `transactions.${row.index}.member_id` as const;
          const isPayroll = isPayrollTransaction(row.original);

          if (!isPayroll || row.original.type !== "expense") {
            return <span className="text-xs text-muted-foreground">-</span>;
          }

          if (!members.length) {
            return <span className="text-xs text-amber-500">Add members first</span>;
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
                  previewForm.setValue(`transactions.${row.index}.contact_id` as const, undefined, {
                    shouldDirty: true,
                  });
                  previewForm.setValue(`transactions.${row.index}.client_id` as const, undefined, {
                    shouldDirty: true,
                  });
                  previewForm.setValue(`transactions.${row.index}.vendor_id` as const, undefined, {
                    shouldDirty: true,
                  });
                  previewForm.setValue(`transactions.${row.index}.match_method` as const, "manual", {
                    shouldDirty: true,
                  });
                  previewForm.setValue(`transactions.${row.index}.match_confidence` as const, 1, {
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
          if (row.original.type !== "income") {
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
                  previewForm.setValue(`transactions.${row.index}.contact_id` as const, undefined, {
                    shouldDirty: true,
                  });
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
    [clients, localCategories, localContacts, members, previewForm]
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
      setColumnFilters((current) =>
        typeof updater === "function" ? updater(current) : updater
      );
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
        row.original.source_file_name,
        row.original.import_id,
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
    const values = new Set<string>(FALLBACK_CATEGORY_OPTIONS as readonly string[]);
    for (const row of previewRows) {
      const category = String(row.category || "").trim();
      if (category) {
        values.add(category);
      }
    }
    for (const category of localCategories) {
      values.add(category.name);
    }
    return Array.from(values).sort((left, right) =>
      left.localeCompare(right, "en", { sensitivity: "base" })
    );
  }, [localCategories, previewRows]);

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
    <>
      <div
        className="fixed inset-0 z-50 bg-foreground/30 p-4 backdrop-blur-sm"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            closeModal();
          }
        }}
      >
        <div className="mx-auto mt-4 flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl animate-fade-in">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h3 className="font-heading text-lg font-semibold">
                Upload Bank Statements
              </h3>
              <p className="text-xs text-muted-foreground sm:text-sm">
                Upload up to 10 PDFs, review combined preview, and confirm batch import.
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={closeModal}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-6 overflow-y-auto p-5">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">1. Upload PDFs</CardTitle>
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
                    <Label htmlFor="statement_files">PDF files (max 10)</Label>
                    <Input
                      id="statement_files"
                      type="file"
                      multiple
                      accept="application/pdf,.pdf"
                      onChange={(event) => {
                        const files = Array.from(event.target.files || []).slice(0, 10);
                        uploadForm.setValue("files", files, {
                          shouldDirty: true,
                          shouldValidate: true,
                        });
                      }}
                    />
                    {uploadForm.formState.errors.files ? (
                      <p className="text-xs text-destructive">
                        {uploadForm.formState.errors.files.message as string}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex items-end">
                    <Button type="submit" disabled={isUploading || isConfirming}>
                      {isUploading ? "Parsing..." : "Upload batch"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            {previewRows.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">2. Review Combined Preview</CardTitle>
                  <p className="text-xs text-muted-foreground sm:text-sm">
                    Imports: {previewImports.length} file(s) | Rows: {previewRows.length}
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-[1fr_180px_220px_auto]">
                    <Input
                      value={globalFilter}
                      onChange={(event) => {
                        setGlobalFilter(event.target.value);
                        setPagination((current) => ({ ...current, pageIndex: 0 }));
                      }}
                      placeholder="Search file, concept, description, folio..."
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
                                {flexRender(
                                  cell.column.columnDef.cell,
                                  cell.getContext()
                                )}
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
                      disabled={isUploading || isConfirming || previewRows.length === 0}
                    >
                      {isConfirming
                        ? "Confirming..."
                        : `Confirm Import Batch (${previewImports.length})`}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {confirmSummary ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Batch Summary</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  Confirmed {confirmSummary.imports_confirmed}/
                  {confirmSummary.imports_total} imports | Inserted{" "}
                  {confirmSummary.inserted_count} | Duplicates{" "}
                  {confirmSummary.skipped_duplicates} | Invalid{" "}
                  {confirmSummary.skipped_invalid}
                  {confirmSummary.imports_failed > 0
                    ? ` | Failed imports: ${confirmSummary.imports_failed}`
                    : ""}
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

      <Dialog open={isCreateContactOpen} onOpenChange={setIsCreateContactOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create contact</DialogTitle>
            <DialogDescription>
              Quick create from import preview row.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="import_contact_name">Name</Label>
              <Input
                id="import_contact_name"
                value={newContactName}
                onChange={(event) => setNewContactName(event.target.value)}
                placeholder="Client or vendor name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="import_contact_type">Type</Label>
              <select
                id="import_contact_type"
                className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                value={newContactType}
                onChange={(event) =>
                  setNewContactType(event.target.value as ContactType)
                }
              >
                <option value="customer">customer</option>
                <option value="vendor">vendor</option>
                <option value="employee">employee</option>
                <option value="contractor">contractor</option>
                <option value="internal">internal</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsCreateContactOpen(false)}
              disabled={isCreatingContact}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                void createContact();
              }}
              disabled={isCreatingContact}
            >
              {isCreatingContact ? "Creating..." : "Create contact"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isCreateCategoryOpen} onOpenChange={setIsCreateCategoryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create category</DialogTitle>
            <DialogDescription>
              Quick create from import preview row.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="import_category_name">Name</Label>
            <Input
              id="import_category_name"
              value={newCategoryName}
              onChange={(event) => setNewCategoryName(event.target.value)}
              placeholder="operations"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsCreateCategoryOpen(false)}
              disabled={isCreatingCategory}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                void createCategory();
              }}
              disabled={isCreatingCategory}
            >
              {isCreatingCategory ? "Creating..." : "Create category"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
