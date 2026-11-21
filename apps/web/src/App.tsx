import {
  useEffect,
  useState,
  useId,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import * as Dialog from "@radix-ui/react-dialog";
import {
  BarChart,
  Bar,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  LayoutDashboard,
  ShoppingBag,
  ScanBarcode,
  Boxes,
  Truck,
  Users,
  Receipt,
  Wallet,
  ChartNoAxesCombined,
  Settings,
  ShieldCheck,
  LogOut,
  Plus,
  Search,
  ArrowUpLeft,
  X,
  Printer,
  Menu,
  History,
  CircleAlert,
  Check,
  ArrowRightLeft,
  RotateCcw,
  Eye,
  EyeOff,
  ChevronDown,
  Zap,
} from "lucide-react";
import { POS } from "./features/pos/POS";
import { DiscountApprovals } from "./features/pos/DiscountApprovals";
import { BrandLogo } from "./features/shared/BrandLogo";
import { LogoSettings } from "./features/shared/LogoSettings";
import {
  ProductImage,
  ProductImageEditor,
  ProductImagePicker,
} from "./features/shared/ProductImage";
import { Promotions } from "./features/pos/Promotions";
import { ReceiptView } from "./features/receipts/ReceiptView";
import { ExchangeDialog } from "./features/pos/ExchangeDialog";
import { api, ApiError, patch, post, useCart, useSession } from "./api";
import { ar, formatDate, formatMoney as fm, statuses, permissionLabels, roleLabels } from "./i18n";
import { Button } from "./components/ui/button";
import { BarcodeLabels } from "./features/barcodes/BarcodeLabels";
import { Suppliers, SupplierDetails } from "./features/suppliers/Suppliers";
import { CustomerHistory } from "./features/customers/CustomerHistory";
import { LoyaltySettings } from "./features/customers/Loyalty";
import { StockDocuments } from "./features/inventory/StockDocuments";
import { useDebouncedSearch } from "./hooks/useDebouncedSearch";
import { Expenses } from "./features/management/Expenses";
import { Administration } from "./features/management/Administration";
import { Reports } from "./features/management/Reports";
import { AdvancedInventory } from "./features/management/AdvancedInventory";

type Row = Record<string, any>;
const nav = [
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
const navGroups = [
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
    paths: ["/shifts", "/expenses", "/reports"],
  },
  {
    id: "admin",
    title: "إدارة النظام",
    icon: Settings,
    paths: ["/users", "/roles", "/settings", "/administration", "/audit-logs"],
  },
];
function SidebarNavigation({ permissions }: { permissions: string[] }) {
  const { pathname } = useLocation();
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const current = nav
    .filter((n) => pathname === n.path || pathname.startsWith(`${n.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  const activeGroup = navGroups.find((g) =>
    g.paths.includes(current?.path ?? ""),
  )?.id;
  useEffect(() => {
    setOpened(activeGroup ? { [activeGroup]: true } : {});
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
function useData(path: string, enabled = true, searchPending = false) {
  const query = useQuery({
    queryKey: [path],
    queryFn: ({ signal }) => api(path, { signal }),
    enabled: enabled && !searchPending,
  });
  return searchPending ? { ...query, isLoading: true } : query;
}
function useAllowed(p: string | string[]) {
  return useSession((s) =>
    (Array.isArray(p) ? p : [p]).some((key) =>
      s.user?.permissions.includes(key),
    ),
  );
}
let notify: (message: string, error?: boolean) => void = () => {};
function readableError(error: unknown) {
  if (!(error instanceof ApiError)) return ar.error;
  const labels: Record<string, string> = {
    password: "كلمة المرور",
    email: "البريد الإلكتروني",
    name: "الاسم",
    roleIds: "الدور",
    discountLimit: "حد الخصم",
  };
  const details = error.fields
    ? Object.entries(error.fields)
        .flatMap(([field, messages]) =>
          messages.map((message) => {
            if (field === "password" && message.includes("Too small"))
              return "كلمة المرور يجب أن تكون ٨ أحرف على الأقل";
            if (message.includes("Invalid email"))
              return "البريد الإلكتروني غير صحيح";
            return `${labels[field] ?? field}: ${message}`;
          }),
        )
        .join(" • ")
    : "";
  return details ? `${ar.error}: ${details}` : `${ar.error}: ${error.message}`;
}
function Toasts() {
  const [toast, setToast] = useState<{
    message: string;
    error?: boolean;
  } | null>(null);
  useEffect(() => {
    notify = (message, error) => setToast({ message, error });
    return () => {
      notify = () => {};
    };
  }, []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  return toast ? (
    <div className={`toast ${toast.error ? "toast-error" : ""}`} role="status">
      {toast.error ? <CircleAlert size={20} /> : <Check size={20} />}{" "}
      {toast.message}
      <button aria-label={ar.cancel} onClick={() => setToast(null)}>
        <X size={16} />
      </button>
    </div>
  ) : null;
}
function useAction() {
  const client = useQueryClient(),
    [busy, setBusy] = useState(false);
  return {
    busy,
    run: async (fn: () => Promise<unknown>, done?: () => void) => {
      if (busy) return;
      setBusy(true);
      try {
        await fn();
        await client.invalidateQueries();
        notify(ar.success);
        done?.();
      } catch (e) {
        notify(
          readableError(e),
          true,
        );
      } finally {
        setBusy(false);
      }
    },
  };
}
function Loading() {
  return (
    <div className="skeletons" aria-label={ar.loading}>
      {[1, 2, 3, 4].map((n) => (
        <div key={n} className="skeleton" />
      ))}
    </div>
  );
}
function ErrorState({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="empty error">
      <CircleAlert />
      <h3>
        {error instanceof ApiError && error.status === 403
          ? ar.forbidden
          : ar.error}
      </h3>
      <p>{readableError(error)}</p>
      <Button variant="outline" onClick={retry}>
        {ar.retry}
      </Button>
    </div>
  );
}
function Empty() {
  return (
    <div className="empty">
      <ShoppingBag size={32} />
      <h3>{ar.empty}</h3>
      <p>{ar.emptyHint}</p>
    </div>
  );
}
function Modal({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="modal" dir="rtl">
          <div className="modal-head">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" aria-label={ar.cancel}>
                <X size={20} />
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            {title} — أكمل الحقول المطلوبة ثم احفظ.
          </Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  const fieldId = useId();
  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ id: string }>, {
            id: fieldId,
          })
        : children}
    </div>
  );
}
function Header({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <div className="eyebrow">A&Z • إدارة المتجر</div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="head-actions">{children}</div>
    </div>
  );
}
function Badge({ value }: { value: string }) {
  return (
    <span className={`badge ${value === "DRAFT" ? "muted" : ""}`}>
      {statuses[value] ?? value}
    </span>
  );
}
function Table({
  rows,
  columns,
  onRowClick,
}: {
  rows: Row[];
  columns: { label: string; render: (r: Row) => ReactNode }[];
  onRowClick?: (r: Row) => void;
}) {
  if (!rows.length) return <Empty />;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.id ?? i}
              onClick={() => onRowClick?.(r)}
              style={onRowClick ? { cursor: "pointer" } : undefined}
            >
              {columns.map((c, j) => (
                <td
                  key={j}
                  onClick={(e) => {
                    if (
                      (e.target as HTMLElement).closest(
                        "button, a, input, select, label",
                      )
                    ) {
                      e.stopPropagation();
                    }
                  }}
                >
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Pager({
  offset,
  setOffset,
  length,
  total,
}: {
  offset: number;
  setOffset: (n: number) => void;
  length: number;
  total?: number;
}) {
  return (
    <div className="pager">
      <span>
        {offset + 1} – {offset + length}
        {total !== undefined ? ` / ${total}` : ""}
      </span>
      <Button
        variant="outline"
        disabled={!offset}
        onClick={() => setOffset(Math.max(0, offset - 30))}
      >
        السابق
      </Button>
      <Button
        variant="outline"
        disabled={length < 30}
        onClick={() => setOffset(offset + 30)}
      >
        التالي
      </Button>
    </div>
  );
}
function Gate({
  permission,
  children,
}: {
  permission: string | string[];
  children: ReactNode;
}) {
  return useAllowed(permission) ? (
    <>{children}</>
  ) : (
    <div className="empty">
      <ShieldCheck />
      <h1>403</h1>
      <p>{ar.forbidden}</p>
    </div>
  );
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
function Login() {
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const {
      register,
      handleSubmit,
      formState: { errors, isSubmitting },
    } = useForm<z.infer<typeof loginSchema>>({
      resolver: zodResolver(loginSchema),
    }),
    setUser = useSession((s) => s.setUser);
  return (
    <main className="login">
      <section className="login-brand">
        <BrandLogo className="login-store-logo" />
        <div className="gold-rule" />
        <h1>GIRLS FASHION</h1>
        <p>{ar.tagline}</p>
        <span className="login-caption">مساحة واحدة لكل تفاصيل متجرك</span>
      </section>
      <section className="login-panel">
        <div className="eyebrow">مرحباً بك من جديد</div>
        <h2>إدارة متجرك تبدأ من هنا</h2>
        <p>سجّل الدخول إلى حسابك للمتابعة</p>
        <form
          onSubmit={handleSubmit(async (values) => {
            try {
              await post("/auth/login", values);
              const { data } = await api("/auth/me");
              setUser(data);
              navigate("/", { replace: true });
            } catch (e) {
              notify(readableError(e), true);
            }
          })}
        >
          <Field label={ar.email}>
            <input
              type="email"
              autoComplete="username"
              dir="ltr"
              {...register("email")}
              aria-invalid={!!errors.email}
            />
          </Field>
          <Field label={ar.password}>
            <div className="password-field">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                {...register("password")}
                aria-invalid={!!errors.password}
              />
              <button
                type="button"
                className="password-toggle"
                aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </Field>
          <Button disabled={isSubmitting} className="full">
            {isSubmitting ? ar.loading : "تسجيل الدخول"}
            <ArrowUpLeft size={18} />
          </Button>
        </form>
        <small>نظام إدارة المبيعات والمخزون • A&Z Girls Fashion</small>
      </section>
    </main>
  );
}

export default function App() {
  const [ready, setReady] = useState(false),
    user = useSession((s) => s.user),
    setUser = useSession((s) => s.setUser);
  useEffect(() => {
    api("/auth/me")
      .then((r) => setUser(r.data))
      .catch(() => {})
      .finally(() => setReady(true));
  }, [setUser]);
  return (
    <>
      <Toasts />
      {!ready ? <Loading /> : user ? <Shell /> : <Login />}
    </>
  );
}

function QuickAccess() {
  const user = useSession((s) => s.user)!;
  const groups = [
    {
      title: "المبيعات ونقطة البيع (الكاشير)",
      desc: "إتمام عمليات البيع، الفواتير، وموافقات الخصومات",
      actions: [
        {
          title: "بيع جديد (الكاشير)",
          desc: "شاشة الكاشير لمسح الباركود وإتمام عمليات البيع فوراً",
          to: "/pos",
          icon: ScanBarcode,
          color: "#059669",
          bg: "#ecfdf5",
          perm: "pos.access",
          primary: true,
        },
        {
          title: "فواتير المبيعات",
          desc: "سجل الفواتير والمرتجعات والطباعة والاستبدال",
          to: "/sales",
          icon: Receipt,
          color: "#2563eb",
          bg: "#eff6ff",
          perm: "sales.view_own",
        },
        {
          title: "موافقات الخصومات",
          desc: "مراجعة واعتماد طلبات الخصم الاستثنائية للكاشير",
          to: "/discount-approvals",
          icon: ShieldCheck,
          color: "#7c3aed",
          bg: "#f5f3ff",
          perm: "sales.discount_approve",
        },
        {
          title: "العروض التلقائية",
          desc: "إدارة الخصومات والعروض الترويجية النشطة",
          to: "/promotions",
          icon: ShoppingBag,
          color: "#db2777",
          bg: "#fdf2f8",
          perm: "promotions.manage",
        },
      ],
    },
    {
      title: "المنتجات والمخزون",
      desc: "إدارة الأصناف، الأرصدة، الجرد، والباركود",
      actions: [
        {
          title: "كتالوج المنتجات",
          desc: "عرض وتعديل المقاسات، الألوان، وأسعار البيع",
          to: "/products",
          icon: ShoppingBag,
          color: "#d97706",
          bg: "#fffbeb",
          perm: "products.view",
        },
        {
          title: "طباعة الباركود",
          desc: "توليد وطباعة ملصقات الباركود للملابس",
          to: "/products/barcodes",
          icon: Printer,
          color: "#0284c7",
          bg: "#f0f9ff",
          perm: "products.view",
        },
        {
          title: "أرصدة المخزون",
          desc: "متابعة الكميات المتوفرة وتفاصيل كل مخزن",
          to: "/inventory",
          icon: Boxes,
          color: "#0d9488",
          bg: "#f0fdfa",
          perm: "inventory.view",
        },
        {
          title: "الشحن وحجر المخزون",
          desc: "التحويلات بين الفروع وحجز المخزون",
          to: "/inventory/advanced",
          icon: Truck,
          color: "#4f46e5",
          bg: "#eef2ff",
          perm: "inventory.view",
        },
      ],
    },
    {
      title: "المشتريات والموردون",
      desc: "أوامر الشراء وإدارة حسابات الموردين",
      actions: [
        {
          title: "أمر شراء جديد",
          desc: "تسجيل بضاعة جديدة مع تحديد سعر الشراء وسعر البيع والحد الأدنى",
          to: "/purchases",
          icon: Plus,
          color: "#059669",
          bg: "#ecfdf5",
          perm: "purchases.create",
          primary: true,
        },
        {
          title: "سجل المشتريات",
          desc: "استلام وتدقيق فواتير الشراء من الموردين",
          to: "/purchases",
          icon: Truck,
          color: "#2563eb",
          bg: "#eff6ff",
          perm: "purchases.view",
        },
        {
          title: "دليل الموردين",
          desc: "بيانات وحسابات الموردين والأرصدة والمدفوعات",
          to: "/suppliers",
          icon: Users,
          color: "#ea580c",
          bg: "#fff7ed",
          perm: "suppliers.manage",
        },
      ],
    },
    {
      title: "المالية والورديات والعملاء",
      desc: "المصروفات، الورديات، والتقارير المالية",
      actions: [
        {
          title: "تسجيل مصروف جديد",
          desc: "تسجيل المصروفات النثرية والتشغيلية للمتجر",
          to: "/expenses",
          icon: Wallet,
          color: "#dc2626",
          bg: "#fef2f2",
          perm: "expenses.create",
        },
        {
          title: "ورديات الكاشير",
          desc: "فتح وردية جديدة أو إغلاق ومراجعة خزن الكاشير",
          to: "/shifts",
          icon: Receipt,
          color: "#6b7280",
          bg: "#f9fafb",
          perm: "cash.open_shift",
        },
        {
          title: "دليل العملاء",
          desc: "بيانات العملاء ونقاط الولاء وسجل المشتريات",
          to: "/customers",
          icon: Users,
          color: "#0284c7",
          bg: "#f0f9ff",
          perm: "customers.manage",
        },
        {
          title: "التقارير المالية",
          desc: "تقرير الأرباح، حركة المبيعات، ومصروفات المتجر",
          to: "/reports",
          icon: ChartNoAxesCombined,
          color: "#c5a24a",
          bg: "#fdf8ee",
          perm: "reports.sales",
        },
      ],
    },
    {
      title: "إدارة النظام والإعدادات",
      desc: "الموظفون، الصلاحيات، وإعدادات المتجر",
      actions: [
        {
          title: "المستخدمون والموظفون",
          desc: "إضافة وتعديل بيانات وحسابات الموظفين",
          to: "/users",
          icon: Users,
          color: "#4b5563",
          bg: "#f3f4f6",
          perm: "users.manage",
        },
        {
          title: "الأدوار والصلاحيات",
          desc: "تخصيص الصلاحيات بالعربية لكل دور وظيفي",
          to: "/roles",
          icon: ShieldCheck,
          color: "#7c3aed",
          bg: "#f5f3ff",
          perm: "roles.manage",
        },
        {
          title: "إعدادات المتجر",
          desc: "شعار المتجر، سياسات الإرجاع، وتفاصيل الفاتورة",
          to: "/settings",
          icon: Settings,
          color: "#374151",
          bg: "#f9fafb",
          perm: "settings.manage",
        },
        {
          title: "الفروع والأجهزة",
          desc: "إدارة الفروع، الخزائن، وأجهزة الكاشير",
          to: "/administration",
          icon: Settings,
          color: "#1f2937",
          bg: "#f3f4f6",
          perm: "settings.manage",
        },
      ],
    },
  ];

  return (
    <>
      <Header
        title="الوصول السريع"
        subtitle="جميع مكونات وعمليات متجرك في أزرار وصول مباشر وسريع"
      />
      <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
        {groups.map((group) => {
          const visibleActions = group.actions.filter((a) =>
            user.permissions.includes(a.perm),
          );
          if (!visibleActions.length) return null;
          return (
            <section
              key={group.title}
              className="panel"
              style={{ padding: "1.25rem" }}
            >
              <div style={{ marginBottom: "1rem" }}>
                <h2 style={{ fontSize: "1.15rem", margin: "0 0 0.25rem" }}>
                  {group.title}
                </h2>
                <small className="muted-text">{group.desc}</small>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                  gap: "1rem",
                }}
              >
                {visibleActions.map((action) => (
                  <Link
                    key={action.title}
                    to={action.to}
                    className="quick-card"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "1rem",
                      padding: "1rem 1.25rem",
                      border: action.primary
                        ? `2px solid ${action.color}`
                        : "1px solid var(--border)",
                      borderRadius: "10px",
                      background: "var(--card-bg, #fff)",
                      textDecoration: "none",
                      color: "inherit",
                      transition:
                        "transform 0.15s ease, box-shadow 0.15s ease",
                      boxShadow: action.primary
                        ? "0 4px 12px rgba(5,150,105,0.12)"
                        : "0 2px 6px rgba(0,0,0,0.03)",
                    }}
                  >
                    <div
                      style={{
                        width: "48px",
                        height: "48px",
                        borderRadius: "10px",
                        background: action.bg,
                        color: action.color,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <action.icon size={24} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h3
                        style={{
                          fontSize: "1rem",
                          margin: "0 0 0.25rem",
                          fontWeight: 600,
                        }}
                      >
                        {action.title}
                      </h3>
                      <p
                        style={{
                          margin: 0,
                          fontSize: "0.8rem",
                          color: "var(--muted, #64748b)",
                          lineHeight: 1.3,
                        }}
                      >
                        {action.desc}
                      </p>
                    </div>
                    <ArrowUpLeft
                      size={18}
                      style={{ color: "var(--muted)", flexShrink: 0 }}
                    />
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
function Shell() {
  const user = useSession((s) => s.user)!,
    setUser = useSession((s) => s.setUser),
    [mobile, setMobile] = useState(false),
    location = useLocation(),
    client = useQueryClient();
  useEffect(() => setMobile(false), [location.pathname]);
  return (
    <div className="app-shell">
      <aside className={mobile ? "sidebar mobile-open" : "sidebar"}>
        <Link to="/dashboard" className="brand">
          <BrandLogo className="sidebar-store-logo" />
          <div>
            GIRLS FASHION<small>نظام إدارة المتجر</small>
          </div>
        </Link>
        <div className="nav-label">مساحة العمل</div>
        <SidebarNavigation permissions={user.permissions} />
        <div className="sidebar-foot">
          <span className="avatar">{user.name.slice(0, 1)}</span>
          <div>
            <strong>{user.name}</strong>
            <small>{user.roles.join(" • ")}</small>
          </div>
          <button
            aria-label={ar.logout}
            onClick={() => {
              void post("/auth/logout", {})
                .then(() => {
                  setUser(null);
                  client.clear();
                  useCart.getState().clear();
                })
                .catch((e) => notify(readableError(e), true));
            }}
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <Button
            variant="ghost"
            className="mobile-toggle"
            aria-label="القائمة"
            onClick={() => setMobile(!mobile)}
          >
            <Menu />
          </Button>
          <div className="breadcrumb">
            المتجر <span>/</span>{" "}
            {nav.find((n) => location.pathname.startsWith(n.path))?.title ??
              ar.brand}
          </div>
          <div className="topbar-end">
            <span className="status-dot" />
            الفرع الرئيسي <span className="divider" />{" "}
            {new Intl.DateTimeFormat("ar-EG", {
              day: "numeric",
              month: "long",
              year: "numeric",
              timeZone: "Africa/Cairo",
            }).format(new Date())}
          </div>
        </header>
        <main className="content">
          <Routes>
            <Route
              path="/administration"
              element={
                <Gate permission={["settings.manage", "users.manage"]}>
                  <Administration />
                </Gate>
              }
            />
            <Route
              path="/inventory/advanced"
              element={
                <Gate permission="inventory.view">
                  <AdvancedInventory />
                </Gate>
              }
            />
            <Route
              path="/expenses"
              element={
                <Gate permission="expenses.view">
                  <Expenses />
                </Gate>
              }
            />
            <Route
              path="/"
              element={
                <Navigate
                  to={
                    nav.find((n) =>
                      (Array.isArray(n.permission)
                        ? n.permission
                        : [n.permission]
                      ).some((key) => user.permissions.includes(key)),
                    )?.path ?? "/dashboard"
                  }
                  replace
                />
              }
            />
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route
              path="/promotions"
              element={
                <Gate permission="promotions.manage">
                  <Promotions />
                </Gate>
              }
            />
            <Route
              path="/dashboard"
              element={
                <Gate permission="dashboard.view">
                  <Dashboard />
                </Gate>
              }
            />
            <Route
              path="/quick-access"
              element={
                <Gate permission="quick_access.view">
                  <QuickAccess />
                </Gate>
              }
            />
            <Route
              path="/pos"
              element={
                <Gate permission="pos.access">
                  <POS />
                </Gate>
              }
            />
            <Route
              path="/products"
              element={
                <Gate permission="products.view">
                  <Products />
                </Gate>
              }
            />
            <Route
              path="/discount-approvals"
              element={
                <Gate permission={["sales.create", "sales.discount_approve"]}>
                  <DiscountApprovals />
                </Gate>
              }
            />
            <Route
              path="/products/barcodes"
              element={
                <Gate permission="products.view">
                  <BarcodeLabels />
                </Gate>
              }
            />
            <Route
              path="/inventory"
              element={
                <Gate permission="inventory.view">
                  <Inventory />
                </Gate>
              }
            />
            <Route
              path="/purchases"
              element={
                <Gate permission={["purchases.view", "purchases.preview"]}>
                  <Purchases />
                </Gate>
              }
            />
            <Route
              path="/sales"
              element={
                <Gate permission="sales.view_own">
                  <Sales />
                </Gate>
              }
            />
            <Route
              path="/shifts"
              element={
                <Gate permission="cash.close_shift">
                  <Shifts />
                </Gate>
              }
            />
            <Route
              path="/reports"
              element={
                <Gate permission="reports.sales">
                  <Reports />
                </Gate>
              }
            />
            <Route
              path="/settings"
              element={
                <Gate permission="settings.manage">
                  <StoreSettings />
                </Gate>
              }
            />
            <Route
              path="/roles"
              element={
                <Gate permission="roles.manage">
                  <Roles />
                </Gate>
              }
            />
            <Route
              path="/suppliers"
              element={
                <Gate permission="suppliers.manage">
                  <Suppliers />
                </Gate>
              }
            />
            <Route
              path="/suppliers/:id"
              element={
                <Gate permission="suppliers.manage">
                  <SupplierDetails />
                </Gate>
              }
            />
            {["customers", "users", "audit-logs"].map((key) => (
              <Route
                key={key}
                path={`/${key}`}
                element={
                  <Gate
                    permission={
                      nav.find((n) => n.path === `/${key}`)!.permission
                    }
                  >
                    <Records kind={key} />
                  </Gate>
                }
              />
            ))}
            <Route
              path="*"
              element={
                <div className="empty">
                  <h1>404</h1>
                  <p>{ar.notFound}</p>
                  <Link to="/">العودة للرئيسية</Link>
                </div>
              }
            />
          </Routes>
        </main>
        <footer className="footer">
          A&Z Girls Fashion <span>صُمّم لتفاصيل يومك</span>
        </footer>
      </div>
    </div>
  );
}

function Dashboard({ reports = false }: { reports?: boolean }) {
  const posAllowed = useAllowed("pos.access");
  const [days, setDays] = useState("30"),
    [range] = useState(() => new Date()),
    from = new Date(range.getTime() - Number(days) * 86400000).toISOString(),
    to = range.toISOString(),
    query = useData(`/reports/dashboard?from=${from}&to=${to}`),
    d = query.data?.data,
    user = useSession((s) => s.user)!;
  return (
    <>
      <Header
        title={reports ? ar.reports : `أهلاً، ${user.name}`}
        subtitle={
          reports
            ? "الأرقام التي تساعدك على اتخاذ القرار"
            : "كل ما تحتاجه لمتابعة متجرك، في مكان واحد."
        }
      >
        <select
          aria-label="الفترة"
          value={days}
          onChange={(e) => setDays(e.target.value)}
        >
          <option value="1">آخر 24 ساعة</option>
          <option value="7">آخر 7 أيام</option>
          <option value="30">آخر 30 يوماً</option>
          <option value="365">آخر سنة</option>
        </select>
        {reports ? (
          <a
            className="btn btn-outline"
            href={`/api/reports/sales/export?from=${from}&to=${to}`}
          >
            تصدير Excel
          </a>
        ) : (
          posAllowed && (
            <Link className="btn btn-primary" to="/pos">
              <Plus size={18} /> عملية بيع جديدة
            </Link>
          )
        )}
      </Header>
      {query.isLoading ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        d && (
          <>
            <div className="stat-grid">
              {[
                {
                  label: "إجمالي المبيعات شامل الضريبة",
                  value: fm(d.totalSalesWithTax),
                  icon: Receipt,
                },
                {
                  label: "الفواتير المكتملة",
                  value: d.orders,
                  icon: ShoppingBag,
                },
                {
                  label:
                    d.grossProfit !== undefined
                      ? "مجمل الربح"
                      : "إجمالي المرتجعات",
                  value: fm(d.grossProfit ?? d.returns),
                  icon: ChartNoAxesCombined,
                },
                {
                  label: "منتجات منخفضة المخزون",
                  value: d.lowStock ?? "—",
                  icon: Boxes,
                },
              ].map((s, i) => (
                <section
                  className={`stat-card ${i === 0 ? "featured" : ""}`}
                  key={s.label}
                >
                  <div className="stat-top">
                    <span>{s.label}</span>
                    <s.icon size={19} />
                  </div>
                  <strong>{s.value}</strong>
                  <small>
                    {i === 3 ? "تابع مستويات المخزون" : "خلال الفترة المحددة"}
                  </small>
                </section>
              ))}
            </div>
            <div className="dashboard-grid">
              <section className="panel chart">
                <div className="panel-title">
                  <div>
                    <h2>حركة المبيعات</h2>
                    <p>إجمالي الفواتير حسب اليوم</p>
                  </div>
                  <span className="legend">
                    <i />
                    المبيعات
                  </span>
                </div>
                {d.daily.length ? (
                  <ResponsiveContainer width="100%" height={290}>
                    <BarChart
                      data={d.daily}
                      margin={{ top: 20, left: 10, right: 10, bottom: 10 }}
                    >
                      <CartesianGrid vertical={false} stroke="#ededed" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip formatter={(v: any) => fm(v)} />
                      <Bar
                        dataKey="sales"
                        fill="#c5a24a"
                        radius={[5, 5, 0, 0]}
                        maxBarSize={36}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <Empty />
                )}
              </section>
              <section className="panel summary">
                <div className="panel-title">
                  <h2>ملخص الفترة</h2>
                </div>
                {[
                  ["إجمالي المبيعات شامل الضريبة", d.totalSalesWithTax],
                  ["صافي المبيعات قبل الضريبة", d.netSales],
                  ["الخصومات", d.discounts],
                  ["المرتجعات", d.returns],
                  ["الضريبة", d.tax],
                  ...(d.expenses !== undefined
                    ? [
                        ["المصروفات", d.expenses],
                        [
                          "فروق تقييم مرتجعات المشتريات",
                          d.purchaseReturnVariance ?? "0",
                        ],
                        ["تكلفة شطب التالف", d.stockDamageCost ?? "0"],
                        ["صافي الربح", d.netProfit],
                      ]
                    : []),
                ].map(([label, value]) => (
                  <div className="summary-row" key={label}>
                    <span>{label}</span>
                    <strong>{fm(value)}</strong>
                  </div>
                ))}
                <p className="note">
                  التقارير تعتمد على أسعار وتكلفة كل عملية وقت تسجيلها.
                </p>
              </section>
              {d.cashiers?.length > 0 && (
                <section className="panel summary cashier-performance">
                  <div className="panel-title">
                    <div>
                      <h2>أداء الكاشير</h2>
                      <p>الفواتير والمبيعات بدون الضريبة خلال الفترة</p>
                    </div>
                  </div>
                  <div className="cashier-performance-head">
                    <span>الكاشير</span><span>الفواتير</span><span>المبيعات بدون الضريبة</span>
                  </div>
                  {d.cashiers.map((cashier: any) => (
                    <div className="cashier-performance-row" key={cashier.id}>
                      <span>{cashier.name} <small dir="ltr">{cashier.sellerCode}</small></span>
                      <strong>{cashier.invoices}</strong>
                      <strong>{fm(cashier.netSales)}</strong>
                    </div>
                  ))}
                </section>
              )}
            </div>
            <section className="quick-grid">
              {[
                {
                  to: "/pos",
                  title: "بيع جديد",
                  sub: "افتح نقطة البيع وابدأ المسح",
                  icon: ScanBarcode,
                  p: "pos.access",
                },
                {
                  to: "/products",
                  title: "كتالوج المنتجات",
                  sub: "المقاسات والألوان والباركود",
                  icon: ShoppingBag,
                  p: "products.view",
                },
                {
                  to: "/inventory",
                  title: "متابعة المخزون",
                  sub: "الأرصدة والحركات والتسويات",
                  icon: Boxes,
                  p: "inventory.view",
                },
              ]
                .filter((x) => user.permissions.includes(x.p))
                .map((x) => (
                  <Link className="quick-card" key={x.to} to={x.to}>
                    <div className="quick-icon">
                      <x.icon size={22} />
                    </div>
                    <div>
                      <h3>{x.title}</h3>
                      <p>{x.sub}</p>
                    </div>
                    <ArrowUpLeft size={18} />
                  </Link>
                ))}
            </section>
          </>
        )
      )}
    </>
  );
}

type FieldSpec = {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  default?: string;
};
function EntryForm({
  fields,
  submit,
  busy,
  initial = {},
}: {
  fields: FieldSpec[];
  submit: (value: Row) => void;
  busy: boolean;
  initial?: Row;
}) {
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});
  const [formError, setFormError] = useState("");
  return (
    <form
      className="entry-form"
      onSubmit={(e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.currentTarget));
        if (
          typeof data.password === "string" &&
          data.password.length > 0 &&
          data.password.length < 8
        ) {
          setFormError("كلمة المرور يجب أن تكون ٨ أحرف على الأقل");
          return;
        }
        setFormError("");
        submit(data);
      }}
    >
      <div className="form-grid">
        {fields.map((f) => (
          <Field key={f.key} label={f.label}>
            {f.options ? (
              <select
                name={f.key}
                required={f.required !== false}
                defaultValue={initial[f.key] ?? f.default ?? ""}
              >
                <option value="">اختر...</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.type === "textarea" ? (
              <textarea
                name={f.key}
                required={f.required !== false}
                defaultValue={initial[f.key] ?? f.default}
              />
            ) : f.type === "password" ? (
              <div className="password-field">
                <input
                  name={f.key}
                  type={visiblePasswords[f.key] ? "text" : "password"}
                  required={f.required !== false}
                  defaultValue={initial[f.key] ?? f.default}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="password-toggle"
                  aria-label={visiblePasswords[f.key] ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                  onClick={() =>
                    setVisiblePasswords((old) => ({ ...old, [f.key]: !old[f.key] }))
                  }
                >
                  {visiblePasswords[f.key] ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            ) : (
              <input
                name={f.key}
                type={f.type ?? "text"}
                dir={f.key === "phone" ? "ltr" : undefined}
                style={f.key === "phone" ? { textAlign: "right" } : undefined}
                min={f.type === "number" ? "0" : undefined}
                step={f.type === "number" ? "0.01" : undefined}
                required={f.required !== false}
                defaultValue={initial[f.key] ?? f.default}
                autoComplete={
                  f.type === "password" ? "new-password" : undefined
                }
              />
            )}
          </Field>
        ))}
      </div>
      {formError && (
        <p className="form-error" role="alert">
          <CircleAlert size={16} />
          {formError}
        </p>
      )}
      <Button className="form-submit" disabled={busy}>
        {busy ? ar.loading : ar.save}
      </Button>
    </form>
  );
}
const simple = (
  key: string,
  label: string,
  type = "text",
  required = true,
): FieldSpec => ({ key, label, type, required });

function Products() {
  const [q, setQ] = useState(""),
    { debounced: debouncedQ, searchPending } = useDebouncedSearch(q),
    [offset, setOffset] = useState(0),
    [open, setOpen] = useState(false),
    [label, setLabel] = useState<Row | null>(null),
    [categoryOpen, setCategoryOpen] = useState(false),
    [selected, setSelected] = useState<Row | null>(null),
    query = useData(
      `/products?q=${encodeURIComponent(debouncedQ)}&offset=${offset}`,
      true,
      searchPending,
    ),
    categories = useData("/categories"),
    brands = useData("/brands"),
    action = useAction(),
    create = useAllowed("products.create"),
    edit = useAllowed("products.update"),
    changePrice = useAllowed("products.change_price");
  return (
    <>
      <Header title={ar.products} subtitle="منتجاتك، بكل مقاس ولون وتفصيلة">
        <Link className="btn btn-outline" to="/products/barcodes">
          <Printer size={16} />
          طباعة الباركود
        </Link>
        <Button variant="outline" onClick={() => setCategoryOpen(true)}>
          {ar.category}
        </Button>
        {create && (
          <Button onClick={() => setOpen(true)}>
            <Plus size={18} />
            إضافة منتج
          </Button>
        )}
      </Header>
      <section className="panel">
        <div className="toolbar">
          <div className="search">
            <Search size={18} />
            <input
              placeholder={ar.search}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOffset(0);
              }}
            />
          </div>
          <span className="muted-text">{query.data?.total ?? 0} منتج</span>
        </div>
        {query.isLoading ? (
          <Loading />
        ) : query.error ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : (
          <>
            <Table
              rows={query.data?.data ?? []}
              columns={[
                {
                  label: "المنتج",
                  render: (r) => (
                    <div className="product-cell">
                      <div className="product-symbol">
                        <ProductImage url={r.imageUrl} name={r.nameAr} />
                      </div>
                      <div>
                        <strong>{r.nameAr}</strong>
                        <small dir="ltr">{r.sku}</small>
                      </div>
                    </div>
                  ),
                },
                { label: ar.category, render: (r) => r.category?.name },
                {
                  label: "المتغيرات",
                  render: (r) => <span>{r.variants.length} مقاس / لون</span>,
                },
                {
                  label: "السعر من",
                  render: (r) =>
                    fm(
                      Math.min(...r.variants.map((v: Row) => Number(v.price))),
                    ),
                },
                {
                  label: ar.quantity,
                  render: (r) =>
                    r.variants.reduce(
                      (s: number, v: Row) =>
                        s +
                        v.balances.reduce(
                          (n: number, b: Row) => n + b.quantity,
                          0,
                        ),
                      0,
                    ),
                },
                { label: ar.status, render: (r) => <Badge value={r.status} /> },
                {
                  label: ar.actions,
                  render: (r) => (
                    <div className="inline-actions">
                      <Button variant="ghost" onClick={() => setSelected(r)}>
                        التفاصيل
                      </Button>
                      <Button variant="ghost" onClick={() => setLabel(r)}>
                        <Printer size={16} />
                        باركود
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
            <Pager
              offset={offset}
              setOffset={setOffset}
              length={query.data?.data.length ?? 0}
              total={query.data?.total}
            />
          </>
        )}
      </section>
      <Modal title="منتج جديد" open={open} onClose={() => setOpen(false)}>
        <ProductForm
          categories={categories.data?.data ?? []}
          brands={brands.data?.data ?? []}
          busy={action.busy}
          submit={(body) =>
            void action.run(
              () => post("/products", body),
              () => setOpen(false),
            )
          }
        />
      </Modal>
      <Modal
        title="التصنيفات"
        open={categoryOpen}
        onClose={() => setCategoryOpen(false)}
      >
        <ul className="list">
          {categories.data?.data.map((c: Row) => (
            <li key={c.id}>{c.name}</li>
          ))}
        </ul>
        {create && (
          <EntryForm
            fields={[
              simple("name", ar.name),
              {
                key: "parentId",
                label: "تصنيف رئيسي",
                required: false,
                options:
                  categories.data?.data.map((c: Row) => ({
                    value: c.id,
                    label: c.name,
                  })) ?? [],
              },
            ]}
            busy={action.busy}
            submit={(body) =>
              void action.run(() =>
                post("/categories", {
                  name: body.name,
                  ...(body.parentId ? { parentId: body.parentId } : {}),
                }),
              )
            }
          />
        )}
      </Modal>
      <Modal
        title={selected?.nameAr ?? "المنتج"}
        open={!!selected}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <>
            {edit && (
              <ProductImageEditor
                key={selected.id}
                product={{
                  id: selected.id,
                  nameAr: selected.nameAr,
                  imageUrl: selected.imageUrl,
                }}
                onChange={(imageUrl) =>
                  setSelected((current) =>
                    current?.id === selected.id
                      ? { ...current, imageUrl }
                      : current,
                  )
                }
              />
            )}
            <Table
              rows={selected.variants}
              columns={[
                { label: ar.sku, render: (r) => r.sku },
                {
                  label: "المقاس / اللون",
                  render: (r) => Object.values(r.options).join(" / ") || "—",
                },
                { label: ar.barcode, render: (r) => <code>{r.barcode}</code> },
                { label: ar.price, render: (r) => fm(r.price) },
                {
                  label: "المخزون",
                  render: (r) => {
                    const total = (r.balances ?? []).reduce(
                      (s: number, b: Row) => s + b.quantity,
                      0,
                    );
                    return (
                      <span className={total <= r.minStock ? "low-stock" : ""}>
                        {total} قطعة
                      </span>
                    );
                  },
                },
              ]}
            />
            <h4 style={{ margin: "1.2rem 0 0.5rem" }}>تفاصيل المخزون حسب المخزن</h4>
            <Table
              rows={selected.variants.flatMap((v: Row) =>
                (v.balances ?? []).map((b: Row) => ({ ...b, variant: v })),
              )}
              columns={[
                {
                  label: "المتغير",
                  render: (r) =>
                    Object.values(r.variant.options).join(" / ") || r.variant.sku,
                },
                {
                  label: "المخزن",
                  render: (r) => r.location?.name ?? "—",
                },
                {
                  label: "الكمية",
                  render: (r) => (
                    <span
                      className={
                        r.quantity <= r.variant.minStock ? "low-stock" : ""
                      }
                    >
                      {r.quantity}
                    </span>
                  ),
                },
                {
                  label: "الحد الأدنى",
                  render: (r) => r.variant.minStock,
                },
              ]}
            />
            {edit && (
              <EntryForm
                initial={selected}
                fields={[
                  simple("nameAr", "الاسم بالعربية"),
                  simple("description", ar.description, "textarea", false),
                  {
                    key: "returnRule",
                    label: "سياسة إرجاع هذا المنتج",
                    options: [
                      { value: "STANDARD", label: "استرجاع عادي" },
                      { value: "DEFECT_ONLY", label: "عيب صناعة فقط" },
                    ],
                  },
                ]}
                busy={action.busy}
                submit={(body) =>
                  void action.run(
                    () => patch(`/products/${selected.id}`, body),
                    () => setSelected(null),
                  )
                }
              />
            )}{" "}
            {changePrice && (
              <EntryForm
                fields={[
                  {
                    key: "variantId",
                    label: "المتغير",
                    options: selected.variants.map((v: Row) => ({
                      value: v.id,
                      label: `${v.sku} ${Object.values(v.options).join(" / ")} (الحد الأدنى الحالي: ${v.minStock})`,
                    })),
                  },
                  simple("price", "سعر البيع الجديد", "number", false),
                  simple("minStock", "الحد الأدنى للمخزون الجديد (ديناميكي)", "number", false),
                ]}
                busy={action.busy}
                submit={(body) => {
                  const data: Row = {};
                  if (body.price) data.price = body.price;
                  if (body.minStock !== "" && body.minStock !== undefined) {
                    data.minStock = Number(body.minStock);
                  }
                  void action.run(
                    () => patch(`/variants/${body.variantId}`, data),
                    () => setSelected(null),
                  );
                }}
              />
            )}
          </>
        )}
      </Modal>
      <Modal
        title="طباعة الباركود"
        open={!!label}
        onClose={() => setLabel(null)}
      >
        {label && (
          <BarcodeLabels
            product={label as { id: string; nameAr: string; variants: any[] }}
          />
        )}
      </Modal>
    </>
  );
}
function ProductForm({
  categories,
  brands,
  busy,
  submit,
}: {
  categories: Row[];
  brands: Row[];
  busy: boolean;
  submit: (body: Row) => void;
}) {
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null),
    [imageBusy, setImageBusy] = useState(false);
  const [variants, setVariants] = useState([
    { size: "", color: "", minStock: "2" },
  ]);
  return (
    <form
      className="entry-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy || imageBusy) return;
        const f = Object.fromEntries(new FormData(e.currentTarget));
        submit({
          nameAr: f.nameAr,
          categoryId: f.categoryId,
          ...(f.brandId ? { brandId: f.brandId } : {}),
          description: f.description ?? "",
          returnRule: f.returnRule,
          ...(imageDataUrl ? { imageDataUrl } : {}),
          variants: variants.map((v) => ({
            options: {
              ...(v.size ? { المقاس: v.size } : {}),
              ...(v.color ? { اللون: v.color } : {}),
            },
            ...(v.minStock !== "" ? { minStock: Number(v.minStock) } : {}),
          })),
        });
      }}
    >
      <div className="form-grid">
        <Field label="اسم المنتج بالعربية">
          <input name="nameAr" required />
        </Field>
        <Field label={ar.category}>
          <select name="categoryId" required>
            <option value="">اختر...</option>
            {categories.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="العلامة التجارية">
          <select name="brandId">
            <option value="">بدون علامة</option>
            {brands.map((b) => (
              <option value={b.id} key={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="note">
        كود المنتج وكود كل مقاس/لون والباركود تُنشأ تلقائيًا عند الحفظ.
      </p>
      <ProductImagePicker
        value={imageDataUrl}
        onChange={setImageDataUrl}
        onBusyChange={setImageBusy}
        disabled={busy}
      />
      <h3>المتغيرات</h3>
      <Field label="سياسة إرجاع هذا المنتج">
        <select name="returnRule" defaultValue="STANDARD">
          <option value="STANDARD">استبدال واسترجاع عادي</option>
          <option value="DEFECT_ONLY">
            عيب صناعة فقط (الملابس الداخلية وما شابه)
          </option>
        </select>
      </Field>
      {variants.map((v, i) => (
        <div className="variant-row" key={i}>
          {(["size", "color"] as const).map(
            (key) => (
              <Field
                key={key}
                label={
                  {
                    size: ar.size,
                    color: ar.color,
                  }[key]
                }
              >
                <input
                  value={v[key]}
                  type="text"
                  onChange={(e) =>
                    setVariants((rows) =>
                      rows.map((r, j) =>
                        j === i ? { ...r, [key]: e.target.value } : r,
                      ),
                    )
                  }
                />
              </Field>
            ),
          )}
          <Field label="الحد الأدنى">
            <input
              value={v.minStock ?? "2"}
              type="number"
              min="0"
              placeholder="الحد الأدنى"
              onChange={(e) =>
                setVariants((rows) =>
                  rows.map((r, j) =>
                    j === i ? { ...r, minStock: e.target.value } : r,
                  ),
                )
              }
            />
          </Field>
          {variants.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              aria-label="حذف المتغير"
              onClick={() =>
                setVariants((rows) => rows.filter((_, j) => j !== i))
              }
            >
              <X size={16} />
            </Button>
          )}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={() =>
          setVariants((v) => [
            ...v,
            { size: "", color: "", minStock: "2" },
          ])
        }
      >
        <Plus size={16} />
        مقاس / لون آخر
      </Button>
      <Button
        className="form-submit"
        disabled={busy || imageBusy || !categories.length}
      >
        {ar.save}
      </Button>
    </form>
  );
}

function Inventory() {
  const [tab, setTab] = useState("balances"),
    [offset, setOffset] = useState(0),
    [open, setOpen] = useState(false),
    [low, setLow] = useState(false),
    [locationFilter, setLocationFilter] = useState(""),
    [search, setSearch] = useState(""),
    { debounced: debouncedSearch, searchPending } = useDebouncedSearch(search),
    [detail, setDetail] = useState<Row | null>(null),
    path =
      tab === "balances"
        ? `/inventory?offset=${offset}${locationFilter ? `&locationId=${locationFilter}` : ""}${debouncedSearch ? `&q=${encodeURIComponent(debouncedSearch)}` : ""}`
        : tab === "movements"
          ? `/inventory/movements?offset=${offset}`
          : `/inventory/stock-counts?offset=${offset}`,
    query = useData(
      path,
      tab !== "documents",
      tab === "balances" ? searchPending : false,
    ),
    locations = useData("/locations"),
    products = useData("/products?limit=100"),
    action = useAction(),
    adjust = useAllowed("inventory.adjust"),
    count = useAllowed("inventory.count"),
    [selected, setSelected] = useState<Row | null>(null);
  return (
    <>
      <Header title={ar.inventory} subtitle="كل قطعة لها رصيد وحركة موثقة">
        {count && (
          <Button variant="outline" onClick={() => setSelected({ new: true })}>
            جرد جديد
          </Button>
        )}
        {adjust && (
          <Button onClick={() => setOpen(true)}>
            <Plus size={18} />
            تسوية المخزون
          </Button>
        )}
      </Header>
      <section className="panel">
        <div className="tabs">
          {[
            ["balances", "أرصدة المخزون"],
            ["movements", "سجل الحركات"],
            ["documents", "التحويلات والتالف والتسويات"],
            ...(count ? [["counts", "جلسات الجرد"]] : []),
          ].map(([k, label]) => (
            <button
              className={tab === k ? "active" : ""}
              key={k}
              onClick={() => {
                setTab(k!);
                setOffset(0);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "balances" && (
          <div
            className="toolbar"
            style={{
              display: "flex",
              gap: "1rem",
              flexWrap: "wrap",
              alignItems: "center",
              marginBottom: "1rem",
            }}
          >
            <div className="search" style={{ minWidth: "220px", flex: 1 }}>
              <Search size={18} />
              <input
                placeholder="ابحث بالاسم أو الباركود أو الكود..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setOffset(0);
                }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.9rem", color: "var(--muted)" }}>
                المخزن:
              </span>
              <select
                style={{
                  padding: "0.45rem 0.8rem",
                  borderRadius: "6px",
                  border: "1px solid var(--border)",
                  background: "var(--card-bg, inherit)",
                  color: "inherit",
                }}
                value={locationFilter}
                onChange={(e) => {
                  setLocationFilter(e.target.value);
                  setOffset(0);
                }}
              >
                <option value="">كل المخازن</option>
                {locations.data?.data?.map((l: Row) => (
                  <option key={l.id} value={l.id}>
                    {l.name} {l.branch?.name ? `(${l.branch.name})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <label
              className="checkbox"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                cursor: "pointer",
                margin: 0,
              }}
            >
              <input
                type="checkbox"
                checked={low}
                onChange={(e) => setLow(e.target.checked)}
              />
              منخفض المخزون فقط
            </label>
          </div>
        )}

        {tab === "documents" ? (
          <StockDocuments />
        ) : query.isLoading ? (
          <Loading />
        ) : query.error ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : (
          <>
            <Table
              rows={(query.data?.data ?? []).filter(
                (r: Row) =>
                  tab !== "balances" ||
                  !low ||
                  r.quantity <= r.variant.minStock,
              )}
              columns={
                tab === "balances"
                  ? [
                      {
                        label: "المنتج",
                        render: (r) => (
                          <div>
                            <strong>{r.variant.product.nameAr}</strong>
                            <small>
                              {Object.values(r.variant.options).join(" / ")}
                            </small>
                          </div>
                        ),
                      },
                      {
                        label: ar.barcode,
                        render: (r) => <code>{r.variant.barcode}</code>,
                      },
                      { label: ar.location, render: (r) => r.location.name },
                      {
                        label: "المتاح",
                        render: (r) => (
                          <span
                            className={
                              r.quantity <= r.variant.minStock
                                ? "low-stock"
                                : ""
                            }
                          >
                            {r.quantity}
                          </span>
                        ),
                      },
                      {
                        label: "الحد الأدنى",
                        render: (r) => r.variant.minStock,
                      },
                      {
                        label: ar.actions,
                        render: (r) => (
                          <Button
                            variant="ghost"
                            onClick={() => setDetail(r)}
                          >
                            التفاصيل
                          </Button>
                        ),
                      },
                    ]
                  : tab === "movements"
                    ? [
                        {
                          label: ar.date,
                          render: (r) => formatDate(r.createdAt),
                        },
                        {
                          label: "المنتج",
                          render: (r) => r.variant.product.nameAr,
                        },
                        {
                          label: "الحركة",
                          render: (r) => <Badge value={r.type} />,
                        },
                        {
                          label: ar.quantity,
                          render: (r) => (
                            <b
                              className={
                                r.quantity < 0 ? "negative" : "positive"
                              }
                            >
                              {r.quantity > 0 ? "+" : ""}
                              {r.quantity}
                            </b>
                          ),
                        },
                        { label: ar.reason, render: (r) => r.reason },
                        {
                          label: "المرجع",
                          render: (r) => <code>{r.reference.slice(0, 8)}</code>,
                        },
                      ]
                    : [
                        { label: ar.date, render: (r) => formatDate(r.cutoff) },
                        {
                          label: ar.status,
                          render: (r) => <Badge value={r.status} />,
                        },
                        { label: "عدد الأصناف", render: (r) => r.items.length },
                        {
                          label: ar.actions,
                          render: (r) =>
                            r.status === "OPEN" ? (
                              <Button
                                variant="outline"
                                onClick={() => setSelected(r)}
                              >
                                فتح الجرد
                              </Button>
                            ) : (
                              <span className="muted-text">تم إغلاق الجرد</span>
                            ),
                        },
                      ]
              }
            />
            <Pager
              offset={offset}
              setOffset={setOffset}
              length={query.data?.data.length ?? 0}
            />
          </>
        )}
      </section>
      <Modal title="تسوية المخزون" open={open} onClose={() => setOpen(false)}>
        <EntryForm
          fields={[
            {
              key: "variantId",
              label: "المتغير",
              options:
                products.data?.data.flatMap((p: Row) =>
                  p.variants.map((v: Row) => ({
                    value: v.id,
                    label: `${p.nameAr} • ${v.sku}`,
                  })),
                ) ?? [],
            },
            {
              key: "locationId",
              label: ar.location,
              options:
                locations.data?.data.map((l: Row) => ({
                  value: l.id,
                  label: l.name,
                })) ?? [],
            },
            simple("quantity", "فرق الكمية (+ زيادة / - نقص)"),
            simple("reason", ar.reason),
          ]}
          busy={action.busy}
          submit={(body) =>
            void action.run(
              () =>
                post(
                  "/inventory/adjustments",
                  { ...body, quantity: Number(body.quantity) },
                  crypto.randomUUID(),
                ),
              () => setOpen(false),
            )
          }
        />
      </Modal>
      <Modal
        title={selected?.new ? "جلسة جرد جديدة" : "الجرد الفعلي"}
        open={!!selected}
        onClose={() => setSelected(null)}
      >
        {selected?.new ? (
          <>
            <p className="note">
              الجرد بلقطة ثابتة يحتاج إيقاف الحركة. في الجرد المستمر سجّل كل سطر
              فور عدّه بالخروج من حقل الكمية؛ تُضاف الحركات التالية لذلك التوقيت
              عند الاعتماد.
            </p>
            <EntryForm
              fields={[
                {
                  key: "locationId",
                  label: ar.location,
                  options:
                    locations.data?.data.map((l: Row) => ({
                      value: l.id,
                      label: l.name,
                    })) ?? [],
                },
                {
                  key: "mode",
                  label: "أسلوب الجرد",
                  options: [
                    { value: "CUTOFF", label: "لقطة ثابتة مع إيقاف الحركة" },
                    {
                      value: "CONTINUOUS",
                      label: "جرد مستمر مع تسوية الحركات اللاحقة",
                    },
                  ],
                },
              ]}
              busy={action.busy}
              submit={(body) =>
                void action.run(
                  () => post("/inventory/stock-counts", body),
                  () => setSelected(null),
                )
              }
            />
          </>
        ) : (
          selected && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                void action.run(
                  async () => {
                    if (selected.mode !== "CONTINUOUS")
                      await patch(`/inventory/stock-counts/${selected.id}`, {
                        items: selected.items.map((i: Row) => ({
                          variantId: i.variantId,
                          actual: Number(data.get(i.variantId)),
                        })),
                      });
                    await post(
                      `/inventory/stock-counts/${selected.id}/approve`,
                      {},
                    );
                  },
                  () => setSelected(null),
                );
              }}
            >
              <p>لقطة المخزون: {formatDate(selected.cutoff)}</p>
              {selected.items.map((i: Row) => (
                <Field
                  key={i.variantId}
                  label={`${products.data?.data.flatMap((p: Row) => p.variants).find((v: Row) => v.id === i.variantId)?.sku ?? i.variantId} • المتوقع ${i.expected}`}
                >
                  <input
                    required
                    type="number"
                    min="0"
                    step="1"
                    name={i.variantId}
                    defaultValue={i.actual ?? ""}
                    onBlur={(e) => {
                      if (
                        selected.mode === "CONTINUOUS" &&
                        selected.status === "OPEN" &&
                        e.target.value !== ""
                      ) {
                        const actual = Number(e.target.value);
                        if (Number.isInteger(actual) && actual >= 0)
                          void action.run(
                            () =>
                              patch(`/inventory/stock-counts/${selected.id}`, {
                                items: [{ variantId: i.variantId, actual }],
                              }),
                            () =>
                              setSelected((current) =>
                                current
                                  ? {
                                      ...current,
                                      items: current.items.map((line: Row) =>
                                        line.variantId === i.variantId
                                          ? {
                                              ...line,
                                              actual,
                                              countedAt:
                                                new Date().toISOString(),
                                            }
                                          : line,
                                      ),
                                    }
                                  : current,
                              ),
                          );
                      }
                    }}
                    disabled={selected.status !== "OPEN"}
                  />
                </Field>
              ))}
              {adjust && selected.status === "OPEN" && (
                <Button disabled={action.busy}>حفظ واعتماد الجرد</Button>
              )}
              {selected.status === "OPEN" && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={action.busy}
                  onClick={() => {
                    if (window.confirm("إلغاء جلسة الجرد دون تغيير المخزون؟"))
                      void action.run(
                        () =>
                          post(
                            `/inventory/stock-counts/${selected.id}/cancel`,
                            {},
                            crypto.randomUUID(),
                          ),
                        () => setSelected(null),
                      );
                  }}
                >
                  إلغاء جلسة الجرد
                </Button>
              )}
            </form>
          )
        )}
      </Modal>
      <Modal
        title={`تفاصيل الصنف بالمخزن: ${detail?.variant?.product?.nameAr ?? ""}`}
        open={!!detail}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: "0.75rem",
              }}
            >
              <div
                className="card"
                style={{
                  padding: "0.85rem",
                  border: "1px solid var(--border, #e2e8f0)",
                  borderRadius: "8px",
                  background: "var(--card-bg, #fff)",
                }}
              >
                <small className="muted-text">اسم المنتج</small>
                <div style={{ fontWeight: 600, fontSize: "1.05rem" }}>
                  {detail.variant?.product?.nameAr}
                </div>
                <small dir="ltr" className="muted-text">
                  {detail.variant?.sku}
                </small>
              </div>
              <div
                className="card"
                style={{
                  padding: "0.85rem",
                  border: "1px solid var(--border, #e2e8f0)",
                  borderRadius: "8px",
                  background: "var(--card-bg, #fff)",
                }}
              >
                <small className="muted-text">المخزن</small>
                <div style={{ fontWeight: 600, fontSize: "1.05rem" }}>
                  {detail.location?.name}
                </div>
                {detail.location?.branch?.name && (
                  <small className="muted-text">
                    الفرع: {detail.location.branch.name}
                  </small>
                )}
              </div>
              <div
                className="card"
                style={{
                  padding: "0.85rem",
                  border: "1px solid var(--border, #e2e8f0)",
                  borderRadius: "8px",
                  background: "var(--card-bg, #fff)",
                }}
              >
                <small className="muted-text">المقاس / اللون</small>
                <div style={{ fontWeight: 600 }}>
                  {Object.values(detail.variant?.options ?? {}).join(" / ") ||
                    "بدون خيارات"}
                </div>
              </div>
              <div
                className="card"
                style={{
                  padding: "0.85rem",
                  border: "1px solid var(--border, #e2e8f0)",
                  borderRadius: "8px",
                  background: "var(--card-bg, #fff)",
                }}
              >
                <small className="muted-text">الباركود</small>
                <div>
                  <code>{detail.variant?.barcode}</code>
                </div>
              </div>
              <div
                className="card"
                style={{
                  padding: "0.85rem",
                  border: "1px solid var(--border, #e2e8f0)",
                  borderRadius: "8px",
                  background: "var(--card-bg, #fff)",
                }}
              >
                <small className="muted-text">الكمية المتاحة</small>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: "1.3rem",
                    color:
                      detail.quantity <= detail.variant?.minStock
                        ? "#ef4444"
                        : "#10b981",
                  }}
                >
                  {detail.quantity} قطعة
                </div>
              </div>
              <div
                className="card"
                style={{
                  padding: "0.85rem",
                  border: "1px solid var(--border, #e2e8f0)",
                  borderRadius: "8px",
                  background: "var(--card-bg, #fff)",
                }}
              >
                <small className="muted-text">الحد الأدنى للطلب (ديناميكي)</small>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    marginTop: "0.3rem",
                  }}
                >
                  <input
                    type="number"
                    min="0"
                    key={`min-${detail.variant?.id}-${detail.variant?.minStock}`}
                    defaultValue={detail.variant?.minStock ?? 2}
                    id={`min-stock-input-${detail.variant?.id}`}
                    style={{
                      width: "65px",
                      padding: "0.2rem 0.4rem",
                      borderRadius: "4px",
                      border: "1px solid var(--border)",
                      fontWeight: 600,
                    }}
                  />
                  <Button
                    variant="outline"
                    type="button"
                    disabled={action.busy}
                    onClick={() => {
                      const el = document.getElementById(
                        `min-stock-input-${detail.variant?.id}`,
                      ) as HTMLInputElement;
                      if (el && el.value !== "") {
                        const val = Number(el.value);
                        void action.run(
                          () =>
                            patch(`/variants/${detail.variant?.id}`, {
                              minStock: val,
                            }),
                          () => {
                            setDetail((curr) =>
                              curr
                                ? {
                                    ...curr,
                                    variant: { ...curr.variant, minStock: val },
                                  }
                                : null,
                            );
                          },
                        );
                      }
                    }}
                  >
                    حفظ
                  </Button>
                </div>
              </div>
              <div
                className="card"
                style={{
                  padding: "0.85rem",
                  border: "1px solid var(--border, #e2e8f0)",
                  borderRadius: "8px",
                  background: "var(--card-bg, #fff)",
                }}
              >
                <small className="muted-text">سعر البيع</small>
                <div style={{ fontWeight: 600 }}>
                  {fm(detail.variant?.price)}
                </div>
              </div>
              {detail.averageCost !== undefined && (
                <div
                  className="card"
                  style={{
                    padding: "0.85rem",
                    border: "1px solid var(--border, #e2e8f0)",
                    borderRadius: "8px",
                    background: "var(--card-bg, #fff)",
                  }}
                >
                  <small className="muted-text">متوسط التكلفة</small>
                  <div style={{ fontWeight: 600 }}>
                    {fm(detail.averageCost)}
                  </div>
                </div>
              )}
            </div>

            {adjust && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  marginTop: "0.5rem",
                }}
              >
                <Button
                  variant="outline"
                  onClick={() => {
                    setDetail(null);
                    setOpen(true);
                  }}
                >
                  <Plus size={16} />
                  تسوية رصيد هذا المخزن
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

