"use client";

import { Toaster as HotToastToaster } from "react-hot-toast";
import { Toaster as SileoToaster } from "sileo";
import { Toaster as SonnerToaster } from "sonner";
import { ToastContainer } from "react-toastify";

import { NotificationProvider } from "@/components/notification/notification-provider";

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <NotificationProvider>
      {children}

      {/*
        Keep all toaster mounts available.
        Switch active notification adapter via:
        1) NEXT_PUBLIC_NOTIFICATION_LIBRARY in .env
        2) Dashboard settings page selector
      */}
      <SonnerToaster richColors closeButton position="top-right" />
      <HotToastToaster position="top-right" />
      <SileoToaster position="top-right" />
      <ToastContainer position="top-right" newestOnTop closeOnClick />
    </NotificationProvider>
  );
}
