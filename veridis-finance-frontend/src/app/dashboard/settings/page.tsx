"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

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
  { id: "profile", label: "Profile" },
  { id: "organization", label: "Organization" },
  { id: "ai", label: "AI Keys" },
  { id: "security", label: "Security" },
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
        error instanceof ApiClientError ? error.message : "Could not load account settings";
      notify.error({ title: "Load failed", description: message });
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
      title: "Notification library changed",
      description: `Active provider: ${value}`,
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
      notify.error({ title: "Validation", description: "Full name is required." });
      return;
    }

    if (!profileForm.email.trim()) {
      notify.error({ title: "Validation", description: "Email is required." });
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
        title: "Profile updated",
        description: "Your account profile was updated.",
      });
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not update profile";
      notify.error({ title: "Update failed", description: message });
    } finally {
      setIsSavingProfile(false);
    }
  };

  const submitOrganization = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!organizationForm.name.trim()) {
      notify.error({ title: "Validation", description: "Organization name is required." });
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
        title: "Organization updated",
        description: "Organization configuration saved.",
      });
    } catch (error) {
      const message =
        error instanceof ApiClientError
          ? error.message
          : "Could not update organization settings";
      notify.error({ title: "Update failed", description: message });
    } finally {
      setIsSavingOrganization(false);
    }
  };

  const uploadOrganizationLogo = async () => {
    if (!logoFile) {
      notify.error({ title: "Validation", description: "Select a logo file first." });
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
        title: "Logo updated",
        description: "Organization logo uploaded successfully.",
      });
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not upload logo";
      notify.error({ title: "Upload failed", description: message });
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const changePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!passwordForm.current_password || !passwordForm.new_password) {
      notify.error({ title: "Validation", description: "All password fields are required." });
      return;
    }

    if (passwordForm.new_password.length < 8) {
      notify.error({
        title: "Validation",
        description: "New password must be at least 8 characters.",
      });
      return;
    }

    if (passwordForm.new_password !== passwordForm.confirm_password) {
      notify.error({ title: "Validation", description: "Password confirmation does not match." });
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
        title: "Password changed",
        description: "Your password was updated successfully.",
      });
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not change password";
      notify.error({ title: "Password update failed", description: message });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const deleteAccount = async () => {
    if (!deletePassword) {
      notify.error({ title: "Validation", description: "Enter your password to continue." });
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
        title: "Account deleted",
        description: "Your account has been deactivated.",
      });
      setIsDeleteModalOpen(false);
      setDeletePassword("");
      await logout();
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not delete account";
      notify.error({ title: "Delete failed", description: message });
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const maskedOrganizationKeyPreview = useMemo(() => {
    const name = account?.organization.name || "Organization";
    return `${name.slice(0, 1).toUpperCase()}***`;
  }, [account?.organization.name]);
  const canManageOrganization =
    account?.user.role === "owner" || account?.user.role === "admin";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Account Settings</CardTitle>
          <CardDescription>
            Configure your user profile, organization, AI provider access, and security.
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
            Loading settings...
          </CardContent>
        </Card>
      ) : null}

      {!isLoading && activeTab === "profile" ? (
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Update your account identity and email.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={submitProfile}>
              <div className="space-y-2">
                <Label htmlFor="profile_full_name">Full Name</Label>
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
                <Label htmlFor="profile_email">Email</Label>
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
                <Label>Role</Label>
                <Input value={account?.user.role || "viewer"} readOnly />
              </div>

              <div className="space-y-2">
                <Label>Organization</Label>
                <Input value={account?.organization.name || "-"} readOnly />
              </div>

              <div className="sm:col-span-2">
                <Button type="submit" disabled={isSavingProfile}>
                  {isSavingProfile ? "Saving..." : "Save profile"}
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
              <CardTitle>Organization</CardTitle>
              <CardDescription>
                Update org details used across your tenant.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-4 sm:grid-cols-2" onSubmit={submitOrganization}>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="org_name">Organization Name</Label>
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
                  <Label htmlFor="org_currency">Currency</Label>
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
                  <Label htmlFor="org_timezone">Timezone</Label>
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
                    {isSavingOrganization ? "Saving..." : "Save organization"}
                  </Button>
                </div>

              {!canManageOrganization ? (
                <p className="text-sm text-muted-foreground sm:col-span-2">
                  Only owner/admin can update organization settings.
                </p>
              ) : null}
            </form>
          </CardContent>
        </Card>

          <Card>
            <CardHeader>
              <CardTitle>Organization Logo</CardTitle>
              <CardDescription>Upload PNG, JPG, WEBP or SVG.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {account?.organization.logo_url ? (
                <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={account.organization.logo_url}
                    alt="Organization logo"
                    className="max-h-24 w-auto rounded-md"
                  />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No logo uploaded yet.</p>
              )}

              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="space-y-2">
                  <Label htmlFor="org_logo">Logo file</Label>
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
                  {isUploadingLogo ? "Uploading..." : "Upload logo"}
                </Button>
              </div>

              {!canManageOrganization ? (
                <p className="text-sm text-muted-foreground">
                  Only owner/admin can upload organization logo.
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
              <CardTitle>AI Provider Keys</CardTitle>
              <CardDescription>
                Manage provider, model, testing and usage from the dedicated AI settings page.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
                Organization key preview: {maskedOrganizationKeyPreview}
              </div>

              <Button asChild>
                <Link href="/dashboard/settings/ai">Open AI settings</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notification Library</CardTitle>
              <CardDescription>
                Pick the active toast adapter used by this frontend.
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
              <CardTitle>Change Password</CardTitle>
              <CardDescription>
                Update your password securely using your current credentials.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-4 sm:grid-cols-2" onSubmit={changePassword}>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="current_password">Current Password</Label>
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
                  <Label htmlFor="new_password">New Password</Label>
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
                  <Label htmlFor="confirm_password">Confirm New Password</Label>
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
                    {isChangingPassword ? "Updating..." : "Change password"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle>Danger Zone</CardTitle>
              <CardDescription>
                Delete your account from this organization. This action is irreversible.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button variant="danger" onClick={() => setIsDeleteModalOpen(true)}>
                Delete Account
              </Button>
              <Button variant="outline" onClick={logout}>
                Logout
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
        <DialogContent className="max-w-md border-slate-700 bg-slate-950 text-slate-100">
          <DialogHeader>
            <DialogTitle className="text-slate-100">Delete Account?</DialogTitle>
            <DialogDescription className="text-slate-300">
              This action cannot be undone. Enter your password to continue.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="delete_account_password">Current Password</Label>
            <Input
              id="delete_account_password"
              type="password"
              value={deletePassword}
              onChange={(event) => setDeletePassword(event.target.value)}
              placeholder="Enter current password"
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
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={isDeletingAccount}
              onClick={deleteAccount}
            >
              {isDeletingAccount ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
