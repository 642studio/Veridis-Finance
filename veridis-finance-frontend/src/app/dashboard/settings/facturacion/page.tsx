"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNotify } from "@/hooks/use-notify";
import { ApiClientError, clientApiFetch } from "@/lib/api-client";
import type { ApiEnvelope } from "@/types/finance";

interface CfdiIssuer {
  id: string | null;
  rfc: string;
  legal_name: string;
  fiscal_regime: string;
  zip_code: string;
  pac_provider: "facturama" | "facturapi";
  pac_env: "sandbox" | "production";
  pac_organization_id: string | null;
  has_credentials: boolean;
  is_active: boolean;
}

const REGIMENES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "601", label: "601 · General de Ley Personas Morales" },
  { value: "603", label: "603 · Personas Morales con Fines no Lucrativos" },
  { value: "605", label: "605 · Sueldos y Salarios" },
  { value: "606", label: "606 · Arrendamiento" },
  { value: "612", label: "612 · Personas Físicas con Actividades Empresariales" },
  { value: "621", label: "621 · Incorporación Fiscal" },
  { value: "625", label: "625 · Plataformas Tecnológicas" },
  { value: "626", label: "626 · Régimen Simplificado de Confianza (RESICO)" },
];

export default function FacturacionSettingsPage() {
  const notify = useNotify();

  const [issuer, setIssuer] = useState<CfdiIssuer | null>(null);
  const [rfc, setRfc] = useState("");
  const [legalName, setLegalName] = useState("");
  const [fiscalRegime, setFiscalRegime] = useState("601");
  const [zipCode, setZipCode] = useState("");
  const [pacProvider, setPacProvider] = useState<"facturama" | "facturapi">("facturama");
  const [pacEnv, setPacEnv] = useState<"sandbox" | "production">("sandbox");
  const [pacUsername, setPacUsername] = useState("");
  const [pacPassword, setPacPassword] = useState("");
  const [pacApiKey, setPacApiKey] = useState("");

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const loadIssuer = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await clientApiFetch<ApiEnvelope<CfdiIssuer | null>>(
        "/api/finance/cfdi/issuer"
      );
      const data = response.data;
      setIssuer(data);
      if (data) {
        setRfc(data.rfc || "");
        setLegalName(data.legal_name || "");
        setFiscalRegime(data.fiscal_regime || "601");
        setZipCode(data.zip_code || "");
        setPacProvider(data.pac_provider || "facturama");
        setPacEnv(data.pac_env || "sandbox");
      }
    } catch (error) {
      const message =
        error instanceof ApiClientError
          ? error.message
          : "No se pudo cargar el emisor fiscal";
      notify.error({ title: "Error al cargar", description: message });
    } finally {
      setIsLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    loadIssuer();
  }, [loadIssuer]);

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      const payload: Record<string, unknown> = {
        rfc: rfc.trim().toUpperCase(),
        legal_name: legalName.trim(),
        fiscal_regime: fiscalRegime,
        zip_code: zipCode.trim(),
        pac_provider: pacProvider,
        pac_env: pacEnv,
      };
      // Secrets are write-only: only sent when the user typed a new value.
      if (pacProvider === "facturama") {
        if (pacUsername.trim()) payload.pac_username = pacUsername.trim();
        if (pacPassword.trim()) payload.pac_password = pacPassword.trim();
      } else if (pacApiKey.trim()) {
        payload.pac_api_key = pacApiKey.trim();
      }

      const response = await clientApiFetch<ApiEnvelope<CfdiIssuer>>(
        "/api/finance/cfdi/issuer",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      setIssuer(response.data);
      setPacUsername("");
      setPacPassword("");
      setPacApiKey("");
      notify.success({
        title: "Emisor guardado",
        description: "Tu empresa ya puede timbrar con su propio RFC.",
      });
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "No se pudo guardar el emisor";
      notify.error({ title: "Error al guardar", description: message });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Emisor fiscal (CFDI)</CardTitle>
          <CardDescription>
            Datos fiscales con los que tu organización emite facturas. Las credenciales del PAC
            se guardan cifradas y nunca se muestran de nuevo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando emisor…</p>
          ) : (
            <form className="space-y-4" onSubmit={save}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={issuer?.has_credentials ? "success" : "outline"}>
                  {issuer?.has_credentials
                    ? "Credenciales configuradas"
                    : "Sin credenciales del PAC"}
                </Badge>
                <Badge variant={pacEnv === "production" ? "success" : "outline"}>
                  {pacEnv === "production" ? "Producción (timbrado real)" : "Sandbox (pruebas)"}
                </Badge>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="rfc">RFC emisor</Label>
                  <Input
                    id="rfc"
                    placeholder="ABC010101XY9"
                    value={rfc}
                    onChange={(e) => setRfc(e.target.value.toUpperCase())}
                    required
                    minLength={12}
                    maxLength={13}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="legal_name">Razón social (sin régimen de capital)</Label>
                  <Input
                    id="legal_name"
                    placeholder="MI EMPRESA"
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fiscal_regime">Régimen fiscal</Label>
                  <select
                    id="fiscal_regime"
                    className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                    value={fiscalRegime}
                    onChange={(e) => setFiscalRegime(e.target.value)}
                  >
                    {REGIMENES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="zip_code">Código postal (lugar de expedición)</Label>
                  <Input
                    id="zip_code"
                    placeholder="01000"
                    value={zipCode}
                    onChange={(e) => setZipCode(e.target.value)}
                    required
                    pattern="\d{5}"
                    maxLength={5}
                  />
                </div>
              </div>

              <div className="space-y-4 rounded-xl border border-border/70 bg-muted/30 p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="pac_provider">Proveedor de timbrado (PAC)</Label>
                    <select
                      id="pac_provider"
                      className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                      value={pacProvider}
                      onChange={(e) => setPacProvider(e.target.value as "facturama" | "facturapi")}
                    >
                      <option value="facturama">Facturama</option>
                      <option value="facturapi">Facturapi</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pac_env">Ambiente</Label>
                    <select
                      id="pac_env"
                      className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                      value={pacEnv}
                      onChange={(e) => setPacEnv(e.target.value as "sandbox" | "production")}
                    >
                      <option value="sandbox">Sandbox (pruebas)</option>
                      <option value="production">Producción</option>
                    </select>
                  </div>
                </div>

                {pacProvider === "facturama" ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="pac_username">Usuario Facturama</Label>
                      <Input
                        id="pac_username"
                        autoComplete="off"
                        placeholder={issuer?.has_credentials ? "Escribe para rotar" : "usuario"}
                        value={pacUsername}
                        onChange={(e) => setPacUsername(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pac_password">Contraseña Facturama</Label>
                      <Input
                        id="pac_password"
                        type="password"
                        autoComplete="new-password"
                        placeholder={issuer?.has_credentials ? "Escribe para rotar" : "contraseña"}
                        value={pacPassword}
                        onChange={(e) => setPacPassword(e.target.value)}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="pac_api_key">API key de Facturapi</Label>
                    <Input
                      id="pac_api_key"
                      type="password"
                      autoComplete="new-password"
                      placeholder={issuer?.has_credentials ? "Escribe para rotar" : "sk_..."}
                      value={pacApiKey}
                      onChange={(e) => setPacApiKey(e.target.value)}
                    />
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Si no escribes credenciales nuevas, se conservan las guardadas.
                </p>
              </div>

              <Button type="submit" disabled={isSaving}>
                {isSaving ? "Guardando…" : "Guardar emisor"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
