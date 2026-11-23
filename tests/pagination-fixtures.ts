import type { PrismaClient } from "@prisma/client";
// Synthetic display fixtures only. Never run against a connected/live database.
export async function seedPaginationLists(db: PrismaClient) {
  if (!process.env.DATABASE_URL?.includes("127.0.0.1"))
    throw new Error("Local fixtures only");
  const user = await db.user.findFirstOrThrow();
  const branch = await db.branch.findFirstOrThrow();
  const location = await db.stockLocation.findFirstOrThrow();
  const destination = await db.stockLocation.create({
    data: { name: "مخزن سموحة", branchId: branch.id },
  });
  const register = await db.register.create({
    data: {
      name: "كاشير تجريبي",
      branchId: branch.id,
      locationId: location.id,
    },
  });
  const shift = await db.cashShift.create({
    data: { registerId: register.id, userId: user.id, openingCash: 500 },
  });
  await db.expenseCategory.create({ data: { name: "تشغيل المتجر" } });
  const variants = await db.productVariant.findMany({
    take: 65,
    include: { product: true },
  });
  const descriptions = [
    "بلوزة قطن صيفي",
    "فستان كاجوال",
    "بنطلون جينز",
    "قميص كتان",
    "تنورة طويلة",
  ];
  for (let i = 0; i < 65; i++) {
    const v = variants[i];
    const name = descriptions[i % descriptions.length];
    await db.product.update({
      where: { id: v.productId },
      data: { nameAr: `${name} ${i + 1}` },
    });
    const customer = await db.customer.create({
      data: {
        name: `عميلة تجريبية ${i + 1}`,
        phone: `010${String(i).padStart(8, "0")}`,
        address: "الإسكندرية، سموحة",
      },
    });
    const supplier = await db.supplier.create({
      data: {
        name: `مورد الأناقة ${i + 1}`,
        phone: `011${String(i).padStart(8, "0")}`,
        address: "الإسكندرية، المنشية",
      },
    });
    await db.sale.create({
      data: {
        receiptNumber: `DEMO-${String(i + 1).padStart(5, "0")}`,
        userId: user.id,
        branchId: branch.id,
        shiftId: shift.id,
        customerId: customer.id,
        subtotal: 400,
        netBeforeTax: 400,
        discount: 0,
        tax: 0,
        total: 400,
        change: 0,
        items: {
          create: {
            variantId: v.id,
            name,
            options: v.options!,
            barcode: v.barcode,
            sku: v.sku,
            unitPrice: 200,
            unitCost: 100,
            quantity: 2,
            discount: 0,
            tax: 0,
            total: 400,
          },
        },
        payments: { create: { method: "CASH", amount: 400 } },
      },
    });
    await db.purchaseOrder.create({
      data: {
        supplierId: supplier.id,
        locationId: location.id,
        createdBy: user.id,
        status: i % 2 ? "DRAFT" : "APPROVED",
        items: { create: { variantId: v.id, quantity: 12, unitCost: 100 } },
      },
    });
    await db.stockBalance.create({
      data: {
        variantId: v.id,
        locationId: location.id,
        quantity: 24 + i,
        averageCost: 100,
      },
    });
    await db.stockMovement.create({
      data: {
        variantId: v.id,
        locationId: location.id,
        quantity: 12,
        unitCost: 100,
        type: "PURCHASE",
        reference: crypto.randomUUID(),
        reason: "استلام تشكيلة الموسم",
        userId: user.id,
      },
    });
    await db.stockDocument.create({
      data: {
        type: "TRANSFER",
        sourceId: location.id,
        destinationId: destination.id,
        reason: `توزيع تشكيلة الفروع ${i + 1}`,
        totalCost: 300,
        createdBy: user.id,
        items: {
          create: {
            variantId: v.id,
            name,
            sku: v.sku,
            quantity: 3,
            unitCost: 100,
          },
        },
      },
    });
    await db.stockCount.create({
      data: {
        locationId: location.id,
        createdBy: user.id,
        status: "CANCELLED",
        items: {
          create: { variantId: v.id, expected: 24 + i, actual: 24 + i },
        },
      },
    });
    await db.shipment.create({
      data: {
        sourceId: location.id,
        destinationId: destination.id,
        reason: `إمداد فرع سموحة ${i + 1}`,
        createdBy: user.id,
        items: { create: { variantId: v.id, quantity: 3, unitCost: 100 } },
      },
    });
    await db.stockHold.create({
      data: {
        variantId: v.id,
        locationId: location.id,
        quantity: 1,
        unitCost: 100,
        reason: `مراجعة جودة ${i + 1}`,
        createdBy: user.id,
      },
    });
    await db.expense.create({
      data: {
        category: "تشغيل المتجر",
        amount: 100 + i,
        method: "BANK",
        description: `مستلزمات تغليف وشحن ${i + 1}`,
        createdBy: user.id,
      },
    });
    await db.auditLog.create({
      data: {
        userId: user.id,
        action: "PRODUCT_CREATE",
        reference: v.productId,
        details: { name },
      },
    });
    await db.promotion.create({
      data: {
        name: `عرض الموسم ${i + 1}`,
        type: "PERCENT",
        percent: 10,
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 86400000 * 7),
        createdBy: user.id,
      },
    });
    await db.discountApproval.create({
      data: {
        requesterId: user.id,
        shiftId: shift.id,
        input: {},
        fingerprint: `fixture-${i}`,
        reason: `خصم عميلة منتظمة ${i + 1}`,
        subtotal: 400,
        discount: 40,
        total: 360,
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
  }
  // Extra display fixtures for nested lists. These are not accounting assertions.
  const customer = await db.customer.findFirstOrThrow();
  await db.sale.updateMany({ data: { customerId: customer.id } });
  const sale = await db.sale.findFirstOrThrow({ include: { items: true } });
  const supplier = await db.supplier.findFirstOrThrow();
  const purchase = await db.purchaseOrder.findFirstOrThrow();
  for (let i = 0; i < 65; i++) {
    await db.saleReturn.create({
      data: {
        saleId: sale.id,
        shiftId: shift.id,
        createdBy: user.id,
        reason: `مرتجع عرض محلي ${i + 1}`,
        method: "BANK",
        total: 10,
        refundAmount: 10,
        items: {
          create: {
            saleItemId: sale.items[0].id,
            quantity: 1,
            sellable: true,
            amount: 10,
            cost: 5,
          },
        },
      },
    });
    await db.loyaltyEntry.create({
      data: {
        customerId: customer.id,
        reference: `display-${i}`,
        kind: "EARN",
        points: 10,
      },
    });
    const receipt = await db.purchaseReceipt.create({
      data: { purchaseId: purchase.id, createdBy: user.id, total: 1200 },
    });
    const invoice = await db.supplierInvoice.create({
      data: {
        supplierId: supplier.id,
        receiptId: receipt.id,
        total: 1200,
        createdBy: user.id,
      },
    });
    await db.purchaseReturn.create({
      data: {
        supplierId: supplier.id,
        invoiceId: invoice.id,
        reason: `مرتجع مورد ${i + 1}`,
        total: 100,
        createdBy: user.id,
      },
    });
    await db.supplierPayment.create({
      data: {
        supplierId: supplier.id,
        amount: 200,
        method: "BANK",
        notes: `دفعة توريد ${i + 1}`,
        createdBy: user.id,
      },
    });
    await db.expenseCategory.create({
      data: { name: `تصنيف تشغيل ${String(i + 1).padStart(3, "0")}` },
    });
    await db.role.create({
      data: { name: `دور تجريبي ${String(i + 1).padStart(3, "0")}` },
    });
    await db.user.create({
      data: {
        name: `موظف تجريبي ${i + 1}`,
        email: `fixture${i}@example.test`,
        passwordHash: user.passwordHash,
      },
    });
    await db.session.create({
      data: {
        id:
          crypto.randomUUID().replaceAll("-", "") +
          crypto.randomUUID().replaceAll("-", ""),
        userId: user.id,
        csrf: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    await db.branch.create({
      data: {
        name: `فرع تجريبي ${String(i + 1).padStart(3, "0")}`,
        locations: { create: { name: `مخزن الفرع ${i + 1}` } },
      },
    });
    await db.stockLocation.create({
      data: { name: `مخزن إضافي ${i + 1}`, branchId: branch.id },
    });
    await db.register.create({
      data: {
        name: `جهاز تجريبي ${i + 1}`,
        branchId: branch.id,
        locationId: location.id,
      },
    });
    await db.cashShift.create({
      data: {
        registerId: register.id,
        userId: user.id,
        openingCash: 500,
        closedAt: new Date(),
        expectedCash: 500,
        countedCash: 500,
        difference: 0,
      },
    });
  }
  await db.category.createMany({
    data: Array.from({ length: 65 }, (_, i) => ({
      name: `تصنيف مؤرشف ${i + 1}`,
      archivedAt: new Date(),
    })),
  });
  const archiveCategory = await db.category.findFirstOrThrow({
    where: { archivedAt: null },
  });
  await db.product.createMany({
    data: Array.from({ length: 65 }, (_, i) => ({
      nameAr: `منتج مؤرشف ${i + 1}`,
      sku: `ARCHIVE-${i}`,
      status: "ARCHIVED",
      categoryId: archiveCategory.id,
      createdBy: user.id,
    })),
  });
 await db.category.createMany({data:Array.from({length:65},(_,i)=>({name:`قسم عرض ${i+1}`}))});

      }
