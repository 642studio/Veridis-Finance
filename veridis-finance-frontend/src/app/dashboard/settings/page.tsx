"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { useNotificationLibrary, useNotify } from "@/hooks/use-notify";
import { ApiClientError, clientApiFetch } from "@/lib/api-client";
import type {
  AccountSettingsData,
  ApiEnvelope,
  OrganizationSettings,
} from "@/types/finance";

type SettingsTab = "profile" | "organization" | "ai" | "security";

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "profile", label: "Perfil" },
  { id: "organization", label: "Organización" },
  { id: "ai", label: "Claves de IA" },
  { id: "security", label: "Seguridad" },
];

const CURRENCY_OPTIONS = ["MXN", "USD", "EUR"] as const;
const TIMEZONE_OPTIONS = [
  "America/Mexico_City",
  "America/Cancun",
  "America/Tijuana",
  "America/Monterrey",
  "UTC",
] as const;

interface ProfileFormState {
  full_name: string;
  email: string;
}

interface OrganizationFormState {
  name: string;
  currency: string;
  timezone: string;
}

interface PasswordFormState {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

function profileFromAccount(account: AccountSettingsData | null): ProfileFormState {
  return {
    full_name: account?.user.full_name || "",
    email: account?.user.email || "",
  };
}

function organizationFromAccount(
  account: AccountSettingsData | null
): OrganizationFormState {
  return {
    name: account?.organization.name || "",
    currency: account?.organization.currency || "MXN",
    timezone: account?.organization.timezone || "America/Mexico_City",
  };
}

export default function DashboardSettingsPage() {
  const router = useRouter();
  const notify = useNotify();
  const { library, availableLibraries, setLibrary } = useNotificationLibrary();

  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");

  const [isLoading, setIsLoading] = useState(true);
  const [account, setAccount] = useState<AccountSettingsData | null>(null);

  const [profileForm, setProfileForm] = useState<ProfileFormState>({
    full_name: "",
    email: "",
  });
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const [organizationForm, setOrganizationForm] = useState<OrganizationFormState>({
    name: "",
    currency: "MXN",
    timezone: "America/Mexico_City",
  });
  const [isSavingOrganization, setIsSavingOrganization] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  const [passwordForm, setPasswordForm] = useState<PasswordFormState>({
    current_password: "",
    new_password: "",
    confirm_password: "",
  });
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const loadAccount = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await clientApiFetch<ApiEnvelope<AccountSettingsData>>(
        "/api/auth/account"
      );
      setAccount(response.data);
      setProfileForm(profileFromAccount(response.data));
      setOrganizationForm(organizationFromAccount(response.data));
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "No se pudo cargar la configuración de la cuenta";
      notify.error({ title: "Error al cargar", description: message });
      setAccount(null);
    } finally {
      setIsLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    loadAccount();
  }, [loadAccount]);

  const handleLibraryChange = (value: (typeof availableLibraries)[number]) => {
    setLibrary(value);
    notify.info({
      title: "Librería de notificaciones cambiada",
      description: `Proveedor activo: ${value}`,
    });
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

  const submitProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!profileForm.full_name.trim()) {
      notify.error({ title: "Validación", description: "El nombre completo es obligatorio." });
      return;
    }

    if (!profileForm.email.trim()) {
      notify.error({ title: "Validación", description: "El correo electrónico es obligatorio." });
      return;
    }

    setIsSavingProfile(true);
    try {
      const response = await clientApiFetch<ApiEnvelope<AccountSettingsData>>(
        "/api/auth/account",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            full_name: profileForm.full_name.trim(),
            email: profileForm.email.trim(),
          }),
        }
      );

      setAccount(response.data);
      setProfileForm(profileFromAccount(response.data));
      notify.success({
        title: "Perfil actualizado",
        description: "El perfil de tu cuenta se actualizó.",
      });
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "No se pudo actualizar el perfil";
      notify.error({ title: "Error al actualizar", description: message });
    } finally {
      setIsSavingProfile(false);
    }
  };

  const submitOrganization = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!organizationForm.name.trim()) {
      notify.error({ title: "Validación", description: "El nombre de la organización es obligatorio." });
      return;
    }

    setIsSavingOrganization(true);
    try {
      const response = await clientApiFetch<ApiEnvelope<OrganizationSettings>>(
        "/api/auth/organization",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: organizationForm.name.trim(),
            currency: organizationForm.currency,
            timezone: organizationForm.timezone,
          }),
        }
      );

      setAccount((current) =>
        current
          ? {
              ...current,
              organization: response.data,
            }
          : current
      );

      setOrganizationForm({
        name: response.data.name,
        currency: response.data.currency,
        timezone: response.data.timezone,
      });

      notify.success({
        title: "Organización actualizada",
        description: "Configuración de la organización guardada.",
      });
    } catch (error) {
      const message =
        error instanceof ApiClientError
          ? error.message
          : "No se pudo actualizar la configuración de la organización";
      notify.error({ title: "Error al actualizar", description: message });
    } finally {
      setIsSavingOrganization(false);
    }
  };

  const uploadOrganizationLogo = async () => {
    if (!logoFile) {
      notify.error({ title: "Validación", description: "Selecciona primero un archivo de logo." });
      return;
    }

    setIsUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append("logo", logoFile);

      const response = await clientApiFetch<ApiEnvelope<OrganizationSettings>>(
        "/api/auth/organization/logo",
        {
          method: "POST",
          body: formData,
        }
      );

      setAccount((current) =>
        current
          ? {
              ...current,
              organization: response.data,
            }
          : current
      );
      setLogoFile(null);

      notify.success({
        title: "Logo actualizado",
        description: "El logo de la organización se subió correctamente.",
      });
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "No se pudo subir el logo";
      notify.error({ title: "Error al subir", description: message });
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const changePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!passwordForm.current_password || !passwordForm.new_password) {
      notify.error({ title: "Validación", description: "Todos los campos de contraseña son obligatorios." });
      return;
    }

    if (passwordForm.new_password.length < 8) {
      notify.error({
        title: "Validación",
        description: "La nueva contraseña debe tener al menos 8 caracteres.",
      });
      return;
    }

    if (passwordForm.new_password !== passwordForm.confirm_password) {
      notify.error({ title: "Validación", description: "La confirmación de la contraseña no coincide." });
      return;
    }

    setIsChangingPassword(true);
    try {
      await clientApiFetch<ApiEnvelope<{ changed: boolean }>>("/api/auth/account/password", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          current_password: passwordForm.current_password,
          new_password: passwordForm.new_password,
        }),
      });

      setPasswordForm({
        current_password: "",
        new_password: "",
        confirm_password: "",
      });

      notify.success({
        title: "Contraseña cambiada",
        description: "Tu contraseña se actualizó correctamente.",
      });
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "No se pudo cambiar la contraseña";
      notify.error({ title: "Error al actualizar la contraseña", description: message });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const deleteAccount = async () => {
    if (!deletePassword) {
      notify.error({ title: "Validación", description: "Ingresa tu contraseña para continuar." });
      return;
    }

    setIsDeletingAccount(true);
    try {
      await clientApiFetch<ApiEnvelope<{ deleted: boolean }>>("/api/auth/account", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: deletePassword }),
      });

      notify.success({
        title: "Cuenta eliminada",
        description: "Tu cuenta ha sido desactivada.",
      });
      setIsDeleteModalOpen(false);
      setDeletePassword("");
      await logout();
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "No se pudo eliminar la cuenta";
      notify.error({ title: "Error al eliminar", description: message });
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const canManageOrganization =
    account?.user.role === "owner" || account?.user.role === "admin";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Configuración de la cuenta</CardTitle>
          <CardDescription>
            Configura tu perfil de usuario, organización, acceso a proveedores de IA y seguridad.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {SETTINGS_TABS.map((tab) => (
              <Button
                key={tab.id}
                variant={activeTab === tab.id ? "default" : "outline"}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            Cargando configuración...
          </CardContent>
        </Card>
      ) : null}

      {!isLoading && activeTab === "profile" ? (
        <Card>
          <CardHeader>
            <CardTitle>Perfil</CardTitle>
            <CardDescription>Actualiza la identidad y el correo de tu cuenta.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={submitProfile}>
              <div className="space-y-2">
                <Label htmlFor="profile_full_name">Nombre completo</Label>
                <Input
                  id="profile_full_name"
                  value={profileForm.full_name}
                  onChange={(event) =>
                    setProfileForm((current) => ({ ...current, full_name: event.target.value }))
                  }
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="profile_email">Correo electrónico</Label>
                <Input
                  id="profile_email"
                  type="email"
                  value={profileForm.email}
                  onChange={(event) =>
                    setProfileForm((current) => ({ ...current, email: event.target.value }))
                  }
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>Rol</Label>
                <Input value={account?.user.role || "viewer"} readOnly />
              </div>

              <div className="space-y-2">
                <Label>Organización</Label>
                <Input value={account?.organization.name || "-"} readOnly />
              </div>

              <div className="sm:col-span-2">
                <Button type="submit" disabled={isSavingProfile}>
                  {isSavingProfile ? "Guardando..." : "Guardar perfil"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {!isLoading && activeTab === "organization" ? (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Plan y suscripción</CardTitle>
              <CardDescription>
                Tu plan actual y sus límites de transacciones. La gestión de facturación
                aún no está disponible dentro de la app.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-6 text-sm">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Plan
                </p>
                <Badge variant="outline" className="uppercase">
                  {account?.organization.plan ?? "free"}
                </Badge>
              </div>
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Estado
                </p>
                <Badge
                  variant={
                    account?.organization.subscription_status === "active"
                      ? "success"
                      : "outline"
                  }
                >
                  {account?.organization.subscription_status ?? "active"}
                </Badge>
              </div>
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Transacciones mensuales
                </p>
                <p className="font-medium">
                  {account?.organization.plan === "free"
                    ? "Hasta 200 / mes"
                    : "Ilimitadas"}
                </p>
              </div>
              {account?.organization.plan === "enterprise" ? (
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Acceso a API
                  </p>
                  <p className="font-medium">Habilitado</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Organización</CardTitle>
              <CardDescription>
                Actualiza los datos de la organización usados en todo tu tenant.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-4 sm:grid-cols-2" onSubmit={submitOrganization}>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="org_name">Nombre de la organización</Label>
                  <Input
                    id="org_name"
                    value={organizationForm.name}
                    onChange={(event) =>
                      setOrganizationForm((current) => ({ ...current, name: event.target.value }))
                    }
                    disabled={!canManageOrganization}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="org_currency">Moneda</Label>
                  <select
                    id="org_currency"
                    className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                    value={organizationForm.currency}
                    onChange={(event) =>
                      setOrganizationForm((current) => ({
                        ...current,
                        currency: event.target.value,
                      }))
                    }
                    disabled={!canManageOrganization}
                  >
                    {CURRENCY_OPTIONS.map((currency) => (
                      <option key={currency} value={currency}>
                        {currency}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="org_timezone">Zona horaria</Label>
                  <select
                    id="org_timezone"
                    className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                    value={organizationForm.timezone}
                    onChange={(event) =>
                      setOrganizationForm((current) => ({
                        ...current,
                        timezone: event.target.value,
                      }))
                    }
                    disabled={!canManageOrganization}
                  >
                    {TIMEZONE_OPTIONS.map((timezone) => (
                      <option key={timezone} value={timezone}>
                        {timezone}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <Button type="submit" disabled={isSavingOrganization || !canManageOrganization}>
                    {isSavingOrganization ? "Guardando..." : "Guardar organización"}
                  </Button>
                </div>

              {!canManageOrganization ? (
                <p className="text-sm text-muted-foreground sm:col-span-2">
                  Solo el propietario/administrador puede actualizar la configuración de la organización.
                </p>
              ) : null}
            </form>
          </CardContent>
        </Card>

          <Card>
            <CardHeader>
              <CardTitle>Logo de la organización</CardTitle>
              <CardDescription>Sube PNG, JPG, WEBP o SVG.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {account?.organization.logo_url ? (
                <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={account.organization.logo_url}
                    alt="Logo de la organización"
                    className="max-h-24 w-auto rounded-md"
                  />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Aún no se ha subido ningún logo.</p>
              )}

              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="space-y-2">
                  <Label htmlFor="org_logo">Archivo de logo</Label>
                  <Input
                    id="org_logo"
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml"
                    disabled={!canManageOrganization}
                    onChange={(event) => {
                      const file = event.target.files?.[0] || null;
                      setLogoFile(file);
                    }}
                  />
                </div>

                <Button
                  onClick={uploadOrganizationLogo}
                  disabled={isUploadingLogo || !logoFile || !canManageOrganization}
                >
                  {isUploadingLogo ? "Subiendo..." : "Subir logo"}
                </Button>
              </div>

              {!canManageOrganization ? (
                <p className="text-sm text-muted-foreground">
                  Solo el propietario/administrador puede subir el logo de la organización.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {!isLoading && activeTab === "ai" ? (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Claves de proveedores de IA</CardTitle>
              <CardDescription>
                Administra el proveedor, el modelo, las pruebas y el uso desde la página dedicada de configuración de IA.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
                Las claves de API de los proveedores se almacenan cifradas (AES-256) en el servidor y
                nunca se exponen aquí. Configúralas y pruébalas desde la página de configuración
                de IA.
              </div>

              <Button asChild>
                <Link href="/dashboard/settings/ai">Abrir configuración de IA</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Librería de notificaciones</CardTitle>
              <CardDescription>
                Elige el adaptador de notificaciones activo que usa este frontend.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {availableLibraries.map((item) => (
                <Button
                  key={item}
                  variant={library === item ? "default" : "outline"}
                  onClick={() => handleLibraryChange(item)}
                >
                  {item}
                </Button>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {!isLoading && activeTab === "security" ? (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Cambiar contraseña</CardTitle>
              <CardDescription>
                Actualiza tu contraseña de forma segura usando tus credenciales actuales.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-4 sm:grid-cols-2" onSubmit={changePassword}>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="current_password">Contraseña actual</Label>
                  <Input
                    id="current_password"
                    type="password"
                    value={passwordForm.current_password}
                    onChange={(event) =>
                      setPasswordForm((current) => ({
                        ...current,
                        current_password: event.target.value,
                      }))
                    }
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="new_password">Nueva contraseña</Label>
                  <Input
                    id="new_password"
                    type="password"
                    value={passwordForm.new_password}
                    onChange={(event) =>
                      setPasswordForm((current) => ({
                        ...current,
                        new_password: event.target.value,
                      }))
                    }
                    minLength={8}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirm_password">Confirmar nueva contraseña</Label>
                  <Input
                    id="confirm_password"
                    type="password"
                    value={passwordForm.confirm_password}
                    onChange={(event) =>
                      setPasswordForm((current) => ({
                        ...current,
                        confirm_password: event.target.value,
                      }))
                    }
                    minLength={8}
                    required
                  />
                </div>

                <div className="sm:col-span-2">
                  <Button type="submit" disabled={isChangingPassword}>
                    {isChangingPassword ? "Actualizando..." : "Cambiar contraseña"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle>Zona de peligro</CardTitle>
              <CardDescription>
                Elimina tu cuenta de esta organización. Esta acción es irreversible.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button variant="danger" onClick={() => setIsDeleteModalOpen(true)}>
                Eliminar cuenta
              </Button>
              <Button variant="outline" onClick={logout}>
                Cerrar sesión
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Dialog
        open={isDeleteModalOpen}
        onOpenChange={(nextOpen) => {
          if (isDeletingAccount && !nextOpen) {
            return;
          }
          setIsDeleteModalOpen(nextOpen);
          if (!nextOpen) {
            setDeletePassword("");
          }
        }}
      >
        <DialogContent className="max-w-md border-border bg-card text-foreground">
          <DialogHeader>
            <DialogTitle className="text-foreground">¿Eliminar cuenta?</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Esta acción no se puede deshacer. Ingresa tu contraseña para continuar.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="delete_account_password">Contraseña actual</Label>
            <Input
              id="delete_account_password"
              type="password"
              value={deletePassword}
              onChange={(event) => setDeletePassword(event.target.value)}
              placeholder="Ingresa la contraseña actual"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              disabled={isDeletingAccount}
              onClick={() => {
                if (!isDeletingAccount) {
                  setIsDeleteModalOpen(false);
                  setDeletePassword("");
                }
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              disabled={isDeletingAccount}
              onClick={deleteAccount}
            >
              {isDeletingAccount ? "Eliminando..." : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
