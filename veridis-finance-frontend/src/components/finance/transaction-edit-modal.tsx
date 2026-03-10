"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
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
import type {
  Account,
  ApiEnvelope,
  Category,
  Contact,
  ContactType,
  Transaction,
  TransactionStatus,
  TransactionType,
} from "@/types/finance";

const CREATE_CONTACT_OPTION = "__create_contact__";
const CREATE_CATEGORY_OPTION = "__create_category__";
const CASH_SOURCE_OPTION = "__cash_source__";

export interface UpdateTransactionPayload {
  type: TransactionType;
  account_id: string | null;
  contact_id: string | null;
  status: TransactionStatus;
  source: string;
  tags: string[];
  category: string;
  member_id: string | null;
  client_id: string | null;
  vendor_id: string | null;
  notes: string | null;
  entity: string | null;
}

interface TransactionEditModalProps {
  open: boolean;
  transaction: Transaction | null;
  accounts: Account[];
  contacts: Contact[];
  categories: Category[];
  isSaving?: boolean;
  onClose: () => void;
  onSubmit: (payload: UpdateTransactionPayload) => Promise<void>;
  onContactCreated?: (contact: Contact) => void;
  onCategoryCreated?: (category: Category) => void;
}

interface FormState {
  type: TransactionType;
  account_id: string;
  expense_source: string;
  contact_id: string;
  status: TransactionStatus;
  source: string;
  tags: string;
  category: string;
  notes: string;
}

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function emptyState(): FormState {
  return {
    type: "expense",
    account_id: "",
    expense_source: "",
    contact_id: "",
    status: "posted",
    source: "manual",
    tags: "",
    category: "",
    notes: "",
  };
}

function resolveDefaultContactType(transactionType: TransactionType): ContactType {
  return transactionType === "income" ? "customer" : "vendor";
}

function toFormState(transaction: Transaction): FormState {
  const accountId = transaction.account_id || "";
  const source = transaction.source || "manual";
  return {
    type: transaction.type,
    account_id: accountId,
    expense_source:
      transaction.type === "expense"
        ? source === "cash"
          ? CASH_SOURCE_OPTION
          : accountId
        : "",
    contact_id: transaction.contact_id || "",
    status: transaction.status || "posted",
    source,
    tags: Array.isArray(transaction.tags) ? transaction.tags.join(", ") : "",
    category: transaction.category || "",
    notes: transaction.notes || "",
  };
}

