import { variantOption } from "@az/shared";
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
    item: item.variant?.product.nameAr || item.variant?.sku || item.variantId,
    size: variantOption(item.variant?.options, "size") || "—",
    color: variantOption(item.variant?.options, "color") || "—",
    quantity: item.quantity,
    received: item.received,
    cost: money(item.unitCost),
    total: money(item.unitCost.mul(item.quantity)),
  }));
  rows.push({
    item: "الإجمالي",
    size: "",
    color: "",
    quantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
    received: order.items.reduce((sum, item) => sum + item.received, 0),
    cost: "",
    total: money(total),
  });
  if (order.receipts.length) {
    rows.push({
      item: "سجل الاستلام",
      size: "",
      color: "",
      quantity: "",
      received: "",
      cost: "",
      total: "",
    });
    for (const receipt of order.receipts)
      rows.push({
        item: date(receipt.createdAt),
        size: "",
        color: "",
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
      { key: "item", label: "الصنف", width: 0.28 },
      { key: "size", label: "المقاس", width: 0.075 },
      { key: "color", label: "اللون", width: 0.115 },
      { key: "quantity", label: "الكمية", width: 0.075 },
      { key: "received", label: "تم استلامه", width: 0.095 },
      { key: "cost", label: "سعر الشراء", width: 0.17 },
      { key: "total", label: "الإجمالي", width: 0.19 },
    ],
    rows,
    date(order.createdAt),
    {
      filename: `purchase-${order.id}.pdf`,
      disposition: "inline",
      centerCells: true,
      unifiedFont: true,
      metadata: [
        `المورد: ${order.supplier.name}`,
        `المخزن: ${order.location?.name ?? "—"}`,
        `الحالة: ${statuses[order.status] ?? order.status}`,
      ],
    },
  );
                                     }
