import { Prisma } from "@prisma/client";
import type { Response } from "express";
import { reportPdf } from "./report-pdf.js";

type PurchaseDocument = {
  id: string;
  status: string;
  createdAt: Date;
  supplier: { name: string };
  location: { name: string } | null;
  items: {
    variantId: string;
    quantity: number;
    received: number;
    unitCost: Prisma.Decimal;
    variant: {
      sku: string;
      options: unknown;
      product: { nameAr: string };
    } | null;
  }[];
  receipts: { createdAt: Date; total: Prisma.Decimal }[];
};
const money = (value: Prisma.Decimal) =>
  `${new Intl.NumberFormat("en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value.toNumber())} EGP`;
const date = (value: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Cairo",
  }).format(value);
const statuses: Record<string, string> = {
  DRAFT: "مسودة",
  APPROVED: "معتمد",
  PARTIAL: "استلام جزئي",
  RECEIVED: "تم الاستلام",
  CANCELLED: "ملغي",
};
export async function purchasePdf(res: Response, order: PurchaseDocument) {
  const total = order.items.reduce(
    (sum, item) => sum.plus(item.unitCost.mul(item.quantity)),
    new Prisma.Decimal(0),
  );
  const rows: Record<string, unknown>[] = order.items.map((item) => ({
    item: item.variant
      ? `${item.variant.product.nameAr || item.variant.sku}\n${Object.entries((item.variant.options ?? {}) as Record<string, unknown>).map(([key, value]) => `${key === "size" ? "المقاس" : key === "color" ? "اللون" : key}: ${String(value)}`).join(" • ")}`
      : item.variantId,
    quantity: item.quantity,
    received: item.received,
    cost: money(item.unitCost),
    total: money(item.unitCost.mul(item.quantity)),
  }));
  rows.push({
    item: "الإجمالي",
    quantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
    received: order.items.reduce((sum, item) => sum + item.received, 0),
    cost: "",
    total: money(total),
  });
  if (order.receipts.length) {
    rows.push({
      item: "سجل الاستلام",
      quantity: "",
      received: "",
      cost: "",
      total: "",
    });
    for (const receipt of order.receipts)
      rows.push({
        item: date(receipt.createdAt),
        quantity: "",
        received: "",
        cost: "",
        total: money(receipt.total),
      });
  }
  await reportPdf(
    res,
    "فاتورة مشتريات",
    [
      { key: "item", label: "الصنف" },
      { key: "quantity", label: "الكمية" },
      { key: "received", label: "تم استلامه" },
      { key: "cost", label: "سعر الشراء" },
      { key: "total", label: "الإجمالي" },
    ],
    rows,
    date(order.createdAt),
    {
      filename: `purchase-${order.id}.pdf`,
      disposition: "inline",
      centerNumericCells: true,
      metadata: [
        `المورد: ${order.supplier.name}`,
        `المخزن: ${order.location?.name ?? "—"}`,
        `الحالة: ${statuses[order.status] ?? order.status}`,
      ],
    },
  );
}
