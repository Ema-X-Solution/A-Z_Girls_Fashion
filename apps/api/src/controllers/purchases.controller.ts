import { listResult } from "../utils/pagination.js";
import type { RequestHandler } from "express";
import { z } from "zod";
import { id, money } from "@az/shared";
import { db, assert, audit, transaction } from "../lib/db.js";
import { actor } from "../middleware/auth.js";
import { once, receive, receiveSchema } from "../services/operations.js";
import { route, uuid, page } from "../utils/http.js";
import { purchasePdf } from "../utils/purchase-pdf.js";

export const handleGetPurchases: RequestHandler = route(async (req, res) => {
  const [data, total] = await Promise.all([
    await db.purchaseOrder.findMany({
      include: {
        supplier: true,
        location: true,
        items: {
          include: {
            variant: {
              select: {
                sku: true,
                options: true,
                product: { select: { nameAr: true } },
              },
            },
          },
        },
        receipts: {
          include: { items: true },
          orderBy: { createdAt: "asc" as const },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...page(req.query),
    }),
    db.purchaseOrder.count(),
  ]);
  res.json(listResult(req.query, data, total));
});

export const handlePostPurchases: RequestHandler = route(async (req, res) => {
  const input = z
    .object({
      supplierId: id,
      locationId: id,
      items: z
        .array(
          z.object({
            variantId: id,
            quantity: z.number().int().positive(),
            unitCost: money,
            salePrice: money,
            minStock: z.coerce.number().int().nonnegative().optional(),
          }),
        )
        .min(1)
        .max(200),
    })
    .parse(req.body);
  const canChangePrice = actor(req).permissions.includes(
    "products.change_price",
  );
  const p = await transaction(async (tx) => {
    // Validate every line before any write, using the same serializable transaction.
    if (!canChangePrice) {
      const variants = await tx.productVariant.findMany({
        where: { id: { in: input.items.map((item) => item.variantId) } },
        select: { id: true, price: true },
      });
      const prices = new Map(
        variants.map((variant) => [variant.id, variant.price]),
      );
      for (const item of input.items) {
        const price = prices.get(item.variantId);
        assert(
          price,
          "VARIANT_NOT_FOUND",
          "الصنف غير موجود. حدّث القائمة وحاول مرة أخرى.",
          404,
        );
        assert(
          price.equals(item.salePrice),
          "PRICE_CHANGE_FORBIDDEN",
          "لا تملك صلاحية تغيير سعر البيع. استخدم سعر البيع الحالي للصنف أو اطلب من المسؤول تعديل السعر.",
          403,
        );
      }
    }
    // Extract salePrice and minStock from items before inserting (not DB columns on PurchaseItem)
    const itemsForCreate = input.items.map(
      ({ salePrice: _sp, minStock: _ms, ...item }) => item,
    );
    const p = await tx.purchaseOrder.create({
      data: {
        supplierId: input.supplierId,
        locationId: input.locationId,
        createdBy: actor(req).id,
        items: { create: itemsForCreate },
      },
      include: { items: true },
    });
    // Update variant sale prices and dynamic minStock where provided
    for (const item of input.items) {
      const updateData: Record<string, any> = {};
      if (canChangePrice) updateData.price = item.salePrice;
      if (item.minStock !== undefined) updateData.minStock = item.minStock;
      if (Object.keys(updateData).length > 0) {
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: updateData,
        });
      }
    }
    await audit(tx, actor(req).id, "PURCHASE_CREATE", p.id);
    return p;
  });
  res.status(201).json({ data: p });
});