export function TransactionEditModal({
  open,
  transaction,
  accounts,
  contacts,
  categories,
  isSaving = false,
  onClose,
  onSubmit,
  onContactCreated,
  onCategoryCreated,
}: TransactionEditModalProps) {
  const notify = useNotify();
  const [form, setForm] = useState<FormState>(emptyState);
  const [localContacts, setLocalContacts] = useState<Contact[]>(contacts);
  const [localCategories, setLocalCategories] = useState<Category[]>(categories);

  const [isCreateContactOpen, setIsCreateContactOpen] = useState(false);
  const [newContactName, setNewContactName] = useState("");
  const [newContactType, setNewContactType] = useState<ContactType>(
    resolveDefaultContactType("expense")
  );
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

  useEffect(() => {
    if (!open || !transaction) {
      return;
    }

    setForm(toFormState(transaction));
    setNewContactType(resolveDefaultContactType(transaction.type));
  }, [open, transaction]);

  const selectableContacts = useMemo(() => {
    if (form.type === "income") {
      return localContacts.filter(
        (contact) => contact.type === "customer" || contact.type === "internal"
      );
    }
    return localContacts.filter((contact) => contact.type !== "customer");
  }, [form.type, localContacts]);

  const categoryOptions = useMemo(
    () =>
      [...localCategories].sort((left, right) =>
        left.name.localeCompare(right.name, "en", { sensitivity: "base" })
      ),
    [localCategories]
  );

  useEffect(() => {
    if (!form.contact_id) {
      return;
    }

    const stillValid = selectableContacts.some(
      (contact) => contact.id === form.contact_id
    );
    if (stillValid) {
      return;
    }

    setForm((current) => ({
      ...current,
      contact_id: "",
    }));
  }, [form.contact_id, selectableContacts]);

  useEffect(() => {
    setNewContactType(resolveDefaultContactType(form.type));
  }, [form.type]);

  if (!open || !transaction) {
    return null;
  }

  const linkedEntityName = (contactId: string) => {
    if (!contactId) {
      return null;
    }
    const match = localContacts.find((contact) => contact.id === contactId);
    if (!match) {
      return null;
    }
    return match.business_name || match.name;
  };

  const createContact = async () => {
    const trimmedName = newContactName.trim();
    if (!trimmedName) {
      notify.error({
        title: "Contact required",
        description: "Name is required.",
      });
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
      setForm((current) => ({ ...current, contact_id: duplicate.id }));
      setIsCreateContactOpen(false);
      setNewContactName("");
      notify.info({
        title: "Contact reused",
        description: "An existing contact with that name was selected.",
      });
      return;
    }

    setIsCreatingContact(true);
    try {
      const response = await clientApiFetch<ApiEnvelope<Contact>>(
        "/api/finance/contacts",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: trimmedName,
            type: newContactType,
            status: "active",
          }),
        }
      );
      const created = response.data;
      setLocalContacts((current) => [created, ...current]);
      onContactCreated?.(created);
      setForm((current) => ({ ...current, contact_id: created.id }));
      setIsCreateContactOpen(false);
      setNewContactName("");
      notify.success({
        title: "Contact created",
        description: "Contact was created and selected.",
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
    if (!trimmedName) {
      notify.error({
        title: "Category required",
        description: "Name is required.",
      });
      return;
    }

    const normalizedName = normalizeText(trimmedName);
    const duplicate = localCategories.find(
      (item) => normalizeText(item.name) === normalizedName
    );
    if (duplicate) {
      setForm((current) => ({ ...current, category: duplicate.name }));
      setIsCreateCategoryOpen(false);
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
      setForm((current) => ({ ...current, category: created.name }));
      setIsCreateCategoryOpen(false);
      setNewCategoryName("");
      notify.success({
        title: "Category created",
        description: "Category was created and selected.",
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

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const parsedTags = form.tags
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean);

    const sourceValue = form.source.trim() || "manual";
    let resolvedAccountId: string | null = form.account_id || null;
    let resolvedSource = sourceValue;

    if (form.type === "expense") {
      if (form.expense_source === CASH_SOURCE_OPTION) {
        resolvedAccountId = null;
        resolvedSource = "cash";
      } else {
        resolvedAccountId = form.expense_source || null;
        resolvedSource = "manual";
      }
    }

    await onSubmit({
      type: form.type,
      account_id: resolvedAccountId,
      contact_id: form.contact_id || null,
      status: form.status,
      source: resolvedSource,
      tags: parsedTags,
      category: form.category.trim(),
      member_id: null,
      client_id: null,
      vendor_id: null,
      notes: form.notes.trim() || null,
      entity: linkedEntityName(form.contact_id) || transaction.entity || null,
    });
  };

  return (
    <>
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
            <div>
              <h3 className="font-heading text-lg font-semibold">Edit transaction</h3>
              <p className="text-xs text-muted-foreground">
                ID: {transaction.id.slice(0, 8)}...
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} disabled={isSaving}>
              Close
            </Button>
          </div>

          <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="tx_type">Type</Label>
              <select
                id="tx_type"
                className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                value={form.type}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    type: event.target.value as TransactionType,
                  }))
                }
              >
                <option value="income">income</option>
                <option value="expense">expense</option>
              </select>
            </div>

            {form.type === "expense" ? (
              <div className="space-y-2">
                <Label htmlFor="tx_expense_source">Expense Source</Label>
                <select
                  id="tx_expense_source"
                  className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                  value={form.expense_source}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      expense_source: event.target.value,
                    }))
                  }
                >
                  <option value="">Default account</option>
                  <option value={CASH_SOURCE_OPTION}>Cash</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} ({account.currency})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="tx_account">Account</Label>
                <select
                  id="tx_account"
                  className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                  value={form.account_id}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      account_id: event.target.value,
                    }))
                  }
                >
                  <option value="">Default account</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} ({account.currency})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="tx_contact">Contact</Label>
              <select
                id="tx_contact"
                className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                value={form.contact_id}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === CREATE_CONTACT_OPTION) {
                    setIsCreateContactOpen(true);
                    return;
                  }
                  setForm((current) => ({ ...current, contact_id: value }));
                }}
              >
                <option value="">None</option>
                {selectableContacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.business_name || contact.name}
                    {contact.business_name ? ` (${contact.name})` : ""}
                    {` [${contact.type}]`}
                  </option>
                ))}
                <option value={CREATE_CONTACT_OPTION}>+ Create new contact</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tx_category">Category</Label>
              <select
                id="tx_category"
                className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                value={form.category}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === CREATE_CATEGORY_OPTION) {
                    setIsCreateCategoryOpen(true);
                    return;
                  }
                  setForm((current) => ({ ...current, category: value }));
                }}
                required
              >
                <option value="">Select category</option>
                {categoryOptions.map((item) => (
                  <option key={item.id} value={item.name}>
                    {item.name}
                  </option>
                ))}
                <option value={CREATE_CATEGORY_OPTION}>+ Create new category</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tx_status">Status</Label>
              <select
                id="tx_status"
                className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                value={form.status}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    status: event.target.value as TransactionStatus,
                  }))
                }
              >
                <option value="posted">posted</option>
                <option value="pending">pending</option>
                <option value="reconciled">reconciled</option>
                <option value="void">void</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tx_source">Source</Label>
              <Input
                id="tx_source"
                value={form.source}
                onChange={(event) =>
                  setForm((current) => ({ ...current, source: event.target.value }))
                }
                readOnly={form.type === "expense"}
                placeholder={form.type === "expense" ? "auto: manual/cash" : "manual"}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tx_tags">Tags</Label>
              <Input
                id="tx_tags"
                value={form.tags}
                onChange={(event) =>
                  setForm((current) => ({ ...current, tags: event.target.value }))
                }
                placeholder="ops, payroll"
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="tx_notes">Notes</Label>
              <textarea
                id="tx_notes"
                className="min-h-[100px] w-full rounded-xl border border-border bg-card px-3 py-2 text-sm"
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, notes: event.target.value }))
                }
                placeholder="Optional notes"
              />
            </div>

            <div className="flex items-end justify-end sm:col-span-2">
              <Button type="submit" disabled={isSaving}>
                {isSaving ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </form>
        </div>
      </div>

      <Dialog open={isCreateContactOpen} onOpenChange={setIsCreateContactOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create contact</DialogTitle>
            <DialogDescription>
              Quick create from transaction edit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="edit_new_contact_name">Name</Label>
              <Input
                id="edit_new_contact_name"
                value={newContactName}
                onChange={(event) => setNewContactName(event.target.value)}
                placeholder="Client or vendor name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_new_contact_type">Type</Label>
              <select
                id="edit_new_contact_type"
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
              Quick create from transaction edit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="edit_new_category_name">Name</Label>
            <Input
              id="edit_new_category_name"
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
