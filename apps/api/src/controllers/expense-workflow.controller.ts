import { page } from "../utils/http.js";
import { listResult, usesPagination } from "../utils/pagination.js";
import type { RequestHandler } from "express";
import { z } from "zod";
import { id } from "@az/shared";
import { actor } from "../middleware/auth.js";
import { db, assert, audit, transaction, type Tx } from "../lib/db.js";
import { activeShift, expenseSchema, once } from "../services/operations.js";
import { D } from "../utils/money.js";

export const expenseInput = expenseSchema.extend({
  submitForApproval: z.boolean().optional(),
});

export async function createExpense(
  tx: Tx,
  user: ReturnType<typeof actor>,
  input: z.infer<typeof expenseInput>,
) {
  const category = await tx.expenseCategory.findUnique({
    where: { name: input.category },
  });
  assert(category?.active, "EXPENSE_CATEGORY", "اختار تصنيف مصروف نشط", 400);
  const pending =
    input.submitForApproval || !user.permissions.includes("expenses.approve");
  if (!pending && input.method === "CASH") {
    assert(input.shiftId, "SHIFT_REQUIRED", "افتح ورديتك لصرف النقد", 400);
    await activeShift(tx, input.shiftId, user);
  }
  const expense = await tx.expense.create({
    data: {
      category: input.category,
      amount: input.amount,
      method: input.method,
      description: input.description,
      createdBy: user.id,
      status: pending ? "PENDING" : "APPROVED",
      shiftId: pending ? null : input.shiftId,
      decidedBy: pending ? null : user.id,
      decidedAt: pending ? null : new Date(),
    },
  });
  if (!pending && input.method === "CASH")
    await tx.cashMovement.create({
      data: {
        shiftId: input.shiftId!,
        userId: user.id,
        type: "EXPENSE",
        amount: D(input.amount).negated(),
        reference: expense.id,
        reason: input.description,
      },
    });
  await audit(
    tx,
    user.id,
    pending ? "EXPENSE_SUBMITTED" : "EXPENSE",
    expense.id,
  );
  return expense;
}

export const handleGetExpenseCategories: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    const data = await db.expenseCategory.findMany({
      orderBy: [{ name: "asc" }, { id: "asc" }],
      ...(usesPagination(req.query) ? page(req.query) : {}),
    });
    res.json(listResult(req.query, data, await db.expenseCategory.count()));
  } catch (e) {
    next(e);
  }
};

export const handlePostExpenseCategories: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    const input = z
      .object({ name: z.string().trim().min(1).max(100) })
      .parse(req.body);
    res.status(201).json({
      data: await transaction(async (tx) => {
        const c = await tx.expenseCategory.create({ data: input });
        await audit(tx, actor(req).id, "EXPENSE_CATEGORY_CREATE", c.id);
        return c;
      }),
    });
  } catch (e) {
    next(e);
  }
};

export const handlePatchExpenseCategoriesById: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    const input = z.object({ active: z.boolean() }).parse(req.body);
    res.json({
      data: await transaction(async (tx) => {
        const c = await tx.expenseCategory.update({
          where: { id: id.parse(req.params.id) },
          data: input,
        });
        await audit(tx, actor(req).id, "EXPENSE_CATEGORY_STATUS", c.id, input);
        return c;
      }),
    });
  } catch (e) {
    next(e);
  }
};

export const handlePostExpensesByIdDecision: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    const expenseId = id.parse(req.params.id),
      input = z
        .object({
          approve: z.boolean(),
          note: z.string().trim().min(3).max(1000),
          shiftId: id.optional(),
        })
        .parse(req.body);
    res.json({
      data: await once(
        actor(req),
        req.get("Idempotency-Key"),
        `expense-decision:${expenseId}`,
        input,
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Expense" WHERE id=${expenseId}::uuid FOR UPDATE`;
          const expense = await tx.expense.findUnique({
            where: { id: expenseId },
          });
          assert(
            expense?.status === "PENDING",
            "EXPENSE_STATE",
            "المصروف ليس قيد المراجعة",
          );
          assert(
            expense.createdBy !== actor(req).id,
            "SELF_APPROVAL",
            "يعتمد الطلب مستخدم آخر",
            403,
          );
          if (input.approve && expense.method === "CASH") {
            assert(
              input.shiftId,
              "SHIFT_REQUIRED",
              "حدد ورديتك لصرف النقد",
              400,
            );
            await activeShift(tx, input.shiftId, actor(req));
            await tx.cashMovement.create({
              data: {
                shiftId: input.shiftId,
                userId: actor(req).id,
                type: "EXPENSE",
                amount: expense.amount.negated(),
                reference: expense.id,
                reason: expense.description,
              },
            });
          }
          const result = await tx.expense.update({
            where: { id: expenseId },
            data: {
              status: input.approve ? "APPROVED" : "REJECTED",
              decidedAt: new Date(),
              decidedBy: actor(req).id,
              decisionNote: input.note,
              shiftId: input.approve ? input.shiftId : null,
              date: input.approve ? new Date() : expense.date,
            },
          });
          await audit(tx, actor(req).id, "EXPENSE_DECISION", expenseId, {
            approved: input.approve,
            note: input.note,
          });
          return result;
        },
      ),
    });
  } catch (e) {
    next(e);
  }
};

