"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

import { createNotificationApi } from "@/lib/notifications/adapters";
import type {
  NotificationApi,
  NotificationLibrary,
} from "@/lib/notifications/types";

const STORAGE_KEY = "vf_notification_library";
const AVAILABLE_LIBRARIES: NotificationLibrary[] = [
  "sonner",
  "hot-toast",
  "sileo",
  "toastify",
];

interface NotificationContextValue {
  library: NotificationLibrary;
  notify: NotificationApi;
  availableLibraries: NotificationLibrary[];
  setLibrary: (library: NotificationLibrary) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

function normalizeLibrary(value?: string | null): NotificationLibrary {
  if (value && AVAILABLE_LIBRARIES.includes(value as NotificationLibrary)) {
    return value as NotificationLibrary;
  }

  return "sonner";
}

function initialLibrary(): NotificationLibrary {
  if (typeof window !== "undefined") {
    const persisted = window.localStorage.getItem(STORAGE_KEY);
    if (persisted) {
      return normalizeLibrary(persisted);
    }
  }

  return normalizeLibrary(process.env.NEXT_PUBLIC_NOTIFICATION_LIBRARY);
}

export function NotificationProvider({ children }: PropsWithChildren) {
  const [library, setLibraryState] = useState<NotificationLibrary>(() =>
    initialLibrary()
  );

  const setLibrary = useCallback((value: NotificationLibrary) => {
    setLibraryState(value);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, value);
    }
  }, []);

  const notify = useMemo(() => createNotificationApi(library), [library]);

  const value = useMemo(
    () => ({
      library,
      notify,
      setLibrary,
      availableLibraries: AVAILABLE_LIBRARIES,
    }),
    [library, notify, setLibrary]
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotificationContext() {
  const context = useContext(NotificationContext);

  if (!context) {
    throw new Error(
      "useNotificationContext must be used within NotificationProvider"
    );
  }

  return context;
}
