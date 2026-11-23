import { EntitySelect } from "../../components/application/EntitySelect";
import { Pagination } from "../../components/application/Pagination";
import { usePagination } from "../../hooks/usePagination";
import { useState } from "react";
import { Header, Modal, ErrorMessage } from "../shared/Controls";
import {
  Grid,
  useRows,
  useTask,
  save,
  patch,
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
    paging = usePagination(tab),
    [edit, setEdit] = useState<Row | null>(null),
    task = useTask();
  const branches = useRows(
      `/administration/branches?${paging.query}`,
      allowed("settings.manage"),
    ),
    sessions = useRows(
      `/administration/sessions?${paging.query}`,
      tab === "sessions" && allowed("users.manage"),
    ),
    users = useRows(
      `/users?${paging.query}`,
      tab === "users" && allowed("users.manage"),
    );
  const allBranches: Row[] = branches.data?.data ?? [];
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
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
                paging.setPage(1);
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
              <button
                className="btn btn-outline"
                onClick={() =>
                  setExpanded((old) => ({ ...old, [b.id]: !old[b.id] }))
                }
              >
                {expanded[b.id]
                  ? "إخفاء المخازن والأجهزة"
                  : "عرض المخازن والأجهزة"}
              </button>
              {expanded[b.id] && (
                <>
                  <BranchLocations branchId={b.id} />
                  <BranchRegisters branchId={b.id} onEdit={setEdit} />
                </>
              )}
            </section>
          ))}
        </>
      )}
      {tab === "branches" && (
        <Pagination
          page={paging.page}
          pageSize={paging.pageSize}
          onPageChange={paging.setPage}
          onPageSizeChange={paging.setPageSize}
          total={branches.data?.total ?? 0}
          length={branches.data?.data.length ?? 0}
          disabled={branches.isFetching}
        />
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
            page={paging.page}
            pageSize={paging.pageSize}
            onPageChange={paging.setPage}
            onPageSizeChange={paging.setPageSize}
            total={sessions.data?.total ?? 0}
            length={sessions.data?.data.length ?? 0}
            disabled={sessions.isFetching}
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
            page={paging.page}
            pageSize={paging.pageSize}
            onPageChange={paging.setPage}
            onPageSizeChange={paging.setPageSize}
            total={users.data?.total ?? 0}
            length={users.data?.data.length ?? 0}
            disabled={users.isFetching}
          />
        </section>
      )}
      <Modal
        error={task.error}
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
                  <EntitySelect
                    kind="roles"
                    name="roleId"
                    id="admin-role"
                    label="الدور الجديد"
                    params="assignable=1"
                  />
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
                        <EntitySelect
                          kind="branches"
                          name="branchId"
                          id="admin-branch"
                          label="الفرع"
                          value={edit.branchId ?? ""}
                          onChange={(branchId) =>
                            setEdit({ ...edit, branchId, locationId: "" })
                          }
                        />
                      </FormField>
                    )}
                    <FormField label="مخزن جهاز الكاشير">
                      <EntitySelect
                        key={edit.branchId}
                        kind="locations"
                        name="locationId"
                        id="admin-location"
                        label="مخزن جهاز الكاشير"
                        initial={edit.locationId ?? ""}
                        params={
                          edit.branchId ? `branchId=${edit.branchId}` : ""
                        }
                      />
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

function BranchRegisters({
  branchId,
  onEdit,
}: {
  branchId: string;
  onEdit: (row: Row) => void;
}) {
  const paging = usePagination(branchId, true, "local");
  const query = useRows(
    `/administration/branches/${branchId}/registers?${paging.query}`,
  );
  return (
    <>
      <PageState query={query} />{" "}
      <Grid
        rows={query.data?.data ?? []}
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
                onClick={() => onEdit({ ...r, kind: "register" })}
              >
                تعديل الجهاز
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
        total={query.data?.total ?? 0}
        length={query.data?.data.length ?? 0}
        disabled={query.isFetching}
      />
    </>
  );
}

function BranchLocations({ branchId }: { branchId: string }) {
  const paging = usePagination(branchId, true, "local");
  const query = useRows(
    `/administration/branches/${branchId}/locations?${paging.query}`,
  );
  return (
    <div>
      <h3>المخازن</h3>
      <PageState query={query} />
      <Grid
        rows={query.data?.data ?? []}
        columns={[{ label: "المخزن", render: (r) => r.name }]}
      />
      <Pagination
        page={paging.page}
        pageSize={paging.pageSize}
        onPageChange={paging.setPage}
        onPageSizeChange={paging.setPageSize}
        total={query.data?.total ?? 0}
        length={query.data?.data.length ?? 0}
        disabled={query.isFetching}
      />
    </div>
  );
        }
