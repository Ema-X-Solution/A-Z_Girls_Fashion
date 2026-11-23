import { Prisma } from "@prisma/client";
import { assert, type Tx } from "../lib/db.js";
import { D } from "../utils/money.js";
export type CostSlice = {
  unitCost: Prisma.Decimal;
  quantity: number;
  acquiredAt: Date;
};
// Slices are retained even when a batch is exhausted, so later returns use the original cost.
export async function originalSlices(
  tx: Tx,
  reference: string,
  type: string,
  variantId: string,
  offset: number,
  quantity: number,
): Promise<CostSlice[]> {
  const flows = await tx.stockCostFlow.findMany({
    where: { reference, type, variantId, quantity: { lt: 0 } },
    orderBy: [{ createdAt: "asc" }, { sequence: "asc" }],
    include: { batch: true },
  });
  const result: CostSlice[] = [];
  for (const flow of flows) {
    const available = -flow.quantity;
    const skip = Math.min(offset, available);
    offset -= skip;
    const take = Math.min(quantity, available - skip);
    if (take) {
      result.push({
        unitCost: flow.batch.unitCost,
        quantity: take,
        acquiredAt: flow.batch.acquiredAt,
      });
      quantity -= take;
    }
  }
  assert(
    quantity === 0,
    "FIFO_HISTORY",
    "تعذر مطابقة تكلفة الحركة الأصلية؛ راجع سجل المخزون",
  );
  return result;
}
export async function fifoStock(
  tx: Tx,
  input: {
    variantId: string;
    locationId: string;
    quantity: number;
    type: string;
    reference: string;
    cost?: Prisma.Decimal;
    layers?: CostSlice[];
  },
  balance: { quantity: number; averageCost: Prisma.Decimal },
) {
  const { variantId, locationId, quantity, type, reference } = input;
  let total = D(0),
    sequence = 0;
  if (quantity > 0) {
    let layers = input.layers;
    const originalType = (
      {
        TRANSFER_IN: "TRANSFER_OUT",
        SHIPMENT_IN: "SHIPMENT_OUT",
        QUARANTINE_RELEASE: "QUARANTINE_OUT",
      } as Record<string, string>
    )[type];
    if (!layers && originalType) {
      const used = await tx.stockCostFlow.aggregate({
        where: { variantId, reference, type, quantity: { gt: 0 } },
        _sum: { quantity: true },
      });
      const history = await tx.stockCostFlow.count({
        where: { variantId, reference, type: originalType },
      });
      if (history)
        layers = await originalSlices(
          tx,
          reference,
          originalType,
          variantId,
          used._sum.quantity ?? 0,
          quantity,
        );
    }
    layers ??= [
      {
        quantity,
        unitCost: input.cost ?? balance.averageCost,
        acquiredAt: new Date(),
      },
    ];
    assert(
      layers.reduce((s, l) => s + l.quantity, 0) === quantity,
      "FIFO_QUANTITY",
      "كميات الدفعات غير متطابقة",
    );
    for (const layer of layers) {
      const batch = await tx.stockBatch.create({
        data: {
          variantId,
          locationId,
          quantity: layer.quantity,
          remaining: layer.quantity,
          unitCost: layer.unitCost,
          acquiredAt: layer.acquiredAt,
          reference,
          type,
        },
      });
      await tx.stockCostFlow.create({
        data: {
          batchId: batch.id,
          variantId,
          reference,
          type,
          quantity: layer.quantity,
          sequence: sequence++,
        },
      });
      total = total.plus(layer.unitCost.mul(layer.quantity));
    }
  } else if (quantity < 0) {
    const batches = await tx.stockBatch.findMany({
      where: { variantId, locationId, remaining: { gt: 0 } },
      orderBy: [{ acquiredAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    let needed = -quantity;
    for (const batch of batches) {
      const take = Math.min(needed, batch.remaining);
      if (!take) break;
      await tx.stockBatch.update({
        where: { id: batch.id },
        data: { remaining: { decrement: take } },
      });
      await tx.stockCostFlow.create({
        data: {
          batchId: batch.id,
          variantId,
          reference,
          type,
          quantity: -take,
          sequence: sequence++,
        },
      });
      total = total.plus(batch.unitCost.mul(take));
      needed -= take;
    }
    assert(
      needed === 0,
      "FIFO_BALANCE",
      "رصيد الدفعات لا يطابق المخزون؛ أوقف العملية وراجع الرصيد",
    );
  }
  const rows = await tx.stockBatch.findMany({
    where: { variantId, locationId, remaining: { gt: 0 } },
  });
  const value = rows.reduce(
    (s, b) => s.plus(b.unitCost.mul(b.remaining)),
    D(0),
  );
  const remaining = rows.reduce((s, b) => s + b.remaining, 0);
  assert(
    remaining === balance.quantity + quantity,
    "FIFO_BALANCE",
    "رصيد الدفعات لا يطابق المخزون",
  );
  return {
    unitCost: quantity
      ? total.div(Math.abs(quantity)).toDecimalPlaces(4)
      : balance.averageCost,
    totalCost: total,
    averageCost: remaining ? value.div(remaining).toDecimalPlaces(4) : D(0),
  };
}

export async function exactOutCost(
  tx: Tx,
  reference: string,
  type: string,
  variantId: string,
) {
  const flows = await tx.stockCostFlow.findMany({
    where: { reference, type, variantId, quantity: { lt: 0 } },
    include: { batch: true },
  });
  return flows.reduce(
    (sum, flow) => sum.plus(flow.batch.unitCost.mul(-flow.quantity)),
    D(0),
  );
        }
