"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DASHBOARD_NAV_ITEMS } from "@/lib/navigation";
import type { SessionClaims } from "@/types/finance";

interface SidebarProps {
  session: SessionClaims | null;
}

export function Sidebar({ session }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="hidden h-fit w-64 shrink-0 rounded-2xl border border-border/70 bg-card/90 p-4 shadow-sm backdrop-blur md:block">
      <div className="mb-5">
        <p className="font-heading text-lg font-semibold text-foreground">Veridis Finance</p>
        <p className="text-sm text-muted-foreground">SaaS Control Center</p>
      </div>

      <nav className="space-y-1">
        {DASHBOARD_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-6 rounded-xl bg-muted/60 p-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Current Role</p>
        <div className="mt-2">
          <Badge variant="secondary">{session?.role ?? "viewer"}</Badge>
        </div>
      </div>
    </aside>
  );
}
