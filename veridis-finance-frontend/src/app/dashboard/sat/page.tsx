"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNotify } from "@/hooks/use-notify";
import { ApiClientError, clientApiFetch } from "@/lib/api-client";
import type { ApiEnvelope } from "@/types/finance";

interface SatCredentials {
  rfc: string;
  legal_name: string | null;
  cert_serial: string | null;
  valid_from: string | null;
  valid_to: string | null;
  expired: boolean | null;
  created_at: string;
  updated_at: string;
}

interface SatRequest {
  id: string;
  sat_request_id: string | null;
  request_type: "issued" | "received";
  download_type: "CFDI" | "Metadata";
  date_from: string;
  date_to: string;
  status: string;
  sat_status_code: string | null;
  sat_message: string | null;
  cfdi_found: number;
  cfdi_imported: number;
  created_at: string;
}

const STATUS_LABELS: Record<string, { label: string; variant: "success" | "outline" | "danger" }> = {
  requested: { label: "Enviando al SAT…", variant: "outline" },
  accepted: { label: "Aceptada por el SAT", variant: "outline" },
  in_progress: { label: "El SAT la está procesando", variant: "outline" },
  ready: { label: "Lista para descargar", variant: "success" },
  downloading: { label: "Descargando…", variant: "outline" },
  completed: { label: "Completada", variant: "success" },
  failed: { label: "Error", variant: "danger" },
};

function fmtDate(value: string | null): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

