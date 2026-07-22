"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
import { findBestContactMatchId } from "@/lib/contact-matching";
import { formatCurrency } from "@/lib/format";
import type { ApiEnvelope, Contact, Member } from "@/types/finance";

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
  const searchParams = useSearchParams();
  // Equipo is a standalone module (its own `members` table). Do not bounce to
  // Contactos — that redirect made the nav glitch and hid the real list.
  const shouldRedirectToContacts = false;

  const [members, setMembers] = useState<Member[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [deletingMember, setDeletingMember] = useState<Member | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [form, setForm] = useState<MemberFormState>(EMPTY_FORM);

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

  const loadMembers = useCallback(async () => {
    if (shouldRedirectToContacts) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const response = await clientApiFetch<ApiEnvelope<Member[]>>(
        "/api/finance/members"
      );
      setMembers(response.data);
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "No se pudieron cargar los miembros";
      notify.error({ title: "Error al cargar", description: message });
    } finally {
      setIsLoading(false);
    }
  }, [notify, shouldRedirectToContacts]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  useEffect(() => {
    const memberId = searchParams.get("memberId");
    if (!memberId || members.length === 0) {
      return;
    }

    const match = members.find((member) => member.id === memberId);
    if (!match) {
      return;
    }

    if (editingMemberId === match.id) {
      return;
    }

    setEditingMemberId(match.id);
    setForm(toForm(match));
  }, [editingMemberId, members, searchParams]);

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
        throw new Error("El nombre completo es obligatorio");
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
          title: "Miembro actualizado",
          description: "Los datos del miembro se actualizaron correctamente.",
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
          title: "Miembro creado",
          description: "Nuevo miembro agregado a tu organización.",
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
            : "No se pudo guardar el miembro";

      notify.error({
        title: "Error al guardar",
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
        title: "Miembro actualizado",
        description: `El miembro ahora está ${!member.active ? "activo" : "inactivo"}.`,
      });
      await loadMembers();
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "No se pudo actualizar el miembro";
      notify.error({ title: "Error al actualizar", description: message });
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
        title: "Miembro eliminado",
        description: "El miembro se eliminó correctamente.",
      });

      if (editingMemberId === member.id) {
        resetForm();
      }

      await loadMembers();
      setDeletingMember(null);
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "No se pudo eliminar el miembro";
      notify.error({ title: "Error al eliminar", description: message });
    } finally {
      setIsDeleting(false);
    }
  };

  const activeCount = useMemo(
    () => members.filter((member) => member.active).length,
    [members]
  );
  const contactByMemberId = useMemo(() => {
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

  if (shouldRedirectToContacts) {
    return null;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{editingMemberId ? "Editar miembro" : "Crear miembro"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="member_full_name">Nombre completo</Label>
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
                placeholder="Opcional"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="member_last4">Últimos 4 de la cuenta bancaria</Label>
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
              <Label htmlFor="member_salary">Salario estimado</Label>
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
              <Label htmlFor="member_active">Estado</Label>
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
                <option value="active">Activo</option>
                <option value="inactive">Inactivo</option>
              </select>
            </div>

            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="submit" disabled={isSaving}>
                {isSaving ? "Guardando..." : editingMemberId ? "Actualizar miembro" : "Crear miembro"}
              </Button>
              {editingMemberId ? (
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancelar edición
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Miembros</CardTitle>
          <Badge variant="secondary">
            {activeCount}/{members.length} activos
          </Badge>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando miembros...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Alias</TableHead>
                  <TableHead>RFC</TableHead>
                  <TableHead>Cuenta</TableHead>
                  <TableHead>Salario</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      Aún no hay miembros.
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
                          <Button size="sm" variant="ghost" asChild>
                            <Link
                              href={
                                contactByMemberId.has(member.id)
                                  ? `/dashboard/transactions?contact_id=${contactByMemberId.get(
                                      member.id
                                    )}`
                                  : `/dashboard/transactions?member_id=${member.id}`
                              }
                            >
                              Transacciones
                            </Link>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => startEdit(member)}
                          >
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => toggleActive(member)}
                          >
                            {member.active ? "Desactivar" : "Activar"}
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => setDeletingMember(member)}
                          >
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
        </CardContent>
      </Card>

      <ConfirmModal
        open={Boolean(deletingMember)}
        title="¿Eliminar miembro?"
        description="Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
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
