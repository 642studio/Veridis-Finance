"use client";

import { useNotificationContext } from "@/components/notification/notification-provider";

export function useNotify() {
  return useNotificationContext().notify;
}

export function useNotificationLibrary() {
  const { library, availableLibraries, setLibrary } = useNotificationContext();

  return {
    library,
    availableLibraries,
    setLibrary,
  };
}