export default function SatPage() {
  const notify = useNotify();

  const [creds, setCreds] = useState<SatCredentials | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);

  const cerRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");

  const [requests, setRequests] = useState<SatRequest[]>([]);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);

  // Descarga form
  const today = new Date().toISOString().slice(0, 10);
  const [requestType, setRequestType] = useState<"issued" | "received">("received");
  const [downloadType, setDownloadType] = useState<"CFDI" | "Metadata">("Metadata");
  const [dateFrom, setDateFrom] = useState("2023-01-01");
  const [dateTo, setDateTo] = useState(today);

  const loadCreds = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await clientApiFetch<ApiEnvelope<SatCredentials | null>>(
        "/api/finance/sat/credentials"
      );
      setCreds(res.data);
    } catch (error) {
      if (!(error instanceof ApiClientError && error.status === 404)) {
        const message = error instanceof ApiClientError ? error.message : "No se pudo cargar la e.firma";
        notify.error({ title: "Error", description: message });
      }
    } finally {
      setIsLoading(false);
    }
  }, [notify]);

  const loadRequests = useCallback(async () => {
    try {
      const res = await clientApiFetch<ApiEnvelope<SatRequest[]>>("/api/finance/sat/requests");
      setRequests(res.data || []);
    } catch {
      /* silent — table just stays empty */
    }
  }, []);

  useEffect(() => {
    loadCreds();
    loadRequests();
  }, [loadCreds, loadRequests]);

  const uploadEfirma = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cer = cerRef.current?.files?.[0];
    const key = keyRef.current?.files?.[0];
    if (!cer) return notify.error({ title: "Falta el .cer", description: "Sube el archivo .cer de tu e.firma" });
    if (!key) return notify.error({ title: "Falta el .key", description: "Sube el archivo .key de tu e.firma" });
    if (!password) return notify.error({ title: "Falta la contraseña", description: "Escribe la contraseña de tu e.firma" });

    setIsUploading(true);
    try {
      const form = new FormData();
      form.append("cer", cer);
      form.append("key", key);
      form.append("password", password);
      const res = await clientApiFetch<ApiEnvelope<SatCredentials>>("/api/finance/sat/credentials", {
        method: "POST",
        body: form,
      });
      setCreds(res.data);
      setPassword("");
      if (cerRef.current) cerRef.current.value = "";
      if (keyRef.current) keyRef.current.value = "";
      notify.success({
        title: "e.firma validada y guardada",
        description: `RFC ${res.data.rfc} · vigente hasta ${fmtDate(res.data.valid_to)}`,
      });
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : "No se pudo guardar la e.firma";
      notify.error({ title: "e.firma rechazada", description: message });
    } finally {
      setIsUploading(false);
    }
  };

  const removeEfirma = async () => {
    if (!confirm("¿Quitar la e.firma guardada? Tendrás que subirla de nuevo para descargar del SAT.")) return;
    try {
      await clientApiFetch("/api/finance/sat/credentials", { method: "DELETE" });
      setCreds(null);
      notify.success({ title: "e.firma eliminada", description: "Se borró de forma segura." });
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : "No se pudo eliminar";
      notify.error({ title: "Error", description: message });
    }
  };

  const createRequest = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsRequesting(true);
    try {
      const res = await clientApiFetch<ApiEnvelope<SatRequest>>("/api/finance/sat/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          request_type: requestType,
          download_type: downloadType,
          date_from: dateFrom,
          date_to: dateTo,
        }),
      });
      const req = res.data;
      await loadRequests();
      if (req.status === "failed") {
        notify.error({ title: "El SAT rechazó la solicitud", description: req.sat_message || "Revisa el rango de fechas." });
      } else {
        notify.success({
          title: "Solicitud enviada al SAT",
          description: "El SAT la procesa en minutos. Usa «Verificar» para traer las facturas cuando esté lista.",
        });
      }
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : "No se pudo crear la solicitud";
      notify.error({ title: "Error", description: message });
    } finally {
      setIsRequesting(false);
    }
  };

  const checkRequest = async (id: string) => {
    setCheckingId(id);
    try {
      const res = await clientApiFetch<ApiEnvelope<SatRequest>>(`/api/finance/sat/requests/${id}/check`, {
        method: "POST",
      });
      const req = res.data;
      await loadRequests();
      if (req.status === "completed") {
        notify.success({
          title: "Facturas importadas del SAT",
          description: `${req.cfdi_imported} CFDI agregados al libro. Ya puedes conciliarlos.`,
        });
      } else if (req.status === "failed") {
        notify.error({ title: "Solicitud con error", description: req.sat_message || "El SAT reportó un error." });
      } else {
        notify.info?.({ title: "Aún en proceso", description: req.sat_message || "El SAT sigue preparando el paquete. Intenta en unos minutos." });
      }
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : "No se pudo verificar";
      notify.error({ title: "Error", description: message });
    } finally {
      setCheckingId(null);
    }
  };

  // Reimportar: vuelve a bajar los paquetes de una solicitud ya terminada
  // (mismo folio del SAT) y los importa con el importador vigente.
  const reimportRequest = async (id: string) => {
    setCheckingId(id);
    try {
      const res = await clientApiFetch<ApiEnvelope<SatRequest>>(
        `/api/finance/sat/requests/${id}/reimport`,
        { method: "POST" }
      );
      const req = res.data;
      await loadRequests();
      if (req.status === "completed") {
        notify.success({
          title: "Reimportación terminada",
          description: `${req.cfdi_imported} factura(s) entraron al libro.`,
        });
      } else {
        notify.info?.({
          title: "Reimportando…",
          description: req.sat_message || "Bajando paquetes del SAT; se termina solo.",
        });
      }
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : "No se pudo reimportar";
      notify.error({ title: "Error al reimportar", description: message });
    } finally {
      setCheckingId(null);
    }
  };

  // Auto-verificación: el SAT procesa de forma asíncrona. Mientras haya
  // solicitudes en curso, revisamos una cada 45s sin que el usuario le pique.
  useEffect(() => {
    const pending = requests.filter((r) =>
      ["accepted", "in_progress", "downloading"].includes(r.status)
    );
    if (pending.length === 0) return undefined;
    const timer = setInterval(async () => {
      try {
        await clientApiFetch(`/api/finance/sat/requests/${pending[0].id}/check`, { method: "POST" });
        await loadRequests();
      } catch {
        /* silencioso — el usuario puede pulsar «Verificar» manualmente */
      }
    }, 45000);
    return () => clearInterval(timer);
  }, [requests, loadRequests]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Descarga Masiva del SAT (e.firma)</CardTitle>
          <CardDescription>
            Lee <strong>todo</strong> tu historial fiscal directo del SAT: cada CFDI que emitiste y
            recibiste, sin importar qué PAC lo timbró. Es el único método que trae absolutamente todas
            tus facturas. Tu e.firma se guarda <strong>cifrada</strong> y nunca se muestra de nuevo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : creds ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="success">e.firma configurada</Badge>
                <Badge variant={creds.expired ? "danger" : "outline"}>
                  {creds.expired ? "Vencida" : `Vigente hasta ${fmtDate(creds.valid_to)}`}
                </Badge>
              </div>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">RFC</dt>
                  <dd className="font-medium">{creds.rfc}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Razón social</dt>
                  <dd className="font-medium">{creds.legal_name || "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">No. de certificado</dt>
                  <dd className="font-mono text-xs">{creds.cert_serial || "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Vigencia</dt>
                  <dd>{fmtDate(creds.valid_from)} → {fmtDate(creds.valid_to)}</dd>
                </div>
              </dl>
              <Button variant="outline" onClick={removeEfirma}>Quitar e.firma</Button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={uploadEfirma}>
              <p className="rounded-xl border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
                Sube los archivos de tu <strong>e.firma (FIEL)</strong> — no del CSD. Se validan y cifran
                al momento; la contraseña nunca se guarda en texto plano ni se envía a terceros.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="cer">Certificado (.cer)</Label>
                  <Input id="cer" type="file" accept=".cer" ref={cerRef} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="key">Llave privada (.key)</Label>
                  <Input id="key" type="file" accept=".key" ref={keyRef} />
                </div>
              </div>
              <div className="space-y-2 sm:max-w-sm">
                <Label htmlFor="efirma_password">Contraseña de la e.firma</Label>
                <Input
                  id="efirma_password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={isUploading}>
                {isUploading ? "Validando…" : "Guardar e.firma"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {creds && (
        <Card>
          <CardHeader>
            <CardTitle>Descargar facturas del SAT</CardTitle>
            <CardDescription>
              Elige el rango y el tipo. «Metadatos» trae la lista completa (rápido, ideal para conciliar);
              «CFDI» trae los XML completos. El SAT procesa la solicitud en minutos.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={createRequest}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="request_type">Tipo</Label>
                  <select
                    id="request_type"
                    className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                    value={requestType}
                    onChange={(e) => setRequestType(e.target.value as "issued" | "received")}
                  >
                    <option value="received">Recibidas (lo que me facturaron)</option>
                    <option value="issued">Emitidas (lo que yo facturé)</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="download_type">Contenido</Label>
                  <select
                    id="download_type"
                    className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                    value={downloadType}
                    onChange={(e) => setDownloadType(e.target.value as "CFDI" | "Metadata")}
                  >
                    <option value="Metadata">Metadatos (lista para conciliar)</option>
                    <option value="CFDI">CFDI completos (XML)</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="date_from">Desde</Label>
                  <Input id="date_from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="date_to">Hasta</Label>
                  <Input id="date_to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
              </div>
              <Button type="submit" disabled={isRequesting}>
                {isRequesting ? "Enviando al SAT…" : "Solicitar al SAT"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Solicitudes</CardTitle>
          <CardDescription>
            El SAT procesa cada solicitud de forma asíncrona: tarda de <strong>unos minutos hasta
            varias horas</strong> (más entre más grande el rango). Las revisamos <strong>solas cada
            45 s</strong> mientras esta página esté abierta; también puedes pulsar «Verificar». Al
            terminar, las facturas entran al libro automáticamente. Tip: para tu primera prueba usa un
            mes para que baje rápido.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no has hecho solicitudes.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 pr-4">Tipo</th>
                    <th className="py-2 pr-4">Rango</th>
                    <th className="py-2 pr-4">Estado</th>
                    <th className="py-2 pr-4">CFDI</th>
                    <th className="py-2 pr-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((req) => {
                    const status = STATUS_LABELS[req.status] || { label: req.status, variant: "outline" as const };
                    const pending = ["accepted", "in_progress", "requested", "ready", "downloading"].includes(req.status);
                    return (
                      <tr key={req.id} className="border-b border-border/50">
                        <td className="py-2 pr-4">
                          {req.request_type === "received" ? "Recibidas" : "Emitidas"}
                          <span className="ml-1 text-xs text-muted-foreground">({req.download_type})</span>
                        </td>
                        <td className="py-2 pr-4 whitespace-nowrap">{fmtDate(req.date_from)} → {fmtDate(req.date_to)}</td>
                        <td className="py-2 pr-4">
                          <Badge variant={status.variant}>{status.label}</Badge>
                          {req.sat_message && (
                            <p className="mt-1 max-w-xs text-xs text-muted-foreground">{req.sat_message}</p>
                          )}
                        </td>
                        <td className="py-2 pr-4 whitespace-nowrap">
                          {req.status === "completed"
                            ? `${req.cfdi_imported} importados`
                            : req.cfdi_found > 0
                              ? `${req.cfdi_found} encontrados`
                              : "—"}
                        </td>
                        <td className="py-2 pr-4">
                          {pending && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={checkingId === req.id}
                              onClick={() => checkRequest(req.id)}
                            >
                              {checkingId === req.id ? "Verificando…" : "Verificar"}
                            </Button>
                          )}
                          {req.status === "completed" && req.sat_request_id && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={checkingId === req.id}
                              onClick={() => reimportRequest(req.id)}
                            >
                              {checkingId === req.id ? "Reimportando…" : "Reimportar"}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
