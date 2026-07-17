"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNotify } from "@/hooks/use-notify";
import { clientApiFetch, ApiClientError } from "@/lib/api-client";
import type { ApiEnvelope, AuthResponseData } from "@/types/finance";

interface LoginFormProps {
  nextPath?: string;
}

export function LoginForm({ nextPath = "/dashboard" }: LoginFormProps) {
  const router = useRouter();
  const notify = useNotify();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setIsSubmitting(true);

    try {
      await clientApiFetch<ApiEnvelope<AuthResponseData>>("/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
          organization_slug: organizationSlug,
        }),
      });

      notify.success({
        title: "Bienvenido de nuevo",
        description: "Tu sesión está activa.",
      });
      router.replace(nextPath);
      router.refresh();
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "No se pudo iniciar sesión";
      notify.error({
        title: "Error al iniciar sesión",
        description: message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Iniciar sesión</CardTitle>
        <CardDescription>
          Accede al espacio de tu organización.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="organization_slug">Identificador de organización</Label>
            <Input
              id="organization_slug"
              autoComplete="organization"
              placeholder="mi-empresa"
              value={organizationSlug}
              onChange={(event) => setOrganizationSlug(event.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Correo electrónico</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="dueño@empresa.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
            />
          </div>

          <Button className="w-full" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Entrando..." : "Entrar"}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            ¿Nuevo aquí?{" "}
            <Link className="font-medium text-primary hover:underline" href="/register">
              Crea una cuenta
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
