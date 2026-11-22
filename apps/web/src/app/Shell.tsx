import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Menu } from "lucide-react";
import { POS } from "../features/pos/POS";
import { DiscountApprovals } from "../features/pos/DiscountApprovals";
import { BrandLogo } from "../features/shared/BrandLogo";
import { Promotions } from "../features/pos/Promotions";
import { post, useCart, useSession } from "../api";
import { ar, displayLocale } from "../i18n";
import { QuickAccess } from "../features/quick-access/QuickAccess";
import { Button } from "../components/ui/button";
import { BarcodeLabels } from "../features/barcodes/BarcodeLabels";
import { Suppliers, SupplierDetails } from "../features/suppliers/Suppliers";
import { Expenses } from "../features/management/Expenses";
import { Administration } from "../features/management/Administration";
import { Reports } from "../features/management/Reports";
import { AdvancedInventory } from "../features/management/AdvancedInventory";
import { notify, readableError } from "./notifications";
import { Gate } from "../components/application/Primitives";
import { nav, SidebarNavigation } from "./SidebarNavigation";
import { Dashboard } from "../features/dashboard/Dashboard";
import { Products } from "../features/products/Products";
import { Inventory } from "../features/inventory/Inventory";
import { Purchases } from "../features/purchases/Purchases";
import { Sales } from "../features/sales/Sales";
import { Shifts } from "../features/shifts/Shifts";
import { Records } from "../features/records/Records";
import { StoreSettings } from "../features/settings/StoreSettings";
import { RolesPage } from "../features/roles/RolesPage";

export function Shell() {
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
      <div className={location.pathname === "/pos" ? "workspace workspace-pos" : "workspace"}>
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
            {new Intl.DateTimeFormat(displayLocale, {
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
                  <RolesPage />
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
