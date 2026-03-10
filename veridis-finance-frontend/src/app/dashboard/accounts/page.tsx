"use client";

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
import { formatCurrency } from "@/lib/format";
import type {
  Account,
  AccountStatus,
  AccountType,
  ApiEnvelope,
} from "@/types/finance";

interface AccountFormState {
  name: string;
  type: AccountType;
  bank_name: string;
  account_number_last4: string;
  credit_limit: string;
  cut_day: string;
  due_day: string;
  balance: string;
  currency: string;
  status: AccountStatus;
}

const ACCOUNT_TYPE_OPTIONS: AccountType[] = [
  "bank",
  "cash",
  "credit_card",
  "wallet",
  "accounts_receivable",
  "accounts_payable",
  "internal",
];

const EMPTY_FORM: AccountFormState = {
  name: "",
  type: "bank",
  bank_name: "",
  account_number_last4: "",
  credit_limit: "",
  cut_day: "",
  due_day: "",
  balance: "0",
  currency: "MXN",
  status: "active",
};

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

function toForm(account: Account): AccountFormState {
  return {
    name: account.name,
    type: account.type,
    bank_name: account.bank_name || "",
    account_number_last4: account.account_number_last4 || "",
    credit_limit:
      account.credit_limit === null || account.credit_limit === undefined
        ? ""
        : String(account.credit_limit),
    cut_day:
      account.cut_day === null || account.cut_day === undefined
        ? ""
        : String(account.cut_day),
    due_day:
      account.due_day === null || account.due_day === undefined
        ? ""
        : String(account.due_day),
    balance: String(account.balance || 0),
    currency: account.currency || "MXN",
    status: account.status,
  };
}

function toPayload(form: AccountFormState) {
  const creditLimit = form.credit_limit.trim();
  const cutDay = form.cut_day.trim();
  const dueDay = form.due_day.trim();

  return {
    name: form.name.trim(),
    type: form.type,
    bank_name: form.bank_name.trim() || null,
    account_number_last4: form.account_number_last4.trim() || null,
    credit_limit: creditLimit ? Number(creditLimit) : null,
    cut_day: cutDay ? Number(cutDay) : null,
    due_day: dueDay ? Number(dueDay) : null,
    balance: Number(form.balance || 0),
    currency: form.currency.trim().toUpperCase() || "MXN",
    status: form.status,
  };
}

interface AccountModalProps {
  open: boolean;
  title: string;
  form: AccountFormState;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onChange: (next: AccountFormState) => void;
}

