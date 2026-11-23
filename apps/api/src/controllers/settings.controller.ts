import type { RequestHandler } from "express";
import { z } from "zod";
import { money, defaultReturnPolicy } from "@az/shared";
import { db, audit, transaction } from "../lib/db.js";
import { actor } from "../middleware/auth.js";
import { D } from "../utils/money.js";
import { route, text } from "../utils/http.js";

export const handleGetStore: RequestHandler = (_req, res) => {
  db.systemSetting
    .findUnique({ where: { key: "store" } })
    .then((s) => res.json({ data: s?.value ?? {} }))
    .catch((e) =>
      res.status(500).json({
        error: {
          code: "SETTINGS_UNAVAILABLE",
          message: String(e.code ?? "Unavailable"),
        },
      }),
    );
};

export const handlePatchSettingsStore: RequestHandler = route(
  async (req, res) => {
    const input = z
      .object({
        name: text.refine(
          (v) => !/<[^>]*>/.test(v),
          "اسم المتجر يجب أن يكون نصًا فقط بدون وسوم HTML.",
        ),
        currency: z.literal("EGP"),
        timezone: z.literal("Africa/Cairo"),
        address: z.string().max(1000),
        phone: z.string().max(40),
        taxRate: money.refine(
          (v) => D(v).lte(100),
          "نسبة الضريبة يجب أن تكون من 0 إلى 100.",
        ),
        cashierCommissionRate: money
          .refine(
            (v) => /^\d{1,10}(\.\d{1,2})?$/.test(v) && D(v).lte(100),
            "نسبة عمولة الكاشير يجب أن تكون من 0 إلى 100 بمنزلتين عشريتين بحد أقصى.",
          )
          .optional(),
        returnDays: z
          .number()
          .int("فترة الاسترجاع يجب أن تكون عددًا صحيحًا من 0 إلى 365 يومًا.")
          .min(0, "فترة الاسترجاع يجب أن تكون من 0 إلى 365 يومًا.")
          .max(365, "فترة الاسترجاع يجب ألا تزيد عن 365 يومًا."),
        receiptFooter: z
          .string()
          .max(1000, "رسالة الإيصال يجب ألا تزيد عن 1000 حرف."),
        receiptWidth: z.union([z.literal(58), z.literal(80)]),
        taxMode: z.enum(["INCLUSIVE", "EXCLUSIVE"]).optional(),
        showTaxOnInvoice: z.boolean().optional(),
        branchName: z.string().max(200).optional(),
        taxNumber: z.string().max(80).optional(),
        commercialRegister: z.string().max(80).optional(),
        invoicePrefix: z
          .string()
          .regex(
            /^[A-Za-z0-9_-]{1,12}$/,
            "بادئة الفاتورة يجب أن تكون من 1 إلى 12 حرفًا إنجليزيًا أو رقمًا أو شرطة أو شرطة سفلية.",
          )
          .optional(),
        returnPolicy: z
          .string()
          .min(3, "سياسة الاستبدال والاسترجاع يجب أن تكون من 3 إلى 5000 حرف.")
          .max(5000, "سياسة الاستبدال والاسترجاع يجب ألا تزيد عن 5000 حرف.")
          .optional(),
      })
      .parse(req.body);
    await transaction(async (tx) => {
      const previous = await tx.systemSetting.findUnique({
        where: { key: "store" },
      });
      const value = {
        cashierCommissionRate: "1",
        taxMode: "EXCLUSIVE",
        showTaxOnInvoice: true,
        invoicePrefix: "INV",
        returnPolicy: defaultReturnPolicy,
        ...((previous?.value as Record<string, any>) ?? {}),
        ...input,
      };
      await tx.systemSetting.upsert({
        where: { key: "store" },
        create: { key: "store", value },
        update: { value },
      });
      await audit(tx, actor(req).id, "STORE_SETTINGS", "store", input);
    });
    res.json({ data: input });
  },
);
