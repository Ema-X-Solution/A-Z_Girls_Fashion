import { useState } from "react";
import { Header, Modal, ErrorMessage } from "../shared/Controls";
import {
  Grid,
  useRows,
  useTask,
  save,
  patch,
  Pagination,
  FormField,
  when,
  PageState,
  allowed,
  type Row,
} from "./Tools";
import "./management.css";
export function Administration() {
  const [tab, setTab] = useState(
      allowed("settings.manage") ? "branches" : "sessions",
    ),
    [offset, setOffset] = useState(0),
    [edit, setEdit] = useState<Row | null>(null),
    task = useTask();
  const branches = useRows(
      "/administration/branches",
      allowed("settings.manage"),
    ),
    sessions = useRows(
      `/administration/sessions?offset=${offset}`,
      tab === "sessions" && allowed("users.manage"),
    ),
    users = useRows(
      `/users?offset=${offset}`,
      tab === "users" && allowed("users.manage"),
    ),
    roles = useRows("/roles", tab === "users" && allowed("roles.manage"));
  const allBranches: Row[] = branches.data?.data ?? [];
  return (
    <>
      <Header
        title="الفروع والأجهزة والجلسات"
        subtitle="إدارة التشغيل مع حماية الورديات المفتوحة وسجل مراجعة لكل تغيير"
      />
      <div className="management-tabs">
        {[
          ["branches", "الفروع والأجهزة", "settings.manage"],
          ["sessions", "جلسات الدخول", "users.manage"],
          ["users", "أدوار المستخدمين", "roles.manage"],
        ]
          .filter((t) => allowed(t[2]!))
          .map((t) => (
            <button
              key={t[0]}
              className={`btn ${tab === t[0] ? "btn-primary" : "btn-outline"}`}
              onClick={() => {
                setTab(t[0]!);
                setOffset(0);
              }}
            >
              {t[1]}
            </button>
          ))}
      </div>
      <ErrorMessage message={task.error} />
      {tab === "branches" && (
        <>
          <div className="inline-actions">
            <button
              className="btn btn-primary"
              onClick={() => setEdit({ kind: "branch" })}
            >
              إضافة فرع
            </button>
            <button
              className="btn btn-outline"
              onClick={() => setEdit({ kind: "register" })}
            >
              إضافة جهاز كاشير
            </button>
          </div>
          <PageState query={branches} />
          {allBranches.map((b) => (
            <section key={b.id} className="panel management-card">
              <div className="panel-title">
                <h2>
                  {b.name} • {b.active ? "نشط" : "متوقف"}
                </h2>
                <button
                  className="btn btn-outline"
                  onClick={() => setEdit({ ...b, kind: "branch" })}
                >
                  تعديل الفرع
                </button>
              </div>
              <p className="management-note">
                المخازن: {b.locations.map((l: Row) => l.name).join(" / ")}
              </p>
              <Grid
                rows={b.registers}
                columns={[
                  { label: "جهاز الكاشير", render: (r) => r.name },
                  { label: "المخزن", render: (r) => r.location.name },
                  {
                    label: "الحالة",
                    render: (r) => (r.active ? "نشط" : "متوقف"),
                  },
                  {
                    label: "الإجراءات",
                    render: (r) => (
                      <button
                        className="btn btn-outline"
                        onClick={() => setEdit({ ...r, kind: "register" })}
                      >
                        تعديل الجهاز
                      </button>
                    ),
                  },
                ]}
              />
            </section>
          ))}
        </>
      )}
      {tab === "sessions" && (
        <section className="panel management-card">
          <PageState query={sessions} />
          <Grid
            rows={sessions.data?.data ?? []}
            columns={[
              {
                label: "المستخدم",
                render: (r) => (
                  <>
                    {r.user.name}
                    <br />
                    {r.user.email}
                  </>
                ),
              },
              { label: "بدأت", render: (r) => when(r.createdAt) },
              { label: "تنتهي", render: (r) => when(r.expiresAt) },
              {
                label: "الجلسة",
                render: (r) => (r.current ? "جلسة هذا الجهاز" : "جلسة أخرى"),
              },
              {
                label: "الإجراء",
                render: (r) => (
                  <button
                    className="btn btn-outline"
                    disabled={task.busy}
                    onClick={() => {
                      if (window.confirm("إنهاء جلسة الدخول؟"))
                        void task.run(() =>
                          save(`/administration/sessions/${r.id}/revoke`, {}),
                        );
                    }}
                  >
                    إنهاء الجلسة
                  </button>
                ),
              },
            ]}
          />
          <Pagination
            offset={offset}
            onChange={setOffset}
            total={sessions.data?.total ?? 0}
          />
        </section>
      )}
      {tab === "users" && (
        <section className="panel management-card">
          <PageState query={users} />
          <Grid
            rows={users.data?.data ?? []}
            columns={[
              { label: "المستخدم", render: (r) => r.name },
              { label: "البريد", render: (r) => r.email },
              {
                label: "الإجراءات",
                render: (r) => (
                  <div className="inline-actions">
                    <button
                      className="btn btn-outline"
                      onClick={() => setEdit({ ...r, kind: "role" })}
                    >
                      تغيير الدور
                    </button>
                    <button
                      className="btn btn-outline"
                      disabled={task.busy}
                      onClick={() => {
                        if (window.confirm("إنهاء كل جلسات المستخدم؟"))
                          void task.run(() =>
                            save(
                              `/administration/users/${r.id}/revoke-sessions`,
                              {},
                            ),
                          );
                      }}
                    >
                      إنهاء جلساته
                    </button>
                  </div>
                ),
              },
            ]}
          />
          <Pagination
            offset={offset}
            onChange={setOffset}
            total={
              users.data?.total ??
              offset +
                (users.data?.data?.length ?? 0) +
                (users.data?.data?.length === 30 ? 1 : 0)
            }
          />
        </section>
      )}
      <Modal
        title={
          edit?.kind === "role"
            ? "تغيير دور المستخدم"
            : edit?.kind === "branch"
              ? "بيانات الفرع"
              : "بيانات جهاز الكاشير"
        }
        open={!!edit}
        close={() => setEdit(null)}
      >
        {edit && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.currentTarget));
              const path =
                edit.kind === "role"
                  ? `/administration/users/${edit.id}/role`
                  : edit.kind === "branch"
                    ? "/administration/branches"
                    : "/administration/registers";
              const body =
                edit.kind === "role"
                  ? { roleId: f.roleId }
                  : edit.id
                    ? {
                        name: f.name,
                        active: f.active === "true",
                        ...(edit.kind === "register"
                          ? { locationId: f.locationId }
                          : {}),
                      }
                    : f;
              void task.run(
                () =>
                  edit.id
                    ? patch(
                        edit.kind === "role" ? path : `${path}/${edit.id}`,
                        body,
                      )
                    : save(path, body),
                () => setEdit(null),
              );
            }}
          >
            {edit.kind === "role" ? (
              <>
                <p>
                  حساب المالك ودوره محميان. تغيير الدور ينهي جلسات المستخدم.
                </p>
                <FormField label="الدور الجديد">
                  <select name="roleId" required>
                    <option value="">اختر...</option>
                    {roles.data?.data
                      .filter((r: Row) => !r.protected)
                      .map((r: Row) => (
                        <option value={r.id} key={r.id}>
                          {r.name}
                        </option>
                      ))}
                  </select>
                </FormField>
              </>
            ) : (
              <>
                <FormField label="الاسم">
                  <input
                    name="name"
                    required
                    maxLength={150}
                    defaultValue={edit.name ?? ""}
                  />
                </FormField>
                {edit.id && (
                  <FormField label="الحالة">
                    <select name="active" defaultValue={String(edit.active)}>
                      <option value="true">نشط</option>
                      <option value="false">متوقف</option>
                    </select>
                  </FormField>
                )}
                {edit.kind === "branch" && !edit.id && (
                  <FormField label="اسم مخزن الفرع الأول">
                    <input name="locationName" required maxLength={150} />
                  </FormField>
                )}
                {edit.kind === "register" && (
                  <>
                    {!edit.id && (
                      <FormField label="الفرع">
                        <select
                          name="branchId"
                          required
                          value={edit.branchId ?? ""}
                          onChange={(e) =>
                            setEdit({
                              ...edit,
                              branchId: e.target.value,
                              locationId: "",
                            })
                          }
                        >
                          <option value="">اختر...</option>
                          {allBranches
                            .filter((b) => b.active)
                            .map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.name}
                              </option>
                            ))}
                        </select>
                      </FormField>
                    )}
                    <FormField label="مخزن جهاز الكاشير">
                      <select
                        name="locationId"
                        required
                        defaultValue={edit.locationId ?? ""}
                      >
                        <option value="">اختر...</option>
                        {allBranches
                          .find((b) => b.id === edit.branchId)
                          ?.locations.map((l: Row) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                      </select>
                    </FormField>
                  </>
                )}
                <p className="management-note">
                  تعديل الجهاز وإيقاف الفرع يحتاجان إغلاق الورديات التابعة أولًا.
                  أضف مخازن أخرى من شاشة المخزون.
                </p>
              </>
            )}
            <button className="btn btn-primary" disabled={task.busy}>
              حفظ التغيير
            </button>
          </form>
        )}
      </Modal>
    </>
  );
}
