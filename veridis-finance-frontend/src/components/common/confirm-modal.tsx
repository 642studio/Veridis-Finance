"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ConfirmModalProps {
  open: boolean;
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isLoading?: boolean;
  onCancel: () => void;
  onConfirm: (rememberChoice: boolean) => Promise<void> | void;
  rememberChoiceKey?: string;
  rememberChoiceLabel?: string;
}

export function ConfirmModal({
  open,
  title = "Delete Transaction?",
  description = "This action cannot be undone.",
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  isLoading = false,
  onCancel,
  onConfirm,
  rememberChoiceKey,
  rememberChoiceLabel = "Don't ask again",
}: ConfirmModalProps) {
  const [rememberChoice, setRememberChoice] = useState(false);

  useEffect(() => {
    if (!open) {
      setRememberChoice(false);
    }
  }, [open]);

  const shouldShowRemember = useMemo(() => Boolean(rememberChoiceKey), [rememberChoiceKey]);

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onCancel() : undefined)}>
      <DialogContent className="max-w-md border-slate-700 bg-slate-950 text-slate-100">
        <DialogHeader>
          <DialogTitle className="text-slate-100">{title}</DialogTitle>
          <DialogDescription className="text-slate-300">{description}</DialogDescription>
        </DialogHeader>

        {shouldShowRemember ? (
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={rememberChoice}
              onChange={(event) => setRememberChoice(event.target.checked)}
              disabled={isLoading}
            />
            {rememberChoiceLabel}
          </label>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isLoading}>
            {cancelLabel}
          </Button>
          <Button
            variant="danger"
            onClick={() => onConfirm(rememberChoice)}
            disabled={isLoading}
          >
            {isLoading ? "Deleting..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function getConfirmSkipPreference(key: string | undefined) {
  if (!key || typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(key) === "1";
}

export function setConfirmSkipPreference(key: string | undefined, skip: boolean) {
  if (!key || typeof window === "undefined") {
    return;
  }

  if (skip) {
    window.localStorage.setItem(key, "1");
    return;
  }

  window.localStorage.removeItem(key);
}
