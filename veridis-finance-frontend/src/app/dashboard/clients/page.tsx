"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
import { findBestContactMatchId } from "@/lib/contact-matching";
import type { ApiEnvelope, Client, Contact } from "@/types/finance";

interface ClientFormState {
  name: string;
  business_name: string;
  email: string;
  phone: string;
  notes: string;
  active: boolean;
}

const EMPTY_FORM: ClientFormState = {
  name: "",
  business_name: "",
  email: "",
  phone: "",
  notes: "",
  active: true,
};

function toPayload(form: ClientFormState) {
  return {
    name: form.name.trim(),
    business_name: form.business_name.trim() || null,
    email: form.email.trim() || null,
    phone: form.phone.trim() || null,
    notes: form.notes.trim() || null,
    active: form.active,
  };
}

function toForm(client: Client): ClientFormState {
  return {
    name: client.name,
    business_name: client.business_name || "",
    email: client.email || "",
    phone: client.phone || "",
    notes: client.notes || "",
    active: Boolean(client.active),
  };
}

interface ClientModalProps {
  open: boolean;
  title: string;
  form: ClientFormState;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onChange: (next: ClientFormState) => void;
}

function ClientModal({
  open,
  title,
  form,
  isSaving,
  onClose,
  onSubmit,
  onChange,
}: ClientModalProps) {
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
            <Label htmlFor="client_name">Full Name</Label>
            <Input
              id="client_name"
              value={form.name}
              onChange={(event) => onChange({ ...form, name: event.target.value })}
              placeholder="Client full name"
              required
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="client_business_name">Business Name</Label>
            <Input
              id="client_business_name"
              value={form.business_name}
              onChange={(event) =>
                onChange({ ...form, business_name: event.target.value })
              }
              placeholder="Company / brand (optional)"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="client_email">Email</Label>
            <Input
              id="client_email"
              type="email"
              value={form.email}
              onChange={(event) => onChange({ ...form, email: event.target.value })}
              placeholder="client@email.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="client_phone">Phone</Label>
            <Input
              id="client_phone"
              value={form.phone}
              onChange={(event) => onChange({ ...form, phone: event.target.value })}
              placeholder="+52 ..."
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="client_notes">Notes</Label>
            <textarea
              id="client_notes"
              className="min-h-[100px] w-full rounded-xl border border-border bg-card px-3 py-2 text-sm"
              value={form.notes}
              onChange={(event) => onChange({ ...form, notes: event.target.value })}
              placeholder="Optional notes"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="client_status">Status</Label>
            <select
              id="client_status"
              className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
              value={form.active ? "active" : "inactive"}
              onChange={(event) =>
                onChange({ ...form, active: event.target.value === "active" })
              }
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          <div className="flex items-end justify-end sm:col-span-2">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving..." : "Save client"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function DashboardClientsPage() {
  const notify = useNotify();
  const router = useRouter();
  const searchParams = useSearchParams();
  const shouldRedirectToContacts = searchParams.toString().length === 0;

  useEffect(() => {
    if (!shouldRedirectToContacts) {
      return;
    }
    router.replace("/dashboard/contacts?type=customer");
  }, [router, shouldRedirectToContacts]);

  const [clients, setClients] = useState<Client[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deletingClient, setDeletingClient] = useState<Client | null>(null);
  const [form, setForm] = useState<ClientFormState>(EMPTY_FORM);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadContacts = useCallback(async () => {
    if (shouldRedirectToContacts) {
      return;
    }

    try {
      const response = await clientApiFetch<ApiEnvelope<Contact[]>>(
        "/api/finance/contacts?sort_by=name&sort_order=asc"
      );
      setContacts(response.data);
    } catch {
      setContacts([]);
    }
  }, [shouldRedirectToContacts]);

  const loadClients = useCallback(async () => {
    if (shouldRedirectToContacts) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const search = new URLSearchParams();
      search.set("active", showInactive ? "all" : "true");

      const response = await clientApiFetch<ApiEnvelope<Client[]>>(
        `/api/finance/clients?${search.toString()}`
      );
      setClients(response.data);
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not fetch clients";
      notify.error({ title: "Load failed", description: message });
    } finally {
      setIsLoading(false);
    }
  }, [notify, shouldRedirectToContacts, showInactive]);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  useEffect(() => {
    const clientId = searchParams.get("clientId");
    if (!clientId || clients.length === 0) {
      return;
    }

    const match = clients.find((client) => client.id === clientId);
    if (!match) {
      return;
    }

    if (editingClient?.id === match.id && isModalOpen) {
      return;
    }

    setEditingClient(match);
    setForm(toForm(match));
    setIsModalOpen(true);
  }, [clients, editingClient?.id, isModalOpen, searchParams]);

  const openCreateModal = () => {
    setEditingClient(null);
    setForm(EMPTY_FORM);
    setIsModalOpen(true);
  };

  const openEditModal = (client: Client) => {
    setEditingClient(client);
    setForm(toForm(client));
    setIsModalOpen(true);
  };

  const closeModal = () => {
    if (isSaving) {
      return;
    }

    setIsModalOpen(false);
    setEditingClient(null);
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
      if (editingClient) {
        await clientApiFetch<ApiEnvelope<Client>>(
          `/api/finance/clients/${editingClient.id}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          }
        );

        notify.success({
          title: "Client updated",
          description: "Client changes were saved.",
        });
      } else {
        await clientApiFetch<ApiEnvelope<Client>>("/api/finance/clients", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });

        notify.success({
          title: "Client created",
          description: "Client added successfully.",
        });
      }

      await loadClients();
      closeModal();
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not save client";
      notify.error({ title: "Save failed", description: message });
    } finally {
      setIsSaving(false);
    }
  };

  const toggleClientActive = async (client: Client) => {
    try {
      await clientApiFetch<ApiEnvelope<Client>>(`/api/finance/clients/${client.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: !client.active }),
      });

      notify.success({
        title: "Client updated",
        description: `Client is now ${client.active ? "inactive" : "active"}.`,
      });
      await loadClients();
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not update client";
      notify.error({ title: "Update failed", description: message });
    }
  };

  const softDeleteClient = async (client: Client) => {
    setIsDeleting(true);
    try {
      await clientApiFetch<ApiEnvelope<Client>>(`/api/finance/clients/${client.id}`, {
        method: "DELETE",
      });

      notify.success({
        title: "Client deactivated",
        description: "Client was soft deleted (active=false).",
      });
      await loadClients();
      setDeletingClient(null);
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not soft delete client";
      notify.error({ title: "Delete failed", description: message });
    } finally {
      setIsDeleting(false);
    }
  };

  const activeCount = useMemo(
    () => clients.filter((client) => client.active).length,
    [clients]
  );
  const contactByClientId = useMemo(() => {
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

  if (shouldRedirectToContacts) {
    return null;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Clients</CardTitle>
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
              Add client
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <Badge variant="secondary">
              {activeCount}/{clients.length} active
            </Badge>
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading clients...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No clients yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  clients.map((client) => (
                    <TableRow key={client.id}>
                      <TableCell className="font-medium">
                        <div className="flex flex-col">
                          <span>{client.business_name || client.name}</span>
                          {client.business_name ? (
                            <span className="text-xs font-normal text-muted-foreground">
                              {client.name}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>{client.email || "-"}</TableCell>
                      <TableCell>{client.phone || "-"}</TableCell>
                      <TableCell>
                        <Badge variant={client.active ? "success" : "outline"}>
                          {client.active ? "active" : "inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate">{client.notes || "-"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button size="sm" variant="ghost" asChild>
                            <Link
                              href={
                                contactByClientId.has(client.id)
                                  ? `/dashboard/transactions?contact_id=${contactByClientId.get(
                                      client.id
                                    )}`
                                  : `/dashboard/transactions?client_id=${client.id}`
                              }
                            >
                              Transactions
                            </Link>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEditModal(client)}
                          >
                            <Edit3 className="mr-1 h-3.5 w-3.5" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => toggleClientActive(client)}
                          >
                            {client.active ? "Deactivate" : "Activate"}
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => setDeletingClient(client)}
                            disabled={!client.active}
                          >
                            <Trash2 className="mr-1 h-3.5 w-3.5" />
                            Soft delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ClientModal
        open={isModalOpen}
        title={editingClient ? "Edit client" : "Create client"}
        form={form}
        isSaving={isSaving}
        onClose={closeModal}
        onSubmit={submitForm}
        onChange={setForm}
      />

      <ConfirmModal
        open={Boolean(deletingClient)}
        title="Delete Client?"
        description="This action cannot be undone."
        confirmLabel="Delete"
        isLoading={isDeleting}
        onCancel={() => {
          if (!isDeleting) {
            setDeletingClient(null);
          }
        }}
        onConfirm={async () => {
          if (deletingClient) {
            await softDeleteClient(deletingClient);
          }
        }}
      />
    </div>
  );
}
