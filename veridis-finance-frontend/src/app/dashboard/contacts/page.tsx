"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Edit3, Plus, Trash2 } from "lucide-react";

import { ConfirmModal } from "@/components/common/confirm-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import type {
  ApiEnvelope,
  Contact,
  ContactStatus,
  ContactType,
} from "@/types/finance";

interface ContactFormState {
  type: ContactType;
  name: string;
  business_name: string;
  email: string;
  phone: string;
  rfc: string;
  notes: string;
  tags: string;
  status: ContactStatus;
}

const CONTACT_TYPE_OPTIONS: ContactType[] = [
  "customer",
  "vendor",
  "employee",
  "contractor",
  "internal",
];

const EMPTY_FORM: ContactFormState = {
  type: "customer",
  name: "",
  business_name: "",
  email: "",
  phone: "",
  rfc: "",
  notes: "",
  tags: "",
  status: "active",
};

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
const CONTACT_SORT_BY_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "created_at", label: "Created" },
  { value: "type", label: "Type" },
] as const;
const CONTACT_SORT_ORDER_OPTIONS = [
  { value: "asc", label: "Asc" },
  { value: "desc", label: "Desc" },
] as const;

function toForm(contact: Contact): ContactFormState {
  return {
    type: contact.type,
    name: contact.name,
    business_name: contact.business_name || "",
    email: contact.email || "",
    phone: contact.phone || "",
    rfc: contact.rfc || "",
    notes: contact.notes || "",
    tags: Array.isArray(contact.tags) ? contact.tags.join(", ") : "",
    status: contact.status,
  };
}

function toPayload(form: ContactFormState) {
  const tags = form.tags
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  return {
    type: form.type,
    name: form.name.trim(),
    business_name: form.business_name.trim() || null,
    email: form.email.trim() || null,
    phone: form.phone.trim() || null,
    rfc: form.rfc.trim().toUpperCase() || null,
    notes: form.notes.trim() || null,
    tags,
    status: form.status,
  };
}

interface ContactModalProps {
  open: boolean;
  title: string;
  form: ContactFormState;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onChange: (next: ContactFormState) => void;
}