function AccountModal({
  open,
  title,
  form,
  isSaving,
  onClose,
  onSubmit,
  onChange,
}: AccountModalProps) {
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
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="account_name">Name</Label>
            <Input
              id="account_name"
              value={form.name}
              onChange={(event) => onChange({ ...form, name: event.target.value })}
              placeholder="Main account"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="account_type">Type</Label>
            <select
              id="account_type"
              className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
              value={form.type}
              onChange={(event) =>
                onChange({ ...form, type: event.target.value as AccountType })
              }
            >
              {ACCOUNT_TYPE_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="account_currency">Currency</Label>
            <Input
              id="account_currency"
              value={form.currency}
              onChange={(event) =>
                onChange({ ...form, currency: event.target.value.toUpperCase() })
              }
              maxLength={10}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="account_bank">Bank name</Label>
            <Input
              id="account_bank"
              value={form.bank_name}
              onChange={(event) => onChange({ ...form, bank_name: event.target.value })}
              placeholder="Optional"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="account_last4">Account last 4</Label>
            <Input
              id="account_last4"
              value={form.account_number_last4}
              onChange={(event) =>
                onChange({
                  ...form,
                  account_number_last4: event.target.value.replace(/\D/g, "").slice(0, 4),
                })
              }
              maxLength={4}
              placeholder="1234"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="account_balance">Balance</Label>
            <Input
              id="account_balance"
              type="number"
              step="0.01"
              value={form.balance}
              onChange={(event) => onChange({ ...form, balance: event.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="account_credit_limit">Credit limit</Label>
            <Input
              id="account_credit_limit"
              type="number"
              step="0.01"
              min="0"
              value={form.credit_limit}
              onChange={(event) => onChange({ ...form, credit_limit: event.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="account_cut_day">Cut day</Label>
            <Input
              id="account_cut_day"
              type="number"
              min="1"
              max="31"
              value={form.cut_day}
              onChange={(event) => onChange({ ...form, cut_day: event.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="account_due_day">Due day</Label>
            <Input
              id="account_due_day"
              type="number"
              min="1"
              max="31"
              value={form.due_day}
              onChange={(event) => onChange({ ...form, due_day: event.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="account_status">Status</Label>
            <select
              id="account_status"
              className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
              value={form.status}
              onChange={(event) =>
                onChange({ ...form, status: event.target.value as AccountStatus })
              }
            >
              <option value="active">active</option>
              <option value="inactive">inactive</option>
              <option value="archived">archived</option>
            </select>
          </div>

          <div className="flex items-end justify-end sm:col-span-2">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving..." : "Save account"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function DashboardAccountsPage() {
  const notify = useNotify();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [deletingAccount, setDeletingAccount] = useState<Account | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [form, setForm] = useState<AccountFormState>(EMPTY_FORM);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);

  const loadAccounts = useCallback(async () => {
    setIsLoading(true);
    try {
      const search = new URLSearchParams();
      if (!showInactive) {
        search.set("status", "active");
      }

      const response = await clientApiFetch<ApiEnvelope<Account[]>>(
        `/api/finance/accounts?${search.toString()}`
      );
      setAccounts(response.data);
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not fetch accounts";
      notify.error({ title: "Load failed", description: message });
    } finally {
      setIsLoading(false);
    }
  }, [notify, showInactive]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const openCreateModal = () => {
    setEditingAccount(null);
    setForm(EMPTY_FORM);
    setIsModalOpen(true);
  };

  const openEditModal = (account: Account) => {
    setEditingAccount(account);
    setForm(toForm(account));
    setIsModalOpen(true);
  };

  const closeModal = () => {
    if (isSaving) {
      return;
    }

    setIsModalOpen(false);
    setEditingAccount(null);
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
      if (editingAccount) {
        await clientApiFetch<ApiEnvelope<Account>>(
          `/api/finance/accounts/${editingAccount.id}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          }
        );

        notify.success({
          title: "Account updated",
          description: "Account changes were saved.",
        });
      } else {
        await clientApiFetch<ApiEnvelope<Account>>("/api/finance/accounts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });

        notify.success({
          title: "Account created",
          description: "Account added successfully.",
        });
      }

      await loadAccounts();
      closeModal();
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not save account";
      notify.error({ title: "Save failed", description: message });
    } finally {
      setIsSaving(false);
    }
  };

  const softDeleteAccount = async (account: Account) => {
    setIsDeleting(true);
    try {
      await clientApiFetch<ApiEnvelope<Account>>(`/api/finance/accounts/${account.id}`, {
        method: "DELETE",
      });

      notify.success({
        title: "Account deactivated",
        description: "Account was soft deleted (status=inactive).",
      });
      await loadAccounts();
      setDeletingAccount(null);
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not soft delete account";
      notify.error({ title: "Delete failed", description: message });
    } finally {
      setIsDeleting(false);
    }
  };

  const activeCount = useMemo(
    () => accounts.filter((account) => account.status === "active").length,
    [accounts]
  );

  const filteredAccounts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return accounts;
    }

    return accounts.filter((account) => {
      const searchable = [
        account.name,
        account.bank_name || "",
        account.type,
        account.currency,
        account.account_number_last4 || "",
      ]
        .join(" ")
        .toLowerCase();
      return searchable.includes(query);
    });
  }, [accounts, searchQuery]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredAccounts.length / pageSize)),
    [filteredAccounts.length, pageSize]
  );

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const paginatedAccounts = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredAccounts.slice(start, start + pageSize);
  }, [filteredAccounts, page, pageSize]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Accounts</CardTitle>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(event) => setShowInactive(event.target.checked)}
              />
              Show inactive
            </label>
            <Button onClick={openCreateModal}>
              <Plus className="mr-2 h-4 w-4" />
              Add account
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 space-y-3">
            <Badge variant="secondary">
              {activeCount}/{accounts.length} active
            </Badge>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="Search name, bank, type, currency..."
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
              <span className="text-xs text-muted-foreground">
                {filteredAccounts.length} results
              </span>
            </div>
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading accounts...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Balance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedAccounts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No accounts found.
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedAccounts.map((account) => (
                    <TableRow key={account.id}>
                      <TableCell>
                        <p className="font-medium">{account.name}</p>
                        <p className="text-xs text-muted-foreground">{account.bank_name || "-"}</p>
                      </TableCell>
                      <TableCell>{account.type}</TableCell>
                      <TableCell>{account.currency}</TableCell>
                      <TableCell>{formatCurrency(account.balance || 0)}</TableCell>
                      <TableCell>
                        <Badge variant={account.status === "active" ? "success" : "secondary"}>
                          {account.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEditModal(account)}
                          >
                            <Edit3 className="mr-1 h-3.5 w-3.5" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => setDeletingAccount(account)}
                            disabled={account.status !== "active"}
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
                Page {page} of {totalPages}
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
                  onClick={() =>
                    setPage((current) => Math.min(totalPages, current + 1))
                  }
                  disabled={page >= totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <AccountModal
        open={isModalOpen}
        title={editingAccount ? "Edit account" : "Create account"}
        form={form}
        isSaving={isSaving}
        onClose={closeModal}
        onSubmit={submitForm}
        onChange={setForm}
      />

      <ConfirmModal
        open={Boolean(deletingAccount)}
        title="Deactivate account?"
        description="This performs a soft delete by setting status to inactive."
        confirmLabel="Deactivate"
        cancelLabel="Cancel"
        isLoading={isDeleting}
        onCancel={() => {
          if (!isDeleting) {
            setDeletingAccount(null);
          }
        }}
        onConfirm={async () => {
          if (!deletingAccount) {
            return;
          }
          await softDeleteAccount(deletingAccount);
        }}
      />
    </div>
  );
}