export const handleGetExpensesByIdAttachments: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    const expense = await db.expense.findUnique({
      where: { id: id.parse(req.params.id) },
    });
    assert(expense, "NOT_FOUND", "المصروف غير موجود", 404);
    assert(
      actor(req).permissions.includes("expenses.view") ||
        expense.createdBy === actor(req).id,
      "FORBIDDEN",
      "غير مسموح",
      403,
    );
    res.json({
      data: await db.expenseAttachment.findMany({
        where: { expenseId: expense.id },
        select: { id: true, name: true, mime: true, createdAt: true },
      }),
    });
  } catch (e) {
    next(e);
  }
};

export const handlePostExpensesByIdAttachments: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    const expenseId = id.parse(req.params.id),
      input = z
        .object({
          name: z.string().trim().min(1).max(150),
          dataUrl: z.string().max(1100000),
        })
        .parse(req.body);
    const match =
      /^data:(application\/pdf|image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
        input.dataUrl,
      );
    assert(match, "ATTACHMENT_FORMAT", "ملف PDF أو صورة فقط", 400);
    const bytes = Buffer.from(match[2]!, "base64"),
      mime = match[1]!;
    const valid =
      mime === "application/pdf"
        ? bytes.subarray(0, 5).toString() === "%PDF-"
        : mime === "image/jpeg"
          ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : mime === "image/png"
            ? bytes
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : bytes.subarray(0, 4).toString() === "RIFF" &&
              bytes.subarray(8, 12).toString() === "WEBP";
    assert(
      valid && bytes.length >= 32 && bytes.length <= 750000,
      "ATTACHMENT_FORMAT",
      "ملف غير صالح أو أكبر من 750 كيلوبايت",
      400,
    );
    const saved = await transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Expense" WHERE id=${expenseId}::uuid FOR UPDATE`;
      const expense = await tx.expense.findUnique({
        where: { id: expenseId },
      });
      assert(expense, "NOT_FOUND", "المصروف غير موجود", 404);
      assert(
        expense.createdBy === actor(req).id ||
          actor(req).permissions.includes("expenses.approve"),
        "FORBIDDEN",
        "مرفق المصروف لصاحب الطلب أو المراجع",
        403,
      );
      assert(
        (await tx.expenseAttachment.count({ where: { expenseId } })) < 5,
        "ATTACHMENT_LIMIT",
        "الحد الأقصى خمسة مرفقات",
        400,
      );
      const attachment = await tx.expenseAttachment.create({
        data: {
          expenseId,
          name: input.name,
          mime,
          data: new Uint8Array(bytes),
          createdBy: actor(req).id,
        },
        select: { id: true, name: true, mime: true, createdAt: true },
      });
      await audit(tx, actor(req).id, "EXPENSE_ATTACHMENT", expenseId, {
        attachmentId: attachment.id,
      });
      return attachment;
    });
    res.status(201).json({ data: saved });
  } catch (e) {
    next(e);
  }
};

export const handleGetExpenseAttachmentsById: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    const file = await db.expenseAttachment.findUnique({
      where: { id: id.parse(req.params.id) },
      include: { expense: true },
    });
    assert(file, "NOT_FOUND", "المرفق غير موجود", 404);
    assert(
      actor(req).permissions.includes("expenses.view") ||
        file.expense.createdBy === actor(req).id,
      "FORBIDDEN",
      "غير مسموح",
      403,
    );
    res
      .set({
        "Content-Type": file.mime,
        "Content-Disposition": `attachment; filename="expense-${file.id}.${file.mime === "application/pdf" ? "pdf" : file.mime.split("/")[1]}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .send(Buffer.from(file.data));
  } catch (e) {
    next(e);
  }
};
