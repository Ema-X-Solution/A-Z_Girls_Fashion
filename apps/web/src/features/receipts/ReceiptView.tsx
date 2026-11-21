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
  return new Intl.DateTimeFormat("en-GB", {
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
  CASH: "Cash",
  CARD: "Card",
  BANK: "Bank transfer",
  WALLET: "Wallet",
  EXCHANGE_CREDIT: "Exchange credit",
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
    customer = snapshot.customer ?? sale.customer ?? null,
    paymentTotals = sale.payments.reduce(
      (totals: { cash: number; card: number; other: number }, payment: Row) => {
        const amount = Number(payment.amount ?? 0);
        if (payment.method === "CASH") totals.cash += amount;
        else if (payment.method === "CARD") totals.card += amount;
        else totals.other += amount;
        return totals;
      },
      { cash: 0, card: 0, other: 0 },
    ),
    receiptTime = new Intl.DateTimeFormat("en", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(new Date(returned?.createdAt ?? exchange?.createdAt ?? sale.createdAt));
  const content = () => (
    <>
      <header className="fashion-receipt-head">
        <h1>{snapshot.name ?? "A&Z Girls Fashion"}</h1>
        {snapshot.promotion && (
          <p>
            Promotion: {snapshot.promotion.name} — discount{" "}
            {money(snapshot.promotion.discount)} EGP
          </p>
        )}
        {snapshot.promotion?.returnRule === "FULL_BUNDLE" && (
          <p>All promotion items must be returned or exchanged together at their paid value.</p>
        )}
        {snapshot.address && <p>{snapshot.address}</p>}
        {snapshot.phone && <p dir="ltr">TEL: {snapshot.phone}</p>}
      </header>
      <div className="fashion-receipt-meta">
        <svg
          className="receipt-side-barcode"
          aria-label="Receipt barcode"
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
          <b>Branch:</b> {snapshot.branchName ?? "Main branch"}
        </p>
        {snapshot.taxNumber && (
          <p>
            <b>Tax number:</b> <span dir="ltr">{snapshot.taxNumber}</span>
          </p>
        )}
        {snapshot.commercialRegister && (
          <p>
            <b>Commercial register:</b>{" "}
            <span dir="ltr">{snapshot.commercialRegister}</span>
          </p>
        )}
        <p>
          <b>
            {exchange
              ? "Exchange receipt"
              : returned
                ? "Return receipt"
                : "Receipt #"}
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
            <b>Original receipt:</b>{" "}
            <span dir="ltr">
              {exchange?.returned?.originalSale?.receiptNumber ?? receiptNumber}
            </span>
          </p>
        )}
        <p>
          <b>Date & time:</b>{" "}
          {date(returned?.createdAt ?? exchange?.createdAt ?? sale.createdAt)}
        </p>
        {!returned && !exchange && customer && (
          <>
            <p>
              <b>Customer:</b> {customer.name || "Cash customer"}
            </p>
            {customer.address && (
              <p>
                <b>Address:</b> {customer.address}
              </p>
            )}
            {customer.phone && (
              <p>
                <b>Phone:</b> <span dir="ltr">{customer.phone}</span>
              </p>
            )}
          </>
        )}
        <p>
          <b>Seller code:</b>{" "}
          <span dir="ltr">{snapshot.sellerCode ?? ""}</span>
        </p>
        </div>
      </div>
      {exchange && (
        <section className="receipt-exchange-return">
          <h3>Returned items</h3>
          {exchange.returned.items.map((r: Row) => {
            const original = exchange.returned.originalSale.items.find(
              (i: Row) => i.id === r.saleItemId,
            );
            return (
              <p key={r.id}>
                <span>
                  {original?.name} × {r.quantity}
                </span>
                <b>{money(r.amount)} EGP</b>
              </p>
            );
          })}
          <h3>Replacement items</h3>
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
            <th>#</th>
            <th>Code</th>
            <th>Item</th>
            <th>Price</th>
            <th>Qty</th>
            <th>Amount</th>
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
                <td colSpan={4}>Savings</td>
                <td colSpan={2} className="receipt-numeric">-{money(i.discount)}</td>
              </tr>
            )}
          </tbody>
        ))}
      </table>
      <section className="fashion-receipt-summary">
        <h3>Account summary & payment</h3>
        {!returned && snapshot.loyalty && (
          <p>
            Points earned: {snapshot.loyalty.earned} | Points redeemed:{" "}
            {snapshot.loyalty.redeemed} | Points discount:{" "}
            {money(snapshot.loyalty.discount)} EGP (included in total discounts)
          </p>
        )}
        {returned?.loyalty && (
          <p>
            Points reversed: {returned.loyalty.reversed} | Points restored:{" "}
            {returned.loyalty.restored}
          </p>
        )}
        <div className="receipt-summary-row">
          <span>Total items</span>
          <b>
            {count} {count === 1 ? "item" : "items"}
          </b>
        </div>
        {returned ? (
          <>
            <div className="receipt-summary-row final">
              <span>Return total</span>
              <b>{money(returned.total)} EGP</b>
            </div>
            <div className="receipt-summary-row">
              <span>Refunded amount</span>
              <b>{money(returned.refundAmount ?? returned.total)} EGP</b>
            </div>
            <div className="receipt-summary-row">
              <span>Refund method</span>
              <b>{methods[returned.method] ?? returned.method}</b>
            </div>
          </>
        ) : (
          <>
            {[
              ["Subtotal before discount", sale.subtotal],
              ["Total discounts", sale.discount],
              [
                "Net before VAT",
                sale.netBeforeTax ?? Number(sale.total) - Number(sale.tax),
              ],
            ].map(([label, value]) => (
              <div className="receipt-summary-row" key={label}>
                <span>{label}</span>
                <b dir="ltr">
                  {label === "Total discounts" && Number(value) > 0 ? "-" : ""}
                  {money(value)} EGP
                </b>
              </div>
            ))}
            <div className="receipt-summary-row">
              <span>
                VAT
                {!snapshot.legacyTaxRateUnknown
                  ? ` (${Number(sale.taxRate ?? 0)}% ${sale.taxMode === "INCLUSIVE" ? "included" : "added"})`
                  : ""}
              </span>
              <b dir="ltr">{money(sale.tax)} EGP</b>
            </div>
            <div className="receipt-summary-row final">
              <span>Amount due</span>
              <b dir="ltr">{money(sale.total)} EGP</b>
            </div>
            {sale.payments.map((p: Row, i: number) => (
              <div className="receipt-payment" key={p.id ?? i}>
                <div className="receipt-summary-row">
                  <span>
                    Payment: {methods[p.method] ?? p.method}
                    {p.method === "CARD" && p.cardBrand
                      ? ` (${p.cardBrand})`
                      : ""}
                  </span>
                  <b dir="ltr">{money(p.amount)} EGP</b>
                </div>
                {p.authorizationCode && (
                  <p>
                    Authorization: <span dir="ltr">{p.authorizationCode}</span>
                  </p>
                )}
                {p.cardLast4 && (
                  <p>
                    Card: <span dir="ltr">**** **** **** {p.cardLast4}</span>
                  </p>
                )}
              </div>
            ))}
            {Number(sale.change) > 0 && (
              <div className="receipt-summary-row">
                <span>Cash change</span>
                <b dir="ltr">{money(sale.change)} EGP</b>
              </div>
            )}
          </>
        )}
        {exchange && (
          <div className="receipt-exchange-settlement">
            <div className="receipt-summary-row">
                <span>Returned items value</span>
              <b>{money(exchange.returned.total)} EGP</b>
            </div>
            <div className="receipt-summary-row final">
              <span>
                {Number(exchange.difference) > 0
                  ? "Price difference collected"
                  : Number(exchange.difference) < 0
                    ? "Price difference refunded"
                    : "Equal-value exchange"}
              </span>
              <b>{money(Math.abs(Number(exchange.difference)))} EGP</b>
            </div>
          </div>
        )}
      </section>
      <section className="fashion-return-policy">
        <h3>Exchange & return policy</h3>
        {policy
          .split("\n")
          .filter(Boolean)
          .map((line, index) => (
            <p key={index}>{line}</p>
          ))}
      </section>
      <footer className="fashion-receipt-footer">
        {!returned && !exchange && (
          <>
            <section className="receipt-credit-details">
              <h3>* Credit card details</h3>
              {sale.payments.filter((p: Row) => p.method !== "CASH").map((p: Row, index: number) => (
                <p key={p.id ?? index}>
                  <span dir="ltr">{money(p.amount)} EGP</span>
                  <b>{methods[p.method] ?? p.method}{p.cardBrand ? ` ${p.cardBrand}` : ""}</b>
                </p>
              ))}
            </section>
            <section className="receipt-pos-meta">
              <div><span>POS #</span><span>cashier</span><span>Time</span></div>
              <div><b dir="ltr">{snapshot.registerName ?? "POS"}</b><b>{snapshot.cashierName ?? sale.user?.name ?? ""}</b><b dir="ltr">{receiptTime}</b></div>
            </section>
            <p className="receipt-powered">{snapshot.receiptFooter || "A&Z Girls Fashion"}</p>
            <section className="receipt-payment-boxes">
              <div><span>Cash</span><strong dir="ltr">{money(paymentTotals.cash)}</strong></div>
              <div><span>Visa</span><strong dir="ltr">{money(paymentTotals.card)}</strong></div>
              <div><span>N/R</span><strong dir="ltr">{money(paymentTotals.other)}</strong></div>
            </section>
          </>
        )}
        {(returned || exchange) && <p>{snapshot.receiptFooter || "Thank you for visiting"}</p>}
      </footer>
    </>
  );
  return (
    <>
      <div
        className="receipt-actions no-print"
        role="group"
        aria-label="Receipt actions"
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
          Print receipt
        </Button>
        {actions && <div className="receipt-actions-secondary">{actions}</div>}
      </div>
      <article
        ref={preview}
        className="receipt fashion-receipt receipt-preview"
        dir="ltr"
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
            dir="ltr"
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
