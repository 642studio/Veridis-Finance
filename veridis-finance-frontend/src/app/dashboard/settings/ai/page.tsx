"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNotify } from "@/hooks/use-notify";
import { ApiClientError, clientApiFetch } from "@/lib/api-client";
import type {
  AiConnectionTestResult,
  AiProviderConfig,
  AiProviderName,
  AiUsageStats,
  ApiEnvelope,
} from "@/types/finance";

const PROVIDERS: ReadonlyArray<{ value: AiProviderName; label: string }> = [
  { value: "openai", label: "OpenAI" },
  { value: "google", label: "Google" },
  { value: "qwen", label: "Qwen" },
];

const MODELS_BY_PROVIDER: Record<AiProviderName, string[]> = {
  openai: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4o"],
  google: ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-pro"],
  qwen: ["qwen-plus", "qwen-turbo", "qwen-max"],
};

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  google: "Google Gemini",
  qwen: "Qwen",
};

function currentMonthYear() {
  const now = new Date();
  return {
    month: now.getUTCMonth() + 1,
    year: now.getUTCFullYear(),
  };
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(Number(value || 0));
}

export default function DashboardAiSettingsPage() {
  const notify = useNotify();
  const [{ month, year }] = useState(currentMonthYear);

  // Platform-managed state (default product mode: one Veridis key for all).
  const [managedConfig, setManagedConfig] = useState<AiProviderConfig | null>(null);
  const [isManaged, setIsManaged] = useState<boolean | null>(null);

  // Legacy BYOK state (only rendered when the backend runs AI_PROVIDER_MODE=byok).
  const [provider, setProvider] = useState<AiProviderName>("openai");
  const [model, setModel] = useState(MODELS_BY_PROVIDER.openai[0]);
  const [apiKey, setApiKey] = useState("");
  const [useSystemKey, setUseSystemKey] = useState(false);
  const [active, setActive] = useState(true);
  const [savedMaskedKey, setSavedMaskedKey] = useState<string | null>(null);
  const [systemKeyAvailable, setSystemKeyAvailable] = useState(false);

  const [usageStats, setUsageStats] = useState<AiUsageStats | null>(null);

  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isLoadingUsage, setIsLoadingUsage] = useState(true);

  const modelOptions = useMemo(() => MODELS_BY_PROVIDER[provider], [provider]);

  const loadConfig = useCallback(
    async (nextProvider?: AiProviderName) => {
      setIsLoadingConfig(true);
      try {
        const suffix = nextProvider ? `?provider=${nextProvider}` : "";
        const response = await clientApiFetch<ApiEnvelope<AiProviderConfig>>(
          `/api/finance/intelligence/ai-provider${suffix}`
        );

        const config = response.data;

        if (config?.managed) {
          setIsManaged(true);
          setManagedConfig(config);
          return;
        }

        setIsManaged(false);
        if (config) {
          setModel(config.model || MODELS_BY_PROVIDER[nextProvider || "openai"][0]);
          setUseSystemKey(Boolean(config.use_system_key));
          setActive(Boolean(config.active));
          setSavedMaskedKey(config.api_key_masked || null);
          setSystemKeyAvailable(Boolean(config.system_key_available));
        } else if (nextProvider) {
          setModel(MODELS_BY_PROVIDER[nextProvider][0]);
          setUseSystemKey(false);
          setActive(true);
          setSavedMaskedKey(null);
          setSystemKeyAvailable(false);
        }
      } catch (error) {
        const message =
          error instanceof ApiClientError
            ? error.message
            : "No se pudo cargar la configuración de IA";
        notify.error({ title: "Error al cargar", description: message });
      } finally {
        setIsLoadingConfig(false);
      }
    },
    [notify]
  );

  const loadUsageStats = useCallback(async () => {
    setIsLoadingUsage(true);
    try {
      const response = await clientApiFetch<ApiEnvelope<AiUsageStats>>(
        `/api/finance/intelligence/ai-provider/usage?month=${month}&year=${year}`
      );
      setUsageStats(response.data);
    } catch (error) {
      const message =
        error instanceof ApiClientError
          ? error.message
          : "No se pudieron cargar las estadísticas de uso";
      notify.error({ title: "Error de estadísticas", description: message });
    } finally {
      setIsLoadingUsage(false);
    }
  }, [month, notify, year]);

  useEffect(() => {
    // First load without a provider param: the backend tells us whether AI is
    // platform-managed. In legacy BYOK mode, provider changes re-load config.
    if (isManaged === false) {
      loadConfig(provider);
    } else {
      loadConfig();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadConfig, provider, isManaged === false]);

  useEffect(() => {
    loadUsageStats();
  }, [loadUsageStats]);

  const saveConfig = async () => {
    if (!useSystemKey && !apiKey.trim() && !savedMaskedKey) {
      notify.error({
        title: "Falta la API key",
        description: "Proporciona una API key o habilita la key del sistema.",
      });
      return;
    }

    setIsSaving(true);

    try {
      const payload: Record<string, unknown> = {
        provider,
        model,
        use_system_key: useSystemKey,
        active,
      };

      if (apiKey.trim()) {
        payload.api_key = apiKey.trim();
      }

      const response = await clientApiFetch<ApiEnvelope<AiProviderConfig>>(
        "/api/finance/intelligence/ai-provider",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      setSavedMaskedKey(response.data?.api_key_masked || savedMaskedKey);
      setSystemKeyAvailable(Boolean(response.data?.system_key_available));
      setApiKey("");

      notify.success({
        title: "Proveedor de IA guardado",
        description: "Configuración almacenada de forma segura.",
      });
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "No se pudo guardar la configuración";
      notify.error({
        title: "Error al guardar",
        description: message,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const testConnection = async () => {
    setIsTesting(true);
    try {
      const response = await clientApiFetch<ApiEnvelope<AiConnectionTestResult>>(
        "/api/finance/intelligence/ai-provider/test",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(isManaged ? {} : { provider }),
        }
      );

      const result = response.data;
      notify.success({
        title: "Conexión correcta",
        description: `${result.provider} (${result.model}) respondió correctamente.`,
      });

      await loadUsageStats();
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "No se pudo probar la IA";
      notify.error({
        title: "Falló la conexión",
        description: message,
      });
    } finally {
      setIsTesting(false);
    }
  };

  const managedProviderLabel = managedConfig
    ? PROVIDER_LABELS[managedConfig.provider] || managedConfig.provider
    : "";

  return (
    <div className="space-y-6">
      {isManaged === null || isLoadingConfig ? (
        <Card>
          <CardHeader>
            <CardTitle>Inteligencia artificial</CardTitle>
            <CardDescription>Cargando configuración…</CardDescription>
          </CardHeader>
        </Card>
      ) : isManaged ? (
        <Card>
          <CardHeader>
            <CardTitle>Inteligencia artificial incluida</CardTitle>
            <CardDescription>
              La clasificación automática con IA está incluida en tu plan y la administra
              Veridis. No necesitas configurar ninguna API key.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-muted/30 p-4">
              <div className="min-w-0 flex-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Motor</p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {managedProviderLabel}
                  {managedConfig?.model ? ` · ${managedConfig.model}` : ""}
                </p>
              </div>
              <Badge variant={managedConfig?.key_configured ? "success" : "outline"}>
                {managedConfig?.key_configured ? "Activa" : "Pendiente de activación"}
              </Badge>
            </div>

            <p className="text-sm text-muted-foreground">
              {managedConfig?.key_configured
                ? "La IA clasifica tus transacciones automáticamente: no hay nada que configurar."
                : "La clasificación funciona con reglas aprendidas mientras se activa el motor de IA."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Proveedor de IA</CardTitle>
            <CardDescription>
              Configura el proveedor de clasificación de tu organización. Las keys se guardan
              cifradas y nunca se devuelven en texto plano.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ai_provider">Proveedor</Label>
                <select
                  id="ai_provider"
                  className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                  value={provider}
                  onChange={(event) => {
                    const nextProvider = event.target.value as AiProviderName;
                    setProvider(nextProvider);
                    setModel(MODELS_BY_PROVIDER[nextProvider][0]);
                    setApiKey("");
                  }}
                  disabled={isLoadingConfig || isSaving || isTesting}
                >
                  {PROVIDERS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai_model">Modelo</Label>
                <select
                  id="ai_model"
                  className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  disabled={isLoadingConfig || isSaving || isTesting}
                >
                  {modelOptions.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai_api_key">API key de la organización</Label>
              <Input
                id="ai_api_key"
                type="password"
                autoComplete="new-password"
                placeholder="Pega una key nueva para rotarla"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                disabled={isLoadingConfig || isSaving || isTesting || useSystemKey}
              />
              <p className="text-xs text-muted-foreground">
                Key almacenada: {savedMaskedKey || "Sin key guardada"}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-muted/30 p-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={useSystemKey}
                  onChange={(event) => setUseSystemKey(event.target.checked)}
                  disabled={isLoadingConfig || isSaving || isTesting}
                />
                Usar la key del sistema en vez de la de la organización
              </label>
              <Badge variant={systemKeyAvailable ? "success" : "outline"}>
                {systemKeyAvailable ? "Key del sistema disponible" : "Key del sistema no configurada"}
              </Badge>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(event) => setActive(event.target.checked)}
                  disabled={isLoadingConfig || isSaving || isTesting}
                />
                Activo
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={saveConfig} disabled={isSaving || isTesting || isLoadingConfig}>
                {isSaving ? "Guardando…" : "Guardar configuración"}
              </Button>
              <Button
                variant="secondary"
                onClick={testConnection}
                disabled={isTesting || isSaving || isLoadingConfig}
              >
                {isTesting ? "Probando…" : "Probar conexión"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Uso de IA este mes</CardTitle>
          <CardDescription>
            Tokens consumidos y costo estimado de {String(month).padStart(2, "0")}/{year}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingUsage ? (
            <p className="text-sm text-muted-foreground">Cargando estadísticas de uso…</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Tokens del mes</p>
                <p className="mt-2 text-2xl font-semibold text-foreground">
                  {usageStats?.monthly_tokens_used?.toLocaleString("es-MX") || 0}
                </p>
              </div>
              <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Costo estimado</p>
                <p className="mt-2 text-2xl font-semibold text-foreground">
                  {formatUsd(usageStats?.estimated_cost_usd || 0)}
                </p>
              </div>
              <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Solicitudes</p>
                <p className="mt-2 text-2xl font-semibold text-foreground">
                  {usageStats?.total_requests?.toLocaleString("es-MX") || 0}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
