"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
import type { ApiEnvelope, Contact, Vendor, VendorType } from "@/types/finance";

interface VendorFormState {
  name: string;
  type: VendorType;
  default_category_id: string;
  active: boolean;
}

const VENDOR_TYPE_OPTIONS: VendorType[] = [
  "ads",
  "software",
  "rent",
  "utilities",
  "payroll",
  "other",
];

const EMPTY_FORM: VendorFormState = {
  name: "",
  type: "other",
  default_category_id: "",
  active: true,
};

function toPayload(form: VendorFormState) {
  return {
    name: form.name.trim(),
    type: form.type,
    default_category_id: form.default_category_id.trim() || null,
    active: form.active,
  };
}

function toForm(vendor: Vendor): VendorFormState {
  return {
    name: vendor.name,
    type: vendor.type,
    default_category_id: vendor.default_category_id || "",
    active: Boolean(vendor.active),
  };
}

interface VendorModalProps {
  open: boolean;
  title: string;
  form: VendorFormState;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onChange: (next: VendorFormState) => void;
}

function VendorModal({
  open,
  title,
  form,
  isSaving,
  onClose,
  onSubmit,
  onChange,
}: VendorModalProps) {
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
            <Label htmlFor="vendor_name">Name</Label>
            <Input
              id="vendor_name"
              value={form.name}
              onChange={(event) => onChange({ ...form, name: event.target.value })}
              placeholder="Vendor name"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="vendor_type">Type</Label>
            <select
              id="vendor_type"
              className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
              value={form.type}
              onChange={(event) =>
                onChange({ ...form, type: event.target.value as VendorType })
              }
            >
              {VENDOR_TYPE_OPTIONS.map((vendorType) => (
                <option key={vendorType} value={vendorType}>
                  {vendorType}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="vendor_default_category">Default category id</Label>
            <Input
              id="vendor_default_category"
              value={form.default_category_id}
              onChange={(event) =>
                onChange({ ...form, default_category_id: event.target.value })
              }
              placeholder="Optional UUID"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="vendor_status">Status</Label>
            <select
              id="vendor_status"
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
              {isSaving ? "Saving..." : "Save vendor"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function DashboardVendorsPage() {
  const notify = useNotify();
  const searchParams = useSearchParams();

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [deletingVendor, setDeletingVendor] = useState<Vendor | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [form, setForm] = useState<VendorFormState>(EMPTY_FORM);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const loadContacts = useCallback(async () => {
    try {
      const response = await clientApiFetch<ApiEnvelope<Contact[]>>(
        "/api/finance/contacts?sort_by=name&sort_order=asc"
      );
      setContacts(response.data);
    } catch {
      setContacts([]);
    }
  }, []);

  const loadVendors = useCallback(async () => {
    setIsLoading(true);
    try {
      const search = new URLSearchParams();
      search.set("active", showInactive ? "all" : "true");

      const response = await clientApiFetch<ApiEnvelope<Vendor[]>>(
        `/api/finance/vendors?${search.toString()}`
      );
      setVendors(response.data);
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not fetch vendors";
      notify.error({ title: "Load failed", description: message });
    } finally {
      setIsLoading(false);
    }
  }, [notify, showInactive]);

  useEffect(() => {
    loadVendors();
  }, [loadVendors]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  useEffect(() => {
    const vendorId = searchParams.get("vendorId");
    if (!vendorId || vendors.length === 0) {
      return;
    }

    const match = vendors.find((vendor) => vendor.id === vendorId);
    if (!match) {
      return;
    }

    if (editingVendor?.id === match.id && isModalOpen) {
      return;
    }

    setEditingVendor(match);
    setForm(toForm(match));
    setIsModalOpen(true);
  }, [editingVendor?.id, isModalOpen, searchParams, vendors]);

  const openCreateModal = () => {
    setEditingVendor(null);
    setForm(EMPTY_FORM);
    setIsModalOpen(true);
  };

  const openEditModal = (vendor: Vendor) => {
    setEditingVendor(vendor);
    setForm(toForm(vendor));
    setIsModalOpen(true);
  };

  const closeModal = () => {
    if (isSaving) {
      return;
    }

    setIsModalOpen(false);
    setEditingVendor(null);
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
      if (editingVendor) {
        await clientApiFetch<ApiEnvelope<Vendor>>(
          `/api/finance/vendors/${editingVendor.id}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          }
        );

        notify.success({
          title: "Vendor updated",
          description: "Vendor changes were saved.",
        });
      } else {
        await clientApiFetch<ApiEnvelope<Vendor>>("/api/finance/vendors", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });

        notify.success({
          title: "Vendor created",
          description: "Vendor added successfully.",
        });
      }

      await loadVendors();
      closeModal();
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not save vendor";
      notify.error({ title: "Save failed", description: message });
    } finally {
      setIsSaving(false);
    }
  };

  const toggleVendorActive = async (vendor: Vendor) => {
    try {
      await clientApiFetch<ApiEnvelope<Vendor>>(`/api/finance/vendors/${vendor.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: !vendor.active }),
      });

      notify.success({
        title: "Vendor updated",
        description: `Vendor is now ${vendor.active ? "inactive" : "active"}.`,
      });
      await loadVendors();
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not update vendor";
      notify.error({ title: "Update failed", description: message });
    }
  };

  const softDeleteVendor = async (vendor: Vendor) => {
    setIsDeleting(true);
    try {
      await clientApiFetch<ApiEnvelope<Vendor>>(`/api/finance/vendors/${vendor.id}`, {
        method: "DELETE",
      });

      notify.success({
        title: "Vendor deactivated",
        description: "Vendor was soft deleted (active=false).",
      });
      await loadVendors();
      setDeletingVendor(null);
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not soft delete vendor";
      notify.error({ title: "Delete failed", description: message });
    } finally {
      setIsDeleting(false);
    }
  };

  const activeCount = useMemo(
    () => vendors.filter((vendor) => vendor.active).length,
    [vendors]
  );
  const contactByVendorId = useMemo(() => {
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Vendors</CardTitle>
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
              Add vendor
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <Badge variant="secondary">
              {activeCount}/{vendors.length} active
            </Badge>
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading vendors...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Default category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendors.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No vendors yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  vendors.map((vendor) => (
                    <TableRow key={vendor.id}>
                      <TableCell className="font-medium">{vendor.name}</TableCell>
                      <TableCell>{vendor.type}</TableCell>
                      <TableCell>{vendor.default_category_id || "-"}</TableCell>
                      <TableCell>
                        <Badge variant={vendor.active ? "success" : "outline"}>
                          {vendor.active ? "active" : "inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button size="sm" variant="ghost" asChild>
                            <Link
                              href={
                                contactByVendorId.has(vendor.id)
                                  ? `/dashboard/transactions?contact_id=${contactByVendorId.get(
                                      vendor.id
                                    )}`
                                  : `/dashboard/transactions?vendor_id=${vendor.id}`
                              }
                            >
                              Transactions
                            </Link>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEditModal(vendor)}
                          >
                            <Edit3 className="mr-1 h-3.5 w-3.5" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => toggleVendorActive(vendor)}
                          >
                            {vendor.active ? "Deactivate" : "Activate"}
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => setDeletingVendor(vendor)}
                            disabled={!vendor.active}
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

      <VendorModal
        open={isModalOpen}
        title={editingVendor ? "Edit vendor" : "Create vendor"}
        form={form}
        isSaving={isSaving}
        onClose={closeModal}
        onSubmit={submitForm}
        onChange={setForm}
      />

      <ConfirmModal
        open={Boolean(deletingVendor)}
        title="Delete Vendor?"
        description="This action cannot be undone."
        confirmLabel="Delete"
        isLoading={isDeleting}
        onCancel={() => {
          if (!isDeleting) {
            setDeletingVendor(null);
          }
        }}
        onConfirm={async () => {
          if (deletingVendor) {
            await softDeleteVendor(deletingVendor);
          }
        }}
      />
    </div>
  );
}
