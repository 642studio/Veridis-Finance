"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNotify } from "@/hooks/use-notify";
import { ApiClientError, clientApiFetch } from "@/lib/api-client";

interface EfosHit {
  rfc: string;
  counterparty_name: string | null;
  source: string;
  situacion: string;
}

/**
 * Monitoreo EFOS (69-B): cruza las contrapartes del tenant contra la lista
 * negra del SAT. Autocontenido — carga sus propios datos.
 */
export function EfosCard({ canWrite }: { canWrite: boolean }) {
  const notify = useNotify();
  const [hits, setHits] = useState<EfosHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [h, s] = await Promise.all([
        clientApiFetch<{ data: EfosHit[] }>("/api/finance/fiscal/efos/hits"),
        clientApiFetch<{ data: { total_rfcs: number; last_refresh: { refreshed_at: string } | null } }>(
          "/api/finance/fiscal/efos/status"
        ),
      ]);
      setHits(h.data || []);
      setLastRefresh(s.data.last_refresh?.refreshed_at || null);
    } catch {
      // la card queda en estado vacío
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setBusy(true);
    try {
      const res = await clientApiFetch<{ data: { rows: number; hits: EfosHit[] } }>(
        "/api/finance/fiscal/efos/refresh",
        { method: "POST" }
      );
      setHits(res.data.hits || []);
      setLastRefresh(new Date().toISOString());
      notify.success({
        title: `Lista 69-B actualizada (${res.data.rows.toLocaleString("es-MX")} RFCs)`,
        description: res.data.hits.length
          ? `⚠️ ${res.data.hits.length} coincidencia(s) con tus contrapartes`
          : "Ninguna de tus contrapartes está en la lista.",
      });
    } catch (error) {
      notify.error({
        title: "No se pudo actualizar EFOS",
        description: error instanceof ApiClientError ? error.message : "Error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={hits.length ? "border-red-300" : undefined}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">
            Monitoreo EFOS (69-B){hits.length ? ` — ⚠️ ${hits.length} coincidencia(s)` : ""}
          </CardTitle>
          <CardDescription>
            Cruza tus clientes y proveedores contra la lista negra del SAT.
            {lastRefresh
              ? ` Última actualización: ${new Date(lastRefresh).toLocaleDateString("es-MX")}.`
              : " Aún no se descarga la lista."}
          </CardDescription>
        </div>
        {canWrite ? (
          <Button size="sm" variant="outline" onClick={refresh} disabled={busy}>
            {busy ? "Verificando…" : "Verificar ahora"}
          </Button>
        ) : null}
      </CardHeader>
      {hits.length ? (
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2">RFC</th>
                  <th className="py-2">Contraparte</th>
                  <th className="py-2">Situación</th>
                  <th className="py-2">Fuente</th>
                </tr>
              </thead>
              <tbody>
                {hits.map((h) => (
                  <tr key={`${h.rfc}-${h.source}`} className="border-t border-border">
                    <td className="py-2 font-mono text-xs">{h.rfc}</td>
                    <td className="py-2">{h.counterparty_name || "—"}</td>
                    <td className="py-2">
                      <Badge
                        className={
                          /definitivo/i.test(h.situacion)
                            ? "bg-red-100 text-red-700"
                            : "bg-amber-100 text-amber-700"
                        }
                      >
                        {h.situacion}
                      </Badge>
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">{h.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}
