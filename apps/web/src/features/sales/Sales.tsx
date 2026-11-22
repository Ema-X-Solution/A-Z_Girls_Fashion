import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search, Printer, ArrowRightLeft, RotateCcw, Eye } from "lucide-react";
import { ReceiptView } from "../receipts/ReceiptView";
import { ExchangeDialog } from "../pos/ExchangeDialog";
import { post } from "../../api";
import { ar, formatDate, formatMoney as fm, statuses } from "../../i18n";
import { Button } from "../../components/ui/button";
import { useDebouncedSearch } from "../../hooks/useDebouncedSearch";
import { useAction } from "../../app/notifications";
import { useData, useAllowed } from "../../hooks/useData";
import { Loading, ErrorState, Modal, Field, Header, Badge, Table, Pager } from "../../components/application/Primitives";
import { type Row } from "../../app/types";

export function Sales() {
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
              placeholder="ابحث برقم الفاتورة أو باركود المنتج..."
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
              onRowClick={(r) => {
                setSelected(r);
                setReturning(false);
                setPrintOnOpen(false);
              }}
              columns={[
                {
                  label: "رقم الفاتورة",
                  render: (r) => (
                    <strong>{r.receiptNumber ?? `#${r.number}`}</strong>
                  ),
                },
                { label: ar.date, render: (r) => formatDate(r.createdAt) },
                {
                  label: "الأصناف والباركود",
                  render: (r) => (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", maxWidth: "240px" }}>
                      {r.items?.map((it: Row) => (
                        <div key={it.id} style={{ fontSize: "0.82rem", lineHeight: 1.3 }}>
                          <span>{it.name}</span>
                          {it.barcode && (
                            <code
                              style={{
                                fontSize: "0.75rem",
                                background: "var(--bg-subtle, #f1f5f9)",
                                padding: "1px 5px",
                                borderRadius: "4px",
                                marginInlineStart: "5px",
                              }}
                            >
                              {it.barcode}
                            </code>
                          )}
                          <span className="muted-text"> × {it.quantity}</span>
                        </div>
                      ))}
                    </div>
                  ),
                },
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
                {!shift.data?.data &&
                  "يجب فتح وردية لمعالجة الاسترداد. "}
                يُعاد المخزون فقط للمنتجات الصالحة للبيع.
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
