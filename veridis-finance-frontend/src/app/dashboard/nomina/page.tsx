"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNotify } from "@/hooks/use-notify";
import { ApiClientError, clientApiFetch } from "@/lib/api-client";

interface ConceptRow {
  description: string;
  taxed: string;
  exempt: string;
}

interface DeductionRow {
  description: string;
  amount: string;
}

export default function NominaPage() {
  const notify = useNotify();

  const today = new Date().toISOString().slice(0, 10);
  const [name, setName] = useState("");
  const [rfc, setRfc] = useState("");
  const [curp, setCurp] = useState("");
  const [zip, setZip] = useState("");
  const [nss, setNss] = useState("");
  const [dailySalary, setDailySalary] = useState("");
  const [paymentDate, setPaymentDate] = useState(today);
  const [initialDate, setInitialDate] = useState(today);
  const [finalDate, setFinalDate] = useState(today);
  const [daysPaid, setDaysPaid] = useState("15");
  const [perceptions, setPerceptions] = useState<ConceptRow[]>([
    { description: "Sueldo quincenal", taxed: "", exempt: "0" },
  ]);
  const [deductions, setDeductions] = useState<DeductionRow[]>([
    { description: "ISR", amount: "" },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !rfc.trim() || zip.trim().length !== 5) {
      notify.error({
        title: "Faltan datos del empleado",
        description: "Nombre, RFC y código postal (5 dígitos) son obligatorios.",
      });
      return;
    }
    const validPerceptions = perceptions.filter(
      (p) => p.description.trim() && Number.parseFloat(p.taxed || "0") + Number.parseFloat(p.exempt || "0") > 0
    );
    if (!validPerceptions.length) {
      notify.error({
        title: "Faltan percepciones",
        description: "Agrega al menos una percepción con importe.",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await clientApiFetch("/api/finance/cfdi/payroll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          employee: {
            name: name.trim(),
            rfc: rfc.trim().toUpperCase(),
            zip: zip.trim(),
            curp: curp.trim() || undefined,
            socialSecurityNumber: nss.trim() || undefined,
            dailySalary: dailySalary ? Number.parseFloat(dailySalary) : undefined,
          },
          payroll: {
            type: "O",
            paymentDate,
            initialPaymentDate: initialDate,
            finalPaymentDate: finalDate,
            daysPaid: Number.parseFloat(daysPaid) || 15,
          },
          perceptions: validPerceptions.map((p) => ({
            description: p.description.trim(),
            taxedAmount: Number.parseFloat(p.taxed || "0") || 0,
            exemptedAmount: Number.parseFloat(p.exempt || "0") || 0,
          })),
          deductions: deductions
            .filter((d) => d.description.trim() && Number.parseFloat(d.amount || "0") > 0)
            .map((d) => ({
              description: d.description.trim(),
              amount: Number.parseFloat(d.amount || "0") || 0,
            })),
        }),
      });
      notify.success({
        title: "Recibo de nómina timbrado",
        description: `CFDI de nómina emitido para ${name.trim()}. Lo encuentras en la sección CFDI.`,
      });
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "No se pudo timbrar la nómina";
      notify.error({ title: "Error al timbrar nómina", description: message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Nómina (CFDI 1.2)</CardTitle>
          <CardDescription>
            Emite recibos de nómina timbrados ante el SAT vía tu PAC (Facturama). Requiere tu{" "}
            <strong>Emisor fiscal</strong> configurado. El recibo queda en la sección CFDI con su
            PDF/XML.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-6" onSubmit={submit}>
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Empleado</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="emp_name">Nombre completo</Label>
                  <Input id="emp_name" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="emp_rfc">RFC</Label>
                  <Input
                    id="emp_rfc"
                    value={rfc}
                    onChange={(e) => setRfc(e.target.value.toUpperCase())}
                    minLength={12}
                    maxLength={13}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="emp_curp">CURP (opcional)</Label>
                  <Input id="emp_curp" value={curp} onChange={(e) => setCurp(e.target.value.toUpperCase())} maxLength={18} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="emp_zip">Código postal del empleado</Label>
                  <Input id="emp_zip" value={zip} onChange={(e) => setZip(e.target.value)} pattern="\d{5}" maxLength={5} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="emp_nss">NSS (opcional)</Label>
                  <Input id="emp_nss" value={nss} onChange={(e) => setNss(e.target.value)} maxLength={20} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="emp_salary">Salario diario (opcional)</Label>
                  <Input id="emp_salary" type="number" min="0" step="0.01" value={dailySalary} onChange={(e) => setDailySalary(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Periodo</h3>
              <div className="grid gap-4 sm:grid-cols-4">
                <div className="space-y-2">
                  <Label htmlFor="pay_date">Fecha de pago</Label>
                  <Input id="pay_date" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pay_start">Inicio del periodo</Label>
                  <Input id="pay_start" type="date" value={initialDate} onChange={(e) => setInitialDate(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pay_end">Fin del periodo</Label>
                  <Input id="pay_end" type="date" value={finalDate} onChange={(e) => setFinalDate(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pay_days">Días pagados</Label>
                  <Input id="pay_days" type="number" min="1" max="31" value={daysPaid} onChange={(e) => setDaysPaid(e.target.value)} required />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Percepciones</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPerceptions((p) => [...p, { description: "", taxed: "", exempt: "0" }])}
                >
                  + Agregar
                </Button>
              </div>
              {perceptions.map((p, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
                  <Input
                    placeholder="Descripción (ej. Sueldo)"
                    value={p.description}
                    onChange={(e) =>
                      setPerceptions((rows) => rows.map((r, j) => (j === i ? { ...r, description: e.target.value } : r)))
                    }
                  />
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Gravado"
                    value={p.taxed}
                    onChange={(e) =>
                      setPerceptions((rows) => rows.map((r, j) => (j === i ? { ...r, taxed: e.target.value } : r)))
                    }
                  />
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Exento"
                    value={p.exempt}
                    onChange={(e) =>
                      setPerceptions((rows) => rows.map((r, j) => (j === i ? { ...r, exempt: e.target.value } : r)))
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={perceptions.length === 1}
                    onClick={() => setPerceptions((rows) => rows.filter((_, j) => j !== i))}
                  >
                    Quitar
                  </Button>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Deducciones</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDeductions((d) => [...d, { description: "", amount: "" }])}
                >
                  + Agregar
                </Button>
              </div>
              {deductions.map((d, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[3fr_1fr_auto]">
                  <Input
                    placeholder="Descripción (ej. ISR, IMSS)"
                    value={d.description}
                    onChange={(e) =>
                      setDeductions((rows) => rows.map((r, j) => (j === i ? { ...r, description: e.target.value } : r)))
                    }
                  />
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Importe"
                    value={d.amount}
                    onChange={(e) =>
                      setDeductions((rows) => rows.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)))
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeductions((rows) => rows.filter((_, j) => j !== i))}
                  >
                    Quitar
                  </Button>
                </div>
              ))}
            </div>

            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Timbrando…" : "Timbrar recibo de nómina"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
