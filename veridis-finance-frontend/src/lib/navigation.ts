import {
  BadgeCheck,
  BookOpen,
  BarChart3,
  BookUser,
  CalendarRange,
  CloudDownload,
  FileText,
  Building2,
  Gauge,
  Landmark,
  LayoutDashboard,
  Receipt,
  Sparkles,
  Store,
  Users,
  UserSquare2,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface DashboardNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface DashboardNavGroup {
  title: string;
  items: DashboardNavItem[];
}

export const NAV_GROUPS: DashboardNavGroup[] = [
  {
    title: "Operación",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/dashboard/transactions", label: "Movimientos", icon: Wallet },
      { href: "/dashboard/accounts", label: "Cuentas", icon: Landmark },
      { href: "/dashboard/reports", label: "Reportes", icon: BarChart3 },
      { href: "/dashboard/planning", label: "Planeación", icon: CalendarRange },
    ],
  },
  {
    title: "Fiscal",
    items: [
      { href: "/dashboard/escritorio", label: "Escritorio fiscal", icon: Gauge },
      { href: "/dashboard/cfdi", label: "CFDI", icon: FileText },
      { href: "/dashboard/invoices", label: "Facturas", icon: Receipt },
      { href: "/dashboard/impuestos", label: "Impuestos", icon: Landmark },
      { href: "/dashboard/contabilidad", label: "Contabilidad", icon: BookOpen },
      { href: "/dashboard/nomina", label: "Nómina", icon: Users },
      { href: "/dashboard/sat", label: "Descarga SAT", icon: CloudDownload },
    ],
  },
  {
    title: "Directorio",
    items: [
      { href: "/dashboard/clients", label: "Clientes", icon: UserSquare2 },
      { href: "/dashboard/vendors", label: "Proveedores", icon: Store },
      { href: "/dashboard/contacts", label: "Contactos", icon: BookUser },
      { href: "/dashboard/members", label: "Equipo", icon: Users },
      { href: "/dashboard/categories", label: "Categorías", icon: BadgeCheck },
    ],
  },
  {
    title: "Configuración",
    items: [
      { href: "/dashboard/settings", label: "Configuración", icon: Building2 },
      { href: "/dashboard/settings/facturacion", label: "Emisor fiscal", icon: FileText },
      { href: "/dashboard/settings/ai", label: "Asistente IA", icon: Sparkles },
    ],
  },
];

// Flat list (used by the mobile nav and title resolver).
export const DASHBOARD_NAV_ITEMS: DashboardNavItem[] = NAV_GROUPS.flatMap(
  (group) => group.items
);

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
