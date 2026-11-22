import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "../../components/ui/button";
import { ar, permissionLabels, roleLabels } from "../../i18n";
import { patch, post } from "../../api";
import { useRoles, usePermissions } from "./queries";
import type { Role } from "./types";
import { useAction } from "../../app/notifications";
import { Header, Loading, ErrorState, Table, Modal, Field } from "../../components/application/Primitives";

export function RolesPage() {
  const action = useAction();
  const query = useRoles(),
    perms = usePermissions(),
    [selected, setSelected] = useState<Role | null>(null),
    [open, setOpen] = useState(false);
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
                  {list.map((p) => {
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
                            (v) => v.permissionKey === p,
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

