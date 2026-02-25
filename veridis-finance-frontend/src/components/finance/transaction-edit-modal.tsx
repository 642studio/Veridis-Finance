"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  Client,
  Member,
  Transaction,
  TransactionType,
  Vendor,
} from "@/types/finance";

export interface UpdateTransactionPayload {
  type: TransactionType;
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
  members: Member[];
  clients: Client[];
  vendors: Vendor[];
  isSaving?: boolean;
  onClose: () => void;
  onSubmit: (payload: UpdateTransactionPayload) => Promise<void>;
}

interface FormState {
  type: TransactionType;
  category: string;
  member_id: string;
  client_id: string;
  vendor_id: string;
  notes: string;
}

function emptyState(): FormState {
  return {
    type: "expense",
    category: "",
    member_id: "",
    client_id: "",
    vendor_id: "",
    notes: "",
  };
}

function toFormState(transaction: Transaction): FormState {
  return {
    type: transaction.type,
    category: transaction.category || "",
    member_id: transaction.member_id || "",
    client_id: transaction.client_id || "",
    vendor_id: transaction.vendor_id || "",
    notes: transaction.notes || "",
  };
}

export function TransactionEditModal({
  open,
  transaction,
  members,
  clients,
  vendors,
  isSaving = false,
  onClose,
  onSubmit,
}: TransactionEditModalProps) {
  const [form, setForm] = useState<FormState>(emptyState);

  useEffect(() => {
    if (!open || !transaction) {
      return;
    }

    setForm(toFormState(transaction));
  }, [open, transaction]);

  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      map.set(member.id, member.full_name);
    }
    return map;
  }, [members]);

  const clientNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const client of clients) {
      map.set(client.id, client.name);
    }
    return map;
  }, [clients]);

  const vendorNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const vendor of vendors) {
      map.set(vendor.id, vendor.name);
    }
    return map;
  }, [vendors]);

  if (!open || !transaction) {
    return null;
  }

  const handleMemberChange = (value: string) => {
    setForm((current) => ({
      ...current,
      member_id: value,
      client_id: "",
      vendor_id: "",
    }));
  };

  const handleClientChange = (value: string) => {
    setForm((current) => ({
      ...current,
      member_id: "",
      client_id: value,
      vendor_id: "",
    }));
  };

  const handleVendorChange = (value: string) => {
    setForm((current) => ({
      ...current,
      member_id: "",
      client_id: "",
      vendor_id: value,
    }));
  };

  const handleTypeChange = (value: TransactionType) => {
    setForm((current) => ({
      ...current,
      type: value,
      member_id: value === "income" ? "" : current.member_id,
      vendor_id: value === "income" ? "" : current.vendor_id,
      client_id: value === "expense" ? "" : current.client_id,
    }));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const linkedMemberName = form.member_id
      ? memberNameById.get(form.member_id) || null
      : null;
    const linkedClientName = form.client_id
      ? clientNameById.get(form.client_id) || null
      : null;
    const linkedVendorName = form.vendor_id
      ? vendorNameById.get(form.vendor_id) || null
      : null;

    await onSubmit({
      type: form.type,
      category: form.category.trim(),
      member_id: form.member_id || null,
      client_id: form.client_id || null,
      vendor_id: form.vendor_id || null,
      notes: form.notes.trim() || null,
      entity: linkedMemberName || linkedClientName || linkedVendorName,
    });
  };

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
          <div>
            <h3 className="font-heading text-lg font-semibold">Edit transaction</h3>
            <p className="text-xs text-muted-foreground">ID: {transaction.id.slice(0, 8)}...</p>
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
              onChange={(event) => handleTypeChange(event.target.value as TransactionType)}
            >
              <option value="income">income</option>
              <option value="expense">expense</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tx_category">Category</Label>
            <Input
              id="tx_category"
              value={form.category}
              onChange={(event) =>
                setForm((current) => ({ ...current, category: event.target.value }))
              }
              required
            />
          </div>

          {form.type === "income" ? (
            <div className="space-y-2">
              <Label htmlFor="tx_client">Client</Label>
              <select
                id="tx_client"
                className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                value={form.client_id}
                onChange={(event) => handleClientChange(event.target.value)}
              >
                <option value="">None</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.business_name || client.name}
                    {client.business_name ? ` (${client.name})` : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="tx_member">Member</Label>
                <select
                  id="tx_member"
                  className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                  value={form.member_id}
                  onChange={(event) => handleMemberChange(event.target.value)}
                >
                  <option value="">None</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.full_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="tx_vendor">Vendor</Label>
                <select
                  id="tx_vendor"
                  className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                  value={form.vendor_id}
                  onChange={(event) => handleVendorChange(event.target.value)}
                >
                  <option value="">None</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

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
  );
}
