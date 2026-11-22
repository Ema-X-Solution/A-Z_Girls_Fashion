import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search, X, Printer, Pencil, Trash2, Check, Archive, RotateCcw } from "lucide-react";
import { ProductImage, ProductImageEditor, ProductImagePicker } from "../shared/ProductImage";
import { patch, post } from "../../api";
import { formatDigits, ar, formatMoney as fm } from "../../i18n";
import { Button } from "../../components/ui/button";
import { BarcodeLabels } from "../barcodes/BarcodeLabels";
import { useDebouncedSearch } from "../../hooks/useDebouncedSearch";
import { useAction, readableError } from "../../app/notifications";
import { useData, useAllowed } from "../../hooks/useData";
import { Loading, ErrorState, Modal, Field, Header, Badge, Table, Pager } from "../../components/application/Primitives";
import { EntryForm, simple } from "../../components/application/EntryForm";
import { type Row } from "../../app/types";

export function Products() {
  const [q, setQ] = useState(""),
    { debounced: debouncedQ, searchPending } = useDebouncedSearch(q),
    [offset, setOffset] = useState(0),
    [open, setOpen] = useState(false),
    [label, setLabel] = useState<Row | null>(null),
    [categoryOpen, setCategoryOpen] = useState(false),
    [selected, setSelected] = useState<Row | null>(null),
    [productTab, setProductTab] = useState<"active" | "archived">("active"),
    [statusChange, setStatusChange] = useState<{ product: Row; restore: boolean } | null>(null),
    [statusError, setStatusError] = useState(""),
    query = useData(
      `/products?q=${encodeURIComponent(debouncedQ)}&offset=${offset}${productTab === "archived" ? "&archived=1" : ""}`,
      true,
      searchPending,
    ),
    categories = useData("/categories"),
    brands = useData("/brands"),
    action = useAction(),
    create = useAllowed("products.create"),
    edit = useAllowed("products.update"),
    changePrice = useAllowed("products.change_price"),
    archive = useAllowed("products.archive");
  const [catFormKey, setCatFormKey] = useState(0);
  const [editingCat, setEditingCat] = useState<string | null>(null),
    [editingName, setEditingName] = useState(""),
    [confirmRemoveCat, setConfirmRemoveCat] = useState<string | null>(null),
    [catTab, setCatTab] = useState<"active" | "archived">("active"),
    archivedCategories = useData(
      "/categories?archived=1",
      categoryOpen && catTab === "archived",
    );
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
        {archive && (
          <div className="cat-tabs" style={{ padding: "18px 22px 0" }} role="group" aria-label="عرض المنتجات">
            <Button
              variant={productTab === "active" ? "default" : "outline"}
              onClick={() => { setProductTab("active"); setOffset(0); }}
            >
              المنتجات الحالية
            </Button>
            <Button
              variant={productTab === "archived" ? "default" : "outline"}
              onClick={() => { setProductTab("archived"); setOffset(0); }}
            >
              أرشيف المنتجات
            </Button>
          </div>
        )}
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
                      {archive && (
                        <Button
                          variant="ghost"
                          disabled={action.busy}
                          onClick={() => { setStatusError(""); setStatusChange({ product: r, restore: productTab === "archived" }); }}
                        >
                          {productTab === "archived" ? <RotateCcw size={16} /> : <Archive size={16} />}
                          {productTab === "archived" ? "استعادة" : "أرشفة"}
                        </Button>
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
        title={statusChange?.restore ? "استعادة المنتج" : "أرشفة المنتج"}
        open={!!statusChange}
        onClose={() => { if (!action.busy) setStatusChange(null); }}
      >
        {statusChange && (
          <>
            <p><strong>{statusChange.product.nameAr}</strong></p>
            <p className="note">
              {statusChange.restore
                ? "سيظهر المنتج في قائمة المنتجات والبيع من جديد، مع الاحتفاظ بسجلاته السابقة."
                : "يمكن أرشفة المنتج فقط إذا كانت كمية كل مقاس ولون في كل المخازن صفرًا، ولا توجد كميات قيد التحويل أو محجورة. لن تُحذف الفواتير أو المشتريات السابقة."}
            </p>
            {statusError && <p role="alert" className="form-error">{statusError}</p>}
            <div className="inline-actions" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, maxWidth: 320, marginTop: 18 }}>
              <Button
                disabled={action.busy}
                onClick={() => void action.run(
                  async () => {
                    setStatusError("");
                    try {
                      const result = await post(`/products/${statusChange.product.id}/${statusChange.restore ? "restore" : "archive"}`, {});
                      return result?.data?.message;
                    } catch (error) {
                      setStatusError(readableError(error));
                      throw error;
                    }
                  },
                  () => { setStatusChange(null); setSelected(null); },
                )}
              >
                {statusChange.restore ? "تأكيد الاستعادة" : "تأكيد الأرشفة"}
              </Button>
              <Button variant="outline" disabled={action.busy} onClick={() => setStatusChange(null)}>
                إلغاء
              </Button>
            </div>
          </>
        )}
      </Modal>
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
        <div className="cat-tabs">
          <Button
            variant={catTab === "active" ? "default" : "outline"}
            onClick={() => setCatTab("active")}
          >
            الأقسام
          </Button>
          <Button
            variant={catTab === "archived" ? "default" : "outline"}
            onClick={() => setCatTab("archived")}
          >
            الأرشيف
          </Button>
        </div>
        {catTab === "archived" ? (
          <>
            <p className="note">
              الأقسام المؤرشفة مخفية من القوائم، ومنتجاتها تبقى ظاهرة في
              المنتجات كما هي.
            </p>
            {archivedCategories.isLoading ? (
              <Loading />
            ) : archivedCategories.error ? (
              <ErrorState
                error={archivedCategories.error}
                retry={() => void archivedCategories.refetch()}
              />
            ) : (archivedCategories.data?.data ?? []).length === 0 ? (
              <p className="note">لا توجد أقسام مؤرشفة.</p>
            ) : (
              <ul className="list">
                {(archivedCategories.data?.data ?? []).map((c: Row) => (
                  <li key={c.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: 16, paddingBlock: 12 }}>
                    <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{c.name}</span>
                    {archive && (
                      <Button
                        variant="outline"
                        title="استعادة القسم من الأرشيف"
                        style={{ width: 96, minHeight: 44 }}
                        disabled={action.busy}
                        onClick={() =>
                          void action.run(async () => {
                            const r = await post(
                              `/categories/${c.id}/restore`,
                              {},
                            );
                            return r?.data?.message;
                          })
                        }
                      >
                        استعادة
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
        <ul className="list">
          {categories.data?.data.map((c: Row) => (
            <li key={c.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: 16, paddingBlock: 12 }}>
              {editingCat === c.id ? (
                <div className="cat-edit-row" style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "minmax(0, 1fr) 72px 64px", gap: 8 }}>
                  <input
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    aria-label={`اسم القسم ${c.name}`}
                    style={{ width: "100%", minWidth: 0, minHeight: 44 }}
                  />
                  <Button
                    variant="outline"
                    style={{ minHeight: 44, paddingInline: 8 }}
                    disabled={action.busy || !editingName.trim()}
                    onClick={() =>
                      void action.run(
                        () =>
                          patch(`/categories/${c.id}`, {
                            name: editingName.trim(),
                          }),
                        () => setEditingCat(null),
                      )
                    }
                  >
                    <Check size={16} />
                    حفظ
                  </Button>
                  <Button
                    variant="outline"
                    style={{ minHeight: 44, paddingInline: 8 }}
                    onClick={() => setEditingCat(null)}
                  >
                    إلغاء
                  </Button>
                </div>
              ) : (
                <>
                  <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{c.name}</span>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", minWidth: 96 }}>
                  {edit && (
                    <Button
                      variant="outline"
                      style={{ width: 44, height: 44, padding: 0 }}
                      title="تعديل اسم القسم"
                      onClick={() => {
                        setEditingCat(c.id);
                        setEditingName(c.name);
                        setConfirmRemoveCat(null);
                      }}
                    >
                      <Pencil size={16} />
                    </Button>
                  )}
                  {archive && (
                    <Button
                      variant={confirmRemoveCat === c.id ? "destructive" : "outline"}
                      style={{ width: 44, height: 44, padding: 0 }}
                      title={
                        confirmRemoveCat === c.id
                          ? "اضغط مرة أخرى للتأكيد"
                          : "حذف أو أرشفة القسم"
                      }
                      onClick={() => {
                        if (confirmRemoveCat !== c.id) {
                          setConfirmRemoveCat(c.id);
                          return;
                        }
                        void action.run(
                          async () => {
                            const r = await post(
                              `/categories/${c.id}/remove`,
                              {},
                            );
                            return r?.data?.message;
                          },
                          () => setConfirmRemoveCat(null),
                        );
                      }}
                    >
                      {confirmRemoveCat === c.id ? "تأكيد؟" : <Trash2 size={16} />}
                    </Button>
                  )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
        {create && (
          <EntryForm
            key={catFormKey}
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
              void action.run(
                () =>
                  post("/categories", {
                    name: body.name,
                    ...(body.parentId ? { parentId: body.parentId } : {}),
                  }),
                () => setCatFormKey((k) => k + 1),
              )
            }
          />
        )}
          </>
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
                  render: (r) => formatDigits(Object.values(r.options).join(" / ")) || "—",
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
                    formatDigits(Object.values(r.variant.options).join(" / ")) || r.variant.sku,
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
                      label: `${v.sku} ${formatDigits(Object.values(v.options).join(" / "))} (الحد الأدنى الحالي: ${v.minStock})`,
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

export function ProductForm({
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