function Purchases() {
  const [offset, setOffset] = useState(0),
    query = useData(`/purchases?offset=${offset}`),
    suppliers = useData("/suppliers?limit=100"),
    locations = useData("/locations"),
    products = useData("/products?limit=100"),
    [open, setOpen] = useState(false),
    [selected, setSelected] = useState<Row | null>(null),
    action = useAction(),
    create = useAllowed("purchases.create"),
    receive = useAllowed("purchases.receive");
  return (
    <>
      <Header
        title={ar.purchases}
        subtitle="من أمر الشراء إلى دخول القطع إلى المخزن"
      >
        {create && (
          <Button onClick={() => setOpen(true)}>
            <Plus size={18} />
            أمر شراء جديد
          </Button>
        )}
      </Header>
      <section className="panel">
        {query.isLoading ? (
          <Loading />
        ) : query.error ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : (
          <>
            <Table
              rows={query.data?.data ?? []}
              columns={[
                { label: ar.supplier, render: (r) => r.supplier.name },
                { label: ar.date, render: (r) => formatDate(r.createdAt) },
                {
                  label: ar.quantity,
                  render: (r) =>
                    r.items.reduce((s: number, i: Row) => s + i.quantity, 0),
                },
                {
                  label: "تم استلامه",
                  render: (r) =>
                    r.items.reduce((s: number, i: Row) => s + i.received, 0),
                },
                {
                  label: ar.total,
                  render: (r) =>
                    fm(
                      r.items.reduce(
                        (s: number, i: Row) =>
                          s + Number(i.unitCost) * i.quantity,
                        0,
                      ),
                    ),
                },
                { label: ar.status, render: (r) => <Badge value={r.status} /> },
                {
                  label: ar.actions,
                  render: (r) =>
                    receive && (
                      <div className="inline-actions">
                        {r.status === "DRAFT" ? (
                          <Button
                            variant="outline"
                            disabled={action.busy}
                            onClick={() =>
                              void action.run(() =>
                                post(`/purchases/${r.id}/approve`, {}),
                              )
                            }
                          >
                            اعتماد
                          </Button>
                        ) : (
                          ["APPROVED", "PARTIAL"].includes(r.status) && (
                            <Button
                              variant="outline"
                              onClick={() => setSelected(r)}
                            >
                              استلام
                            </Button>
                          )
                        )}
                      </div>
                    ),
                },
              ]}
            />
            <Pager
              offset={offset}
              setOffset={setOffset}
              length={query.data?.data.length ?? 0}
            />
          </>
        )}
      </section>
      <Modal title="أمر شراء جديد" open={open} onClose={() => setOpen(false)}>
        <PurchaseForm
          suppliers={suppliers.data?.data ?? []}
          locations={locations.data?.data ?? []}
          products={products.data?.data ?? []}
          busy={action.busy}
          submit={(body) =>
            void action.run(
              () => post("/purchases", body),
              () => setOpen(false),
            )
          }
        />
      </Modal>
      <Modal
        title="استلام المشتريات"
        open={!!selected}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <form
            className="entry-form"
            onSubmit={(e) => {
              e.preventDefault();
              const values = new FormData(e.currentTarget);
              void action.run(
                () =>
                  post(
                    `/purchases/${selected.id}/receive`,
                    {
                      items: selected.items
                        .map((i: Row) => ({
                          purchaseItemId: i.id,
                          quantity: Number(values.get(i.id)),
                        }))
                        .filter((i: Row) => i.quantity > 0),
                    },
                    crypto.randomUUID(),
                  ),
                () => setSelected(null),
              );
            }}
          >
            {selected.items
              .filter((i: Row) => i.received < i.quantity)
              .map((i: Row) => (
                <Field
                  key={i.id}
                  label={`${products.data?.data.flatMap((p: Row) => p.variants).find((v: Row) => v.id === i.variantId)?.sku ?? i.variantId} • المتبقي ${i.quantity - i.received}`}
                >
                  <input
                    type="number"
                    name={i.id}
                    min="0"
                    step="1"
                    max={i.quantity - i.received}
                    defaultValue={i.quantity - i.received}
                  />
                </Field>
              ))}
            <Button disabled={action.busy}>تأكيد الاستلام</Button>
          </form>
        )}
      </Modal>
    </>
  );
}
function PurchaseForm({
  suppliers,
  locations,
  products,
  busy,
  submit,
}: {
  suppliers: Row[];
  locations: Row[];
  products: Row[];
  busy: boolean;
  submit: (v: Row) => void;
}) {
  const [lines, setLines] = useState(1);
  const [linePrices, setLinePrices] = useState<Record<number, string>>({});

  const allVariants = products.flatMap((p: Row) =>
    p.variants.map((v: Row) => ({ ...v, productNameAr: p.nameAr })),
  );

  const handleVariantChange = (lineIndex: number, variantId: string) => {
    const variant = allVariants.find((v) => v.id === variantId);
    if (variant?.price) {
      setLinePrices((prev) => ({ ...prev, [lineIndex]: String(variant.price) }));
    } else {
      setLinePrices((prev) => ({ ...prev, [lineIndex]: "" }));
    }
  };

  return (
    <form
      className="entry-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        submit({
          supplierId: f.get("supplierId"),
          locationId: f.get("locationId"),
          items: Array.from({ length: lines }, (_, i) => ({
            variantId: f.get(`v${i}`),
            quantity: Number(f.get(`q${i}`)),
            unitCost: f.get(`c${i}`),
            salePrice: f.get(`sp${i}`),
            ...(f.get(`ms${i}`) ? { minStock: Number(f.get(`ms${i}`)) } : {}),
          })),
        });
      }}
    >
      <div className="form-grid">
        <Field label={ar.supplier}>
          <select required name="supplierId">
            <option value="">اختر...</option>
            {suppliers.map((s) => (
              <option value={s.id} key={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={ar.location}>
          <select required name="locationId">
            <option value="">اختر...</option>
            {locations.map((l) => (
              <option value={l.id} key={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {Array.from({ length: lines }, (_, i) => (
        <div className="purchase-line" key={i}>
          <Field label="الصنف">
            <select
              name={`v${i}`}
              required
              onChange={(e) => handleVariantChange(i, e.target.value)}
            >
              <option value="">اختر...</option>
              {products.flatMap((p) =>
                p.variants.map((v: Row) => (
                  <option key={v.id} value={v.id}>
                    {p.nameAr} • {Object.values(v.options ?? {}).join(" / ") || "بدون مقاس أو لون"}
                  </option>
                )),
              )}
            </select>
          </Field>
          <Field label={ar.quantity}>
            <input
              required
              type="number"
              name={`q${i}`}
              min="1"
              step="1"
              defaultValue="1"
            />
          </Field>
          <Field label="التكلفة — سعر الشراء">
            <input
              required
              type="number"
              name={`c${i}`}
              min="0"
              step="0.01"
              value={linePrices[i] ?? ""}
              onChange={(e) =>
                setLinePrices((prev) => ({ ...prev, [i]: e.target.value }))
              }
            />
          </Field>
          <Field label="سعر البيع">
            <input
              required
              type="number"
              name={`sp${i}`}
              min="0"
              step="0.01"
            />
          </Field>
          <Field label="الحد الأدنى">
            <input
              type="number"
              name={`ms${i}`}
              min="0"
              placeholder="ديناميكي"
            />
          </Field>
        </div>
      ))}
      <p className="note">
        التكلفة هي سعر الشراء من المورد. سعر البيع إن حُدِّد سيُحدَّث على المنتج فوراً.
      </p>
      <Button
        type="button"
        variant="outline"
        onClick={() => setLines((n) => n + 1)}
      >
        <Plus size={16} />
        صنف آخر
      </Button>
      <Button disabled={busy}>{ar.save}</Button>
    </form>
  );
}

function Sales() {
  const [exchangeSale, setExchangeSale] = useState<Row | null>(null),
    [returnedReceipt, setReturnedReceipt] = useState<{
      sale: Row;
      returned: Row;
    } | null>(null);
  const [offset, setOffset] = useState(0),
    [number, setNumber] = useState(""),
    { debounced: debouncedNumber, searchPending } = useDebouncedSearch(number),
    query = useData(
      `/sales?offset=${offset}${debouncedNumber ? `&number=${encodeURIComponent(debouncedNumber)}` : ""}`,
      true,
      searchPending,
    ),
    [selected, setSelected] = useState<Row | null>(null),
    [returning, setReturning] = useState(false),
    [printOnOpen, setPrintOnOpen] = useState(false),
    action = useAction(),
    shift = useData("/shifts/current"),
    refund = useAllowed("sales.refund");
  return (
    <>
      <Header title={ar.sales} subtitle="سجل الفواتير والمرتجعات">
        <Link className="btn btn-primary" to="/pos">
          <Plus size={18} />
          بيع جديد
        </Link>
      </Header>
      <section className="panel">
        <div className="toolbar">
          <div className="search">
            <Search size={18} />
            <input
              placeholder="ابحث برقم الفاتورة أو باركود المنتج..."
              value={number}
              onChange={(e) => {
                setNumber(e.target.value.trim());
                setOffset(0);
              }}
            />
          </div>
        </div>
        {query.isLoading ? (
          <Loading />
        ) : query.error ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : (
          <>
            <Table
              rows={query.data?.data ?? []}
              onRowClick={(r) => {
                setSelected(r);
                setReturning(false);
                setPrintOnOpen(false);
              }}
              columns={[
                {
                  label: "رقم الفاتورة",
                  render: (r) => (
                    <strong>{r.receiptNumber ?? `#${r.number}`}</strong>
                  ),
                },
                { label: ar.date, render: (r) => formatDate(r.createdAt) },
                {
                  label: "الأصناف والباركود",
                  render: (r) => (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", maxWidth: "240px" }}>
                      {r.items?.map((it: Row) => (
                        <div key={it.id} style={{ fontSize: "0.82rem", lineHeight: 1.3 }}>
                          <span>{it.name}</span>
                          {it.barcode && (
                            <code
                              style={{
                                fontSize: "0.75rem",
                                background: "var(--bg-subtle, #f1f5f9)",
                                padding: "1px 5px",
                                borderRadius: "4px",
                                marginInlineStart: "5px",
                              }}
                            >
                              {it.barcode}
                            </code>
                          )}
                          <span className="muted-text"> × {it.quantity}</span>
                        </div>
                      ))}
                    </div>
                  ),
                },
                { label: "الكاشير", render: (r) => r.user.name },
                {
                  label: ar.total,
                  render: (r) => <strong>{fm(r.total)}</strong>,
                },
                {
                  label: "الدفع",
                  render: (r) =>
                    r.payments.map((p: Row) => statuses[p.method]).join(" / "),
                },
                { label: ar.status, render: (r) => <Badge value={r.status} /> },
                {
                  label: ar.actions,
                  render: (r) => (
                    <div
                      className="sales-row-actions"
                      role="group"
                      aria-label={`إجراءات فاتورة ${r.receiptNumber ?? r.number}`}
                    >
                      <Button
                        variant="outline"
                        title="عرض الفاتورة"
                        aria-label="عرض الفاتورة"
                        onClick={() => {
                          setSelected(r);
                          setReturning(false);
                          setPrintOnOpen(false);
                        }}
                      >
                        <Eye size={17} />
                      </Button>
                      <Button
                        variant="outline"
                        title="طباعة الفاتورة"
                        aria-label="طباعة الفاتورة"
                        onClick={() => {
                          setSelected(r);
                          setReturning(false);
                          setPrintOnOpen(true);
                        }}
                      >
                        <Printer size={17} />
                      </Button>
                      {refund && r.status !== "FULLY_RETURNED" && (
                        <>
                          <Button
                            variant="outline"
                            title="استبدال منتجات"
                            aria-label="استبدال منتجات"
                            onClick={() => {
                              setExchangeSale(r);
                              setSelected(null);
                            }}
                          >
                            <ArrowRightLeft size={17} />
                          </Button>
                          <Button
                            variant="outline"
                            title="إرجاع منتجات"
                            aria-label="إرجاع منتجات"
                            onClick={() => {
                              setSelected(r);
                              setReturning(true);
                              setPrintOnOpen(false);
                            }}
                          >
                            <RotateCcw size={17} />
                          </Button>
                        </>
                      )}
                    </div>
                  ),
                },
              ]}
            />
            <Pager
              offset={offset}
              setOffset={setOffset}
              length={query.data?.data.length ?? 0}
              total={query.data?.total}
            />
          </>
        )}
      </section>
      <Modal
        title={returning ? "مرتجع مبيعات" : `فاتورة #${selected?.number ?? ""}`}
        open={!!selected}
        onClose={() => setSelected(null)}
      >
        {selected?.receiptSnapshot?.promotion?.returnRule === "FULL_BUNDLE" && (
          <p className="notice">
            هذه الفاتورة تشمل عرض هدية. أرجع أو استبدل جميع الأصناف المشمولة
            بالعرض معًا بالقيمة المدفوعة.
          </p>
        )}
        {selected &&
          (returning ? (
            <>
              <p className="notice">
                يجب فتح وردية لمعالجة الاسترداد. يُعاد المخزون فقط للمنتجات
                الصالحة للبيع.
              </p>
              <form
                className="entry-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void action.run(
                    async () => {
                      const result = await post(
                        `/sales/${selected.id}/returns`,
                        {
                          shiftId: shift.data?.data?.id,
                          reason: f.get("reason"),
                          reasonType: f.get("reasonType"),
                          method: f.get("method"),
                          items: selected.items
                            .map((i: Row) => ({
                              saleItemId: i.id,
                              quantity: Number(f.get(i.id)),
                              sellable: f.get(`s${i.id}`) === "on",
                            }))
                            .filter((i: Row) => i.quantity > 0),
                        },
                        crypto.randomUUID(),
                      );
                      setSelected(null);
                      setReturnedReceipt({
                        sale: selected,
                        returned: result.data,
                      });
                    },
                    () => setSelected(null),
                  );
                }}
              >
                {selected.items
                  .filter((i: Row) => i.quantity > i.returned)
                  .map((i: Row) => (
                    <div className="return-line" key={i.id}>
                      <Field
                        label={`${i.name} • متاح ${i.quantity - i.returned}`}
                      >
                        <input
                          name={i.id}
                          type="number"
                          min="0"
                          max={i.quantity - i.returned}
                          step="1"
                          defaultValue="0"
                        />
                      </Field>
                      <label className="checkbox">
                        <input
                          name={`s${i.id}`}
                          type="checkbox"
                          defaultChecked
                        />
                        صالح للبيع
                      </label>
                    </div>
                  ))}
                <Field label={ar.reason}>
                  <textarea required name="reason" minLength={3} />
                </Field>
                <Field label="نوع سبب الإرجاع">
                  <select name="reasonType">
                    <option value="CHANGE_MIND">
                      تغيير مقاس / لون / رغبة العميل
                    </option>
                    <option value="MANUFACTURING_DEFECT">عيب صناعة</option>
                  </select>
                </Field>
                <Field label="طريقة الاسترداد">
                  <select name="method">
                    <option value="CASH">نقدي</option>
                    <option value="CARD">بطاقة</option>
                    <option value="WALLET">محفظة</option>
                    <option value="BANK">تحويل</option>
                  </select>
                </Field>
                <Button disabled={action.busy || !shift.data?.data}>
                  اعتماد المرتجع
                </Button>
              </form>
            </>
          ) : (
            <>
              <ReceiptView
                sale={selected}
                autoPrint={printOnOpen}
                actions={
                  <>
                    {refund && selected.status !== "FULLY_RETURNED" && (
                      <Button
                        className="no-print"
                        variant="outline"
                        onClick={() => {
                          setExchangeSale(selected);
                          setSelected(null);
                        }}
                      >
                        <ArrowRightLeft size={18} />
                        استبدال منتجات
                      </Button>
                    )}
                    {refund && selected.status !== "FULLY_RETURNED" && (
                      <Button
                        className="no-print"
                        variant="outline"
                        onClick={() => setReturning(true)}
                      >
                        <RotateCcw size={18} />
                        إرجاع منتجات
                      </Button>
                    )}
                  </>
                }
              />
            </>
          ))}
      </Modal>
      {exchangeSale && (
        <ExchangeDialog
          sale={exchangeSale}
          close={() => setExchangeSale(null)}
        />
      )}
      <Modal
        title="إيصال المرتجع"
        open={!!returnedReceipt}
        onClose={() => setReturnedReceipt(null)}
      >
        {returnedReceipt && (
          <ReceiptView
            sale={returnedReceipt.sale}
            returned={returnedReceipt.returned}
          />
        )}
      </Modal>
    </>
  );
}

function Shifts() {
  const [offset, setOffset] = useState(0),
    query = useData(`/shifts?offset=${offset}`),
    current = useData("/shifts/current"),
    registers = useData("/registers"),
    [open, setOpen] = useState(false),
    [closing, setClosing] = useState<Row | null>(null),
    action = useAction();
  return (
    <>
      <Header
        title={ar.shifts}
        subtitle="رصيد افتتاحي واضح، وإغلاق قابل للمراجعة"
      >
        {!current.data?.data && (
          <Button onClick={() => setOpen(true)}>
            <Plus size={18} />
            فتح وردية
          </Button>
        )}
      </Header>
      {current.data?.data && (
        <div className="notice">
          <span className="status-dot" />
          وردية مفتوحة • {current.data.data.register.name} • رصيد الافتتاح{" "}
          {fm(current.data.data.openingCash)}
          <Link to="/pos">
            انتقل لنقطة البيع <ArrowUpLeft size={16} />
          </Link>
        </div>
      )}
      <section className="panel">
        {query.isLoading ? (
          <Loading />
        ) : query.error ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : (
          <>
            <Table
              rows={query.data?.data ?? []}
              columns={[
                { label: ar.register, render: (r) => r.register.name },
                { label: "الافتتاح", render: (r) => formatDate(r.openedAt) },
                { label: "رصيد الافتتاح", render: (r) => fm(r.openingCash) },
                {
                  label: "النقد المتوقع",
                  render: (r) => (r.closedAt ? fm(r.expectedCash) : "—"),
                },
                {
                  label: "النقد الفعلي",
                  render: (r) => (r.closedAt ? fm(r.countedCash) : "—"),
                },
                {
                  label: "العجز / الزيادة",
                  render: (r) =>
                    r.closedAt ? (
                      <b
                        className={
                          Number(r.difference) < 0 ? "negative" : "positive"
                        }
                      >
                        {fm(r.difference)}
                      </b>
                    ) : (
                      "—"
                    ),
                },
                {
                  label: ar.actions,
                  render: (r) =>
                    !r.closedAt ? (
                      <Button variant="outline" onClick={() => setClosing(r)}>
                        إغلاق الوردية
                      </Button>
                    ) : (
                      <Badge value="مغلقة" />
                    ),
                },
              ]}
            />
            <Pager
              offset={offset}
              setOffset={setOffset}
              length={query.data?.data.length ?? 0}
            />
          </>
        )}
      </section>
      <Modal title="فتح وردية" open={open} onClose={() => setOpen(false)}>
        <EntryForm
          fields={[
            {
              key: "registerId",
              label: ar.register,
              options:
                registers.data?.data.map((r: Row) => ({
                  value: r.id,
                  label: r.name,
                })) ?? [],
            },
            simple("openingCash", "النقد الافتتاحي", "number"),
          ]}
          busy={action.busy}
          submit={(body) =>
            void action.run(
              () => post("/shifts/open", body, crypto.randomUUID()),
              () => setOpen(false),
            )
          }
        />
      </Modal>
      <Modal
        title="إغلاق وتسوية الوردية"
        open={!!closing}
        onClose={() => setClosing(null)}
      >
        <p>
          أدخل النقد الفعلي بعد عدّ الدرج. يُحسب العجز أو الزيادة على الخادم ويُحفظ
          نهائياً.
        </p>
        <EntryForm
          fields={[
            simple("countedCash", "النقد الفعلي", "number"),
            simple("notes", ar.notes, "textarea", false),
          ]}
          busy={action.busy}
          submit={(body) =>
            void action.run(
              () =>
                post(`/shifts/${closing?.id}/close`, body, crypto.randomUUID()),
              () => setClosing(null),
            )
          }
        />
      </Modal>
    </>
  );
}

function Records({ kind }: { kind: string }) {
  const [search, setSearch] = useState("");
  const { debounced: debouncedSearch, searchPending } =
    useDebouncedSearch(search);
  const [editingRecord, setEditingRecord] = useState<Row | null>(null);
  const [historyCustomer, setHistoryCustomer] = useState<Row | null>(null);
  const [offset, setOffset] = useState(0),
    [open, setOpen] = useState(false),
    query = useData(
      `/${kind}?offset=${offset}${kind === "customers" ? `&q=${encodeURIComponent(debouncedSearch)}` : ""}`,
      true,
      kind === "customers" && searchPending,
    ),
    roles = useData("/roles", kind === "users"),
    shift = useData("/shifts/current", kind === "expenses"),
    action = useAction(),
    user = useSession((s) => s.user)!,
    canCreate =
      kind !== "audit-logs" &&
      user.permissions.includes(
        (
          {
            suppliers: "suppliers.manage",
            customers: "customers.manage",
            expenses: "expenses.create",
            users: "users.manage",
          } as Row
        )[kind],
      );
  const fields: FieldSpec[] =
    kind === "suppliers"
      ? [
          simple("name", ar.name),
          simple("phone", ar.phone),
          simple("address", "العنوان", "text", false),
          simple("openingBalance", "الرصيد الافتتاحي", "number"),
        ]
      : kind === "customers"
        ? [
            simple("name", "الاسم (اختياري)", "text", false),
            simple("phone", ar.phone, "tel"),
            simple("email", ar.email, "email", false),
            simple("address", "العنوان", "text", false),
            simple("notes", ar.notes, "textarea", false),
          ]
        : kind === "expenses"
          ? [
              {
                key: "category",
                label: ar.category,
                options: [
                  "إيجار",
                  "كهرباء",
                  "إنترنت",
                  "رواتب",
                  "نقل",
                  "تغليف",
                  "صيانة",
                  "تسويق",
                  "أخرى",
                ].map((value) => ({ value, label: value })),
              },
              simple("amount", ar.amount, "number"),
              {
                key: "method",
                label: "طريقة الدفع",
                options: [
                  { value: "CASH", label: ar.cash },
                  { value: "BANK", label: ar.bank },
                  { value: "WALLET", label: ar.wallet },
                  { value: "CARD", label: ar.card },
                ],
              },
              simple("description", ar.description, "textarea"),
            ]
          : [
              simple("name", ar.name),
              simple("email", ar.email, "email"),
              {
                key: "password",
                label: editingRecord
                  ? "كلمة المرور الجديدة (اتركه فارغاً للإبقاء على الحالية)"
                  : "كلمة المرور (٨ أحرف على الأقل)",
                type: "password",
                required: !editingRecord,
              },
              {
                key: "roleId",
                label: "الدور",
                options:
                  roles.data?.data.map((r: Row) => ({
                    value: r.id,
                    label: roleLabels[r.name] ?? r.name,
                  })) ?? [],
              },
              simple("discountLimit", "حد الخصم (%)", "number"),
            ];
  const columns =
    kind === "audit-logs"
      ? [
          { label: ar.date, render: (r: Row) => formatDate(r.createdAt) },
          { label: "الإجراء", render: (r: Row) => <code>{r.action}</code> },
          {
            label: "المستخدم",
            render: (r: Row) => (
              <code>{r.userId?.slice(0, 8) ?? "النظام"}</code>
            ),
          },
          { label: "المرجع", render: (r: Row) => <code>{r.reference}</code> },
        ]
      : kind === "expenses"
        ? [
            { label: ar.date, render: (r: Row) => formatDate(r.date) },
            { label: ar.category, render: (r: Row) => r.category },
            { label: ar.description, render: (r: Row) => r.description },
            { label: ar.amount, render: (r: Row) => fm(r.amount) },
            { label: "الدفع", render: (r: Row) => statuses[r.method] },
          ]
        : [
            {
              label: ar.name,
              render: (r: Row) => (
                <strong>
                  {r.name || (kind === "customers" ? "بدون اسم" : "—")}
                </strong>
              ),
            },
            {
              label: kind === "users" ? ar.email : ar.phone,
              render: (r: Row) =>
                kind === "users" ? (
                  r.email
                ) : (
                  <bdi dir="ltr" className="customer-phone">
                    {r.phone}
                  </bdi>
                ),
            },
            ...(kind === "users"
              ? [
                  {
                    label: "الأدوار",
                    render: (r: Row) =>
                      r.roles
                        .map(
                          (v: Row) =>
                            roleLabels[v.role.name] ?? v.role.name,
                        )
                        .join(" / "),
                  },
                  {
                    label: ar.status,
                    render: (r: Row) => (
                      <Badge value={r.active ? "نشط" : "معطّل"} />
                    ),
                  },
                  {
                    label: ar.actions,
                    render: (r: Row) => (
                      <div
                        className="inline-actions"
                        style={{ display: "flex", gap: "0.5rem" }}
                      >
                        <Button
                          variant="outline"
                          onClick={() => {
                            setEditingRecord({
                              id: r.id,
                              name: r.name,
                              email: r.email,
                              roleId: r.roles?.[0]?.role?.id ?? "",
                              discountLimit: r.discountLimit,
                            });
                            setOpen(true);
                          }}
                        >
                          تعديل
                        </Button>
                        {!r.roles.some((v: Row) => v.role.name === "OWNER") && (
                          <Button
                            variant="outline"
                            disabled={action.busy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  "تغيير حالة المستخدم وإلغاء جلساته؟",
                                )
                              )
                                void action.run(() =>
                                  patch(`/users/${r.id}/status`, {
                                    active: !r.active,
                                  }),
                                );
                            }}
                          >
                            {r.active ? "تعطيل" : "تفعيل"}
                          </Button>
                        )}
                      </div>
                    ),
                  },
                ]
              : [
                  { label: "العنوان", render: (r: Row) => r.address || "—" },
                  ...(kind === "customers"
                    ? [
                        {
                          label: ar.actions,
                          render: (r: Row) => (
                            <div className="head-actions">
                              <Button
                                variant="outline"
                                onClick={() => {
                                  setEditingRecord(r);
                                  setOpen(true);
                                }}
                              >
                                تعديل
                              </Button>
                              {user.permissions.some((p) =>
                                ["sales.view_all", "sales.view_own"].includes(
                                  p,
                                ),
                              ) && (
                                <Button
                                  variant="outline"
                                  onClick={() => setHistoryCustomer(r)}
                                >
                                  سجل العميل
                                </Button>
                              )}
                            </div>
                          ),
                        },
                      ]
                    : []),
                ]),
          ];
  return (
    <>
      <Header
        title={nav.find((n) => n.path === `/${kind}`)?.title ?? ""}
        subtitle="بيانات محفوظة ومتصلة بعمليات متجرك"
      >
        {canCreate && (
          <Button
            onClick={() => {
              setEditingRecord(null);
              setOpen(true);
            }}
          >
            <Plus size={18} />
            {ar.add}
          </Button>
        )}
      </Header>
      <section className="panel">
        {kind === "customers" && (
          <div className="toolbar">
            <input
              aria-label="بحث العملاء"
              dir="ltr"
              style={{ textAlign: "right" }}
              placeholder="ابحث بالاسم أو رقم الهاتف"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
            />
          </div>
        )}
        {query.isLoading ? (
          <Loading />
        ) : query.error ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : (
          <>
            <Table rows={query.data?.data ?? []} columns={columns} />
            <Pager
              offset={offset}
              setOffset={setOffset}
              length={query.data?.data.length ?? 0}
            />
          </>
        )}
      </section>
      {historyCustomer && (
        <Modal
          title={`سجل العميل — ${historyCustomer.name || historyCustomer.phone}`}
          open
          onClose={() => setHistoryCustomer(null)}
        >
          <CustomerHistory customerId={historyCustomer.id} />
        </Modal>
      )}
      <Modal
        title={
          editingRecord
            ? kind === "users"
              ? `تعديل المستخدم: ${editingRecord.name}`
              : kind === "customers"
                ? "تعديل العميل"
                : "تعديل"
            : ar.add
        }
        open={open}
        onClose={() => {
          setOpen(false);
          setEditingRecord(null);
        }}
      >
        <EntryForm
          key={editingRecord?.id ?? "new"}
          initial={editingRecord ?? undefined}
          fields={fields}
          busy={action.busy}
          submit={(body) => {
            if (kind === "users") {
              body.roleIds = [body.roleId];
              delete body.roleId;
              if (!body.password) {
                delete body.password;
              }
              if (!body.employeeCode) delete body.employeeCode;
            }
            if (kind === "customers" && !body.email) {
              if (editingRecord) body.email = null;
              else delete body.email;
            }
            if (kind === "expenses" && body.method === "CASH")
              body.shiftId = shift.data?.data?.id;
            void action.run(
              () =>
                editingRecord
                  ? patch(`/${kind}/${editingRecord.id}`, body)
                  : post(
                      `/${kind}`,
                      body,
                      kind === "expenses" ? crypto.randomUUID() : undefined,
                    ),
              () => {
                setOpen(false);
                setEditingRecord(null);
              },
            );
          }}
        />
      </Modal>
    </>
  );
}
function StoreSettings() {
  const query = useData("/store"),
    action = useAction();
  return (
    <>
      <Header
        title={ar.settings}
        subtitle="هوية المتجر وسياسات البيع والطباعة"
      />
      <LogoSettings />
      <LoyaltySettings />
      <section className="panel settings-panel">
        {query.isLoading ? (
          <Loading />
        ) : query.error ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : (
          <EntryForm
            key={query.dataUpdatedAt}
            initial={query.data?.data}
            fields={[
              simple("name", "اسم المتجر"),
              simple("address", "العنوان", "text", false),
              simple("phone", ar.phone, "text", false),
              simple("branchName", "اسم الفرع المطبوع", "text", false),
              simple("taxNumber", "الرقم الضريبي", "text", false),
              simple("commercialRegister", "رقم السجل التجاري", "text", false),
              {
                key: "invoicePrefix",
                label: "بادئة رقم الفاتورة",
                default: "INV",
              },
              {
                key: "currency",
                label: "العملة",
                options: [{ value: "EGP", label: "جنيه مصري" }],
              },
              {
                key: "timezone",
                label: "المنطقة الزمنية",
                options: [{ value: "Africa/Cairo", label: "القاهرة" }],
              },
              simple("taxRate", "نسبة الضريبة (%)", "number"),
              {
                key: "taxMode",
                label: "طريقة احتساب الضريبة",
                default: "INCLUSIVE",
                options: [
                  {
                    value: "INCLUSIVE",
                    label: "الضريبة مشمولة داخل سعر البيع",
                  },
                  { value: "EXCLUSIVE", label: "الضريبة تُضاف إلى سعر البيع" },
                ],
              },
              simple("returnDays", "فترة الاسترجاع بالأيام", "number"),
              {
                key: "receiptWidth",
                label: "عرض الإيصال",
                options: [
                  { value: "80", label: "80 مم" },
                  { value: "58", label: "58 مم" },
                ],
              },
              simple("receiptFooter", "رسالة الإيصال", "textarea", false),
              simple(
                "returnPolicy",
                "سياسة الاستبدال والاسترجاع المطبوعة",
                "textarea",
                false,
              ),
            ]}
            busy={action.busy}
            submit={(body) =>
              void action.run(() =>
                patch("/settings/store", {
                  ...body,
                  returnDays: Number(body.returnDays),
                  receiptWidth: Number(body.receiptWidth),
                }),
              )
            }
          />
        )}
      </section>
    </>
  );
}
function Roles() {
  const query = useData("/roles"),
    perms = useData("/permissions"),
    [selected, setSelected] = useState<Row | null>(null),
    [open, setOpen] = useState(false),
    action = useAction();
  return (
    <>
      <Header title={ar.roles} subtitle="الصلاحيات تُطبّق على كل طلب في الخادم">
        <Button
          onClick={() => {
            setSelected(null);
            setOpen(true);
          }}
        >
          <Plus size={18} />
          دور جديد
        </Button>
      </Header>
      <section className="panel">
        {query.isLoading ? (
          <Loading />
        ) : query.error ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : (
          <Table
            rows={query.data?.data ?? []}
            columns={[
              {
                label: "الدور",
                render: (r) => <strong>{roleLabels[r.name] ?? r.name}</strong>,
              },
              { label: "الصلاحيات", render: (r) => r.permissions.length },
              {
                label: ar.actions,
                render: (r) =>
                  r.protected ? (
                    <span>دور المالك محمي</span>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSelected(r);
                        setOpen(true);
                      }}
                    >
                      تعديل الصلاحيات
                    </Button>
                  ),
              },
            ]}
          />
        )}
      </section>
      <Modal
        title={selected ? (roleLabels[selected.name] ?? selected.name) : "دور جديد"}
        open={open}
        onClose={() => setOpen(false)}
      >
        <form
          className="entry-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget),
              permissions = f.getAll("permission");
            void action.run(
              () =>
                selected
                  ? patch(`/roles/${selected.id}`, { permissions })
                  : post("/roles", { name: f.get("name"), permissions }),
              () => setOpen(false),
            );
          }}
        >
          {!selected && (
            <Field label="اسم الدور">
              <input required name="name" />
            </Field>
          )}
          <div
            className="permissions-grouped"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
              maxHeight: "60vh",
              overflowY: "auto",
              paddingLeft: "0.5rem",
            }}
          >
            {Object.entries(
              (perms.data?.data ?? []).reduce(
                (acc: Record<string, string[]>, p: string) => {
                  const group = permissionLabels[p]?.group ?? "أخرى";
                  if (!acc[group]) acc[group] = [];
                  acc[group].push(p);
                  return acc;
                },
                {},
              ),
            ).map(([group, list]) => (
              <div
                key={group}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  padding: "0.75rem",
                  background: "var(--card-bg, #fff)",
                }}
              >
                <h4
                  style={{
                    margin: "0 0 0.5rem",
                    fontSize: "0.95rem",
                    color: "var(--primary)",
                  }}
                >
                  {group}
                </h4>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fit, minmax(260px, 1fr))",
                    gap: "0.5rem",
                  }}
                >
                  {(list as string[]).map((p) => {
                    const info = permissionLabels[p];
                    return (
                      <label
                        className="checkbox"
                        key={p}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: "0.5rem",
                          cursor: "pointer",
                          margin: 0,
                          padding: "0.25rem 0",
                        }}
                      >
                        <input
                          type="checkbox"
                          name="permission"
                          value={p}
                          defaultChecked={selected?.permissions.some(
                            (v: Row) => v.permissionKey === p,
                          )}
                          style={{ marginTop: "0.2rem" }}
                        />
                        <div>
                          <div
                            style={{
                              fontWeight: 500,
                              fontSize: "0.9rem",
                            }}
                          >
                            {info?.label ?? p}
                          </div>
                          <small
                            style={{
                              color: "var(--muted, #64748b)",
                              fontSize: "0.75rem",
                            }}
                            dir="ltr"
                          >
                            {p}
                          </small>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <Button disabled={action.busy}>{ar.save}</Button>
        </form>
      </Modal>
    </>
  );
}
