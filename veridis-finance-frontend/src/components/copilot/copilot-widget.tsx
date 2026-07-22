"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { useNotify } from "@/hooks/use-notify";
import { ApiClientError, clientApiFetch } from "@/lib/api-client";
import { pageTitleFromPath } from "@/lib/navigation";
import { cn } from "@/lib/utils";

interface Msg {
  role: "user" | "assistant";
  content: string;
  tools?: { name: string }[];
}

interface PendingAction {
  tool: string;
  input: Record<string, unknown>;
  resumen: string;
}

const SUGERENCIAS = [
  "¿Cómo va mi IVA este mes?",
  "¿Algo urgente o algún riesgo fiscal?",
  "¿Qué gastos sin CFDI tengo?",
];

export function CopilotWidget() {
  const notify = useNotify();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, open]);

  // No mostrar el widget en la página dedicada del copiloto (evita chat doble).
  if (pathname === "/dashboard/copilot") return null;

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setInput("");
    setBusy(true);
    try {
      const res = await clientApiFetch<{ data: { reply: string; tool_calls?: { name: string }[]; pending_action?: PendingAction } }>(
        "/api/finance/copilot/chat",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: q, history, context: pageTitleFromPath(pathname || "") }),
        }
      );
      setMessages((prev) => [...prev, { role: "assistant", content: res.data.reply, tools: res.data.tool_calls }]);
      setPending(res.data.pending_action || null);
    } catch (error) {
      const msg = error instanceof ApiClientError ? error.message : "Error";
      setMessages((prev) => [...prev, { role: "assistant", content: `No pude responder: ${msg}` }]);
      notify.error({ title: "Copiloto", description: msg });
    } finally {
      setBusy(false);
    }
  };

  const runPending = async () => {
    if (!pending || busy) return;
    const action = pending;
    setPending(null);
    setBusy(true);
    try {
      const res = await clientApiFetch<{ data: { reply: string } }>("/api/finance/copilot/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tool: action.tool, input: action.input }),
      });
      setMessages((prev) => [...prev, { role: "assistant", content: res.data.reply }]);
    } catch (error) {
      const msg = error instanceof ApiClientError ? error.message : "Error";
      setMessages((prev) => [...prev, { role: "assistant", content: `❌ No se pudo ejecutar: ${msg}` }]);
    } finally {
      setBusy(false);
    }
  };

  const cancelPending = () => {
    setPending(null);
    setMessages((prev) => [...prev, { role: "assistant", content: "Acción cancelada. No ejecuté nada." }]);
  };

  return (
    <>
      {/* Botón flotante */}
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir copiloto"
          className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <SparkleIcon />
        </button>
      ) : null}

      {/* Panel lateral */}
      <div
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col border-l border-border bg-card shadow-2xl transition-transform duration-300",
          open ? "translate-x-0" : "pointer-events-none translate-x-full"
        )}
        role="dialog"
        aria-hidden={!open}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-[11px] font-bold text-primary-foreground">642</div>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-none">Copiloto</p>
            <p className="truncate text-[11px] text-muted-foreground">{pageTitleFromPath(pathname || "")}</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Cerrar"
            className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <CloseIcon />
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <p className="max-w-[16rem] text-sm text-muted-foreground">
                Pregúntame lo que quieras de tu empresa. Consulto tus datos reales.
              </p>
              <div className="flex flex-col gap-2">
                {SUGERENCIAS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="rounded-lg border border-border bg-surface px-3 py-2 text-left text-xs text-foreground hover:bg-muted"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((m, i) => (
                <Fragment key={i}>
                  <div className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[88%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                        m.role === "user"
                          ? "rounded-br-md bg-primary text-primary-foreground"
                          : "rounded-bl-md border border-border bg-muted/40 text-foreground"
                      )}
                    >
                      {m.role === "assistant" && m.tools && m.tools.length > 0 ? (
                        <div className="mb-1 text-[10.5px] font-medium text-violet-600">
                          ⚙ {m.tools.map((t) => t.name).join(" · ")}
                        </div>
                      ) : null}
                      <div className="whitespace-pre-wrap break-words">{m.content}</div>
                    </div>
                  </div>
                </Fragment>
              ))}
              {busy ? (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-md border border-border bg-muted/40 px-3.5 py-2 text-sm text-muted-foreground">
                    Consultando tus datos…
                  </div>
                </div>
              ) : null}
              {pending ? (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Acción pendiente de tu confirmación</p>
                  <p className="mt-1 text-sm text-amber-900">{pending.resumen}</p>
                  <div className="mt-2.5 flex gap-2">
                    <button type="button" onClick={runPending}
                      className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
                      Confirmar y ejecutar
                    </button>
                    <button type="button" onClick={cancelPending}
                      className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground">
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); send(input); }}
          className="flex items-center gap-2 border-t border-border p-3"
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pregunta lo que sea…"
            disabled={busy}
            className="h-10 flex-1 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground disabled:opacity-50"
            aria-label="Enviar"
          >
            <SendIcon />
          </button>
        </form>
      </div>
    </>
  );
}

function SparkleIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" />
      <path d="M19 14l.7 1.7 1.8.7-1.8.7L19 19l-.7-1.9-1.8-.7 1.8-.7z" />
    </svg>
  );
}
function CloseIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>;
}
function SendIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" /></svg>;
}
