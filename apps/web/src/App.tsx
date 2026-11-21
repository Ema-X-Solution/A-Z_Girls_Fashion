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
import { ar, formatDate, formatMoney as fm, statuses } from "./i18n";
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
    permission: "purchases.view",
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
      {allowed.filter((n) => n.path === "/dashboard").map(link)}
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
}: {
  rows: Row[];
  columns: { label: string; render: (r: Row) => ReactNode }[];
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
            <tr key={r.id ?? i}>
              {columns.map((c, j) => (
                <td key={j}>{c.render(r)}</td>
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
                <Gate permission="purchases.view">
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
                      label: `${v.sku} ${Object.values(v.options).join(" / ")}`,
                    })),
                  },
                  simple("price", "سعر البيع الجديد", "number"),
                ]}
                busy={action.busy}
                submit={(body) =>
                  void action.run(
                    () =>
                      patch(`/variants/${body.variantId}`, {
                        price: body.price,
                      }),
                    () => setSelected(null),
                  )
                }
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
    { size: "", color: "", price: "" },
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
            price: v.price,
            options: {
              ...(v.size ? { المقاس: v.size } : {}),
              ...(v.color ? { اللون: v.color } : {}),
            },
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
          {(["size", "color", "price"] as const).map(
            (key) => (
              <Field
                key={key}
                label={
                  {
                    size: ar.size,
                    color: ar.color,
                    price: "السعر — سعر البيع",
                  }[key]
                }
              >
                <input
                  value={v[key]}
                  type={key === "price" ? "number" : "text"}
                  min="0"
                  step="0.01"
                  required={key === "price"}
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
            { size: "", color: "", price: "" },
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
    path =
      tab === "balances"
        ? "/inventory"
        : tab === "movements"
          ? "/inventory/movements"
          : "/inventory/stock-counts",
    query = useData(`${path}?offset=${offset}`, tab !== "documents"),
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
          {tab === "balances" && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={low}
                onChange={(e) => setLow(e.target.checked)}
              />
              منخفض المخزون فقط
            </label>
          )}
        </div>
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
                          render: (r) => (
                            <Button
                              variant="outline"
                              onClick={() => setSelected(r)}
                            >
                              فتح الجرد
                            </Button>
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
            <select name={`v${i}`} required>
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
            <input required type="number" name={`c${i}`} min="0" step="0.01" />
          </Field>
        </div>
      ))}
      <p className="note">
        هذه هي التكلفة الفعلية من المورد، ومنها يُحسب متوسط تكلفة المخزون والربح.
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
              placeholder="ابحث برقم الفاتورة"
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
              columns={[
                {
                  label: "رقم الفاتورة",
                  render: (r) => (
                    <strong>{r.receiptNumber ?? `#${r.number}`}</strong>
                  ),
                },
                { label: ar.date, render: (r) => formatDate(r.createdAt) },
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
  const [editingCustomer, setEditingCustomer] = useState<Row | null>(null);
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
              simple("password", "كلمة المرور (٨ أحرف على الأقل)", "password"),
              {
                key: "roleId",
                label: "الدور",
                options:
                  roles.data?.data.map((r: Row) => ({
                    value: r.id,
                    label: r.name,
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
                      r.roles.map((v: Row) => v.role.name).join(" / "),
                  },
                  {
                    label: ar.status,
                    render: (r: Row) => (
                      <Badge value={r.active ? "نشط" : "معطّل"} />
                    ),
                  },
                  {
                    label: ar.actions,
                    render: (r: Row) =>
                      !r.roles.some((v: Row) => v.role.name === "OWNER") && (
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
                                  setEditingCustomer(r);
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
              setEditingCustomer(null);
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
        title={editingCustomer ? "تعديل العميل" : ar.add}
        open={open}
        onClose={() => setOpen(false)}
      >
        <EntryForm
          key={editingCustomer?.id ?? "new"}
          initial={editingCustomer ?? undefined}
          fields={fields}
          busy={action.busy}
          submit={(body) => {
            if (kind === "users") {
              body.roleIds = [body.roleId];
              if (!body.employeeCode) delete body.employeeCode;
              delete body.roleId;
            }
            if (kind === "customers" && !body.email) {
              if (editingCustomer) body.email = null;
              else delete body.email;
            }
            if (kind === "expenses" && body.method === "CASH")
              body.shiftId = shift.data?.data?.id;
            void action.run(
              () =>
                editingCustomer && kind === "customers"
                  ? patch(`/customers/${editingCustomer.id}`, body)
                  : post(
                      `/${kind}`,
                      body,
                      kind === "expenses" ? crypto.randomUUID() : undefined,
                    ),
              () => setOpen(false),
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
              { label: "الدور", render: (r) => <strong>{r.name}</strong> },
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
        title={selected?.name ?? "دور جديد"}
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
          <div className="permissions-grid">
            {perms.data?.data.map((p: string) => (
              <label className="checkbox" key={p}>
                <input
                  type="checkbox"
                  name="permission"
                  value={p}
                  defaultChecked={selected?.permissions.some(
                    (v: Row) => v.permissionKey === p,
                  )}
                />
                <code>{p}</code>
              </label>
            ))}
          </div>
          <Button disabled={action.busy}>{ar.save}</Button>
        </form>
      </Modal>
    </>
  );
}
