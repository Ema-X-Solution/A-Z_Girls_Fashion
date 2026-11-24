import { Link } from "react-router-dom";
import {
  ScanBarcode, Receipt, ShieldCheck, ShoppingBag, Printer, Boxes,
  Truck, Plus, Users, Wallet, ChartNoAxesCombined, Settings, ArrowUpLeft,
} from "lucide-react";
import { useSession } from "../../api";
import { Header } from "../../components/application/Primitives";

export function QuickAccess() {
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
                      height: "100%",
                      gap: "1rem",
                      padding: "1rem 1.25rem",
                      border: "1px solid var(--border)",
                      borderRadius: "10px",
                      background: "var(--card-bg, #fff)",
                      textDecoration: "none",
                      color: "inherit",
                      transition:
                        "transform 0.15s ease, box-shadow 0.15s ease",
                      boxShadow: "0 2px 6px rgba(0,0,0,0.03)",
                    }}
                  >
                    <div
                      style={{
                        width: "48px",
                        height: "48px",
                        borderRadius: "10px",
                        background: "#f7f2e4",
                        color: "#a4823c",
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
