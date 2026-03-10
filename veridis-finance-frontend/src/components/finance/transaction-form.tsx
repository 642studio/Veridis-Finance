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
  TransactionStatus,
  TransactionType,
} from "@/types/finance";

const CREATE_CONTACT_OPTION = "__create_contact__";
const CREATE_CATEGORY_OPTION = "__create_category__";
const CASH_SOURCE_OPTION = "__cash_source__";

export interface CreateTransactionPayload {
  type: TransactionType;
  account_id?: string | null;
  contact_id?: string | null;
  status?: TransactionStatus;
  source?: string;
  tags?: string[];
  amount: number;
  category: string;
  description?: string;
  entity?: string;
  transaction_date: string;
}

interface TransactionFormProps {
  accounts: Account[];
  contacts: Contact[];
  categories: Category[];
  onSubmit: (payload: CreateTransactionPayload) => Promise<void>;
  onContactCreated?: (contact: Contact) => void;
  onCategoryCreated?: (category: Category) => void;
}

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function resolveDefaultContactType(transactionType: TransactionType): ContactType {
  return transactionType === "income" ? "customer" : "vendor";
}

export function TransactionForm({
  accounts,
  contacts,
  categories,
  onSubmit,
  onContactCreated,
  onCategoryCreated,
}: TransactionFormProps) {
  const notify = useNotify();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [type, setType] = useState<TransactionType>("income");
  const [accountId, setAccountId] = useState("");
  const [expenseSource, setExpenseSource] = useState("");
  const [contactId, setContactId] = useState("");
  const [status, setStatus] = useState<TransactionStatus>("posted");
  const [source, setSource] = useState("manual");
  const [tags, setTags] = useState("");
  const [amount, setAmount] = useState("0.00");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [entity, setEntity] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 16));

  const [localContacts, setLocalContacts] = useState<Contact[]>(contacts);
  const [localCategories, setLocalCategories] = useState<Category[]>(categories);

  const [isCreateContactOpen, setIsCreateContactOpen] = useState(false);
  const [newContactName, setNewContactName] = useState("");
  const [newContactType, setNewContactType] = useState<ContactType>(
    resolveDefaultContactType("income")
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
    setNewContactType(resolveDefaultContactType(type));
  }, [type]);

  const selectableContacts = useMemo(() => {
    if (type === "income") {
      return localContacts.filter(
        (contact) => contact.type === "customer" || contact.type === "internal"
      );
    }

    return localContacts.filter((contact) => contact.type !== "customer");
  }, [localContacts, type]);

  const categoryOptions = useMemo(
    () =>
      [...localCategories].sort((left, right) =>
        left.name.localeCompare(right.name, "en", { sensitivity: "base" })
      ),
    [localCategories]
  );

  const resolveContactEntity = (id: string) => {
    if (!id) {
      return "";
    }
    const match = localContacts.find((contact) => contact.id === id);
    if (!match) {
      return "";
    }
    return match.business_name || match.name;
  };

  useEffect(() => {
    if (!contactId) {
      return;
    }

    const stillValid = selectableContacts.some((contact) => contact.id === contactId);
    if (stillValid) {
      return;
    }

    setContactId("");
    setEntity("");
  }, [contactId, selectableContacts]);

  useEffect(() => {
    if (type === "expense") {
      setSource("manual");
      if (!expenseSource && accountId) {
        setExpenseSource(accountId);
      }
      return;
    }

    if (expenseSource && expenseSource !== CASH_SOURCE_OPTION) {
      setAccountId(expenseSource);
    }
    setExpenseSource("");
  }, [accountId, expenseSource, type]);

  const resetForm = () => {
    setAccountId("");
    setExpenseSource("");
    setContactId("");
    setStatus("posted");
    setSource("manual");
    setTags("");
    setAmount("0.00");
    setCategory("");
    setDescription("");
    setEntity("");
    setDate(new Date().toISOString().slice(0, 16));
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
      setContactId(duplicate.id);
      setEntity(resolveContactEntity(duplicate.id));
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
      setContactId(created.id);
      setEntity(created.business_name || created.name);
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
      setCategory(duplicate.name);
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
      setCategory(created.name);
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

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      notify.error({
        title: "Invalid amount",
        description: "Amount must be greater than 0.",
      });
      return;
    }

    const selectedCategory = category.trim();
    if (!selectedCategory) {
      notify.error({
        title: "Category required",
        description: "Select or create a category.",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const parsedTags = tags
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean);
      const derivedEntity = resolveContactEntity(contactId);

      let resolvedAccountId: string | undefined;
      let resolvedSource = source.trim() || "manual";

      if (type === "expense") {
        if (expenseSource === CASH_SOURCE_OPTION) {
          resolvedAccountId = undefined;
          resolvedSource = "cash";
        } else if (expenseSource) {
          resolvedAccountId = expenseSource;
          resolvedSource = "manual";
        } else {
          resolvedAccountId = undefined;
          resolvedSource = "manual";
        }
      } else {
        resolvedAccountId = accountId || undefined;
      }

      await onSubmit({
        type,
        account_id: resolvedAccountId,
        contact_id: contactId || undefined,
        status,
        source: resolvedSource,
        tags: parsedTags.length ? parsedTags : undefined,
        amount: parsedAmount,
        category: selectedCategory,
        description: description || undefined,
        entity: derivedEntity || entity || undefined,
        transaction_date: new Date(date).toISOString(),
      });

      resetForm();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="type">Type</Label>
          <select
            id="type"
            className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
            value={type}
            onChange={(event) => setType(event.target.value as TransactionType)}
          >
            <option value="income">Income</option>
            <option value="expense">Expense</option>
          </select>
        </div>

        {type === "expense" ? (
          <div className="space-y-2">
            <Label htmlFor="expense_source">Expense Source</Label>
            <select
              id="expense_source"
              className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
              value={expenseSource}
              onChange={(event) => {
                const value = event.target.value;
                setExpenseSource(value);
                if (value && value !== CASH_SOURCE_OPTION) {
                  setAccountId(value);
                }
              }}
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
            <Label htmlFor="account_id">Account</Label>
            <select
              id="account_id"
              className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
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
          <Label htmlFor="contact_id">Contact (optional)</Label>
          <select
            id="contact_id"
            className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
            value={contactId}
            onChange={(event) => {
              const nextId = event.target.value;
              if (nextId === CREATE_CONTACT_OPTION) {
                setIsCreateContactOpen(true);
                return;
              }
              setContactId(nextId);
              setEntity(resolveContactEntity(nextId));
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
          <Label htmlFor="amount">Amount</Label>
          <Input
            id="amount"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="category">Category</Label>
          <select
            id="category"
            className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
            value={category}
            onChange={(event) => {
              const nextValue = event.target.value;
              if (nextValue === CREATE_CATEGORY_OPTION) {
                setIsCreateCategoryOpen(true);
                return;
              }
              setCategory(nextValue);
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
          <Label htmlFor="entity">Entity</Label>
          <Input
            id="entity"
            value={entity}
            onChange={(event) => setEntity(event.target.value)}
            placeholder={contactId ? "Auto from contact" : "Client / Vendor"}
            readOnly={Boolean(contactId)}
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="description">Description</Label>
          <Input
            id="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Optional detail"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <select
            id="status"
            className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
            value={status}
            onChange={(event) => setStatus(event.target.value as TransactionStatus)}
          >
            <option value="posted">posted</option>
            <option value="pending">pending</option>
            <option value="reconciled">reconciled</option>
            <option value="void">void</option>
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="source">Source</Label>
          <Input
            id="source"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder={type === "expense" ? "auto: manual/cash" : "manual"}
            readOnly={type === "expense"}
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="tags">Tags (comma separated)</Label>
          <Input
            id="tags"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="ops, urgent, payroll"
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="transaction_date">Date</Label>
          <Input
            id="transaction_date"
            type="datetime-local"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            required
          />
        </div>

        <Button className="sm:col-span-2" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : "Save transaction"}
        </Button>
      </form>

      <Dialog open={isCreateContactOpen} onOpenChange={setIsCreateContactOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create contact</DialogTitle>
            <DialogDescription>
              Quick create from transaction capture.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="new_contact_name">Name</Label>
              <Input
                id="new_contact_name"
                value={newContactName}
                onChange={(event) => setNewContactName(event.target.value)}
                placeholder="Client or vendor name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new_contact_type">Type</Label>
              <select
                id="new_contact_type"
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
              Quick create from transaction capture.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new_category_name">Name</Label>
            <Input
              id="new_category_name"
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
