import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import JsBarcode from "jsbarcode";
import { Printer } from "lucide-react";
import { Button } from "../../components/ui/button";
import { defaultReturnPolicy } from "@az/shared";
import "./receipts.css";
import { cents, decimal } from "../pos/money";
type Row = Record<string, any>;
const money = (v: unknown) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(v ?? 0));
function date(v: string) {
  return new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
    timeZone: "Africa/Cairo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(v));
}
const methods: Record<string, string> = {
  CASH: "نقدي",
  CARD: "بطاقة بنكية",
  BANK: "تحويل بنكي",
  WALLET: "محفظة إلكترونية",
  EXCHANGE_CREDIT: "رصيد من عملية الاستبدال",
};
export function ReceiptView({
  sale,
  returned,
  exchange,
  actions,
  autoPrint = false,
}: {
  sale: Row;
  returned?: Row;
  exchange?: Row;
  actions?: ReactNode;
  autoPrint?: boolean;
}) {
  const snapshot = sale.receiptSnapshot ?? {},
    width = snapshot.receiptWidth === 58 ? 58 : 80,
    preview = useRef<HTMLElement | null>(null),
    [pageHeight, setPageHeight] = useState(297);
  useLayoutEffect(() => {
    document.body.dataset.printKind = "receipt";
    const element = preview.current;
    if (!element) return;
    const measure = () => {
      const height = element.getBoundingClientRect().height;
      if (height > 0)
        setPageHeight(
          Math.min(1500, Math.max(100, Math.ceil((height * 25.4) / 96) + 3)),
        );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    void document.fonts.ready.then(measure);
    return () => {
      observer.disconnect();
      delete document.body.dataset.printKind;
    };
  }, [sale.id, returned?.id, exchange?.id]);
  useEffect(() => {
    if (!autoPrint) return;
    let cancelled = false;
    void document.fonts.ready.then(async () => {
      await Promise.all(
        Array.from(preview.current?.querySelectorAll("img") ?? []).map((img) =>
          img.decode().catch(() => {}),
        ),
      );
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!cancelled) window.print();
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [autoPrint, sale.id]);
  const printed = returned
    ? returned.items.map((r: Row) => {
        const original =
          sale.items.find((i: Row) => i.id === r.saleItemId) ?? r.saleItem;
        const quantity = BigInt(original?.quantity ?? 1);
        return {
          ...original,
          quantity: r.quantity,
          total: r.amount,
          discount: decimal(
            (cents(original?.discount) * BigInt(r.quantity) + quantity / 2n) /
              quantity,
          ),
        };
      })
    : sale.items;
  const receiptNumber = sale.receiptNumber ?? String(sale.number),
    policy = String(snapshot.returnPolicy ?? defaultReturnPolicy),
    count = printed.reduce((s: number, i: Row) => s + i.quantity, 0),
    customer = snapshot.customer ?? sale.customer ?? null;
  const content = () => (
    <>
      <header className="fashion-receipt-head">
        <h1>{snapshot.name ?? "A&Z Girls Fashion"}</h1>
        {snapshot.promotion && (
          <p>
            العرض: {snapshot.promotion.name} — خصم{" "}
            {money(snapshot.promotion.discount)} ج.م
          </p>
        )}
        {snapshot.promotion?.returnRule === "FULL_BUNDLE" && (
          <p>تُرد أو تُستبدل جميع أصناف العرض معًا بقيمتها المدفوعة.</p>
        )}
        {snapshot.address && <p>{snapshot.address}</p>}
        {snapshot.phone && <p dir="ltr">TEL: {snapshot.phone}</p>}
      </header>
      <div className="fashion-receipt-meta">
        <svg
          className="receipt-side-barcode"
          aria-label="باركود الفاتورة"
          role="img"
          ref={(svg) => {
            if (!svg) return;
            JsBarcode(svg, receiptNumber, {
              format: "CODE128",
              height: 82,
              width: 1.2,
              margin: 0,
              displayValue: false,
            });
            const w = svg.getAttribute("width"),
              h = svg.getAttribute("height");
            svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
            svg.removeAttribute("width");
            svg.removeAttribute("height");
          }}
        />
        <div className="receipt-meta-lines">
        <p>
          <b>الفرع:</b> {snapshot.branchName ?? "الفرع الرئيسي"}
        </p>
        {snapshot.taxNumber && (
          <p>
            <b>الرقم الضريبي:</b> <span dir="ltr">{snapshot.taxNumber}</span>
          </p>
        )}
        {snapshot.commercialRegister && (
          <p>
            <b>رقم السجل التجاري:</b>{" "}
            <span dir="ltr">{snapshot.commercialRegister}</span>
          </p>
        )}
        <p>
          <b>
            {exchange
              ? "إيصال استبدال"
              : returned
                ? "إيصال مرتجع"
                : "رقم الفاتورة (Receipt #)"}
            :
          </b>{" "}
          <span dir="ltr">
            {exchange
              ? `EX-${exchange.number}`
              : returned
                ? `RET-${returned.id.slice(0, 8).toUpperCase()}`
                : receiptNumber}
          </span>
        </p>
        {(exchange || returned) && (
          <p>
            <b>الفاتورة الأصلية:</b>{" "}
            <span dir="ltr">
              {exchange?.returned?.originalSale?.receiptNumber ?? receiptNumber}
            </span>
          </p>
        )}
        <p>
          <b>التاريخ والوقت:</b>{" "}
          {date(returned?.createdAt ?? exchange?.createdAt ?? sale.createdAt)}
        </p>
        {!returned && !exchange && customer && (
          <>
            <p>
              <b>اسم العميل:</b> {customer.name || "عميل نقدي"}
            </p>
            {customer.address && (
              <p>
                <b>العنوان:</b> {customer.address}
              </p>
            )}
            {customer.phone && (
              <p>
                <b>رقم الهاتف:</b> <span dir="ltr">{customer.phone}</span>
              </p>
            )}
          </>
        )}
        <p>
          <b>اسم الكاشير:</b> {snapshot.cashierName ?? sale.user?.name ?? ""}{" "}
          <span className="receipt-meta-separator">|</span> <b>كود البائع:</b>{" "}
          <span dir="ltr">{snapshot.sellerCode ?? ""}</span>
        </p>
        </div>
      </div>
      {exchange && (
        <section className="receipt-exchange-return">
          <h3>الأصناف المرتجعة</h3>
          {exchange.returned.items.map((r: Row) => {
            const original = exchange.returned.originalSale.items.find(
              (i: Row) => i.id === r.saleItemId,
            );
            return (
              <p key={r.id}>
                <span>
                  {original?.name} × {r.quantity}
                </span>
                <b>{money(r.amount)} ج.م</b>
              </p>
            );
          })}
          <h3>الأصناف البديلة</h3>
        </section>
      )}
      <table className="fashion-receipt-items">
        <colgroup>
          <col style={{ width: "6%" }} />
          <col style={{ width: "15%" }} />
          <col style={{ width: "34%" }} />
          <col style={{ width: "16%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "18%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>م</th>
            <th>الكود</th>
            <th>الصنف</th>
            <th>السعر</th>
            <th>كمية</th>
            <th>القيمة</th>
          </tr>
        </thead>
        {printed.map((i: Row, index: number) => (
          <tbody key={i.id ?? index} className="receipt-item-group">
            <tr>
              <td>{index + 1}</td>
              <td className="receipt-sku" dir="ltr">{i.sku || i.barcode}</td>
              <td>
                <b>{i.name}</b>
                <small>{Object.values(i.options ?? {}).join(" / ")}</small>
              </td>
              <td className="receipt-numeric">{money(i.unitPrice)}</td>
              <td>{i.quantity}</td>
              <td className="receipt-numeric"><b>{money(i.total)}</b></td>
            </tr>
            {Number(i.discount) > 0 && (
              <tr className="receipt-item-saving">
                <td colSpan={4}>قيمة التوفير</td>
                <td colSpan={2} className="receipt-numeric">-{money(i.discount)}</td>
              </tr>
            )}
          </tbody>
        ))}
      </table>
      <section className="fashion-receipt-summary">
        <h3>ملخص الحساب وطريقة الدفع</h3>
        {!returned && snapshot.loyalty && (
          <p>
            نقاط مكتسبة: {snapshot.loyalty.earned} | نقاط مستخدمة:{" "}
            {snapshot.loyalty.redeemed} | خصم النقاط:{" "}
            {money(snapshot.loyalty.discount)} ج.م (ضمن إجمالي الخصومات)
          </p>
        )}
        {returned?.loyalty && (
          <p>
            نقاط ملغاة: {returned.loyalty.reversed} | نقاط مستعادة:{" "}
            {returned.loyalty.restored}
          </p>
        )}
        <div className="receipt-summary-row">
          <span>إجمالي عدد القطع</span>
          <b>
            {count} {count === 1 ? "قطعة" : "قطع"}
          </b>
        </div>
        {returned ? (
          <>
            <div className="receipt-summary-row final">
              <span>إجمالي المرتجع</span>
              <b>{money(returned.total)} ج.م</b>
            </div>
            <div className="receipt-summary-row">
              <span>المبلغ المسترد</span>
              <b>{money(returned.refundAmount ?? returned.total)} ج.م</b>
            </div>
            <div className="receipt-summary-row">
              <span>طريقة الاسترداد</span>
              <b>{methods[returned.method] ?? returned.method}</b>
            </div>
          </>
        ) : (
          <>
            {[
              ["الإجمالي قبل الخصم", sale.subtotal],
              ["إجمالي الخصومات", sale.discount],
              [
                "الصافي قبل ضريبة القيمة المضافة",
                sale.netBeforeTax ?? Number(sale.total) - Number(sale.tax),
              ],
            ].map(([label, value]) => (
              <div className="receipt-summary-row" key={label}>
                <span>{label}</span>
                <b dir="ltr">
                  {label === "إجمالي الخصومات" && Number(value) > 0 ? "-" : ""}
                  {money(value)} ج.م
                </b>
              </div>
            ))}
            <div className="receipt-summary-row">
              <span>
                ضريبة القيمة المضافة
                {!snapshot.legacyTaxRateUnknown
                  ? ` (${Number(sale.taxRate ?? 0)}% ${sale.taxMode === "INCLUSIVE" ? "مشمولة بالسعر" : "تُضاف إلى السعر"})`
                  : ""}
              </span>
              <b dir="ltr">{money(sale.tax)} ج.م</b>
            </div>
            <div className="receipt-summary-row final">
              <span>الإجمالي النهائي المستحق</span>
              <b dir="ltr">{money(sale.total)} ج.م</b>
            </div>
            {sale.payments.map((p: Row, i: number) => (
              <div className="receipt-payment" key={p.id ?? i}>
                <div className="receipt-summary-row">
                  <span>
                    طريقة الدفع: {methods[p.method] ?? p.method}
                    {p.method === "CARD" && p.cardBrand
                      ? ` (${p.cardBrand})`
                      : ""}
                  </span>
                  <b dir="ltr">{money(p.amount)} ج.م</b>
                </div>
                {p.authorizationCode && (
                  <p>
                    رقم التفويض: <span dir="ltr">{p.authorizationCode}</span>
                  </p>
                )}
                {p.cardLast4 && (
                  <p>
                    البطاقة: <span dir="ltr">**** **** **** {p.cardLast4}</span>
                  </p>
                )}
              </div>
            ))}
            {Number(sale.change) > 0 && (
              <div className="receipt-summary-row">
                <span>الباقي النقدي</span>
                <b dir="ltr">{money(sale.change)} ج.م</b>
              </div>
            )}
          </>
        )}
        {exchange && (
          <div className="receipt-exchange-settlement">
            <div className="receipt-summary-row">
              <span>قيمة الأصناف المرتجعة</span>
              <b>{money(exchange.returned.total)} ج.م</b>
            </div>
            <div className="receipt-summary-row final">
              <span>
                {Number(exchange.difference) > 0
                  ? "فرق السعر المحصل"
                  : Number(exchange.difference) < 0
                    ? "فرق السعر المسترد"
                    : "استبدال بنفس القيمة"}
              </span>
              <b>{money(Math.abs(Number(exchange.difference)))} ج.م</b>
            </div>
          </div>
        )}
      </section>
      <section className="fashion-return-policy">
        <h3>سياسة الاستبدال والاسترجاع</h3>
        {policy
          .split("\n")
          .filter(Boolean)
          .map((line, index) => (
            <p key={index}>{line}</p>
          ))}
      </section>
      <footer className="fashion-receipt-footer">
        <p>{snapshot.receiptFooter || "شكراً لزيارتكم"}</p>
      </footer>
    </>
  );
  return (
    <>
      <div
        className="receipt-actions no-print"
        role="group"
        aria-label="إجراءات الفاتورة"
      >
        <Button
          onClick={() => {
            void document.fonts.ready.then(async () => {
              await Promise.all(
                Array.from(preview.current?.querySelectorAll("img") ?? []).map(
                  (img) => img.decode().catch(() => {}),
                ),
              );
              window.print();
            });
          }}
        >
          <Printer size={18} />
          طباعة الفاتورة
        </Button>
        {actions && <div className="receipt-actions-secondary">{actions}</div>}
      </div>
      <article
        ref={preview}
        className="receipt fashion-receipt receipt-preview"
        dir="rtl"
        data-sequence={sale.number}
        data-sale-id={sale.id}
        style={{ width: `${width}mm` }}
      >
        {content()}
      </article>
      {createPortal(
        <div id="az-receipt-print-root">
          <style>{`@media print { @page { size: ${width}mm ${pageHeight}mm; margin: 0; } }`}</style>
          <article
            className="receipt fashion-receipt"
            dir="rtl"
            style={{ width: `${width}mm` }}
          >
            {content()}
          </article>
        </div>,
        document.body,
      )}
    </>
  );
}
