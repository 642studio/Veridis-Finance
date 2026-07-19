"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useNotify } from "@/hooks/use-notify";
import { clientApiFetch } from "@/lib/api-client";
import { formatDate } from "@/lib/format";

interface EvidenceItem {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  note?: string | null;
  created_at: string;
}

interface EvidenceDialogProps {
  cfdiId: string | null;
  cfdiLabel?: string | null;
  canWrite: boolean;
  onClose: () => void;
}

/**
 * Materialidad (CFF 49 Bis): adjunta contratos, entregables o correos que
 * comprueben la operación de un CFDI. Autocontenido — carga y sube solo.
 */
export function EvidenceDialog({ cfdiId, cfdiLabel, canWrite, onClose }: EvidenceDialogProps) {
  const notify = useNotify();
  const [items, setItems] = useState<EvidenceItem[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!cfdiId) return;
    try {
      const res = await clientApiFetch<{ data: EvidenceItem[] }>(
        `/api/finance/fiscal/cfdi/${cfdiId}/evidence`
      );
      setItems(res.data || []);
    } catch {
      setItems([]);
    }
  }, [cfdiId]);

  useEffect(() => {
    setItems([]);
    load();
  }, [load]);

  const upload = async (file: File) => {
    if (!cfdiId) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/finance/fiscal/cfdi/${cfdiId}/evidence`, {
        method: "POST",
        body: fd,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "No se pudo subir");
      notify.success({ title: "Evidencia adjuntada" });
      load();
    } catch (error) {
      notify.error({ title: "Error al subir evidencia", description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (evidenceId: string) => {
    if (!cfdiId) return;
    try {
      await clientApiFetch(`/api/finance/fiscal/cfdi/${cfdiId}/evidence/${evidenceId}`, {
        method: "DELETE",
      });
      setItems((prev) => prev.filter((e) => e.id !== evidenceId));
    } catch {
      notify.error({ title: "No se pudo borrar la evidencia" });
    }
  };

  return (
    <Dialog open={Boolean(cfdiId)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Evidencia de materialidad</DialogTitle>
          <DialogDescription>
            {cfdiLabel ? `CFDI ${cfdiLabel} — ` : ""}adjunta contratos, entregables o correos que
            comprueben la operación (art. 49 Bis CFF).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = "";
            }}
          />
          {canWrite ? (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              {busy ? "Subiendo…" : "Adjuntar archivo (máx. 5MB)"}
            </Button>
          ) : null}
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin evidencia adjunta todavía.</p>
          ) : (
            <div className="space-y-2">
              {items.map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    <a
                      className="block truncate text-sm font-medium text-primary hover:underline"
                      href={`/api/finance/fiscal/cfdi/${cfdiId}/evidence/${ev.id}`}
                    >
                      {ev.filename}
                    </a>
                    <p className="text-xs text-muted-foreground">
                      {(ev.size_bytes / 1024).toFixed(0)} KB · {formatDate(ev.created_at)}
                    </p>
                  </div>
                  {canWrite ? (
                    <button
                      type="button"
                      className="text-xs text-red-600 hover:underline"
                      onClick={() => remove(ev.id)}
                    >
                      Borrar
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
