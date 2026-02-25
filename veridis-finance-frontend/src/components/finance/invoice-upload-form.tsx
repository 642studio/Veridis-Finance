"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface InvoiceUploadFormProps {
  onUpload: (file: File) => Promise<void>;
}

export function InvoiceUploadForm({ onUpload }: InvoiceUploadFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!file) {
      return;
    }

    setIsSubmitting(true);

    try {
      await onUpload(file);
      setFile(null);
      const input = document.getElementById("invoice_file") as HTMLInputElement | null;
      if (input) {
        input.value = "";
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload CFDI 4.0 XML</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="invoice_file">XML file</Label>
            <Input
              id="invoice_file"
              type="file"
              accept=".xml,application/xml,text/xml"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              required
            />
          </div>

          <Button type="submit" disabled={!file || isSubmitting}>
            {isSubmitting ? "Uploading..." : "Upload invoice"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
