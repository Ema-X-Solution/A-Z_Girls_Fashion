import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  id,
  customerPhoneKey,
  customerPhoneSchema,
  customerPhoneSearch,
  asciiPhone,
} from "@az/shared";
import { db, assert, audit, transaction, type Tx } from "../lib/db.js";
import { actor, requirePermission as can, type Actor } from "../middleware/auth.js";
export const customerSchema = z
  .object({
    name: z.string().trim().max(200).default(""),
    phone: customerPhoneSchema,
    email: z.string().email().optional(),
    address: z.string().max(1000).default(""),
    notes: z.string().max(2000).default(""),
  })
  .strict();
export async function matchingPhone(tx: Tx, phone: string, except?: string) {
  const key = customerPhoneKey(phone);
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "Customer" WHERE customer_phone_key(phone)=${key} AND (${except ?? null}::uuid IS NULL OR id<>${except ?? null}::uuid) ORDER BY "createdAt",id LIMIT 1`;
  return rows[0]
    ? tx.customer.findUniqueOrThrow({ where: { id: rows[0].id } })
    : null;
}
export async function lockCustomerPhone(tx: Tx, phone: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`customer-phone:${customerPhoneKey(phone)}`},0))`;
}
export async function createCustomer(
  tx: Tx,
  user: Actor,
  input: z.infer<typeof customerSchema>,
  reuse = false,
) {
  await lockCustomerPhone(tx, input.phone);
  const existing = await matchingPhone(tx, input.phone);
  if (existing) {
    assert(
      reuse,
      "CUSTOMER_PHONE_EXISTS",
      "رقم التليفون مسجل بالفعل لعميل آخر",
      409,
    );
    return { customer: existing, created: false };
  }
  const customer = await tx.customer.create({ data: input });
  await audit(tx, user.id, "CUSTOMER_CREATE", customer.id, {});
  return { customer, created: true };
}
export async function searchCustomers(
  q: string,
  offset: number,
  limit: number,
  details: boolean,
) {
  const digits = customerPhoneSearch(q);
  const rawDigits = asciiPhone(q).replace(/\D/g, "");
  const where = digits
    ? Prisma.sql`(customer_phone_key(phone) LIKE ${`%${digits}%`} OR customer_phone_key(phone) LIKE ${`%${rawDigits}%`})`
    : q
      ? Prisma.sql`name ILIKE ${`%${q.replace(/[\\%_]/g, "\\$&")}%`} ESCAPE '\'`
      : Prisma.sql`TRUE`;
  return db.$transaction(
    async (tx) => {
      const ids = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM "Customer" WHERE ${where} ORDER BY "createdAt" DESC,id DESC LIMIT ${limit} OFFSET ${offset}`,
      );
      const count = await tx.$queryRaw<{ total: bigint }[]>(
        Prisma.sql`SELECT COUNT(*) AS total FROM "Customer" WHERE ${where}`,
      );
      const rows = await tx.customer.findMany({
        where: { id: { in: ids.map((i) => i.id) } },
        ...(details ? {} : { select: { id: true, name: true, phone: true } }),
      });
      return {
        data: ids.map((i) => rows.find((row) => row.id === i.id)!),
        total: Number(count[0]!.total),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
export const customers = Router();
customers.post(
  "/customers/resolve",
  can("pos.access"),
  can("sales.create"),
  async (req, res, next) => {
    try {
      const input = z
        .object({
          phone: customerPhoneSchema,
          name: z.string().trim().max(200).default(""),
        })
        .strict()
        .parse(req.body);
      const result = await transaction((tx) =>
        createCustomer(
          tx,
          actor(req),
          { ...input, address: "", notes: "" },
          true,
        ),
      );
      res.status(result.created ? 201 : 200).json({
        data: {
          id: result.customer.id,
          name: result.customer.name,
          phone: result.customer.phone,
        },
        created: result.created,
      });
    } catch (e) {
      next(e);
    }
  },
);
customers.get(
  "/customers/:id",
  can("customers.manage", "pos.access"),
  async (req, res, next) => {
    try {
      const customer = await db.customer.findUnique({
        where: { id: id.parse(req.params.id) },
        select: { id: true, name: true, phone: true },
      });
      assert(customer, "NOT_FOUND", "العميل غير موجود", 404);
      res.json({ data: customer });
    } catch (e) {
      next(e);
    }
  },
);
