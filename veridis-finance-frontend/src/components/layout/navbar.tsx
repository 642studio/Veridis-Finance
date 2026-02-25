"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DASHBOARD_NAV_ITEMS, pageTitleFromPath } from "@/lib/navigation";
import type { SessionClaims } from "@/types/finance";
import { useNotify } from "@/hooks/use-notify";

interface NavbarProps {
  session: SessionClaims | null;
}

export function Navbar({ session }: NavbarProps) {
  const notify = useNotify();
  const router = useRouter();
  const pathname = usePathname();
  const title = pageTitleFromPath(pathname);

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
      });
      notify.info({
        title: "Session closed",
        description: "You have been signed out.",
      });
      router.replace("/login");
    } catch {
      notify.error("Could not close session");
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <div>
          <p className="font-heading text-lg font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">
            Org: {session?.organization_id?.slice(0, 8) ?? "unknown"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline">{session?.role ?? "viewer"}</Badge>
          <Button variant="outline" size="sm" onClick={logout}>
            <LogOut className="mr-2 h-4 w-4" />
            Logout
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto border-t border-border/50 px-3 py-2 md:hidden">
        <div className="flex min-w-max items-center gap-2">
          {DASHBOARD_NAV_ITEMS.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground"
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
