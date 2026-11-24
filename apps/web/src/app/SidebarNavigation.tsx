import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, ShoppingBag, ScanBarcode, Boxes, Truck, Users, Receipt, Wallet, ChartNoAxesCombined, Settings, ShieldCheck, Printer, History, ChevronDown, Zap } from "lucide-react";
import { ar } from "../i18n";

export const nav = [
  {
    path: "/dashboard",
    title: ar.dashboard,
    permission: "dashboard.view",
    icon: LayoutDashboard,
  },
  {
    path: "/quick-access",
    title: "الوصول السريع",
    permission: "quick_access.view",
    icon: Zap,
  },

  {
    path: "/administration",
    title: "الفروع والأجهزة والجلسات",
    permission: ["settings.manage", "users.manage"],
    icon: Settings,
  },
  {
    path: "/inventory/advanced",
    title: "الشحن وحجر المخزون",
    permission: "inventory.view",
    icon: Truck,
  },
  { path: "/pos", title: ar.pos, permission: "pos.access", icon: ScanBarcode },
  {
    path: "/promotions",
    title: "العروض التلقائية",
    permission: "promotions.manage",
    icon: ShoppingBag,
  },
  {
    path: "/discount-approvals",
    title: "موافقات الخصومات",
    permission: ["sales.create", "sales.discount_approve"],
    icon: ShieldCheck,
  },
  {
    path: "/products/barcodes",
    title: "طباعة الباركود",
    permission: "products.view",
    icon: Printer,
  },
  {
    path: "/products",
    title: ar.products,
    permission: "products.view",
    icon: ShoppingBag,
  },
  {
    path: "/inventory",
    title: ar.inventory,
    permission: "inventory.view",
    icon: Boxes,
  },
  {
    path: "/purchases",
    title: ar.purchases,
    permission: ["purchases.view", "purchases.preview"],
    icon: Truck,
  },
  {
    path: "/suppliers",
    title: ar.suppliers,
    permission: "suppliers.manage",
    icon: Truck,
  },
  {
    path: "/sales",
    title: ar.sales,
    permission: "sales.view_own",
    icon: Receipt,
  },
  {
    path: "/customers",
    title: ar.customers,
    permission: "customers.manage",
    icon: Users,
  },
  {
    path: "/expenses",
    title: ar.expenses,
    permission: "expenses.view",
    icon: Wallet,
  },
  {
    path: "/shifts",
    title: ar.shifts,
    permission: "cash.close_shift",
    icon: History,
  },
  {
    path: "/reports",
    title: ar.reports,
    permission: "reports.sales",
    icon: ChartNoAxesCombined,
  },
  { path: "/quarterly-closing", title: "إقفال الأرباح ربع السنوي", permission: "reports.profit", icon: Wallet },
  { path: "/users", title: ar.users, permission: "users.manage", icon: Users },
  {
    path: "/roles",
    title: ar.roles,
    permission: "roles.manage",
    icon: ShieldCheck,
  },
  {
    path: "/settings",
    title: ar.settings,
    permission: "settings.manage",
    icon: Settings,
  },
  {
    path: "/audit-logs",
    title: ar.audit,
    permission: "audit.view",
    icon: ShieldCheck,
  },
];

export const navGroups = [
  {
    id: "selling",
    title: "المبيعات والعملاء",
    icon: Receipt,
    paths: [
      "/pos",
      "/sales",
      "/customers",
      "/promotions",
      "/discount-approvals",
    ],
  },
  {
    id: "stock",
    title: "المنتجات والمخزون",
    icon: Boxes,
    paths: [
      "/products",
      "/products/barcodes",
      "/inventory",
      "/inventory/advanced",
    ],
  },
  {
    id: "buying",
    title: "المشتريات والموردون",
    icon: Truck,
    paths: ["/purchases", "/suppliers"],
  },
  {
    id: "finance",
    title: "المالية والتقارير",
    icon: ChartNoAxesCombined,
    paths: ["/shifts", "/expenses", "/reports", "/quarterly-closing"],
  },
  {
    id: "admin",
    title: "إدارة النظام",
    icon: Settings,
    paths: ["/users", "/roles", "/settings", "/administration", "/audit-logs"],
  },
];

export function SidebarNavigation({ permissions }: { permissions: string[] }) {
  const { pathname } = useLocation();
  const [opened, setOpened] = useState<Record<string, boolean>>({ selling: true });
  const current = nav
    .filter((n) => pathname === n.path || pathname.startsWith(`${n.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  const activeGroup = navGroups.find((g) =>
    g.paths.includes(current?.path ?? ""),
  )?.id;
  useEffect(() => {
    if (activeGroup) setOpened({ [activeGroup]: true });
  }, [pathname, activeGroup]);
  const allowed = nav.filter((n) =>
    (Array.isArray(n.permission) ? n.permission : [n.permission]).some((key) =>
      permissions.includes(key),
    ),
  );
  const link = (n: (typeof nav)[number]) => (
    <NavLink key={n.path} to={n.path} end={n.path === "/products"}>
      <n.icon size={17} />
      <span>{n.title}</span>
    </NavLink>
  );
  return (
    <nav aria-label="القائمة الرئيسية">
      {allowed
        .filter((n) => n.path === "/dashboard" || n.path === "/quick-access")
        .map(link)}
      {navGroups.map((group) => {
        const items = group.paths.flatMap((path) =>
          allowed.filter((n) => n.path === path),
        );
        if (!items.length) return null;
        const expanded = opened[group.id] ?? false;
        return (
          <div className="nav-group" data-nav-group={group.id} key={group.id}>
            <button
              type="button"
              className={`nav-group-toggle${activeGroup === group.id ? " current" : ""}`}
              aria-expanded={expanded}
              aria-controls={`nav-${group.id}`}
              onClick={() =>
                setOpened(() =>
                  expanded ? {} : { [group.id]: true },
                )
              }
            >
              <group.icon size={18} />
              <span>{group.title}</span>
              <ChevronDown size={15} className="nav-group-chevron" />
            </button>
            <div
              className="nav-group-links"
              id={`nav-${group.id}`}
              hidden={!expanded}
            >
              {items.map(link)}
            </div>
          </div>
        );
      })}
    </nav>
  );
    }
