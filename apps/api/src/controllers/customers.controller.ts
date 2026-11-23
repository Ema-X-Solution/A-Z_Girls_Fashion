import { listResult } from "../utils/pagination.js";
import type { RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { id } from "@az/shared";
import { db, assert, audit, transaction } from "../lib/db.js";
import { actor } from "../middleware/auth.js";
import { D } from "../utils/money.js";
import { customerSchema, createCustomer, searchCustomers, lockCustomerPhone, matchingPhone } from "../routes/customers.js";
import { customerPhoneSchema } from "@az/shared";
import { route, page } from "../utils/http.js";

export const handleGetCustomers: RequestHandler = route(async (req, res) => {
    const q = z.string().max(100).default("").parse(req.query.q);
    const { skip, take } = page(req.query);
    const result = await searchCustomers(
        q,
        skip,
        take,
        actor(req).permissions.includes("customers.manage"),
      );
    res.json(listResult(req.query,result.data,result.total));
  });

export const handlePostCustomers: RequestHandler = route(async (req, res) => {
    const input = customerSchema.parse(req.body);
    const result = await transaction((tx) =>
      createCustomer(tx, actor(req), input),
    );
    res.status(201).json({ data: result.customer });
  });

export const handlePatchCustomersById: RequestHandler = route(async (req, res) => {
    const customerId = id.parse(req.params.id);
    const input = z
      .object({
        name: z.string().trim().max(200).default(""),
        phone: customerPhoneSchema,
        email: z.string().email().nullable(),
        address: z.string().max(1000),
        notes: z.string().max(2000),
      })
      .strict()
      .parse(req.body);
    const customer = await transaction(async (tx) => {
      await lockCustomerPhone(tx, input.phone);
      assert(
        !(await matchingPhone(tx, input.phone, customerId)),
        "CUSTOMER_PHONE_EXISTS",
        "رقم التليفون مسجل بالفعل لعميل آخر",
        409,
      );
      assert(
        await tx.customer.findUnique({ where: { id: customerId } }),
        "NOT_FOUND",
        "Customer not found",
        404,
      );
      const updated = await tx.customer.update({
        where: { id: customerId },
        data: input,
      });
      await audit(tx, actor(req).id, "CUSTOMER_UPDATE", customerId, {});
      return updated;
    });
    res.json({ data: customer });
  });

export const handleGetCustomersByIdHistory: RequestHandler = route(async (req, res) => {
    const customerId = id.parse(req.params.id);
    const { skip, take } = page(req.query);
    const all = actor(req).permissions.includes("sales.view_all");
    const where = { customerId, ...(all ? {} : { userId: actor(req).id }) };
    const data = await db.$transaction(
      async (tx) => {
        const customer = await tx.customer.findUnique({
          where: { id: customerId },
        });
        assert(customer, "NOT_FOUND", "Customer not found", 404);
        const [purchases, returned, sales, total, returns, returnCount] =
          await Promise.all([
            tx.sale.aggregate({ where, _sum: { total: true }, _count: true }),
            tx.saleReturn.aggregate({
              where: { sale: where },
              _sum: { total: true },
            }),
            tx.sale.findMany({
              where,
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              skip,
              take,
              select: {
                id: true,
                number: true,
                receiptNumber: true,
                createdAt: true,
                total: true,
                status: true,
                items: {
                  select: {
                    id: true,
                    name: true,
                    sku: true,
                    options: true,
                    quantity: true,
                    returned: true,
                    total: true,
                  },
                },
              },
            }),
            tx.sale.count({ where }),
            tx.saleReturn.findMany({
              where: { sale: where },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              skip,
              take,
              select: {
                id: true,
                createdAt: true,
                total: true,
                refundAmount: true,
                creditAmount: true,
                reason: true,
                sale: { select: { receiptNumber: true, number: true } },
                items: {
                  select: {
                    quantity: true,
                    amount: true,
                    saleItem: { select: { name: true, sku: true } },
                  },
                },
              },
            }),
            tx.saleReturn.count({ where: { sale: where } }),
          ]);
        return {
          customer,
          scope: all ? "ALL" : "OWN",
          summary: {
            purchaseCount: purchases._count,
            purchases: D(purchases._sum.total ?? 0).toFixed(2),
            returns: D(returned._sum.total ?? 0).toFixed(2),
            netSpending: D(purchases._sum.total ?? 0)
              .minus(returned._sum.total ?? 0)
              .toFixed(2),
          },
          sales,
          total,
          returns,
          returnCount,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    res.json({ data });
  });
