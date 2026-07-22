"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useNotify } from "@/hooks/use-notify";
import { ApiClientError, clientApiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface Msg {
  role: "user" | "assistant";
  content: string;
  tools?: { name: string }[];
}

const SUGERENCIAS = [
  "¿Cómo va mi IVA este mes?",
  "Dame un reporte del cliente Rivi Grand Hotel",
  "¿Qué gastos sin CFDI tengo en junio?",
  "¿Algún proveedor en la lista EFOS?",
];

export default function CopilotPage() {
  const notify = useNotify();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setInput("");
    setBusy(true);
    try {
      const res = await clientApiFetch<{ data: { reply: string; tool_calls?: { name: string }[] } }>(
        "/api/finance/copilot/chat",
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: q, history }) }
      );
      setMessages((prev) => [...prev, { role: "assistant", content: res.data.reply, tools: res.data.tool_calls }]);
    } catch (error) {
      const msg = error instanceof ApiClientError ? error.message : "Error";
      setMessages((prev) => [...prev, { role: "assistant", content: `No pude responder: ${msg}` }]);
      notify.error({ title: "Copiloto", description: msg });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-9rem)] max-w-3xl flex-col">
      <div className="mb-3">
        <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Copiloto</h1>
        <p className="text-sm text-muted-foreground">
          Pregúntale a tus datos. Consulta clientes, facturas, IVA, reportes y más — en lenguaje natural.
        </p>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto rounded-xl border border-border bg-card p-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">642</div>
            <p className="max-w-sm text-sm text-muted-foreground">
              Soy tu copiloto. Consulto tus datos reales — nunca invento cifras. Prueba con:
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGERENCIAS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)}
                  className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-foreground hover:bg-muted">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((m, i) => (
              <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                  m.role === "user"
                    ? "rounded-br-md bg-primary text-primary-foreground"
                    : "rounded-bl-md border border-border bg-muted/40 text-foreground"
                )}>
                  {m.role === "assistant" && m.tools && m.tools.length > 0 ? (
                    <div className="mb-1.5 text-[11px] font-medium text-violet-600">
                      ⚙ consultó: {m.tools.map((t) => t.name).join(" · ")}
                    </div>
                  ) : null}
                  <div className="whitespace-pre-wrap">{m.content}</div>
                </div>
              </div>
            ))}
            {busy ? (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-md border border-border bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
                  Consultando tus datos…
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="mt-3 flex items-center gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Pregunta lo que quieras de tu empresa…"
          className="h-11 flex-1 rounded-xl border border-border bg-card px-4 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          disabled={busy}
        />
        <Button type="submit" disabled={busy || !input.trim()} className="h-11">Enviar</Button>
      </form>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        El copiloto responde solo con tus datos reales. Verifica cifras importantes antes de declarar.
      </p>
    </div>
  );
}