export const handlePatchPurchasesById: RequestHandler = route(
  async (req, res) => {
    const purchaseId = uuid(req.params.id);
    // Editing never touches the variant sale price: the form does not send one.
    const input = z
      .object({
        supplierId: id,
        locationId: id,
        items: z
          .array(
            z.object({
              variantId: id,
              quantity: z.number().int().positive(),
              unitCost: money,
            }),
          )
          .min(1)
          .max(200),
      })
      .parse(req.body);
    assert(
      new Set(input.items.map((item) => item.variantId)).size ===
        input.items.length,
      "PURCHASE_DUPLICATE_ITEM",
      "الصنف مكرر في الفاتورة. ادمج الكميات في صف واحد.",
    );
    const p = await transaction(async (tx) => {
      // The status guard is the lock: only a draft that nobody approved meanwhile.
      const locked = await tx.purchaseOrder.updateMany({
        where: { id: purchaseId, status: "DRAFT" },
        data: { supplierId: input.supplierId, locationId: input.locationId },
      });
      assert(
        locked.count === 1,
        "PURCHASE_STATUS",
        "لا يمكن تعديل الفاتورة إلا وهي مسودة. ألغِ الاعتماد أولاً.",
        409,
      );
      await tx.purchaseOrderItem.deleteMany({ where: { purchaseId } });
      await tx.purchaseOrderItem.createMany({
        data: input.items.map((item) => ({ ...item, purchaseId })),
      });
      await audit(tx, actor(req).id, "PURCHASE_EDIT", purchaseId);
      return tx.purchaseOrder.findUnique({
        where: { id: purchaseId },
        include: { items: true },
      });
    });
    res.json({ data: p });
  },
);

export const handlePostPurchasesByIdUnapprove: RequestHandler = route(
  async (req, res) => {
    const purchaseId = uuid(req.params.id);
    await transaction(async (tx) => {
      const receipts = await tx.purchaseReceipt.count({
        where: { purchaseId },
      });
      assert(
        receipts === 0,
        "PURCHASE_RECEIVED",
        "تم استلام جزء من الفاتورة، لا يمكن إلغاء اعتمادها.",
        409,
      );
      const p = await tx.purchaseOrder.updateMany({
        where: { id: purchaseId, status: "APPROVED" },
        data: { status: "DRAFT" },
      });
      assert(
        p.count === 1,
        "PURCHASE_STATUS",
        "يمكن إلغاء الاعتماد للفواتير المعتمدة فقط.",
        409,
      );
      await audit(tx, actor(req).id, "PURCHASE_UNAPPROVE", purchaseId);
    });
    res.json({ data: { ok: true } });
  },
);

export const handlePostPurchasesByIdApprove: RequestHandler = route(
  async (req, res) => {
    const purchaseId = uuid(req.params.id);
    await transaction(async (tx) => {
      const p = await tx.purchaseOrder.updateMany({
        where: { id: purchaseId, status: "DRAFT" },
        data: { status: "APPROVED" },
      });
      assert(p.count === 1, "PURCHASE_STATUS", "Purchase is not draft");
      await audit(tx, actor(req).id, "PURCHASE_APPROVE", purchaseId);
    });
    res.json({ data: { ok: true } });
  },
);

export const handlePostPurchasesByIdReceive: RequestHandler = route(
  async (req, res) => {
    const purchaseId = uuid(req.params.id),
      input = receiveSchema.parse(req.body);
    res.json({
      data: await once(
        actor(req),
        req.get("Idempotency-Key"),
        `receive:${purchaseId}`,
        input,
        (tx) => receive(tx, actor(req), purchaseId, input),
      ),
    });
  },
);

export const handleGetPurchasePdf: RequestHandler = route(async (req, res) => {
  const order = await db.purchaseOrder.findUnique({
    where: { id: uuid(req.params.id) },
    include: {
      supplier: true,
      location: true,
      items: {
        include: {
          variant: {
            select: {
              sku: true,
              options: true,
              product: { select: { nameAr: true } },
            },
          },
        },
      },
      receipts: { orderBy: { createdAt: "asc" } },
    },
  });
  assert(order, "PURCHASE_NOT_FOUND", "فاتورة المشتريات غير موجودة", 404);
  await purchasePdf(res, order);
});
