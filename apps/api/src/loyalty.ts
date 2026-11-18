import { z } from "zod";
import { money } from "@az/shared";
import { type Tx, assert } from "./db.js";
import { D, round } from "./money.js";

export const loyaltySettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    spendPerPoint: money.refine((v) => D(v).gte(1)).default("100"),
    pointValue: money.refine((v) => D(v).gt(0) && D(v).lte(100)).default("1"),
    expiryDays: z.number().int().min(1).max(3650).default(365),
    maxRedeemPercent: z.number().int().min(1).max(90).default(20),
    minimumRedeemPoints: z.number().int().min(1).max(1000000).default(1),
  })
  .strict();
export async function loyaltySettings(tx: Tx) {
  return loyaltySettingsSchema.parse(
    (await tx.systemSetting.findUnique({ where: { key: "loyalty" } }))?.value ??
      {},
  );
}
export async function loyaltyBalance(tx: Tx, customerId: string) {
  const [lots, account] = await Promise.all([
    tx.loyaltyLot.aggregate({
      where: { customerId, expiresAt: { gt: new Date() } },
      _sum: { remaining: true },
    }),
    tx.loyaltyAccount.findUnique({ where: { customerId } }),
  ]);
  return {
    available: Math.max(0, (lots._sum.remaining ?? 0) - (account?.debt ?? 0)),
    debt: account?.debt ?? 0,
  };
}
export async function lockLoyalty(tx: Tx, customerId: string) {
  assert(
    await tx.customer.findUnique({ where: { id: customerId } }),
    "NOT_FOUND",
    "Customer not found",
    404,
  );
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`loyalty:${customerId}`},0))`;
  await tx.loyaltyAccount.upsert({
    where: { customerId },
    create: { customerId },
    update: {},
  });
  const expired = await tx.loyaltyLot.findMany({
    where: { customerId, remaining: { gt: 0 }, expiresAt: { lte: new Date() } },
  });
  for (const lot of expired) {
    await tx.loyaltyLot.update({
      where: { id: lot.id },
      data: { remaining: 0, expired: { increment: lot.remaining } },
    });
    await tx.loyaltyEntry.create({
      data: {
        customerId,
        reference: `expire:${lot.id}`,
        kind: "EXPIRE",
        points: -lot.remaining,
      },
    });
  }
}
export async function loyaltyQuote(
  tx: Tx,
  customerId: string | undefined,
  points: number,
  base: ReturnType<typeof D>,
) {
  const settings = await loyaltySettings(tx);
  assert(
    !points || customerId,
    "LOYALTY_CUSTOMER",
    "Select a customer to redeem points",
    400,
  );
  assert(
    !points || settings.enabled,
    "LOYALTY_DISABLED",
    "Loyalty program is disabled",
    409,
  );
  const balance = customerId
    ? await loyaltyBalance(tx, customerId)
    : { available: 0, debt: 0 };
  if (points) {
    assert(
      points >= settings.minimumRedeemPoints,
      "LOYALTY_MINIMUM",
      "Below the minimum redemption points",
      400,
    );
    assert(
      points <= balance.available && balance.debt === 0,
      "LOYALTY_BALANCE",
      "Insufficient available loyalty points",
      409,
    );
  }
  const discount = round(D(settings.pointValue).mul(points));
  assert(
    discount.lte(round(base.mul(settings.maxRedeemPercent).div(100))) &&
      (!points || discount.lt(base)),
    "LOYALTY_LIMIT",
    "Loyalty redemption exceeds the configured invoice limit",
    400,
  );
  return { ...balance, points, discount, settings };
}
async function grant(
  tx: Tx,
  customerId: string,
  points: number,
  reference: string,
  expiresAt: Date,
  saleId?: string,
) {
  if (points <= 0 || expiresAt <= new Date()) return 0;
  const account = await tx.loyaltyAccount.findUniqueOrThrow({
    where: { customerId },
  });
  const paidDebt = Math.min(points, account.debt);
  if (paidDebt)
    await tx.loyaltyAccount.update({
      where: { customerId },
      data: { debt: { decrement: paidDebt } },
    });
  await tx.loyaltyLot.create({
    data: {
      customerId,
      reference,
      saleId,
      points,
      remaining: points - paidDebt,
      expiresAt,
    },
  });
  return points;
}
export async function postLoyaltySale(
  tx: Tx,
  customerId: string | undefined,
  saleId: string,
  quote: any,
  net: ReturnType<typeof D>,
) {
  if (!customerId || !quote.settings.enabled)
    return { earned: 0, redeemed: 0, discount: "0.00" };
  let remaining = quote.points as number;
  const lots = await tx.loyaltyLot.findMany({
    where: { customerId, expiresAt: { gt: new Date() }, remaining: { gt: 0 } },
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
  });
  for (const lot of lots) {
    const use = Math.min(remaining, lot.remaining);
    if (!use) break;
    await tx.loyaltyLot.update({
      where: { id: lot.id },
      data: { remaining: { decrement: use } },
    });
    await tx.loyaltyRedemption.create({
      data: { saleId, lotId: lot.id, points: use },
    });
    remaining -= use;
  }
  assert(
    remaining === 0,
    "LOYALTY_BALANCE",
    "Loyalty points changed; retry checkout",
  );
  if (quote.points)
    await tx.loyaltyEntry.create({
      data: {
        customerId,
        saleId,
        reference: `redeem:${saleId}`,
        kind: "REDEEM",
        points: -quote.points,
      },
    });
  const earned = Math.min(
    1000000,
    net.div(quote.settings.spendPerPoint).floor().toNumber(),
  );
  const expiresAt = new Date(Date.now() + quote.settings.expiryDays * 86400000);
  if (earned) {
    await grant(tx, customerId, earned, `earn:${saleId}`, expiresAt, saleId);
    await tx.loyaltyEntry.create({
      data: {
        customerId,
        saleId,
        reference: `earn:${saleId}`,
        kind: "EARN",
        points: earned,
      },
    });
  }
  return {
    earned,
    redeemed: quote.points,
    discount: quote.discount.toFixed(2),
    expiresAt: earned ? expiresAt.toISOString() : null,
  };
}
export async function reverseLoyalty(tx: Tx, sale: any, returnId: string) {
  const snapshot = sale.receiptSnapshot as any;
  if (!sale.customerId || !snapshot.loyalty)
    return { reversed: 0, restored: 0 };
  const customerId = sale.customerId as string;
  await lockLoyalty(tx, customerId);
  const items = await tx.saleItem.findMany({ where: { saleId: sale.id } });
  const complete = items.every((i) => i.returned === i.quantity);
  const refunded = items.reduce((sum, i) => sum.plus(i.refunded), D(0));
  const ratio = complete
    ? D(1)
    : D(sale.total).gt(0)
      ? refunded.div(sale.total)
      : D(0);
  const lot = await tx.loyaltyLot.findUnique({ where: { saleId: sale.id } });
  let reversed = 0;
  if (lot) {
    reversed = Math.max(
      0,
      ratio.mul(lot.points).floor().toNumber() - lot.reversed,
    );
    const available = Math.min(reversed, lot.remaining),
      expired = Math.min(reversed - available, lot.expired);
    let owed = reversed - available - expired;
    await tx.loyaltyLot.update({
      where: { id: lot.id },
      data: {
        remaining: { decrement: available },
        expired: { decrement: expired },
        reversed: { increment: reversed },
      },
    });
    const others = await tx.loyaltyLot.findMany({
      where: {
        customerId,
        id: { not: lot.id },
        remaining: { gt: 0 },
        expiresAt: { gt: new Date() },
      },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
    });
    for (const other of others) {
      const use = Math.min(owed, other.remaining);
      if (!use) break;
      await tx.loyaltyLot.update({
        where: { id: other.id },
        data: { remaining: { decrement: use } },
      });
      owed -= use;
    }
    if (owed)
      await tx.loyaltyAccount.update({
        where: { customerId },
        data: { debt: { increment: owed } },
      });
    if (reversed > expired)
      await tx.loyaltyEntry.create({
        data: {
          customerId,
          saleId: sale.id,
          returnId,
          reference: `reverse:${returnId}`,
          kind: "REVERSE",
          points: -(reversed - expired),
        },
      });
  }
  const spends = await tx.loyaltyRedemption.findMany({
    where: { saleId: sale.id },
    include: { lot: true },
    orderBy: { id: "asc" },
  });
  let toRestore = Math.max(
      0,
      ratio
        .mul(snapshot.loyalty.redeemed ?? 0)
        .floor()
        .toNumber() - spends.reduce((s, r) => s + r.restored, 0),
    ),
    restored = 0;
  for (const spend of spends) {
    const count = Math.min(toRestore, spend.points - spend.restored);
    if (!count) continue;
    await tx.loyaltyRedemption.update({
      where: { id: spend.id },
      data: { restored: { increment: count } },
    });
    if (spend.lot.expiresAt <= new Date()) {
      // An expired refund cannot create spendable points, but must cancel any
      // outstanding clawback it repays. Mark the uncredited remainder expired
      // on its source lot so a later return of that award cannot charge it again.
      const account = await tx.loyaltyAccount.findUniqueOrThrow({
        where: { customerId },
      });
      const paidDebt = Math.min(count, account.debt);
      if (paidDebt)
        await tx.loyaltyAccount.update({
          where: { customerId },
          data: { debt: { decrement: paidDebt } },
        });
      restored += paidDebt;
      const source = await tx.loyaltyLot.findUniqueOrThrow({
        where: { id: spend.lotId },
      });
      const expired = Math.min(
        count - paidDebt,
        source.points - source.remaining - source.expired - source.reversed,
      );
      if (expired)
        await tx.loyaltyLot.update({
          where: { id: source.id },
          data: { expired: { increment: expired } },
        });
    } else {
      restored += await grant(
        tx,
        customerId,
        count,
        `restore:${returnId}:${spend.id}`,
        spend.lot.expiresAt,
      );
    }
    toRestore -= count;
  }
  if (restored)
    await tx.loyaltyEntry.create({
      data: {
        customerId,
        saleId: sale.id,
        returnId,
        reference: `restore:${returnId}`,
        kind: "RESTORE",
        points: restored,
      },
    });
  return { reversed, restored };
}
