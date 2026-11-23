import { page } from "../utils/http.js";
import { listResult, usesPagination } from "../utils/pagination.js";
import type { RequestHandler } from "express";
import { z } from "zod";
import { checkoutSchema, id } from "@az/shared";
import { actor } from "../middleware/auth.js";
import { db, assert, audit, json, transaction } from "../lib/db.js";
import { activeShift, once } from "../services/operations.js";
import { quoteSale } from "../services/sale-pricing.js";
import { approvalActor, approvalFingerprint } from "../services/discount-policy.js";

export const handlePostDiscountApprovals: RequestHandler = async (req, res, next) => {
    try {
      const input = z
        .object({
          sale: checkoutSchema,
          reason: z.string().trim().min(3).max(1000),
        })
        .parse(req.body);
      // Tender is not part of discount authorization and is never stored here.
      const sale = {
        ...input.sale,
        discountApprovalId: undefined,
        payments: [
          {
            method: "CASH" as const,
            amount: "0",
            cardBrand: "",
            authorizationCode: "",
            cardLast4: "",
          },
        ],
      };
      const result = await once(
        actor(req),
        req.get("Idempotency-Key"),
        "discount-request",
        input,
        async (tx) => {
          await activeShift(tx, sale.shiftId, actor(req));
          const pricing = await quoteSale(tx, actor(req), sale, {
            checkDiscount: false,
          });
          assert(
            pricing.percent.gt(actor(req).discountLimit),
            "APPROVAL_NOT_REQUIRED",
            "Discount is within your limit",
            400,
          );
          const count = await tx.discountApproval.count({
            where: {
              requesterId: actor(req).id,
              status: "PENDING",
              expiresAt: { gt: new Date() },
            },
          });
          assert(
            count < 20,
            "TOO_MANY_APPROVALS",
            "Too many pending approvals",
            409,
          );
          const created = await tx.discountApproval.create({
            data: {
              requesterId: actor(req).id,
              shiftId: sale.shiftId,
              input: json({
                ...sale,
                displayPromotion: pricing.promotion,
                automaticDiscount: pricing.automaticDiscount.toFixed(2),
                manualDiscount: pricing.manualDiscount.toFixed(2),
                displayItems: pricing.lines.map((l) => ({
                  variantId: l.variantId,
                  name: l.variant.product.nameAr,
                  sku: l.variant.sku,
                  options: l.variant.options,
                  unitPrice: l.variant.price.toFixed(2),
                })),
              }),
              fingerprint: approvalFingerprint(actor(req), sale, pricing),
              reason: input.reason,
              subtotal: pricing.sum.subtotal,
              discount: pricing.sum.discount,
              total: pricing.sum.total,
              expiresAt: new Date(Date.now() + 15 * 60 * 1000),
            },
          });
          await audit(tx, actor(req).id, "DISCOUNT_REQUESTED", created.id, {
            discount: created.discount.toFixed(2),
            reason: input.reason,
          });
          return created;
        },
      );
      res.status(201).json({ data: result });
    } catch (e) {
      next(e);
    }
  };

export const handleGetDiscountApprovals: RequestHandler = async (req, res, next) => {
    try {
      const reviewer = actor(req).permissions.includes(
        "sales.discount_approve",
      );
      const where = reviewer ? {} : { requesterId: actor(req).id };
      const rows = await db.discountApproval.findMany({
        where,
        orderBy: [{ createdAt: "desc" },{id:"desc"}],
        ...(usesPagination(req.query)?page(req.query):{take:100,skip:0}),
      });
      const ids = [
        ...new Set(
          rows.flatMap((r) => [
            r.requesterId,
            ...(r.approverId ? [r.approverId] : []),
          ]),
        ),
      ];
      const users = await db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      });
      const total=await db.discountApproval.count({where});
      res.json(listResult(req.query,rows.map((r) => ({
          ...r,
          requesterName: users.find((u) => u.id === r.requesterId)?.name,
          approverName: users.find((u) => u.id === r.approverId)?.name,
        })),total));
    } catch (e) {
      next(e);
    }
  };

export const handleGetDiscountApprovalsById: RequestHandler = async (req, res, next) => {
    try {
      const row = await db.discountApproval.findUnique({
        where: { id: id.parse(req.params.id) },
      });
      assert(row, "NOT_FOUND", "Approval not found", 404);
      assert(
        row.requesterId === actor(req).id ||
          actor(req).permissions.includes("sales.discount_approve"),
        "FORBIDDEN",
        "Access denied",
        403,
      );
      res.json({ data: row });
    } catch (e) {
      next(e);
    }
  };

export const handlePostDiscountApprovalsByIdDecision: RequestHandler = async (req, res, next) => {
    try {
      const approvalId = id.parse(req.params.id),
        input = z
          .object({
            decision: z.enum(["APPROVED", "REJECTED"]),
            note: z.string().trim().min(3).max(1000),
          })
          .parse(req.body);
      const result = await transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "DiscountApproval" WHERE id=${approvalId}::uuid FOR UPDATE`;
        const row = await tx.discountApproval.findUnique({
          where: { id: approvalId },
        });
        assert(row, "NOT_FOUND", "Approval not found", 404);
        assert(
          row.requesterId !== actor(req).id,
          "SELF_APPROVAL",
          "You cannot approve your own request",
          403,
        );
        if (row.status === input.decision && row.approverId === actor(req).id)
          return row;
        assert(
          row.status === "PENDING" && row.expiresAt > new Date(),
          "APPROVAL_CLOSED",
          "Approval is expired or already decided",
          409,
        );
        if (input.decision === "APPROVED") {
          const requester = await approvalActor(tx, row.requesterId),
            sale = checkoutSchema.parse(row.input);
          await activeShift(tx, sale.shiftId, requester);
          const pricing = await quoteSale(tx, requester, sale, {
            checkDiscount: false,
          });
          assert(
            approvalFingerprint(requester, sale, pricing) === row.fingerprint,
            "DISCOUNT_APPROVAL_CHANGED",
            "Cart prices or tax changed; request approval again",
            409,
          );
          assert(
            pricing.percent.lte(actor(req).discountLimit),
            "APPROVER_LIMIT",
            "الخصم المطلوب يتجاوز حد الموافقة المسموح لك به.",
            403,
          );
        }
        const result = await tx.discountApproval.update({
          where: { id: approvalId },
          data: {
            status: input.decision,
            approverId: actor(req).id,
            decidedAt: new Date(),
            decisionNote: input.note,
          },
        });
        await audit(
          tx,
          actor(req).id,
          `DISCOUNT_${input.decision}`,
          approvalId,
          { requesterId: row.requesterId, note: input.note },
        );
        return result;
      });
      res.json({ data: result });
    } catch (e) {
      next(e);
    }
  };
