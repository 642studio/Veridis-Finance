"use client";

import { useRef, useState } from "react";

interface CsfData {
  rfc: string;
  name: string;
  fiscal_regime: string;
  zip_code: string;
  cfdi_use: string;
  email: string;
}

const empty: CsfData = { rfc: "", name: "", fiscal_regime: "", zip_code: "", cfdi_use: "G03", email: "" };

export default function SubirCsfPage({ params }: { params: { token: string } }) {
  const [form, setForm] = useState<CsfData>(empty);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"upload" | "confirm" | "done">("upload");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/public/csf/${params.token}/preview`, { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "No se pudo leer la Constancia");
      const d = body.data;
      setForm({
        rfc: d.rfc || "",
        name: d.name || "",
        fiscal_regime: d.fiscal_regime || "",
        zip_code: d.zip_code || "",
        cfdi_use: "G03",
        email: "",
      });
      setStep("confirm");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/public/csf/${params.token}/save`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "No se pudo guardar");
      setStep("done");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const input =
    "w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
        <h1 className="font-heading text-xl font-semibold">Datos fiscales para tu factura</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sube tu Constancia de Situación Fiscal (SAT) y confirma tus datos. Con esto podremos
          emitir tus facturas (CFDI) automáticamente.
        </p>

        {error ? (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : null}

        {step === "upload" ? (
          <div className="mt-6">
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? "Leyendo tu Constancia…" : "Subir Constancia (PDF)"}
            </button>
          </div>
        ) : null}

        {step === "confirm" ? (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              Extrajimos esto de tu Constancia. Revisa que tu <b>razón social</b> esté correcta
              (en MAYÚSCULAS, sin “SA/SAS DE CV”).
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium">RFC</label>
                <input className={input} value={form.rfc} onChange={(e) => setForm({ ...form, rfc: e.target.value.toUpperCase() })} />
              </div>
              <div>
                <label className="text-xs font-medium">Código Postal</label>
                <input className={input} value={form.zip_code} onChange={(e) => setForm({ ...form, zip_code: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium">Razón social</label>
              <input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value.toUpperCase() })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium">Régimen fiscal</label>
                <input className={input} value={form.fiscal_regime} onChange={(e) => setForm({ ...form, fiscal_regime: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium">Uso CFDI</label>
                <input className={input} value={form.cfdi_use} onChange={(e) => setForm({ ...form, cfdi_use: e.target.value.toUpperCase() })} />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium">Email (opcional)</label>
              <input className={input} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <button
              onClick={save}
              disabled={busy || !form.rfc || !form.name || !form.zip_code}
              className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? "Guardando…" : "Confirmar mis datos fiscales"}
            </button>
          </div>
        ) : null}

        {step === "done" ? (
          <div className="mt-6 text-center">
            <div className="text-4xl">✅</div>
            <p className="mt-2 font-semibold">¡Listo!</p>
            <p className="text-sm text-muted-foreground">
              Recibimos tus datos fiscales. Tus próximas facturas se emitirán automáticamente.
            </p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
