import {
  BarChart3,
  CalendarRange,
  Building2,
  Handshake,
  LayoutDashboard,
  Receipt,
  Store,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface DashboardNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const DASHBOARD_NAV_ITEMS: DashboardNavItem[] = [
  {
    href: "/dashboard",
    label: "Overview",
    icon: LayoutDashboard,
  },
  {
    href: "/dashboard/transactions",
    label: "Transactions",
    icon: Wallet,
  },
  {
    href: "/dashboard/invoices",
    label: "Invoices",
    icon: Receipt,
  },
  {
    href: "/dashboard/reports",
    label: "Reports",
    icon: BarChart3,
  },
  {
    href: "/dashboard/planning",
    label: "Planning",
    icon: CalendarRange,
  },
  {
    href: "/dashboard/members",
    label: "Members",
    icon: Users,
  },
  {
    href: "/dashboard/clients",
    label: "Clients",
    icon: Handshake,
  },
  {
    href: "/dashboard/vendors",
    label: "Vendors",
    icon: Store,
  },
  {
    href: "/dashboard/settings",
    label: "Settings",
    icon: Building2,
  },
];

export function pageTitleFromPath(pathname: string) {
  const sorted = [...DASHBOARD_NAV_ITEMS].sort(
    (left, right) => right.href.length - left.href.length
  );

  const match = sorted.find(
    (item) =>
      pathname === item.href ||
      (item.href !== "/dashboard" && pathname.startsWith(item.href))
  );
  return match?.label || "Dashboard";
}
