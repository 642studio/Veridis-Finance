"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";

import { clientApiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface NotificationItem {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body?: string | null;
  read_at?: string | null;
  created_at: string;
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await clientApiFetch<{ data: { items: NotificationItem[]; unread_count: number } }>(
        "/api/finance/notifications"
      );
      setItems(res.data.items || []);
      setUnread(res.data.unread_count || 0);
    } catch {
      // silent — the bell just stays empty
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const markAll = async () => {
    try {
      await clientApiFetch("/api/finance/notifications/read-all", { method: "POST" });
      load();
    } catch {
      // ignore
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="Notificaciones"
        onClick={() => setOpen((v) => !v)}
        className="relative grid h-9 w-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-11 z-50 w-80 rounded-xl border border-border bg-card shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="text-sm font-semibold">Notificaciones</p>
            {unread > 0 ? (
              <button type="button" onClick={markAll} className="text-xs font-medium text-primary hover:underline">
                Marcar leídas
              </button>
            ) : null}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                Sin notificaciones. Aquí verás alertas de EFOS, errores de timbrado y sincronización SAT.
              </p>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  className={cn(
                    "border-b border-border px-4 py-3 last:border-0",
                    !n.read_at && "bg-primary/5"
                  )}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={cn(
                        "mt-1.5 h-2 w-2 flex-none rounded-full",
                        n.severity === "critical"
                          ? "bg-red-600"
                          : n.severity === "warning"
                            ? "bg-amber-500"
                            : "bg-muted-foreground/40"
                      )}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{n.title}</p>
                      {n.body ? <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p> : null}
                      <p className="mt-1 text-[11px] text-muted-foreground/70">
                        {new Date(n.created_at).toLocaleString("es-MX")}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
