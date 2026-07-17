"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface InvoiceUploadFormProps {
  /** Receives every selected XML (1..50); bulk uploads happen in one request. */
  onUpload: (files: File[]) => Promise<void>;
}

export function InvoiceUploadForm({ onUpload }: InvoiceUploadFormProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (files.length === 0) return;

    setIsSubmitting(true);
    try {
      await onUpload(files);
      setFiles([]);
      const input = document.getElementById("invoice_file") as HTMLInputElement | null;
      if (input) input.value = "";
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Subir CFDI (XML)</CardTitle>
        <CardDescription>
          Selecciona uno o varios XML (hasta 50) — ideal para importar tu histórico
          descargado del SAT. Los duplicados se omiten automáticamente.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="invoice_file">Archivos XML</Label>
            <Input
              id="invoice_file"
              type="file"
              accept=".xml,application/xml,text/xml"
              multiple
              onChange={(event) =>
                setFiles(Array.from(event.target.files ?? []).slice(0, 50))
              }
              required
            />
            {files.length > 1 ? (
              <p className="text-xs text-muted-foreground">
                {files.length} archivos seleccionados
              </p>
            ) : null}
          </div>

          <Button type="submit" disabled={files.length === 0 || isSubmitting}>
            {isSubmitting
              ? "Subiendo…"
              : files.length > 1
                ? `Subir ${files.length} facturas`
                : "Subir factura"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
