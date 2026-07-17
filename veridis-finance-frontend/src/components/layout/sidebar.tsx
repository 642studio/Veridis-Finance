"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Logo } from "@/components/layout/logo";
import { cn } from "@/lib/utils";
import { NAV_GROUPS } from "@/lib/navigation";
import type { SessionClaims } from "@/types/finance";

interface SidebarProps {
  session: SessionClaims | null;
}

function isItemActive(pathname: string, href: string) {
  return pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
}

export function Sidebar({ session }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 border-r border-border bg-card md:flex md:flex-col">
      <div className="flex h-16 items-center border-b border-border px-5">
        <Link href="/dashboard" aria-label="642 Finance">
          <Logo />
        </Link>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
        {NAV_GROUPS.map((group) => (
          <div key={group.title}>
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {group.title}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = isItemActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    {active ? (
                      <span className="absolute inset-y-1.5 left-0 w-1 rounded-full bg-primary" />
                    ) : null}
                    <Icon className="h-[18px] w-[18px]" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 rounded-lg bg-muted px-3 py-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary">
            {(session?.role ?? "V").slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">642 Studio</p>
            <p className="text-xs capitalize text-muted-foreground">{session?.role ?? "viewer"}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
