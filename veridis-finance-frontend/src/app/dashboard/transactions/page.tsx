"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { History, Link2, Pencil, Trash2 } from "lucide-react";

import {
  ConfirmModal,
  getConfirmSkipPreference,
  setConfirmSkipPreference,
} from "@/components/common/confirm-modal";
import {
  CreateTransactionPayload,
  TransactionForm,
} from "@/components/finance/transaction-form";
import { BankStatementUploadModal } from "@/components/finance/bank-statement-upload-modal";
import { TransactionSplitsModal } from "@/components/finance/transaction-splits-modal";
import { ReconciliationModal } from "@/components/finance/reconciliation-modal";
import {
  TransactionEditModal,
  type UpdateTransactionPayload,
} from "@/components/finance/transaction-edit-modal";
import { Badge } from "@/components/ui/badge";
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
import { findBestContactMatchId } from "@/lib/contact-matching";
import { emitFinanceDataRefresh } from "@/lib/finance-events";
import { formatCurrency, formatDate } from "@/lib/format";
import type {
  Account,
  ApiEnvelope,
  Category,
  Client,
  Contact,
  Member,
  TransactionAuditEntry,
  Transaction,
  TransactionStatus,
  Vendor,
} from "@/types/finance";

type CategoryCatalog = {
  income: string[];
  expense: string[];
  neutral: string[];
  review: string;
};

type CategoryBreakdownItem = { category: string; count: number; total: number };
type CategoryBreakdown = {
  year: number;
  month: number;
  income: CategoryBreakdownItem[];
  expense: CategoryBreakdownItem[];
  income_total: number;
  expense_total: number;
  net: number;
  transfers_total: number;
  review_count: number;
  review_total: number;
};

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
const SORT_BY_OPTIONS = [
  { value: "transaction_date", label: "Fecha" },
  { value: "amount", label: "Monto" },
  { value: "category", label: "Categoría" },
  { value: "created_at", label: "Creación" },
] as const;
const SORT_ORDER_OPTIONS = [
  { value: "desc", label: "Descendente" },
  { value: "asc", label: "Ascendente" },
] as const;

const STATUS_LABELS: Record<string, string> = {
  posted: "Registrado",
  pending: "Pendiente",
  reconciled: "Conciliado",
  void: "Anulado",
};

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  automation: "Automatización",
  bank_statement_import: "Estado de cuenta",
  ghl: "642 CRM",
  crm: "642 CRM",
  sat_download: "Descarga SAT",
  seed: "Demo",
};

function statusLabel(status?: string | null) {
  return STATUS_LABELS[status || "posted"] || status || "—";
}

function sourceLabel(source?: string | null) {
  return SOURCE_LABELS[source || "manual"] || source || "Manual";
}

