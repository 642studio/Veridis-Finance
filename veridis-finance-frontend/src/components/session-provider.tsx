"use client";

import { createContext, useContext, useMemo } from "react";

import { canManageOrganization, canWrite, isViewer } from "@/lib/roles";
import type { SessionClaims, UserRole } from "@/types/finance";

interface SessionContextValue {
  session: SessionClaims | null;
  role: UserRole | null;
  canWrite: boolean;
  canManageOrganization: boolean;
  isViewer: boolean;
}

const SessionContext = createContext<SessionContextValue>({
  session: null,
  role: null,
  canWrite: false,
  canManageOrganization: false,
  isViewer: false,
});

export function SessionProvider({
  session,
  children,
}: {
  session: SessionClaims | null;
  children: React.ReactNode;
}) {
  const value = useMemo<SessionContextValue>(() => {
    const role = session?.role ?? null;
    return {
      session,
      role,
      canWrite: canWrite(role),
      canManageOrganization: canManageOrganization(role),
      isViewer: isViewer(role),
    };
  }, [session]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}