function ContactModal({
  open,
  title,
  form,
  isSaving,
  onClose,
  onSubmit,
  onChange,
}: ContactModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-foreground/30 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) {
          onClose();
        }
      }}
    >
      <div className="mx-auto mt-8 w-full max-w-2xl rounded-2xl border border-border bg-card p-5 shadow-xl animate-fade-in">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="font-heading text-lg font-semibold">{title}</h3>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isSaving}>
            Close
          </Button>
        </div>

        <form className="grid gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="contact_type">Type</Label>
            <select
              id="contact_type"
              className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
              value={form.type}
              onChange={(event) =>
                onChange({ ...form, type: event.target.value as ContactType })
              }
            >
              {CONTACT_TYPE_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="contact_status">Status</Label>
            <select
              id="contact_status"
              className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
              value={form.status}
              onChange={(event) =>
                onChange({ ...form, status: event.target.value as ContactStatus })
              }
            >
              <option value="active">active</option>
              <option value="inactive">inactive</option>
            </select>
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="contact_name">Name</Label>
            <Input
              id="contact_name"
              value={form.name}
              onChange={(event) => onChange({ ...form, name: event.target.value })}
              placeholder="Contact name"
              required
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="contact_business_name">Business name</Label>
            <Input
              id="contact_business_name"
              value={form.business_name}
              onChange={(event) =>
                onChange({ ...form, business_name: event.target.value })
              }
              placeholder="Optional"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="contact_email">Email</Label>
            <Input
              id="contact_email"
              type="email"
              value={form.email}
              onChange={(event) => onChange({ ...form, email: event.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="contact_phone">Phone</Label>
            <Input
              id="contact_phone"
              value={form.phone}
              onChange={(event) => onChange({ ...form, phone: event.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="contact_rfc">RFC</Label>
            <Input
              id="contact_rfc"
              value={form.rfc}
              onChange={(event) =>
                onChange({ ...form, rfc: event.target.value.toUpperCase() })
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="contact_tags">Tags</Label>
            <Input
              id="contact_tags"
              value={form.tags}
              onChange={(event) => onChange({ ...form, tags: event.target.value })}
              placeholder="client, key-account"
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="contact_notes">Notes</Label>
            <textarea
              id="contact_notes"
              className="min-h-[100px] w-full rounded-xl border border-border bg-card px-3 py-2 text-sm"
              value={form.notes}
              onChange={(event) => onChange({ ...form, notes: event.target.value })}
              placeholder="Optional notes"
            />
          </div>

          <div className="flex items-end justify-end sm:col-span-2">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving..." : "Save contact"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function DashboardContactsPage() {
  const notify = useNotify();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [deletingContact, setDeletingContact] = useState<Contact | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [form, setForm] = useState<ContactFormState>(EMPTY_FORM);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState<"all" | ContactType>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);
  const [sortBy, setSortBy] = useState<
    (typeof CONTACT_SORT_BY_OPTIONS)[number]["value"]
  >("name");
  const [sortOrder, setSortOrder] = useState<
    (typeof CONTACT_SORT_ORDER_OPTIONS)[number]["value"]
  >("asc");
  const [hasNextPage, setHasNextPage] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const loadContacts = useCallback(async () => {
    setIsLoading(true);
    setHasNextPage(false);
    try {
      const apiLimit = pageSize + 1;
      const apiOffset = (page - 1) * pageSize;
      const search = new URLSearchParams();
      if (!showInactive) {
        search.set("status", "active");
      }
      if (selectedType !== "all") {
        search.set("type", selectedType);
      }
      const trimmedQuery = searchQuery.trim();
      if (trimmedQuery) {
        search.set("q", trimmedQuery);
      }
      search.set("sort_by", sortBy);
      search.set("sort_order", sortOrder);
      search.set("limit", String(apiLimit));
      search.set("offset", String(apiOffset));

      const response = await clientApiFetch<ApiEnvelope<Contact[]>>(
        `/api/finance/contacts?${search.toString()}`
      );
      const hasExtraRow = response.data.length > pageSize;
      setHasNextPage(hasExtraRow);
      setContacts(
        hasExtraRow ? response.data.slice(0, pageSize) : response.data
      );
    } catch (error) {
      setContacts([]);
      const message =
        error instanceof ApiClientError ? error.message : "Could not fetch contacts";
      notify.error({ title: "Load failed", description: message });
    } finally {
      setIsLoading(false);
    }
  }, [notify, page, pageSize, searchQuery, selectedType, showInactive, sortBy, sortOrder]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  useEffect(() => {
    const typeParam = searchParams.get("type");
    const queryParam = searchParams.get("q");
    const pageParam = searchParams.get("page");
    const pageSizeParam = searchParams.get("page_size");
    const inactiveParam = searchParams.get("inactive");
    const sortByParam = searchParams.get("sort_by");
    const sortOrderParam = searchParams.get("sort_order");

    if (
      typeParam &&
      CONTACT_TYPE_OPTIONS.includes(typeParam as ContactType) &&
      typeParam !== selectedType
    ) {
      setSelectedType(typeParam as ContactType);
    } else if (!typeParam && selectedType !== "all") {
      setSelectedType("all");
    }

    if (queryParam !== null && queryParam !== searchQuery) {
      setSearchQuery(queryParam);
    } else if (queryParam === null && searchQuery !== "") {
      setSearchQuery("");
    }

    const parsedPage = Number.parseInt(pageParam || "", 10);
    if (Number.isFinite(parsedPage) && parsedPage > 0 && parsedPage !== page) {
      setPage(parsedPage);
    } else if (!pageParam && page !== 1) {
      setPage(1);
    }

    const parsedPageSize = Number.parseInt(pageSizeParam || "", 10);
    if (
      Number.isFinite(parsedPageSize) &&
      PAGE_SIZE_OPTIONS.includes(parsedPageSize as (typeof PAGE_SIZE_OPTIONS)[number]) &&
      parsedPageSize !== pageSize
    ) {
      setPageSize(parsedPageSize);
    } else if (!pageSizeParam && pageSize !== PAGE_SIZE_OPTIONS[0]) {
      setPageSize(PAGE_SIZE_OPTIONS[0]);
    }

    const shouldShowInactive = inactiveParam === "1";
    if (shouldShowInactive !== showInactive) {
      setShowInactive(shouldShowInactive);
    }

    if (
      sortByParam &&
      CONTACT_SORT_BY_OPTIONS.some((option) => option.value === sortByParam) &&
      sortByParam !== sortBy
    ) {
      setSortBy(sortByParam as (typeof CONTACT_SORT_BY_OPTIONS)[number]["value"]);
    } else if (!sortByParam && sortBy !== "name") {
      setSortBy("name");
    }

    if (
      sortOrderParam &&
      CONTACT_SORT_ORDER_OPTIONS.some((option) => option.value === sortOrderParam) &&
      sortOrderParam !== sortOrder
    ) {
      setSortOrder(
        sortOrderParam as (typeof CONTACT_SORT_ORDER_OPTIONS)[number]["value"]
      );
    } else if (!sortOrderParam && sortOrder !== "asc") {
      setSortOrder("asc");
    }
  }, [page, pageSize, searchParams, searchQuery, selectedType, showInactive, sortBy, sortOrder]);

  useEffect(() => {
    const nextParams = new URLSearchParams();

    if (selectedType !== "all") {
      nextParams.set("type", selectedType);
    }

    const trimmedQuery = searchQuery.trim();
    if (trimmedQuery) {
      nextParams.set("q", trimmedQuery);
    }

    if (page > 1) {
      nextParams.set("page", String(page));
    }

    if (pageSize !== PAGE_SIZE_OPTIONS[0]) {
      nextParams.set("page_size", String(pageSize));
    }

    if (showInactive) {
      nextParams.set("inactive", "1");
    }

    if (sortBy !== "name") {
      nextParams.set("sort_by", sortBy);
    }

    if (sortOrder !== "asc") {
      nextParams.set("sort_order", sortOrder);
    }

    const contactId = searchParams.get("contactId");
    if (contactId) {
      nextParams.set("contactId", contactId);
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
    page,
    pageSize,
    pathname,
    router,
    searchParams,
    searchQuery,
    selectedType,
    showInactive,
    sortBy,
    sortOrder,
  ]);

  useEffect(() => {
    const contactId = searchParams.get("contactId");
    if (!contactId || contacts.length === 0) {
      if (!contactId) {
        return;
      }
    }

    const match = contacts.find((contact) => contact.id === contactId);
    if (match) {
      if (editingContact?.id === match.id && isModalOpen) {
        return;
      }

      setEditingContact(match);
      setForm(toForm(match));
      setIsModalOpen(true);
      return;
    }

    let cancelled = false;
    const loadContactById = async () => {
      try {
        const response = await clientApiFetch<ApiEnvelope<Contact>>(
          `/api/finance/contacts/${contactId}`
        );
        if (cancelled) {
          return;
        }

        const loaded = response.data;
        setEditingContact(loaded);
        setForm(toForm(loaded));
        setIsModalOpen(true);
      } catch {
        // ignore deep-link failures silently
      }
    };

    loadContactById();
    return () => {
      cancelled = true;
    };
  }, [contacts, editingContact?.id, isModalOpen, searchParams]);

  const openCreateModal = () => {
    setEditingContact(null);
    setForm(EMPTY_FORM);
    setIsModalOpen(true);
  };

  const openEditModal = (contact: Contact) => {
    setEditingContact(contact);
    setForm(toForm(contact));
    setIsModalOpen(true);
  };

  const closeModal = () => {
    if (isSaving) {
      return;
    }

    setIsModalOpen(false);
    setEditingContact(null);
    setForm(EMPTY_FORM);
  };

  const submitForm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const payload = toPayload(form);
    if (!payload.name) {
      notify.error({ title: "Validation", description: "Name is required" });
      return;
    }

    setIsSaving(true);
    try {
      if (editingContact) {
        await clientApiFetch<ApiEnvelope<Contact>>(
          `/api/finance/contacts/${editingContact.id}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          }
        );

        notify.success({
          title: "Contact updated",
          description: "Contact changes were saved.",
        });
      } else {
        await clientApiFetch<ApiEnvelope<Contact>>("/api/finance/contacts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });

        notify.success({
          title: "Contact created",
          description: "Contact added successfully.",
        });
      }

      await loadContacts();
      closeModal();
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not save contact";
      notify.error({ title: "Save failed", description: message });
    } finally {
      setIsSaving(false);
    }
  };

  const softDeleteContact = async (contact: Contact) => {
    setIsDeleting(true);
    try {
      await clientApiFetch<ApiEnvelope<Contact>>(`/api/finance/contacts/${contact.id}`, {
        method: "DELETE",
      });

      notify.success({
        title: "Contact deactivated",
        description: "Contact was soft deleted (status=inactive).",
      });
      await loadContacts();
      setDeletingContact(null);
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not soft delete contact";
      notify.error({ title: "Delete failed", description: message });
    } finally {
      setIsDeleting(false);
    }
  };

  const exportContactsCsv = async () => {
    setIsExporting(true);
    const EXPORT_BATCH_LIMIT = 200;
    const EXPORT_MAX_ROWS = 10000;
    let offset = 0;
    const allRows: Contact[] = [];
    let truncated = false;

    const appendSharedFilters = (params: URLSearchParams) => {
      if (!showInactive) {
        params.set("status", "active");
      }
      if (selectedType !== "all") {
        params.set("type", selectedType);
      }
      const trimmedQuery = searchQuery.trim();
      if (trimmedQuery) {
        params.set("q", trimmedQuery);
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

        const response = await clientApiFetch<ApiEnvelope<Contact[]>>(
          `/api/finance/contacts?${params.toString()}`
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
          description: "Current filters returned zero contacts.",
        });
        return;
      }

      const headers = [
        "id",
        "type",
        "name",
        "business_name",
        "email",
        "phone",
        "rfc",
        "status",
        "tags",
        "notes",
        "created_at",
        "updated_at",
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
            row.type,
            row.name,
            row.business_name || "",
            row.email || "",
            row.phone || "",
            row.rfc || "",
            row.status,
            Array.isArray(row.tags) ? row.tags.join("|") : "",
            row.notes || "",
            row.created_at,
            row.updated_at,
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
      anchor.download = `contacts-export-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      notify.success({
        title: "CSV exported",
        description: truncated
          ? `Exported first ${allRows.length} rows (max limit reached).`
          : `Exported ${allRows.length} contacts.`,
      });
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not export CSV";
      notify.error({ title: "Export failed", description: message });
    } finally {
      setIsExporting(false);
    }
  };

  const activeCount = useMemo(
    () => contacts.filter((contact) => contact.status === "active").length,
    [contacts]
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Contacts</CardTitle>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(event) => {
                  setShowInactive(event.target.checked);
                  setPage(1);
                }}
              />
              Show inactive
            </label>
            <Button onClick={openCreateModal}>
              <Plus className="mr-2 h-4 w-4" />
              Add contact
            </Button>
            <Button
              variant="outline"
              onClick={exportContactsCsv}
              disabled={isLoading || isExporting}
            >
              {isExporting ? "Exporting..." : "Export CSV"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 space-y-3">
            <Badge variant="secondary">
              {activeCount}/{contacts.length} active
            </Badge>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="h-10 rounded-xl border border-border bg-card px-3 text-sm"
                value={selectedType}
                onChange={(event) => {
                  setSelectedType(event.target.value as "all" | ContactType);
                  setPage(1);
                }}
              >
                <option value="all">All types</option>
                {CONTACT_TYPE_OPTIONS.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              <Input
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="Search name, email, phone, type..."
                className="min-w-[260px] max-w-sm"
              />
              <select
                className="h-10 rounded-xl border border-border bg-card px-3 text-sm"
                value={String(pageSize)}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size} / page
                  </option>
                ))}
              </select>
              <select
                className="h-10 rounded-xl border border-border bg-card px-3 text-sm"
                value={sortBy}
                onChange={(event) => {
                  setSortBy(
                    event.target.value as (typeof CONTACT_SORT_BY_OPTIONS)[number]["value"]
                  );
                  setPage(1);
                }}
              >
                {CONTACT_SORT_BY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    Sort: {option.label}
                  </option>
                ))}
              </select>
              <select
                className="h-10 rounded-xl border border-border bg-card px-3 text-sm"
                value={sortOrder}
                onChange={(event) => {
                  setSortOrder(
                    event.target.value as (typeof CONTACT_SORT_ORDER_OPTIONS)[number]["value"]
                  );
                  setPage(1);
                }}
              >
                {CONTACT_SORT_ORDER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">
                {contacts.length} loaded
              </span>
            </div>
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading contacts...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No contacts found.
                    </TableCell>
                  </TableRow>
                ) : (
                  contacts.map((contact) => (
                    <TableRow key={contact.id}>
                      <TableCell>
                        <p className="font-medium">{contact.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {contact.business_name || "-"}
                        </p>
                      </TableCell>
                      <TableCell>{contact.type}</TableCell>
                      <TableCell>{contact.email || "-"}</TableCell>
                      <TableCell>{contact.phone || "-"}</TableCell>
                      <TableCell>
                        <Badge variant={contact.status === "active" ? "success" : "secondary"}>
                          {contact.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" asChild>
                            <Link href={`/dashboard/transactions?contact_id=${contact.id}`}>
                              Transactions
                            </Link>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEditModal(contact)}
                          >
                            <Edit3 className="mr-1 h-3.5 w-3.5" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => setDeletingContact(contact)}
                            disabled={contact.status !== "active"}
                          >
                            <Trash2 className="mr-1 h-3.5 w-3.5" />
                            Delete
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
                Page {page} - showing {contacts.length} rows
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

      <ContactModal
        open={isModalOpen}
        title={editingContact ? "Edit contact" : "Create contact"}
        form={form}
        isSaving={isSaving}
        onClose={closeModal}
        onSubmit={submitForm}
        onChange={setForm}
      />

      <ConfirmModal
        open={Boolean(deletingContact)}
        title="Deactivate contact?"
        description="This performs a soft delete by setting status to inactive."
        confirmLabel="Deactivate"
        cancelLabel="Cancel"
        isLoading={isDeleting}
        onCancel={() => {
          if (!isDeleting) {
            setDeletingContact(null);
          }
        }}
        onConfirm={async () => {
          if (!deletingContact) {
            return;
          }
          await softDeleteContact(deletingContact);
        }}
      />
    </div>
  );
}
