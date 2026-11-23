import { Pagination } from "../../components/application/Pagination";
import { TableSkeleton } from "../../components/application/Skeleton";
import { usePagination } from "../../hooks/usePagination";
import { useState } from "react";
import { Plus } from "lucide-react";
import { patch, post, useSession } from "../../api";
import {
  ar,
  formatDate,
  formatMoney as fm,
  statuses,
  roleLabels,
} from "../../i18n";

const auditActions: Record<string, string> = {
  EXPENSE_SUBMITTED: "طلب مراجعة مصروف",
  EXPENSE: "تسجيل مصروف",
  EXPENSE_CATEGORY_STATUS: "تغيير حالة تصنيف مصروف",
  PROMOTION_CREATED: "إنشاء عرض",
  PROMOTION_UPDATED: "تعديل عرض",
  DISCOUNT_APPROVED: "اعتماد خصم",
  DISCOUNT_REJECTED: "رفض خصم",
  PRODUCT_RESTORE: "استعادة منتج",
  SALE: "إنشاء فاتورة بيع",
  REFUND: "مرتجع نقدي",
  CHECKOUT_CANCELLED: "إلغاء فاتورة من نقطة البيع",
  CUSTOMER_CREATE: "إضافة عميل",
  PURCHASE_RECEIVE: "استلام مشتريات",
  SUPPLIER_PAYMENT: "سداد مورد",
  SUPPLIER_RETURN: "مرتجع مورد",
  ROLE_CREATE: "إنشاء دور صلاحيات",
  ROLE_UPDATE: "تعديل دور صلاحيات",
  DISCOUNT_APPROVAL_USED: "استخدام موافقة خصم",
  LOGIN: "تسجيل دخول",
  LOGIN_FAILED: "محاولة دخول فاشلة",
  SHIFT_OPEN: "فتح وردية",
  SHIFT_CLOSE: "إغلاق وردية",
  SHIFT_REOPEN: "إعادة فتح وردية الدرج",
  CASH_MOVEMENT: "حركة نقدية",
  NET_EXCHANGE: "استبدال صافي",
  CATEGORY_RENAME: "إعادة تسمية قسم",
  CATEGORY_ARCHIVE: "أرشفة قسم",
  CATEGORY_DELETE: "حذف قسم",
  CATEGORY_RESTORE: "استعادة قسم من الأرشيف",
  PRODUCT_CREATE: "إضافة منتج",
  PRODUCT_UPDATE: "تعديل منتج",
  PRODUCT_ARCHIVE: "أرشفة منتج",
  PRODUCT_IMAGE_UPDATED: "تحديث صورة منتج",
  VARIANT_CREATE: "إضافة متغير منتج",
  VARIANT_UPDATE: "تعديل متغير منتج",
  BARCODE_LABELS_PREPARE: "تجهيز ملصقات باركود",
  BRANCH_CREATE: "إضافة فرع",
  BRANCH_UPDATE: "تعديل فرع",
  REGISTER_CREATE: "إضافة جهاز كاشير",
  REGISTER_UPDATE: "تعديل جهاز كاشير",
  STOCK_LOCATION: "تعديل موقع مخزون",
  COUNT_OPEN: "فتح جلسة جرد",
  COUNT_APPROVE: "اعتماد جرد",
  COUNT_CANCEL: "إلغاء جرد",
  QUARANTINE_CREATE: "إضافة حجر مخزون",
  QUARANTINE_RESOLVE: "معالجة حجر مخزون",
  SHIPMENT_SEND: "إرسال شحنة",
  SHIPMENT_RECEIVE: "استلام شحنة",
  PURCHASE_CREATE: "إنشاء أمر شراء",
  PURCHASE_APPROVE: "اعتماد أمر شراء",
  SUPPLIER_CREATE: "إضافة مورد",
  SUPPLIER_UPDATE: "تعديل مورد",
  CUSTOMER_UPDATE: "تعديل عميل",
  CUSTOMER_DISCOUNT: "خصم عميل",
  DISCOUNT_REQUESTED: "طلب موافقة خصم",
  EXPENSE_DECISION: "قرار مصروف",
  EXPENSE_CATEGORY_CREATE: "إضافة فئة مصروف",
  EXPENSE_ATTACHMENT: "إرفاق مستند مصروف",
  STORE_SETTINGS: "تعديل إعدادات المتجر",
  LOYALTY_SETTINGS: "تعديل إعدادات الولاء",
  LOGO_UPDATED: "تحديث الشعار",
  USER_CREATE: "إضافة مستخدم",
  USER_UPDATE: "تعديل مستخدم",
  USER_STATUS: "تغيير حالة مستخدم",
  USER_ROLE_CHANGE: "تغيير دور مستخدم",
  USER_SESSIONS_REVOKE: "إنهاء جلسات مستخدم",
  SESSION_REVOKE: "إنهاء جلسة",
  CREDENTIAL_RESET: "إعادة تعيين بيانات دخول",
};
import { Button } from "../../components/ui/button";
import { CustomerHistory } from "../customers/CustomerHistory";
import { useDebouncedSearch } from "../../hooks/useDebouncedSearch";
import { useAction } from "../../app/notifications";
import { useData } from "../../hooks/useData";
import {
  ErrorState,
  Modal,
  Header,
  Badge,
  Table,
} from "../../components/application/Primitives";
import {
  type FieldSpec,
  EntryForm,
  simple,
} from "../../components/application/EntryForm";
import { nav } from "../../app/SidebarNavigation";
import { type Row } from "../../app/types";

