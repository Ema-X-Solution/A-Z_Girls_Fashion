import { useState } from "react";
import { Plus } from "lucide-react";
import { patch, post, useSession } from "../../api";
import { ar, formatDate, formatMoney as fm, statuses, roleLabels } from "../../i18n";

const auditActions: Record<string, string> = {
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
};
import { Button } from "../../components/ui/button";
import { CustomerHistory } from "../customers/CustomerHistory";
import { useDebouncedSearch } from "../../hooks/useDebouncedSearch";
import { useAction } from "../../app/notifications";
import { useData } from "../../hooks/useData";
import { Loading, ErrorState, Modal, Header, Badge, Table, Pager } from "../../components/application/Primitives";
import { type FieldSpec, EntryForm, simple } from "../../components/application/EntryForm";
import { nav } from "../../app/SidebarNavigation";
import { type Row } from "../../app/types";

export function Records({ kind }: { kind: string }) {
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
          { label: "الإجراء", render: (r: Row) => auditActions[r.action] ?? r.action },
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
