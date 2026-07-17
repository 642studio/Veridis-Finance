"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, LogOut, Search } from "lucide-react";

import { Logo } from "@/components/layout/logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { cn } from "@/lib/utils";
import { DASHBOARD_NAV_ITEMS } from "@/lib/navigation";
import type { SessionClaims } from "@/types/finance";
import { useNotify } from "@/hooks/use-notify";

interface NavbarProps {
  session: SessionClaims | null;
}

export function Navbar({ session }: NavbarProps) {
  const notify = useNotify();
  const router = useRouter();
  const pathname = usePathname();

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      notify.info({ title: "Sesión cerrada", description: "Cerraste sesión correctamente." });
      router.replace("/login");
    } catch {
      notify.error("No se pudo cerrar sesión");
    }
  };

  const initial = (session?.role ?? "V").slice(0, 1).toUpperCase();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
        {/* Mobile brand (sidebar hidden on small screens) */}
        <Link href="/dashboard" className="md:hidden" aria-label="642 Finance">
          <Logo markOnly />
        </Link>

        {/* Command search */}
        <div className="relative hidden max-w-md flex-1 sm:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar o escribe un comando…"
            className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-14 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            ⌘K
          </kbd>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <button
            type="button"
            aria-label="Notificaciones"
            className="relative grid h-9 w-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
          >
            <Bell className="h-4 w-4" />
            <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-primary" />
          </button>

          <div className="flex items-center gap-2 rounded-lg border border-border bg-card py-1 pl-1 pr-2">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary">
              {initial}
            </span>
            <span className="hidden text-sm font-medium text-foreground sm:block">Adrián</span>
          </div>

          <button
            type="button"
            onClick={logout}
            aria-label="Cerrar sesión"
            className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Mobile horizontal nav */}
      <div className="overflow-x-auto border-t border-border px-3 py-2 md:hidden">
        <div className="flex min-w-max items-center gap-2">
          {DASHBOARD_NAV_ITEMS.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium",
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </header>
  );
}
