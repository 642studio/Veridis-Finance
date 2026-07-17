"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useNotify } from "@/hooks/use-notify";
import { ApiClientError, clientApiFetch } from "@/lib/api-client";
import { formatCurrency, formatDate } from "@/lib/format";
import type { ApiEnvelope } from "@/types/finance";

interface ReconciliationCandidate {
  invoice_id: string;
  uuid_sat: string | null;
  emitter: string;
  receiver: string;
  total: number;
  invoice_date: string;
  match: {
    score: number;
    amountScore: number;
    dateScore: number;
    nameScore: number;
    days_apart: number;
  };
}

interface CandidatesResponse {
  transaction_id: string;
  count: number;
  candidates: ReconciliationCandidate[];
}

interface ReconciliationModalProps {
  open: boolean;
  transactionId: string | null;
  transactionLabel?: string;
  onClose: () => void;
  onReconciled: () => void;
}

function scoreTone(score: number): "success" | "secondary" | "outline" {
  if (score >= 0.8) return "success";
  if (score >= 0.5) return "secondary";
  return "outline";
}

export function ReconciliationModal({
  open,
  transactionId,
  transactionLabel,
  onClose,
  onReconciled,
}: ReconciliationModalProps) {
  const notify = useNotify();
  const [candidates, setCandidates] = useState<ReconciliationCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const loadCandidates = useCallback(async () => {
    if (!transactionId) return;
    setIsLoading(true);
    try {
      const response = await clientApiFetch<ApiEnvelope<CandidatesResponse>>(
        `/api/finance/transactions/${transactionId}/reconciliation-candidates`
      );
      setCandidates(response.data?.candidates ?? []);
    } catch (error) {
      const message =
        error instanceof ApiClientError
          ? error.message
          : "No se pudieron cargar los candidatos";
      notify.error({ title: "Error al buscar coincidencias", description: message });
      setCandidates([]);
    } finally {
      setIsLoading(false);
    }
  }, [notify, transactionId]);

  useEffect(() => {
    if (open && transactionId) {
      void loadCandidates();
    }
  }, [open, transactionId, loadCandidates]);

  const confirm = async (candidate: ReconciliationCandidate) => {
    if (!transactionId) return;
    setConfirmingId(candidate.invoice_id);
    try {
      await clientApiFetch(`/api/finance/transactions/${transactionId}/reconcile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoice_id: candidate.invoice_id }),
      });
      notify.success({
        title: "Conciliado",
        description: "La factura quedó marcada como pagada con este movimiento.",
      });
      onReconciled();
      onClose();
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "No se pudo conciliar";
      notify.error({ title: "Error al conciliar", description: message });
    } finally {
      setConfirmingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Conciliar movimiento bancario</DialogTitle>
          <DialogDescription>
            {transactionLabel
              ? `Facturas pendientes que coinciden con “${transactionLabel}”.`
              : "Facturas pendientes que coinciden con este movimiento."}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="py-6 text-sm text-muted-foreground">Buscando coincidencias…</p>
        ) : candidates.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            No hay facturas pendientes que coincidan en monto (±2%) y fecha (±45 días).
          </p>
        ) : (
          <div className="space-y-3">
            {candidates.map((candidate) => (
              <div
                key={candidate.invoice_id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-muted/30 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {candidate.receiver || candidate.emitter}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatCurrency(candidate.total)} · {formatDate(candidate.invoice_date)}
                    {candidate.match.days_apart > 0
                      ? ` · ${candidate.match.days_apart} día(s) de diferencia`
                      : " · mismo día"}
                  </p>
                  {candidate.uuid_sat ? (
                    <p className="truncate font-mono text-[10px] text-muted-foreground">
                      {candidate.uuid_sat}
                    </p>
                  ) : null}
                </div>
                <Badge variant={scoreTone(candidate.match.score)}>
                  {Math.round(candidate.match.score * 100)}% match
                </Badge>
                <Button
                  size="sm"
                  onClick={() => confirm(candidate)}
                  disabled={confirmingId !== null}
                >
                  {confirmingId === candidate.invoice_id ? "Conciliando…" : "Conciliar"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