function isUncategorized(category?: string | null) {
  // Alineado con el motor de reclasificación del backend, que solo actúa sobre
  // categorías nulas/vacías/"uncategorized" (no toca categorías ya asignadas).
  const c = (category || "").trim().toLowerCase();
  return !c || c === "uncategorized" || c === "sin categoría";
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function EntityBadge({ transaction }: { transaction: Transaction }) {
  if (transaction.contact_id) {
    return (
      <Link href={`/dashboard/contacts?contactId=${transaction.contact_id}`}>
        <Badge variant="outline" className="hover:bg-accent">
          Contacto: {transaction.contact_name || "Ver"}
        </Badge>
      </Link>
    );
  }

  if (transaction.member_id) {
    return (
      <Link
        href={`/dashboard/contacts?type=internal&q=${encodeURIComponent(
          transaction.member_name || transaction.entity || ""
        )}`}
      >
        <Badge variant="outline" className="hover:bg-accent">
          Equipo: {transaction.member_name || "Ver"}
        </Badge>
      </Link>
    );
  }

  if (transaction.client_id) {
    return (
      <Link
        href={`/dashboard/contacts?type=customer&q=${encodeURIComponent(
          transaction.client_name || transaction.entity || ""
        )}`}
      >
        <Badge variant="outline" className="hover:bg-accent">
          Cliente: {transaction.client_name || "Ver"}
        </Badge>
      </Link>
    );
  }

  if (transaction.vendor_id) {
    return (
      <Link
        href={`/dashboard/contacts?type=vendor&q=${encodeURIComponent(
          transaction.vendor_name || transaction.entity || ""
        )}`}
      >
        <Badge variant="outline" className="hover:bg-accent">
          Proveedor: {transaction.vendor_name || "Ver"}
        </Badge>
      </Link>
    );
  }

  return <span className="text-xs text-muted-foreground">-</span>;
}

export default function DashboardTransactionsPage() {
  const notify = useNotify();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [canonicalCategories, setCanonicalCategories] = useState<string[]>([]);
  const [breakdown, setBreakdown] = useState<CategoryBreakdown | null>(null);
  const [isRecategorizing, setIsRecategorizing] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isMetaLoading, setIsMetaLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isBankUploadOpen, setIsBankUploadOpen] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState("all");
  const [selectedClientId, setSelectedClientId] = useState("all");
  const [selectedVendorId, setSelectedVendorId] = useState("all");
  const [selectedContactId, setSelectedContactId] = useState("all");
  const [selectedAccountId, setSelectedAccountId] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState<"all" | TransactionStatus>(
    "all"
  );
  const [selectedSource, setSelectedSource] = useState("all");
  const [queryText, setQueryText] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);
  const [sortBy, setSortBy] = useState<(typeof SORT_BY_OPTIONS)[number]["value"]>(
    "transaction_date"
  );
  const [sortOrder, setSortOrder] = useState<
    (typeof SORT_ORDER_OPTIONS)[number]["value"]
  >("desc");
  const [hasNextPage, setHasNextPage] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isCategorizing, setIsCategorizing] = useState(false);
  const [categorizingId, setCategorizingId] = useState<string | null>(null);
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState<"" | TransactionStatus>("");
  const [bulkCategory, setBulkCategory] = useState("");
  const [isBulkApplying, setIsBulkApplying] = useState(false);
  const [isBulkDeleteConfirmOpen, setIsBulkDeleteConfirmOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [splitTransaction, setSplitTransaction] = useState<Transaction | null>(null);
  const [isSplitsOpen, setIsSplitsOpen] = useState(false);

  const [reconcileTransaction, setReconcileTransaction] = useState<Transaction | null>(null);
  const [isReconcileOpen, setIsReconcileOpen] = useState(false);
  const [deletingTransaction, setDeletingTransaction] = useState<Transaction | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [historyTransaction, setHistoryTransaction] = useState<Transaction | null>(
    null
  );
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyRows, setHistoryRows] = useState<TransactionAuditEntry[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  const applyDatePreset = (preset: "today" | "this_month" | "last_30" | "clear") => {
    if (preset === "clear") {
      setFromDate("");
      setToDate("");
      setPage(1);
      return;
    }

    const now = new Date();
    const to = toDateInputValue(now);

    if (preset === "today") {
      setFromDate(to);
      setToDate(to);
      setPage(1);
      return;
    }

    if (preset === "this_month") {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      setFromDate(toDateInputValue(firstDay));
      setToDate(to);
      setPage(1);
      return;
    }

    const start = new Date(now);
    start.setDate(start.getDate() - 29);
    setFromDate(toDateInputValue(start));
    setToDate(to);
    setPage(1);
  };

  // IA: sugiere nombre y categoría a los movimientos sin categorizar,
  // reutilizando el motor de reclasificación del backend.
  const runReclassify = useCallback(
    async (limit: number) => {
      const res = await clientApiFetch<{ data: { updated: number; scanned: number } }>(
        "/api/finance/intelligence/reclassify",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ limit, min_confidence: 0.5 }),
        }
      );
      return res.data;
    },
    []
  );

  const loadTransactions = useCallback(async () => {
    setIsLoading(true);
    setHasNextPage(false);
    try {
      const apiLimit = pageSize + 1;
      const apiOffset = (page - 1) * pageSize;
      const searchParams = new URLSearchParams({
        limit: String(apiLimit),
        offset: String(apiOffset),
        sort_by: sortBy,
        sort_order: sortOrder,
      });

      if (selectedContactId !== "all") {
        searchParams.set("contact_id", selectedContactId);
      } else if (selectedMemberId !== "all") {
        searchParams.set("member_id", selectedMemberId);
      } else if (selectedClientId !== "all") {
        searchParams.set("client_id", selectedClientId);
      } else if (selectedVendorId !== "all") {
        searchParams.set("vendor_id", selectedVendorId);
      }

      if (selectedAccountId !== "all") {
        searchParams.set("account_id", selectedAccountId);
      }

      if (selectedStatus !== "all") {
        searchParams.set("status", selectedStatus);
      }

      if (selectedSource !== "all") {
        searchParams.set("source", selectedSource);
      }

      const trimmedQuery = queryText.trim();
      if (trimmedQuery) {
        searchParams.set("q", trimmedQuery);
      }

      if (fromDate) {
        searchParams.set("from", fromDate);
      }

      if (toDate) {
        searchParams.set("to", toDate);
      }

      const response = await clientApiFetch<ApiEnvelope<Transaction[]>>(
        `/api/finance/transactions?${searchParams.toString()}`
      );
      const hasExtraRow = response.data.length > pageSize;
      setHasNextPage(hasExtraRow);
      setTransactions(
        hasExtraRow ? response.data.slice(0, pageSize) : response.data
      );
    } catch (error) {
      setTransactions([]);
      const message =
        error instanceof ApiClientError ? error.message : "Could not fetch transactions";
      notify.error({ title: "Load failed", description: message });
    } finally {
      setIsLoading(false);
    }
  }, [
    fromDate,
    notify,
    page,
    pageSize,
    queryText,
    sortBy,
    sortOrder,
    selectedAccountId,
    selectedClientId,
    selectedContactId,
    selectedMemberId,
    selectedSource,
    selectedStatus,
    toDate,
    selectedVendorId,
  ]);

  const loadMeta = useCallback(async () => {
    setIsMetaLoading(true);
    try {
      const [
        accountsResponse,
        contactsResponse,
        categoriesResponse,
        membersResponse,
        clientsResponse,
        vendorsResponse,
        catalogResponse,
      ] = await Promise.all([
        clientApiFetch<ApiEnvelope<Account[]>>("/api/finance/accounts?status=active"),
        clientApiFetch<ApiEnvelope<Contact[]>>("/api/finance/contacts?status=active"),
        clientApiFetch<ApiEnvelope<Category[]>>("/api/finance/categories?active=true"),
        clientApiFetch<ApiEnvelope<Member[]>>("/api/finance/members?active=true"),
        clientApiFetch<ApiEnvelope<Client[]>>("/api/finance/clients?active=true"),
        clientApiFetch<ApiEnvelope<Vendor[]>>("/api/finance/vendors?active=true"),
        clientApiFetch<ApiEnvelope<CategoryCatalog>>("/api/finance/categories/catalog").catch(
          () => null
        ),
      ]);

      setAccounts(accountsResponse.data);
      setContacts(contactsResponse.data);
      setCategories(categoriesResponse.data);
      setMembers(membersResponse.data);
      setClients(clientsResponse.data);
      setVendors(vendorsResponse.data);
      if (catalogResponse?.data) {
        const c = catalogResponse.data;
        setCanonicalCategories([
          ...(c.income || []),
          ...(c.expense || []),
          ...(c.neutral || []),
          ...(c.review ? [c.review] : []),
        ]);
      }
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not load entities";
      notify.error({ title: "Load failed", description: message });
    } finally {
      setIsMetaLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    const memberId = searchParams.get("member_id");
    const clientId = searchParams.get("client_id");
    const vendorId = searchParams.get("vendor_id");
    const contactId = searchParams.get("contact_id");
    const accountId = searchParams.get("account_id");
    const status = searchParams.get("status");
    const source = searchParams.get("source");
    const q = searchParams.get("q");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const pageParam = searchParams.get("page");
    const pageSizeParam = searchParams.get("page_size");
    const sortByParam = searchParams.get("sort_by");
    const sortOrderParam = searchParams.get("sort_order");

    const hasAnyFilter = Boolean(
      memberId ||
        clientId ||
        vendorId ||
        contactId ||
        accountId ||
        status ||
        source ||
        q ||
        from ||
        to ||
        pageParam ||
        pageSizeParam ||
        sortByParam ||
        sortOrderParam
    );
    if (!hasAnyFilter) {
      return;
    }

    if (memberId) {
      setSelectedMemberId(memberId);
      setSelectedClientId("all");
      setSelectedVendorId("all");
      setSelectedContactId("all");
    } else if (clientId) {
      setSelectedMemberId("all");
      setSelectedClientId(clientId);
      setSelectedVendorId("all");
      setSelectedContactId("all");
    } else if (vendorId) {
      setSelectedMemberId("all");
      setSelectedClientId("all");
      setSelectedVendorId(vendorId);
      setSelectedContactId("all");
    } else if (contactId) {
      setSelectedMemberId("all");
      setSelectedClientId("all");
      setSelectedVendorId("all");
      setSelectedContactId(contactId);
    }

    if (accountId) {
      setSelectedAccountId(accountId);
    }

    if (status && ["posted", "pending", "reconciled", "void"].includes(status)) {
      setSelectedStatus(status as TransactionStatus);
    }

    if (source) {
      setSelectedSource(source);
    }

    if (q !== null) {
      setQueryText(q);
    }

    if (from !== null) {
      setFromDate(from);
    }

    if (to !== null) {
      setToDate(to);
    }

    const parsedPage = Number.parseInt(pageParam || "", 10);
    if (Number.isFinite(parsedPage) && parsedPage > 0) {
      setPage(parsedPage);
    }

    const parsedPageSize = Number.parseInt(pageSizeParam || "", 10);
    if (
      Number.isFinite(parsedPageSize) &&
      PAGE_SIZE_OPTIONS.includes(
        parsedPageSize as (typeof PAGE_SIZE_OPTIONS)[number]
      )
    ) {
      setPageSize(parsedPageSize);
    }

    if (
      sortByParam &&
      SORT_BY_OPTIONS.some((option) => option.value === sortByParam)
    ) {
      setSortBy(sortByParam as (typeof SORT_BY_OPTIONS)[number]["value"]);
    }

    if (
      sortOrderParam &&
      SORT_ORDER_OPTIONS.some((option) => option.value === sortOrderParam)
    ) {
      setSortOrder(
        sortOrderParam as (typeof SORT_ORDER_OPTIONS)[number]["value"]
      );
    }
  }, [searchParams]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  useEffect(() => {
    const visibleIds = new Set(transactions.map((transaction) => transaction.id));
    setSelectedTransactionIds((current) =>
      current.filter((transactionId) => visibleIds.has(transactionId))
    );
  }, [transactions]);

  useEffect(() => {
    const nextParams = new URLSearchParams();

    if (selectedContactId !== "all") {
      nextParams.set("contact_id", selectedContactId);
    } else if (selectedMemberId !== "all") {
      nextParams.set("member_id", selectedMemberId);
    } else if (selectedClientId !== "all") {
      nextParams.set("client_id", selectedClientId);
    } else if (selectedVendorId !== "all") {
      nextParams.set("vendor_id", selectedVendorId);
    }

    if (selectedAccountId !== "all") {
      nextParams.set("account_id", selectedAccountId);
    }
    if (selectedStatus !== "all") {
      nextParams.set("status", selectedStatus);
    }
    if (selectedSource !== "all") {
      nextParams.set("source", selectedSource);
    }

    const trimmedQuery = queryText.trim();
    if (trimmedQuery) {
      nextParams.set("q", trimmedQuery);
    }

    if (fromDate) {
      nextParams.set("from", fromDate);
    }
    if (toDate) {
      nextParams.set("to", toDate);
    }

    if (page > 1) {
      nextParams.set("page", String(page));
    }

    if (pageSize !== PAGE_SIZE_OPTIONS[0]) {
      nextParams.set("page_size", String(pageSize));
    }

    if (sortBy !== "transaction_date") {
      nextParams.set("sort_by", sortBy);
    }

    if (sortOrder !== "desc") {
      nextParams.set("sort_order", sortOrder);
    }

    const nextQuery = nextParams.toString();
    const currentQuery = searchParams.toString();
    if (nextQuery === currentQuery) {
      return;
    }

    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
      scroll: false,
    });
  }, [
    fromDate,
    page,
    pageSize,
    pathname,
    queryText,
    router,
    searchParams,
    sortBy,
    sortOrder,
    selectedAccountId,
    selectedClientId,
    selectedContactId,
    selectedMemberId,
    selectedSource,
    selectedStatus,
    selectedVendorId,
    toDate,
  ]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  const upsertContact = useCallback((contact: Contact) => {
    setContacts((current) => {
      const existingIndex = current.findIndex((item) => item.id === contact.id);
      if (existingIndex >= 0) {
        const next = [...current];
        next[existingIndex] = contact;
        return next;
      }
      return [contact, ...current];
    });
  }, []);

  const upsertCategory = useCallback((category: Category) => {
    setCategories((current) => {
      const existingIndex = current.findIndex((item) => item.id === category.id);
      if (existingIndex >= 0) {
        const next = [...current];
        next[existingIndex] = category;
        return next;
      }
      return [category, ...current];
    });
  }, []);

  const handleCreateTransaction = async (payload: CreateTransactionPayload) => {
    try {
      await clientApiFetch<ApiEnvelope<Transaction>>("/api/finance/transactions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      notify.success({
        title: "Transaction created",
        description: "The entry was saved successfully.",
      });
      setIsCreateOpen(false);
      await loadTransactions();
      emitFinanceDataRefresh("transaction_create");
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not create transaction";
      notify.error({
        title: "Transaction failed",
        description: message,
      });
      throw error;
    }
  };

  const openEdit = (transaction: Transaction) => {
    setEditingTransaction(transaction);
    setIsEditOpen(true);
  };

  const closeEdit = () => {
    if (isSavingEdit) {
      return;
    }

    setIsEditOpen(false);
    setEditingTransaction(null);
  };

  const openSplits = (transaction: Transaction) => {
    setSplitTransaction(transaction);
    setIsSplitsOpen(true);
  };

  const loadTransactionHistory = useCallback(
    async (transactionId: string) => {
      setIsHistoryLoading(true);
      try {
        const response = await clientApiFetch<ApiEnvelope<TransactionAuditEntry[]>>(
          `/api/finance/transactions/${transactionId}/history?limit=100`
        );
        setHistoryRows(response.data);
      } catch (error) {
        setHistoryRows([]);
        const message =
          error instanceof ApiClientError
            ? error.message
            : "Could not load transaction history";
        notify.error({ title: "Load failed", description: message });
      } finally {
        setIsHistoryLoading(false);
      }
    },
    [notify]
  );

  const openHistory = async (transaction: Transaction) => {
    setHistoryTransaction(transaction);
    setIsHistoryOpen(true);
    await loadTransactionHistory(transaction.id);
  };

  const closeHistory = () => {
    setIsHistoryOpen(false);
    setHistoryTransaction(null);
    setHistoryRows([]);
  };

  const handleEditSave = async (payload: UpdateTransactionPayload) => {
    if (!editingTransaction) {
      return;
    }

    setIsSavingEdit(true);
    try {
      await clientApiFetch<ApiEnvelope<Transaction>>(
        `/api/finance/transactions/${editingTransaction.id}`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      notify.success({
        title: "Transaction updated",
        description: "Changes were saved successfully.",
      });
      await loadTransactions();
      emitFinanceDataRefresh("transaction_update");
      closeEdit();
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not update transaction";
      notify.error({ title: "Update failed", description: message });
    } finally {
      setIsSavingEdit(false);
    }
  };

  const runDeleteTransaction = async (
    transaction: Transaction,
    rememberChoice = false
  ) => {
    setIsDeleting(true);
    try {
      await clientApiFetch<ApiEnvelope<{ id: string; deleted: boolean }>>(
        `/api/finance/transactions/${transaction.id}`,
        {
          method: "DELETE",
        }
      );

      notify.success({
        title: "Transaction deleted",
        description: "Transaction was removed.",
      });
      await loadTransactions();
      emitFinanceDataRefresh("transaction_delete");
      setDeletingTransaction(null);

      if (rememberChoice) {
        setConfirmSkipPreference("vf_skip_confirm_transaction_delete", true);
      }
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not delete transaction";
      notify.error({ title: "Delete failed", description: message });
    } finally {
      setIsDeleting(false);
    }
  };

  const requestDeleteTransaction = async (transaction: Transaction) => {
    if (getConfirmSkipPreference("vf_skip_confirm_transaction_delete")) {
      await runDeleteTransaction(transaction, true);
      return;
    }

    setDeletingTransaction(transaction);
  };

  const runBulkPatch = async (
    patch: Record<string, unknown>,
    actionLabel: string
  ) => {
    const targetIds = [...selectedTransactionIds];
    if (targetIds.length === 0) {
      notify.info({
        title: "Sin movimientos seleccionados",
        description: "Select at least one transaction to continue.",
      });
      return;
    }

    setIsBulkApplying(true);
    const failedIds: string[] = [];
    let successCount = 0;
    let firstErrorMessage = "";

    try {
      for (const transactionId of targetIds) {
        try {
          await clientApiFetch<ApiEnvelope<Transaction>>(
            `/api/finance/transactions/${transactionId}`,
            {
              method: "PUT",
              headers: {
                "content-type": "application/json",
              },
              body: JSON.stringify(patch),
            }
          );
          successCount += 1;
        } catch (error) {
          failedIds.push(transactionId);
          if (!firstErrorMessage && error instanceof ApiClientError) {
            firstErrorMessage = error.message;
          }
        }
      }

      if (successCount > 0) {
        await loadTransactions();
        emitFinanceDataRefresh("transaction_update");
      }

      setSelectedTransactionIds(failedIds);

      if (failedIds.length === 0) {
        notify.success({
          title: `${actionLabel} applied`,
          description: `${successCount} transaction(s) updated.`,
        });
      } else {
        notify.warning({
          title: "Partial update",
          description: `${successCount} updated, ${failedIds.length} failed${
            firstErrorMessage ? ` (${firstErrorMessage})` : ""
          }.`,
        });
      }
    } finally {
      setIsBulkApplying(false);
    }
  };

  const applyBulkStatus = async () => {
    if (!bulkStatus) {
      notify.info({
        title: "Select a status",
        description: "Choose the status to apply first.",
      });
      return;
    }

    await runBulkPatch({ status: bulkStatus }, "Status");
  };

  const applyBulkCategory = async () => {
    const nextCategory = bulkCategory.trim();
    if (!nextCategory) {
      notify.info({
        title: "Enter a category",
        description: "Type the category to apply first.",
      });
      return;
    }

    await runBulkPatch({ category: nextCategory }, "Category");
  };

  const loadBreakdown = useCallback(async () => {
    try {
      const now = new Date();
      const year = fromDate ? new Date(fromDate).getUTCFullYear() : now.getUTCFullYear();
      const month = fromDate ? new Date(fromDate).getUTCMonth() + 1 : now.getUTCMonth() + 1;
      const res = await clientApiFetch<ApiEnvelope<CategoryBreakdown>>(
        `/api/finance/report/category-breakdown?year=${year}&month=${month}`
      );
      setBreakdown(res.data);
    } catch {
      setBreakdown(null);
    }
  }, [fromDate]);

  useEffect(() => {
    loadBreakdown();
  }, [loadBreakdown]);

  const runRecategorize = async () => {
    setIsRecategorizing(true);
    try {
      let remaining = Infinity;
      let totalApplied = 0;
      // El endpoint es idempotente y acota el trabajo de IA por llamada; se
      // invoca en bucle hasta que ya no queden por resolver (o tope de vueltas).
      for (let i = 0; i < 8; i += 1) {
        const res = await clientApiFetch<ApiEnvelope<{ applied: number; remaining: number; scanned: number }>>(
          "/api/finance/intelligence/recategorize-review",
          { method: "POST", body: JSON.stringify({ limit: 60, apply: true, use_ai: true }) }
        );
        totalApplied += res.data?.applied || 0;
        remaining = res.data?.remaining ?? 0;
        if (!res.data?.scanned || (res.data.applied === 0 && res.data.scanned < 60)) break;
        if (remaining === 0) break;
      }
      notify.success({
        title: "Re-categorización lista",
        description: `${totalApplied} gasto(s) clasificados. ${
          Number.isFinite(remaining) ? `${remaining} siguen en "Por revisar".` : ""
        }`,
      });
      await Promise.all([loadTransactions(), loadBreakdown()]);
    } catch (error) {
      notify.error({
        title: "No se pudo re-categorizar",
        description: error instanceof ApiClientError ? error.message : "Intenta de nuevo.",
      });
    } finally {
      setIsRecategorizing(false);
    }
  };

  const runBulkDelete = async () => {
    const selectedRows = transactions.filter((transaction) =>
      selectedTransactionIds.includes(transaction.id)
    );
    const editableIds = selectedRows
      .filter((transaction) => transaction.editable !== false)
      .map((transaction) => transaction.id);
    const lockedCount = selectedRows.length - editableIds.length;

    if (editableIds.length === 0) {
      notify.info({
        title: "No editable transactions",
        description: "Selected rows are protected and cannot be deleted.",
      });
      setIsBulkDeleteConfirmOpen(false);
      return;
    }

    setIsBulkDeleting(true);
    const failedIds: string[] = [];
    let successCount = 0;
    let firstErrorMessage = "";

    try {
      for (const transactionId of editableIds) {
        try {
          await clientApiFetch<ApiEnvelope<{ id: string; deleted: boolean }>>(
            `/api/finance/transactions/${transactionId}`,
            {
              method: "DELETE",
            }
          );
          successCount += 1;
        } catch (error) {
          failedIds.push(transactionId);
          if (!firstErrorMessage && error instanceof ApiClientError) {
            firstErrorMessage = error.message;
          }
        }
      }

      if (successCount > 0) {
        await loadTransactions();
        emitFinanceDataRefresh("transaction_delete");
      }

      setSelectedTransactionIds(failedIds);
      setIsBulkDeleteConfirmOpen(false);

      if (failedIds.length === 0) {
        const lockMessage =
          lockedCount > 0 ? ` ${lockedCount} non-editable rows were skipped.` : "";
        notify.success({
          title: "Bulk delete completed",
          description: `${successCount} transaction(s) deleted.${lockMessage}`,
        });
      } else {
        notify.warning({
          title: "Partial bulk delete",
          description: `${successCount} deleted, ${failedIds.length} failed${
            firstErrorMessage ? ` (${firstErrorMessage})` : ""
          }.`,
        });
      }
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const categorizeWithAI = async () => {
    setIsCategorizing(true);
    try {
      const data = await runReclassify(200);
      notify.success({
        title: "Categorización con IA",
        description: data.updated
          ? `${data.updated} movimiento(s) categorizado(s) de ${data.scanned} revisados.`
          : "No había movimientos sin categorizar.",
      });
      await loadTransactions();
    } catch (error) {
      notify.error({
        title: "No se pudo categorizar",
        description: error instanceof ApiClientError ? error.message : "Error",
      });
    } finally {
      setIsCategorizing(false);
    }
  };

  const categorizeRow = async (transaction: Transaction) => {
    setCategorizingId(transaction.id);
    try {
      const data = await runReclassify(50);
      if (data.updated) {
        notify.success({ title: "Categoría sugerida por IA aplicada" });
      } else {
        notify.info({
          title: "La IA no encontró una categoría clara",
          description: "Agrega una descripción o edítalo manualmente.",
        });
      }
      await loadTransactions();
    } catch (error) {
      notify.error({
        title: "No se pudo categorizar",
        description: error instanceof ApiClientError ? error.message : "Error",
      });
    } finally {
      setCategorizingId(null);
    }
  };

  const exportTransactionsCsv = async () => {
    setIsExporting(true);
    const EXPORT_BATCH_LIMIT = 100;
    const EXPORT_MAX_ROWS = 10000;
    let offset = 0;
    const allRows: Transaction[] = [];
    let truncated = false;

    const appendSharedFilters = (params: URLSearchParams) => {
      if (selectedContactId !== "all") {
        params.set("contact_id", selectedContactId);
      } else if (selectedMemberId !== "all") {
        params.set("member_id", selectedMemberId);
      } else if (selectedClientId !== "all") {
        params.set("client_id", selectedClientId);
      } else if (selectedVendorId !== "all") {
        params.set("vendor_id", selectedVendorId);
      }

      if (selectedAccountId !== "all") {
        params.set("account_id", selectedAccountId);
      }
      if (selectedStatus !== "all") {
        params.set("status", selectedStatus);
      }
      if (selectedSource !== "all") {
        params.set("source", selectedSource);
      }
      const trimmed = queryText.trim();
      if (trimmed) {
        params.set("q", trimmed);
      }
      if (fromDate) {
        params.set("from", fromDate);
      }
      if (toDate) {
        params.set("to", toDate);
      }
      params.set("sort_by", sortBy);
      params.set("sort_order", sortOrder);
    };

    try {
      while (true) {
        const params = new URLSearchParams({
          limit: String(EXPORT_BATCH_LIMIT),
          offset: String(offset),
        });
        appendSharedFilters(params);

        const response = await clientApiFetch<ApiEnvelope<Transaction[]>>(
          `/api/finance/transactions?${params.toString()}`
        );
        const batch = response.data;
        if (batch.length === 0) {
          break;
        }

        allRows.push(...batch);
        offset += batch.length;

        if (allRows.length >= EXPORT_MAX_ROWS) {
          allRows.splice(EXPORT_MAX_ROWS);
          truncated = true;
          break;
        }

        if (batch.length < EXPORT_BATCH_LIMIT) {
          break;
        }
      }

      if (allRows.length === 0) {
        notify.info({
          title: "No data to export",
          description: "Current filters returned zero transactions.",
        });
        return;
      }

      const headers = [
        "id",
        "transaction_date",
        "type",
        "amount",
        "category",
        "description",
        "entity",
        "account_name",
        "contact_name",
        "member_name",
        "client_name",
        "vendor_name",
        "status",
        "source",
        "notes",
      ];

      const escapeCsv = (value: unknown) => {
        const text = String(value ?? "");
        if (/[",\n]/.test(text)) {
          return `"${text.replace(/"/g, '""')}"`;
        }
        return text;
      };

      const lines = [
        headers.join(","),
        ...allRows.map((row) =>
          [
            row.id,
            row.transaction_date,
            row.type,
            row.amount,
            row.category,
            row.description || "",
            row.entity || "",
            row.account_name || "",
            row.contact_name || "",
            row.member_name || "",
            row.client_name || "",
            row.vendor_name || "",
            row.status || "",
            row.source || "",
            row.notes || "",
          ]
            .map(escapeCsv)
            .join(",")
        ),
      ];

      const csvContent = `${lines.join("\n")}\n`;
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `transactions-export-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      notify.success({
        title: "CSV exported",
        description: truncated
          ? `Exported first ${allRows.length} rows (max limit reached).`
          : `Exported ${allRows.length} transactions.`,
      });
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not export CSV";
      notify.error({ title: "Export failed", description: message });
    } finally {
      setIsExporting(false);
    }
  };

  const transactionRows = useMemo(() => transactions, [transactions]);
  const selectedIdSet = useMemo(
    () => new Set(selectedTransactionIds),
    [selectedTransactionIds]
  );
  const areAllVisibleSelected =
    transactionRows.length > 0 &&
    transactionRows.every((transaction) => selectedIdSet.has(transaction.id));
  const selectedCount = selectedTransactionIds.length;
  const selectedAmountTotal = useMemo(
    () =>
      transactionRows
        .filter((transaction) => selectedIdSet.has(transaction.id))
        .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0),
    [selectedIdSet, transactionRows]
  );

  const toggleVisibleSelection = (checked: boolean) => {
    if (!checked) {
      setSelectedTransactionIds([]);
      return;
    }

    setSelectedTransactionIds(transactionRows.map((transaction) => transaction.id));
  };

  const toggleRowSelection = (transactionId: string, checked: boolean) => {
    setSelectedTransactionIds((current) => {
      if (checked) {
        return current.includes(transactionId) ? current : [...current, transactionId];
      }
      return current.filter((id) => id !== transactionId);
    });
  };

  const sourceOptions = useMemo(() => {
    const values = new Set<string>();
    for (const transaction of transactions) {
      const source = String(transaction.source || "").trim();
      if (source) {
        values.add(source);
      }
    }
    return Array.from(values).sort((left, right) => left.localeCompare(right));
  }, [transactions]);

  const memberToContactMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      const matchId = findBestContactMatchId({
        contacts,
        preferredTypes: ["internal", "employee", "contractor"],
        candidates: [member.full_name, member.alias, member.rfc],
      });
      if (matchId) {
        map.set(member.id, matchId);
      }
    }
    return map;
  }, [contacts, members]);

  const clientToContactMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const client of clients) {
      const matchId = findBestContactMatchId({
        contacts,
        preferredTypes: ["customer"],
        candidates: [client.business_name, client.name, client.email],
      });
      if (matchId) {
        map.set(client.id, matchId);
      }
    }
    return map;
  }, [clients, contacts]);

  const vendorToContactMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const vendor of vendors) {
      const matchId = findBestContactMatchId({
        contacts,
        preferredTypes: ["vendor"],
        candidates: [vendor.name],
      });
      if (matchId) {
        map.set(vendor.id, matchId);
      }
    }
    return map;
  }, [contacts, vendors]);

  useEffect(() => {
    if (selectedContactId !== "all") {
      return;
    }

    if (selectedMemberId !== "all") {
      const mapped = memberToContactMap.get(selectedMemberId);
      if (mapped) {
        setSelectedContactId(mapped);
        setSelectedMemberId("all");
      }
      return;
    }

    if (selectedClientId !== "all") {
      const mapped = clientToContactMap.get(selectedClientId);
      if (mapped) {
        setSelectedContactId(mapped);
        setSelectedClientId("all");
      }
      return;
    }

    if (selectedVendorId !== "all") {
      const mapped = vendorToContactMap.get(selectedVendorId);
      if (mapped) {
        setSelectedContactId(mapped);
        setSelectedVendorId("all");
      }
    }
  }, [
    clientToContactMap,
    memberToContactMap,
    selectedClientId,
    selectedContactId,
    selectedMemberId,
    selectedVendorId,
    vendorToContactMap,
  ]);

  const legacyEntityFilterLabel = useMemo(() => {
    if (selectedMemberId !== "all") {
      const match = members.find((item) => item.id === selectedMemberId);
      return `Member: ${match?.full_name || selectedMemberId}`;
    }

    if (selectedClientId !== "all") {
      const match = clients.find((item) => item.id === selectedClientId);
      return `Client: ${match?.business_name || match?.name || selectedClientId}`;
    }

    if (selectedVendorId !== "all") {
      const match = vendors.find((item) => item.id === selectedVendorId);
      return `Vendor: ${match?.name || selectedVendorId}`;
    }

    return null;
  }, [clients, members, selectedClientId, selectedMemberId, selectedVendorId, vendors]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (selectedContactId !== "all") n += 1;
    if (selectedAccountId !== "all") n += 1;
    if (selectedStatus !== "all") n += 1;
    if (selectedSource !== "all") n += 1;
    if (queryText.trim()) n += 1;
    if (fromDate || toDate) n += 1;
    if (legacyEntityFilterLabel) n += 1;
    return n;
  }, [
    selectedContactId,
    selectedAccountId,
    selectedStatus,
    selectedSource,
    queryText,
    fromDate,
    toDate,
    legacyEntityFilterLabel,
  ]);

  const clearAllFilters = () => {
    setSelectedMemberId("all");
    setSelectedClientId("all");
    setSelectedVendorId("all");
    setSelectedContactId("all");
    setSelectedAccountId("all");
    setSelectedStatus("all");
    setSelectedSource("all");
    setQueryText("");
    setFromDate("");
    setToDate("");
    setPage(1);
  };

  const [isAutoReconciling, setIsAutoReconciling] = useState(false);
  const runAutoReconcile = async () => {
    setIsAutoReconciling(true);
    try {
      const res = await clientApiFetch<{
        data: { scanned: number; matched: number; ambiguous: number; no_match: number; remaining: number };
      }>("/api/finance/reconciliation/auto", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ max_transactions: 150 }),
      });
      const s = res.data;
      notify.success({
        title: `Conciliación automática: ${s.matched} conciliadas`,
        description: `${s.scanned} movimientos revisados · ${s.ambiguous} con candidatos ambiguos (revísalos 1×1) · ${s.no_match} sin factura${s.remaining ? ` · quedan ${s.remaining}, vuelve a ejecutar` : ""}.`,
      });
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : "No se pudo conciliar";
      notify.error({ title: "Error en conciliación automática", description: message });
    } finally {
      setIsAutoReconciling(false);
    }
  };

  return (
    <div className="space-y-6">
      {breakdown ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle>
                Verificación de categorías —{" "}
                {new Date(breakdown.year, breakdown.month - 1, 1).toLocaleDateString("es-MX", {
                  month: "long",
                  year: "numeric",
                })}
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Flujo del banco (no es utilidad). Los traspasos entre cuentas propias no cuentan.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={runRecategorize}
              disabled={isRecategorizing || breakdown.review_count === 0}
            >
              {isRecategorizing ? "Re-categorizando…" : "Re-categorizar con IA"}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-border/60 p-3">
                <p className="text-xs text-muted-foreground">Ingresos (flujo)</p>
                <p className="text-lg font-semibold text-emerald-600">
                  {formatCurrency(breakdown.income_total)}
                </p>
              </div>
              <div className="rounded-lg border border-border/60 p-3">
                <p className="text-xs text-muted-foreground">Gastos (flujo)</p>
                <p className="text-lg font-semibold text-rose-600">
                  {formatCurrency(breakdown.expense_total)}
                </p>
              </div>
              <div className="rounded-lg border border-border/60 p-3">
                <p className="text-xs text-muted-foreground">Flujo neto</p>
                <p
                  className={`text-lg font-semibold ${
                    breakdown.net >= 0 ? "text-emerald-600" : "text-rose-600"
                  }`}
                >
                  {formatCurrency(breakdown.net)}
                </p>
              </div>
              <div
                className={`rounded-lg border p-3 ${
                  breakdown.review_count > 0
                    ? "border-amber-400/70 bg-amber-50/60 dark:bg-amber-950/20"
                    : "border-border/60"
                }`}
              >
                <p className="text-xs text-muted-foreground">Por revisar</p>
                <p className="text-lg font-semibold text-amber-600">
                  {breakdown.review_count}{" "}
                  <span className="text-xs font-normal">({formatCurrency(breakdown.review_total)})</span>
                </p>
              </div>
            </div>
            {breakdown.expense.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {breakdown.expense.slice(0, 12).map((item) => (
                  <span
                    key={item.category}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${
                      item.category === "Por revisar"
                        ? "border-amber-400/70 text-amber-700 dark:text-amber-400"
                        : "border-border/60 text-muted-foreground"
                    }`}
                  >
                    {item.category}
                    <span className="font-medium text-foreground">{formatCurrency(item.total)}</span>
                    <span className="text-muted-foreground">· {item.count}</span>
                  </span>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader className="sticky top-2 z-20 flex flex-col gap-3 border-b border-border/70 bg-card/95 backdrop-blur">
          <div className="flex flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle>Movimientos</CardTitle>
            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              <Button
                variant="outline"
                onClick={runAutoReconcile}
                disabled={isAutoReconciling}
              >
                {isAutoReconciling ? "Conciliando…" : "Conciliar automático"}
              </Button>
              <Button
                variant="outline"
                onClick={exportTransactionsCsv}
                disabled={isLoading || isExporting}
              >
                {isExporting ? "Exportando…" : "Exportar CSV"}
              </Button>
              <Button variant="secondary" onClick={() => setIsBankUploadOpen(true)}>
                Subir estado de cuenta
              </Button>
              <Button variant="outline" onClick={categorizeWithAI} disabled={isCategorizing}>
                {isCategorizing ? "Categorizando…" : "✨ Categorizar con IA"}
              </Button>
              <Button onClick={() => setIsCreateOpen(true)}>Nuevo movimiento</Button>
              <Button
                variant={showFilters ? "secondary" : "outline"}
                onClick={() => setShowFilters((value) => !value)}
              >
                Filtros{activeFilterCount ? ` · ${activeFilterCount}` : ""}
              </Button>
            </div>
          </div>
          {activeFilterCount > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {queryText.trim() ? (
                <Badge variant="secondary">Búsqueda: “{queryText.trim()}”</Badge>
              ) : null}
              {selectedStatus !== "all" ? (
                <Badge variant="secondary">Estatus: {selectedStatus}</Badge>
              ) : null}
              {selectedSource !== "all" ? (
                <Badge variant="secondary">Origen: {sourceLabel(selectedSource)}</Badge>
              ) : null}
              {selectedAccountId !== "all" ? (
                <Badge variant="secondary">
                  Cuenta: {accounts.find((a) => a.id === selectedAccountId)?.name || "—"}
                </Badge>
              ) : null}
              {legacyEntityFilterLabel ? (
                <Badge variant="secondary">{legacyEntityFilterLabel}</Badge>
              ) : null}
              {fromDate || toDate ? (
                <Badge variant="secondary">
                  {fromDate || "…"} → {toDate || "…"}
                </Badge>
              ) : null}
              <Button variant="ghost" size="sm" onClick={clearAllFilters}>
                Limpiar filtros
              </Button>
            </div>
          ) : null}
          {showFilters ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-background/40 p-3">
            <select
              className="h-9 min-w-[220px] rounded-lg border border-border bg-card px-3 text-sm"
              value={selectedContactId}
              onChange={(event) => {
                setSelectedContactId(event.target.value);
                setPage(1);
                setSelectedMemberId("all");
                setSelectedClientId("all");
                setSelectedVendorId("all");
              }}
              disabled={isMetaLoading}
            >
              <option value="all">Todos los contactos</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.business_name || contact.name}
                  {contact.business_name ? ` (${contact.name})` : ""}
                  {` [${contact.type}]`}
                </option>
              ))}
            </select>
            {legacyEntityFilterLabel ? (
              <>
                <Badge variant="secondary">{legacyEntityFilterLabel}</Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedMemberId("all");
                    setSelectedClientId("all");
                    setSelectedVendorId("all");
                    setPage(1);
                  }}
                >
                  Clear legacy
                </Button>
              </>
            ) : null}
            <select
              className="h-9 min-w-[170px] rounded-lg border border-border bg-card px-3 text-sm"
              value={selectedAccountId}
              onChange={(event) => {
                setSelectedAccountId(event.target.value);
                setPage(1);
              }}
              disabled={isMetaLoading}
            >
              <option value="all">Todas las cuentas</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
            <select
              className="h-9 min-w-[130px] rounded-lg border border-border bg-card px-3 text-sm"
              value={selectedStatus}
              onChange={(event) => {
                setSelectedStatus(event.target.value as "all" | TransactionStatus);
                setPage(1);
              }}
            >
              <option value="all">Todos los estatus</option>
              <option value="posted">Registrado</option>
              <option value="pending">Pendiente</option>
              <option value="reconciled">Conciliado</option>
              <option value="void">Anulado</option>
            </select>
            <select
              className="h-9 min-w-[130px] rounded-lg border border-border bg-card px-3 text-sm"
              value={selectedSource}
              onChange={(event) => {
                setSelectedSource(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">Todos los orígenes</option>
              <option value="manual">Manual</option>
              <option value="automation">Automatización</option>
              <option value="bank_statement_import">Estado de cuenta</option>
              {sourceOptions.map((source) => (
                <option key={source} value={source}>
                  {sourceLabel(source)}
                </option>
              ))}
            </select>
            <Input
              value={queryText}
              onChange={(event) => {
                setQueryText(event.target.value);
                setPage(1);
              }}
              placeholder="Buscar descripción o categoría…"
              className="h-9 min-w-[230px]"
            />
            <Input
              type="date"
              value={fromDate}
              onChange={(event) => {
                const nextFrom = event.target.value;
                setFromDate(nextFrom);
                if (toDate && nextFrom && nextFrom > toDate) {
                  setToDate(nextFrom);
                }
                setPage(1);
              }}
              className="h-9 min-w-[170px]"
            />
            <Input
              type="date"
              value={toDate}
              onChange={(event) => {
                const nextTo = event.target.value;
                setToDate(nextTo);
                if (fromDate && nextTo && nextTo < fromDate) {
                  setFromDate(nextTo);
                }
                setPage(1);
              }}
              className="h-9 min-w-[170px]"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => applyDatePreset("today")}
            >
              Hoy
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => applyDatePreset("this_month")}
            >
              Este mes
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => applyDatePreset("last_30")}
            >
              Últimos 30d
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => applyDatePreset("clear")}
              disabled={!fromDate && !toDate}
            >
              Limpiar fechas
            </Button>
            <select
              className="h-9 min-w-[130px] rounded-lg border border-border bg-card px-3 text-sm"
              value={String(pageSize)}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size} / pág.
                </option>
              ))}
            </select>
            <select
              className="h-9 min-w-[130px] rounded-lg border border-border bg-card px-3 text-sm"
              value={sortBy}
              onChange={(event) => {
                setSortBy(
                  event.target.value as (typeof SORT_BY_OPTIONS)[number]["value"]
                );
                setPage(1);
              }}
            >
              {SORT_BY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  Orden: {option.label}
                </option>
              ))}
            </select>
            <select
              className="h-9 min-w-[110px] rounded-lg border border-border bg-card px-3 text-sm"
              value={sortOrder}
              onChange={(event) => {
                setSortOrder(
                  event.target.value as (typeof SORT_ORDER_OPTIONS)[number]["value"]
                );
                setPage(1);
              }}
            >
              {SORT_ORDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              onClick={() => {
                setSelectedMemberId("all");
                setSelectedClientId("all");
                setSelectedVendorId("all");
                setSelectedContactId("all");
                setSelectedAccountId("all");
                setSelectedStatus("all");
                setSelectedSource("all");
                setQueryText("");
                setFromDate("");
                setToDate("");
                setPageSize(PAGE_SIZE_OPTIONS[0]);
                setSortBy("transaction_date");
                setSortOrder("desc");
                setSelectedTransactionIds([]);
                setBulkStatus("");
                setBulkCategory("");
                setPage(1);
              }}
            >
              Limpiar filtros
            </Button>
          </div>
          ) : null}
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-background/40 p-3">
            <span className="text-sm text-muted-foreground">
              {selectedCount} seleccionados
            </span>
            <span className="text-sm text-muted-foreground">
              Total: {formatCurrency(selectedAmountTotal)}
            </span>
            <select
              className="h-9 min-w-[150px] rounded-lg border border-border bg-card px-3 text-sm"
              value={bulkStatus}
              onChange={(event) =>
                setBulkStatus(event.target.value as "" | TransactionStatus)
              }
              disabled={selectedCount === 0 || isBulkApplying || isBulkDeleting}
            >
              <option value="">Cambiar estatus…</option>
              <option value="posted">posted</option>
              <option value="pending">pending</option>
              <option value="reconciled">reconciled</option>
              <option value="void">void</option>
            </select>
            <Button
              variant="outline"
              size="sm"
              onClick={applyBulkStatus}
              disabled={
                selectedCount === 0 ||
                !bulkStatus ||
                isBulkApplying ||
                isBulkDeleting
              }
            >
              {isBulkApplying ? "Aplicando…" : "Aplicar estatus"}
            </Button>
            <Input
              value={bulkCategory}
              onChange={(event) => setBulkCategory(event.target.value)}
              placeholder="Asignar categoría…"
              list="bulk-category-options"
              className="h-9 min-w-[220px]"
              disabled={selectedCount === 0 || isBulkApplying || isBulkDeleting}
            />
            <datalist id="bulk-category-options">
              {canonicalCategories.map((name) => (
                <option key={`canon-${name}`} value={name} />
              ))}
              {categories.map((item) => (
                <option key={item.id} value={item.name} />
              ))}
            </datalist>
            <Button
              variant="outline"
              size="sm"
              onClick={applyBulkCategory}
              disabled={
                selectedCount === 0 ||
                !bulkCategory.trim() ||
                isBulkApplying ||
                isBulkDeleting
              }
            >
              {isBulkApplying ? "Aplicando…" : "Aplicar categoría"}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => setIsBulkDeleteConfirmOpen(true)}
              disabled={selectedCount === 0 || isBulkApplying || isBulkDeleting}
            >
              Delete selected
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedTransactionIds([])}
              disabled={selectedCount === 0 || isBulkApplying || isBulkDeleting}
            >
              Clear selection
            </Button>
          </div>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading transactions...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[44px]">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={areAllVisibleSelected}
                      onChange={(event) => toggleVisibleSelection(event.target.checked)}
                      aria-label="Select all visible transactions"
                    />
                  </TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Estatus</TableHead>
                  <TableHead>Monto</TableHead>
                  <TableHead>Cuenta</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead>Vinculado a</TableHead>
                  <TableHead>Origen</TableHead>
                  <TableHead>Notas</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactionRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-muted-foreground">
                      No transactions yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  transactionRows.map((transaction) => (
                    <TableRow key={transaction.id}>
                      <TableCell>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
                          checked={selectedIdSet.has(transaction.id)}
                          onChange={(event) =>
                            toggleRowSelection(transaction.id, event.target.checked)
                          }
                          aria-label={`Select transaction ${transaction.id}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Badge variant={transaction.type === "income" ? "success" : "danger"}>
                          {transaction.type === "income" ? "Ingreso" : "Gasto"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={transaction.status === "reconciled" ? "success" : "secondary"}>
                          {transaction.status === "reconciled" ? "✓ " : ""}
                          {statusLabel(transaction.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        {formatCurrency(transaction.amount)}
                      </TableCell>
                      <TableCell>{transaction.account_name || "-"}</TableCell>
                      <TableCell>
                        {isUncategorized(transaction.category) ? (
                          <button
                            type="button"
                            onClick={() => categorizeRow(transaction)}
                            disabled={categorizingId === transaction.id}
                            className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
                            title="Sugerir categoría con IA"
                          >
                            {categorizingId === transaction.id ? "…" : "✨ Categorizar"}
                          </button>
                        ) : (
                          <span>{transaction.category}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <EntityBadge transaction={transaction} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {sourceLabel(transaction.source)}
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate">
                        {transaction.notes || "-"}
                      </TableCell>
                      <TableCell>{formatDate(transaction.transaction_date)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => openSplits(transaction)}
                            disabled={transaction.editable === false}
                          >
                            Desglose
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setReconcileTransaction(transaction);
                              setIsReconcileOpen(true);
                            }}
                          >
                            <Link2 className="mr-1 h-3.5 w-3.5" />
                            Conciliar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              void openHistory(transaction);
                            }}
                          >
                            <History className="mr-1 h-3.5 w-3.5" />
                            Historial
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEdit(transaction)}
                          >
                            <Pencil className="mr-1 h-3.5 w-3.5" />
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => requestDeleteTransaction(transaction)}
                            disabled={transaction.editable === false}
                          >
                            <Trash2 className="mr-1 h-3.5 w-3.5" />
                            Eliminar
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
          {!isLoading ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">
                Page {page} - showing {transactions.length} rows
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!hasNextPage) {
                      return;
                    }
                    setPage((current) => current + 1);
                  }}
                  disabled={!hasNextPage}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create transaction</DialogTitle>
            <DialogDescription>
              Capture a new transaction with inline contact/category quick create.
            </DialogDescription>
          </DialogHeader>
          <TransactionForm
            accounts={accounts}
            contacts={contacts}
            categories={categories}
            onSubmit={handleCreateTransaction}
            onContactCreated={upsertContact}
            onCategoryCreated={upsertCategory}
          />
        </DialogContent>
      </Dialog>

      <BankStatementUploadModal
        open={isBankUploadOpen}
        onOpenChange={setIsBankUploadOpen}
        onImportConfirmed={async () => {
          await loadTransactions();
          emitFinanceDataRefresh("bank_statement_confirm");
        }}
        contacts={contacts}
        categories={categories}
        onContactCreated={upsertContact}
        onCategoryCreated={upsertCategory}
        members={members}
        clients={clients}
      />

      <TransactionEditModal
        open={isEditOpen}
        transaction={editingTransaction}
        accounts={accounts}
        contacts={contacts}
        categories={categories}
        isSaving={isSavingEdit}
        onClose={closeEdit}
        onSubmit={handleEditSave}
        onContactCreated={upsertContact}
        onCategoryCreated={upsertCategory}
      />

      <TransactionSplitsModal
        open={isSplitsOpen}
        transaction={splitTransaction}
        categories={categories}
        onOpenChange={(next) => {
          setIsSplitsOpen(next);
          if (!next) {
            setSplitTransaction(null);
          }
        }}
        onChanged={async () => {
          await loadTransactions();
          emitFinanceDataRefresh("transaction_split_update");
        }}
      />

      <ReconciliationModal
        open={isReconcileOpen}
        transactionId={reconcileTransaction?.id ?? null}
        transactionLabel={
          reconcileTransaction
            ? `${reconcileTransaction.description || reconcileTransaction.category} · ${formatCurrency(reconcileTransaction.amount)}`
            : undefined
        }
        onClose={() => {
          setIsReconcileOpen(false);
          setReconcileTransaction(null);
        }}
        onReconciled={() => {
          void loadTransactions();
          emitFinanceDataRefresh("transaction_reconciled");
        }}
      />

      {isHistoryOpen && historyTransaction ? (
        <div
          className="fixed inset-0 z-50 bg-foreground/30 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeHistory();
            }
          }}
        >
          <div className="mx-auto mt-8 w-full max-w-3xl rounded-2xl border border-border bg-card p-5 shadow-xl animate-fade-in">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-heading text-lg font-semibold">
                  Transaction history
                </h3>
                <p className="text-xs text-muted-foreground">
                  {historyTransaction.id.slice(0, 8)}...
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={closeHistory}>
                Close
              </Button>
            </div>

            <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
              {isHistoryLoading ? (
                <p className="text-sm text-muted-foreground">Loading history...</p>
              ) : historyRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No audit records available.
                </p>
              ) : (
                historyRows.map((entry) => (
                  <div
                    key={entry.id}
                    className="space-y-2 rounded-xl border border-border p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge
                        variant={
                          entry.action === "create"
                            ? "success"
                            : entry.action === "update"
                              ? "secondary"
                              : "danger"
                        }
                      >
                        {entry.action}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(entry.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Source: {entry.source || "api"}
                      {entry.actor_role ? ` • Role: ${entry.actor_role}` : ""}
                    </p>
                    <pre className="max-h-56 overflow-auto rounded-lg border border-border bg-background/50 p-2 text-xs leading-5">
                      {JSON.stringify(entry.changes || {}, null, 2)}
                    </pre>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmModal
        open={isBulkDeleteConfirmOpen}
        title="Delete Selected Transactions?"
        description="This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        isLoading={isBulkDeleting}
        onCancel={() => {
          if (!isBulkDeleting) {
            setIsBulkDeleteConfirmOpen(false);
          }
        }}
        onConfirm={async () => {
          await runBulkDelete();
        }}
      />

      <ConfirmModal
        open={Boolean(deletingTransaction)}
        title="Delete Transaction?"
        description="This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        rememberChoiceKey="vf_skip_confirm_transaction_delete"
        isLoading={isDeleting}
        onCancel={() => {
          if (!isDeleting) {
            setDeletingTransaction(null);
          }
        }}
        onConfirm={async (rememberChoice) => {
          if (!deletingTransaction) {
            return;
          }
          await runDeleteTransaction(deletingTransaction, rememberChoice);
        }}
      />
    </div>
  );
}
