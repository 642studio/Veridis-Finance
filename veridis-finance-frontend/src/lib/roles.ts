import type { UserRole } from "@/types/finance";

/**
 * UI-side role gating helpers. These mirror the backend RBAC (which is the
 * real authority): the backend authorizes writes for owner/admin/ops and treats
 * viewer as read-only. These helpers just let the UI hide/disable actions the
 * current role cannot perform, so viewers don't see buttons that would 403.
 */

export function canWrite(role: UserRole | undefined | null): boolean {
  return role === "owner" || role === "admin" || role === "ops";
}

export function canManageOrganization(role: UserRole | undefined | null): boolean {
  return role === "owner" || role === "admin";
}

export function isViewer(role: UserRole | undefined | null): boolean {
  return role === "viewer";
}