export function Records({ kind }: { kind: string }) {
  const [search, setSearch] = useState("");
  const { debounced: debouncedSearch, searchPending } =
    useDebouncedSearch(search);
  const [editingRecord, setEditingRecord] = useState<Row | null>(null);
  const [historyCustomer, setHistoryCustomer] = useState<Row | null>(null);
  const paging = usePagination(`${kind}|${search.trim()}`),
    [open, setOpen] = useState(false),
    query = useData(
      `/${kind}?${paging.query}${kind === "customers" ? `&q=${encodeURIComponent(debouncedSearch)}` : ""}`,
      true,
      kind === "customers" && searchPending,
    ),
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
                  : "كلمة المرور (8 أحرف على الأقل)",
                type: "password",
                required: !editingRecord,
              },
              {
                key: "roleId",
                label: "الدور",
                pickerEndpoint: "/options/roles",
              },
              simple("discountLimit", "حد الخصم (%)", "number"),
            ];
  const columns =
    kind === "audit-logs"
      ? [
          { label: ar.date, render: (r: Row) => formatDate(r.createdAt) },
          {
            label: "الإجراء",
            render: (r: Row) => auditActions[r.action] ?? r.action,
          },
          {
            label: "المستخدم",
            render: (r: Row) => (
              <span title={r.userId ?? undefined}>
                {r.userName ||
                  (r.userId
                    ? `مستخدم غير متاح (${r.userId.slice(0, 8)})`
                    : "النظام")}
              </span>
            ),
          },
          {
            label: "الكاشير على الفاتورة",
            render: (r: Row) => r.details?.cashierName ?? "—",
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
                        .map((v: Row) => roleLabels[v.role.name] ?? v.role.name)
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
                            action.clearError();
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
                                  action.clearError();
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
              action.clearError();
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
                paging.setPage(1);
              }}
            />
          </div>
        )}
        {query.isLoading ? (
          <TableSkeleton />
        ) : query.error ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : (
          <>
            <Table rows={query.data?.data ?? []} columns={columns} />
            <Pagination
              page={paging.page}
              pageSize={paging.pageSize}
              onPageChange={paging.setPage}
              onPageSizeChange={paging.setPageSize}
              length={query.data?.data.length ?? 0}
              total={query.data?.total ?? 0}
              disabled={query.isFetching}
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
        error={action.error}
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
              true,
            );
          }}
        />
      </Modal>
    </>
  );
}
