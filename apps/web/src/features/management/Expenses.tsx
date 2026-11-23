import { SmartSelect } from "../../components/application/SmartSelect";
import { Pagination } from "../../components/application/Pagination";
import { usePagination } from "../../hooks/usePagination";
import { useState, type FormEvent } from "react";
import { Header, Modal, ErrorMessage } from "../shared/Controls";
import { statuses, formatMoney } from "../../i18n";
import {
  allowed,
  Grid,
  useRows,
  useTask,
  save,
  patch,
  FormField,
  when,
  PageState,
  type Row,
} from "./Tools";
import "./management.css";
export function Expenses() {
  const [status, setStatus] = useState(""),
    [open, setOpen] = useState(false),
    [categoryOpen, setCategoryOpen] = useState(false),
    [selected, setSelected] = useState<Row | null>(null);
  const paging = usePagination(status);
  const categoryPaging = usePagination("", true, "local");
  const [category, setCategory] = useState({ id: "", name: "" });
  const rows = useRows(
      `/expenses?${paging.query}${status ? `&status=${status}` : ""}`,
    ),
    categories = useRows(
      `/expense-categories?${categoryPaging.query}`,
      categoryOpen,
    ),
    shift = useRows("/shifts/current", allowed("cash.open_shift")),
    attachments = useRows(`/expenses/${selected?.id}/attachments`, !!selected),
    task = useTask();
  const labels: Row = {
    PENDING: "قيد المراجعة",
    APPROVED: "معتمد ومصروف",
    REJECTED: "مرفوض",
  };
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    await task.run(
      () =>
        save("/expenses", {
          ...f,
          category: category.name,
          submitForApproval: f.workflow !== "DIRECT",
          ...(f.workflow === "DIRECT" && f.method === "CASH"
            ? { shiftId: shift.data?.data?.id }
            : {}),
        }),
      () => setOpen(false),
    );
  }
  async function attach(file?: File) {
    if (!file || !selected) return;
    await task.run(async () => {
      if (file.size > 750000)
        throw new Error("اختار ملفًا أصغر من 750 كيلوبايت");
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("تعذر قراءة المرفق"));
        reader.readAsDataURL(file);
      });
      return save(`/expenses/${selected.id}/attachments`, {
        name: file.name,
        dataUrl,
      });
    });
  }
  return (
    <>
      <Header
        title="المصروفات"
        subtitle="طلبات مراجعة ومرفقات وإثبات صرف؛ الطلب المعلق لا يخصم من الدرج أو الربح"
      >
        {allowed("expenses.approve") && (
          <button
            className="btn btn-outline"
            onClick={() => {
              task.clearError();
              setCategoryOpen(true);
            }}
          >
            تصنيفات المصروفات
          </button>
        )}
        {allowed("expenses.create") && (
          <button
            className="btn btn-primary"
            onClick={() => {
              task.clearError();
              setOpen(true);
            }}
          >
            طلب مصروف جديد
          </button>
        )}
      </Header>
      <ErrorMessage
        message={!open && !categoryOpen && !selected ? task.error : ""}
      />
      <section className="panel management-card">
        <div className="report-controls">
          <FormField label="الحالة">
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
              }}
            >
              <option value="">كل الحالات</option>
              {Object.keys(labels).map((s) => (
                <option key={s} value={s}>
                  {labels[s]}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <PageState query={rows} />
        <Grid
          rows={rows.data?.data ?? []}
          columns={[
            { label: "التاريخ", render: (r) => when(r.date) },
            { label: "التصنيف", render: (r) => r.category },
            { label: "الوصف", render: (r) => r.description },
            { label: "القيمة", render: (r) => formatMoney(r.amount) },
            { label: "الدفع", render: (r) => statuses[r.method] ?? r.method },
            { label: "الحالة", render: (r) => labels[r.status] },
            {
              label: "الإجراءات",
              render: (r) => (
                <button
                  className="btn btn-outline"
                  onClick={() => {
                    task.clearError();
                    setSelected(r);
                  }}
                >
                  تفاصيل ومرفقات
                </button>
              ),
            },
          ]}
        />
        <Pagination
          page={paging.page}
          pageSize={paging.pageSize}
          onPageChange={paging.setPage}
          onPageSizeChange={paging.setPageSize}
          total={rows.data?.total ?? 0}
          length={rows.data?.data.length ?? 0}
          disabled={rows.isFetching}
        />
      </section>
      <Modal
        error={task.error}
        title="طلب مصروف جديد"
        open={open}
        close={() => {
          task.clearError();
          setOpen(false);
        }}
      >
        <form onSubmit={submit} className="entry-form">
          <FormField label="التصنيف">
            <SmartSelect
              id="expense-category"
              name="categoryId"
              label="التصنيف"
              value={category.id}
              endpoint="/options/expense-categories"
              placeholder="ابحث بالاسم"
              optionLabel={(row) => row.name}
              onChange={(row) => setCategory({ id: row.id, name: row.name })}
            />
          </FormField>
          <FormField label="القيمة">
            <input
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
            />
          </FormField>
          {allowed("expenses.approve") && (
            <FormField label="معالجة المصروف">
              <select name="workflow">
                <option value="REQUEST">إرسال طلب لمراجع آخر</option>
                <option value="DIRECT">
                  تسجيل مصروف معتمد مباشرة بصلاحيتي
                </option>
              </select>
            </FormField>
          )}
          <FormField label="طريقة الصرف">
            <select name="method">
              <option value="CASH">نقدي</option>
              <option value="BANK">تحويل بنكي</option>
              <option value="WALLET">محفظة</option>
              <option value="CARD">بطاقة</option>
            </select>
          </FormField>
          <FormField label="الوصف والسبب">
            <textarea
              name="description"
              minLength={3}
              maxLength={1000}
              required
            />
          </FormField>
          <p className="management-note">
            يعتمد الطلب المعلق مستخدم آخر؛ النقد يُصرف من وردية المعتمد وقت
            الموافقة. التسجيل المباشر بصلاحية الاعتماد يحتاج ورديتك المفتوحة عند
            الدفع نقدًا. أضف المرفقات من تفاصيل الطلب بعد إرساله.
          </p>
          <button className="btn btn-primary" disabled={task.busy}>
            حفظ المصروف
          </button>
        </form>
      </Modal>
      <Modal
        error={task.error}
        title="تصنيفات المصروفات"
        open={categoryOpen}
        close={() => {
          task.clearError();
          setCategoryOpen(false);
        }}
      >
        <Grid
          rows={categories.data?.data ?? []}
          columns={[
            { label: "التصنيف", render: (r) => r.name },
            { label: "الحالة", render: (r) => (r.active ? "نشط" : "متوقف") },
            {
              label: "الإجراء",
              render: (r) => (
                <button
                  className="btn btn-outline"
                  disabled={task.busy}
                  onClick={() =>
                    void task.run(() =>
                      patch(`/expense-categories/${r.id}`, {
                        active: !r.active,
                      }),
                    )
                  }
                >
                  {r.active ? "إيقاف" : "تفعيل"}
                </button>
              ),
            },
          ]}
        />
        <Pagination
          page={categoryPaging.page}
          pageSize={categoryPaging.pageSize}
          onPageChange={categoryPaging.setPage}
          onPageSizeChange={categoryPaging.setPageSize}
          total={categories.data?.total ?? 0}
          length={categories.data?.data.length ?? 0}
          disabled={categories.isFetching}
        />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            void task.run(
              () =>
                save("/expense-categories", {
                  name: new FormData(form).get("name"),
                }),
              () => form.reset(),
            );
          }}
        >
          <FormField label="اسم تصنيف جديد">
            <input name="name" required maxLength={100} />
          </FormField>
          <button className="btn btn-primary" disabled={task.busy}>
            إضافة التصنيف
          </button>
        </form>
      </Modal>
      <Modal
        error={task.error}
        title="تفاصيل المصروف"
        open={!!selected}
        close={() => {
          task.clearError();
          setSelected(null);
        }}
      >
        {selected && (
          <>
            <p>
              {selected.description} • {formatMoney(selected.amount)} •{" "}
              {labels[selected.status]}
            </p>
            <p>{selected.decisionNote}</p>
            <h3>المرفقات</h3>
            <PageState query={attachments} />
            <ul>
              {attachments.data?.data.map((f: Row) => (
                <li key={f.id}>
                  <a href={`/api/expense-attachments/${f.id}`} download>
                    {f.name}
                  </a>
                </li>
              ))}
            </ul>
            {allowed("expenses.create") && (
              <FormField label="إضافة مستند PDF أو صورة (حد 750 كيلوبايت، خمسة مرفقات)">
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  disabled={task.busy}
                  onChange={(e) => {
                    void attach(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </FormField>
            )}
            {selected.status === "PENDING" && allowed("expenses.approve") && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = Object.fromEntries(new FormData(e.currentTarget));
                  void task.run(
                    () =>
                      save(`/expenses/${selected.id}/decision`, {
                        approve: f.decision === "approve",
                        note: f.note,
                        ...(selected.method === "CASH" &&
                        f.decision === "approve"
                          ? { shiftId: shift.data?.data?.id }
                          : {}),
                      }),
                    () => setSelected(null),
                  );
                }}
              >
                <FormField label="قرار المراجعة">
                  <select name="decision">
                    <option value="approve">اعتماد وصرف</option>
                    <option value="reject">رفض</option>
                  </select>
                </FormField>
                <FormField label="ملاحظة المراجع">
                  <textarea name="note" required minLength={3} />
                </FormField>
                <p className="management-note">
                  اعتماد النقد يحتاج ورديتك المفتوحة. لا يمكن اعتماد طلبك بنفسك.
                </p>
                <button className="btn btn-primary" disabled={task.busy}>
                  تسجيل القرار
                </button>
              </form>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
