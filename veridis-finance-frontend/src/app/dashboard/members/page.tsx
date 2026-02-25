"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
import type { ApiEnvelope, Member } from "@/types/finance";

interface MemberFormState {
  full_name: string;
  alias: string;
  bank_account_last4: string;
  rfc: string;
  salary_estimate: string;
  active: boolean;
}

const EMPTY_FORM: MemberFormState = {
  full_name: "",
  alias: "",
  bank_account_last4: "",
  rfc: "",
  salary_estimate: "",
  active: true,
};

function toPayload(form: MemberFormState) {
  const salaryValue = form.salary_estimate.trim();

  return {
    full_name: form.full_name.trim(),
    alias: form.alias.trim() || null,
    bank_account_last4: form.bank_account_last4.trim() || null,
    rfc: form.rfc.trim().toUpperCase() || null,
    salary_estimate: salaryValue ? Number(salaryValue) : null,
    active: form.active,
  };
}

function toForm(member: Member): MemberFormState {
  return {
    full_name: member.full_name,
    alias: member.alias || "",
    bank_account_last4: member.bank_account_last4 || "",
    rfc: member.rfc || "",
    salary_estimate:
      member.salary_estimate === null || member.salary_estimate === undefined
        ? ""
        : String(member.salary_estimate),
    active: Boolean(member.active),
  };
}

export default function DashboardMembersPage() {
  const notify = useNotify();

  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [deletingMember, setDeletingMember] = useState<Member | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [form, setForm] = useState<MemberFormState>(EMPTY_FORM);

  const loadMembers = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await clientApiFetch<ApiEnvelope<Member[]>>(
        "/api/finance/members"
      );
      setMembers(response.data);
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not fetch members";
      notify.error({ title: "Load failed", description: message });
    } finally {
      setIsLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingMemberId(null);
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);

    try {
      const payload = toPayload(form);

      if (!payload.full_name) {
        throw new Error("Full name is required");
      }

      if (editingMemberId) {
        await clientApiFetch<ApiEnvelope<Member>>(
          `/api/finance/members/${editingMemberId}`,
          {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify(payload),
          }
        );

        notify.success({
          title: "Member updated",
          description: "Member data was updated successfully.",
        });
      } else {
        await clientApiFetch<ApiEnvelope<Member>>("/api/finance/members", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        notify.success({
          title: "Member created",
          description: "New member added to your organization.",
        });
      }

      await loadMembers();
      resetForm();
    } catch (error) {
      const message =
        error instanceof ApiClientError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Could not save member";

      notify.error({
        title: "Save failed",
        description: message,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const startEdit = (member: Member) => {
    setEditingMemberId(member.id);
    setForm(toForm(member));
  };

  const toggleActive = async (member: Member) => {
    try {
      await clientApiFetch<ApiEnvelope<Member>>(`/api/finance/members/${member.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ active: !member.active }),
      });

      notify.success({
        title: "Member updated",
        description: `Member is now ${!member.active ? "active" : "inactive"}.`,
      });
      await loadMembers();
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not update member";
      notify.error({ title: "Update failed", description: message });
    }
  };

  const deleteMember = async (member: Member) => {
    setIsDeleting(true);
    try {
      await clientApiFetch<ApiEnvelope<{ id: string; deleted: boolean }>>(
        `/api/finance/members/${member.id}`,
        {
          method: "DELETE",
        }
      );

      notify.success({
        title: "Member deleted",
        description: "Member removed successfully.",
      });

      if (editingMemberId === member.id) {
        resetForm();
      }

      await loadMembers();
      setDeletingMember(null);
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not delete member";
      notify.error({ title: "Delete failed", description: message });
    } finally {
      setIsDeleting(false);
    }
  };

  const activeCount = useMemo(
    () => members.filter((member) => member.active).length,
    [members]
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{editingMemberId ? "Edit member" : "Create member"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="member_full_name">Full name</Label>
              <Input
                id="member_full_name"
                value={form.full_name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, full_name: event.target.value }))
                }
                placeholder="Nombre completo"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="member_alias">Alias</Label>
              <Input
                id="member_alias"
                value={form.alias}
                onChange={(event) =>
                  setForm((current) => ({ ...current, alias: event.target.value }))
                }
                placeholder="Optional"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="member_last4">Bank account last 4</Label>
              <Input
                id="member_last4"
                maxLength={4}
                value={form.bank_account_last4}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    bank_account_last4: event.target.value.replace(/\D/g, "").slice(0, 4),
                  }))
                }
                placeholder="1234"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="member_rfc">RFC</Label>
              <Input
                id="member_rfc"
                value={form.rfc}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    rfc: event.target.value.toUpperCase(),
                  }))
                }
                placeholder="RFC"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="member_salary">Salary estimate</Label>
              <Input
                id="member_salary"
                type="number"
                step="0.01"
                min="0"
                value={form.salary_estimate}
                onChange={(event) =>
                  setForm((current) => ({ ...current, salary_estimate: event.target.value }))
                }
                placeholder="0.00"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="member_active">Status</Label>
              <select
                id="member_active"
                className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                value={form.active ? "active" : "inactive"}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    active: event.target.value === "active",
                  }))
                }
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="submit" disabled={isSaving}>
                {isSaving ? "Saving..." : editingMemberId ? "Update member" : "Create member"}
              </Button>
              {editingMemberId ? (
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel edit
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Members</CardTitle>
          <Badge variant="secondary">
            {activeCount}/{members.length} active
          </Badge>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading members...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Alias</TableHead>
                  <TableHead>RFC</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Salary</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      No members yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  members.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell className="font-medium">{member.full_name}</TableCell>
                      <TableCell>{member.alias || "-"}</TableCell>
                      <TableCell>{member.rfc || "-"}</TableCell>
                      <TableCell>
                        {member.bank_account_last4 ? `****${member.bank_account_last4}` : "-"}
                      </TableCell>
                      <TableCell>
                        {member.salary_estimate === null || member.salary_estimate === undefined
                          ? "-"
                          : formatCurrency(member.salary_estimate)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={member.active ? "success" : "outline"}>
                          {member.active ? "active" : "inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => startEdit(member)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => toggleActive(member)}
                          >
                            {member.active ? "Deactivate" : "Activate"}
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => setDeletingMember(member)}
                          >
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
        </CardContent>
      </Card>

      <ConfirmModal
        open={Boolean(deletingMember)}
        title="Delete Member?"
        description="This action cannot be undone."
        confirmLabel="Delete"
        isLoading={isDeleting}
        onCancel={() => {
          if (!isDeleting) {
            setDeletingMember(null);
          }
        }}
        onConfirm={async () => {
          if (deletingMember) {
            await deleteMember(deletingMember);
          }
        }}
      />
    </div>
  );
}
