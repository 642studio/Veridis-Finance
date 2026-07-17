"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Circle, Sparkles } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { clientApiFetch } from "@/lib/api-client";
import { onFinanceDataRefresh } from "@/lib/finance-events";
import type { ApiEnvelope } from "@/types/finance";

interface OnboardingSteps {
  fiscal_issuer: boolean;
  crm_connected: boolean;
  accounts_ready: boolean;
  first_transactions: boolean;
  bank_statement_uploaded: boolean;
  invoices_uploaded: boolean;
  team_invited: boolean;
  ai_active: boolean;
}

interface OnboardingStatus {
  steps: OnboardingSteps;
  completed: number;
  total: number;
  done: boolean;
}

const STEP_DEFS: Array<{
  key: keyof OnboardingSteps;
  title: string;
  description: string;
  href: string;
}> = [
  {
    key: "fiscal_issuer",
    title: "Conecta Facturama (emisor fiscal)",
    description: "RFC, régimen y credenciales del PAC para timbrar CFDI.",
    href: "/dashboard/settings/facturacion",
  },
  {
    key: "crm_connected",
    title: "Conecta tu CRM",
    description: "Factura automáticamente cuando cobras en el 642 CRM.",
    href: "/dashboard/cfdi",
  },
  {
    key: "accounts_ready",
    title: "Crea tus cuentas bancarias",
    description: "Bancos, efectivo y tarjetas para organizar tus movimientos.",
    href: "/dashboard/accounts",
  },
  {
    key: "bank_statement_uploaded",
    title: "Sube tu primer estado de cuenta",
    description: "PDF de tu banco — la IA lo lee aunque esté escaneado.",
    href: "/dashboard/transactions",
  },
  {
    key: "first_transactions",
    title: "Registra movimientos",
    description: "Importados o manuales; la IA los clasifica sola.",
    href: "/dashboard/transactions",
  },
  {
    key: "invoices_uploaded",
    title: "Sube tus facturas recibidas (XML)",
    description: "Alimenta la conciliación y el IVA por proveedor (DIOT).",
    href: "/dashboard/invoices",
  },
  {
    key: "team_invited",
    title: "Invita a tu equipo",
    description: "Roles de administración, operación y solo lectura.",
    href: "/dashboard/members",
  },
];

export function OnboardingChecklist() {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);

  const load = async () => {
    try {
      const response = await clientApiFetch<ApiEnvelope<OnboardingStatus>>(
        "/api/finance/onboarding"
      );
      setStatus(response.data);
    } catch {
      setStatus(null);
    }
  };

  useEffect(() => {
    void load();
    return onFinanceDataRefresh(() => {
      void load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!status || status.done) {
    return null;
  }

  const percent = Math.round((status.completed / status.total) * 100);

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Primeros pasos</CardTitle>
            <CardDescription>
              Configura tu operación completa — {status.completed} de {status.total} listos.
            </CardDescription>
          </div>
          {status.steps.ai_active ? (
            <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              IA activa en tu plan
            </span>
          ) : null}
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 lg:grid-cols-2">
          {STEP_DEFS.map((step) => {
            const isDone = status.steps[step.key];
            return (
              <Link
                key={step.key}
                href={step.href}
                className={`group flex items-start gap-3 rounded-xl border p-3 transition-colors ${
                  isDone
                    ? "border-border/60 bg-muted/30 opacity-70"
                    : "border-border hover:border-primary/50 hover:bg-primary/5"
                }`}
              >
                {isDone ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                ) : (
                  <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-sm font-medium ${
                      isDone ? "text-muted-foreground line-through" : "text-foreground"
                    }`}
                  >
                    {step.title}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {step.description}
                  </span>
                </span>
                {!isDone ? (
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                ) : null}
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
