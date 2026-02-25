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
  google: ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash"],
  qwen: ["qwen-plus", "qwen-turbo", "qwen-max"],
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
    async (nextProvider: AiProviderName) => {
      setIsLoadingConfig(true);
      try {
        const response = await clientApiFetch<ApiEnvelope<AiProviderConfig>>(
          `/api/finance/intelligence/ai-provider?provider=${nextProvider}`
        );

        const config = response.data;
        if (config) {
          setModel(config.model || MODELS_BY_PROVIDER[nextProvider][0]);
          setUseSystemKey(Boolean(config.use_system_key));
          setActive(Boolean(config.active));
          setSavedMaskedKey(config.api_key_masked || null);
          setSystemKeyAvailable(Boolean(config.system_key_available));
        } else {
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
            : "Could not load provider configuration";
        notify.error({ title: "Load failed", description: message });
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
          : "Could not load usage statistics";
      notify.error({ title: "Stats failed", description: message });
    } finally {
      setIsLoadingUsage(false);
    }
  }, [month, notify, year]);

  useEffect(() => {
    loadConfig(provider);
  }, [loadConfig, provider]);

  useEffect(() => {
    loadUsageStats();
  }, [loadUsageStats]);

  const saveConfig = async () => {
    if (!useSystemKey && !apiKey.trim() && !savedMaskedKey) {
      notify.error({
        title: "API key required",
        description: "Provide an organization API key or enable system key mode.",
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
        title: "AI provider saved",
        description: "Configuration stored securely.",
      });
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not save provider config";
      notify.error({
        title: "Save failed",
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
          body: JSON.stringify({ provider }),
        }
      );

      const result = response.data;
      notify.success({
        title: "Connection OK",
        description: `${result.provider} (${result.model}) via ${result.key_source} key.`,
      });

      await loadUsageStats();
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not test AI provider";
      notify.error({
        title: "Connection failed",
        description: message,
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>AI Provider</CardTitle>
          <CardDescription>
            Configure your tenant AI classification provider. Stored keys are encrypted and never returned in plain text.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ai_provider">Provider</Label>
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
              <Label htmlFor="ai_model">Model</Label>
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
            <Label htmlFor="ai_api_key">Organization API key</Label>
            <Input
              id="ai_api_key"
              type="password"
              autoComplete="new-password"
              placeholder="Paste new key to rotate"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              disabled={isLoadingConfig || isSaving || isTesting || useSystemKey}
            />
            <p className="text-xs text-muted-foreground">
              Stored key preview: {savedMaskedKey || "No key stored"}
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
              Use system key instead of organization key
            </label>
            <Badge variant={systemKeyAvailable ? "success" : "outline"}>
              {systemKeyAvailable ? "System key available" : "System key not configured"}
            </Badge>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={active}
                onChange={(event) => setActive(event.target.checked)}
                disabled={isLoadingConfig || isSaving || isTesting}
              />
              Active
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={saveConfig} disabled={isSaving || isTesting || isLoadingConfig}>
              {isSaving ? "Saving..." : "Save Configuration"}
            </Button>
            <Button
              variant="secondary"
              onClick={testConnection}
              disabled={isTesting || isSaving || isLoadingConfig}
            >
              {isTesting ? "Testing..." : "Test Connection"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI Usage This Month</CardTitle>
          <CardDescription>
            Token consumption and estimated spend for {String(month).padStart(2, "0")}/{year}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingUsage ? (
            <p className="text-sm text-muted-foreground">Loading usage statistics...</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Monthly Tokens</p>
                <p className="mt-2 text-2xl font-semibold text-foreground">
                  {usageStats?.monthly_tokens_used?.toLocaleString("en-US") || 0}
                </p>
              </div>
              <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Estimated Cost</p>
                <p className="mt-2 text-2xl font-semibold text-foreground">
                  {formatUsd(usageStats?.estimated_cost_usd || 0)}
                </p>
              </div>
              <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Requests</p>
                <p className="mt-2 text-2xl font-semibold text-foreground">
                  {usageStats?.total_requests?.toLocaleString("en-US") || 0}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
