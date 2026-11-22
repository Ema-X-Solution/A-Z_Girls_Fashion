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

export const handlePatchSettingsStore: RequestHandler = route(async (req, res) => {
    const input = z
      .object({
        name: text,
        currency: z.literal("EGP"),
        timezone: z.literal("Africa/Cairo"),
        address: z.string().max(1000),
        phone: z.string().max(40),
        taxRate: money.refine((v) => D(v).lte(100)),
        returnDays: z.number().int().min(0).max(365),
        receiptFooter: z.string().max(1000),
        receiptWidth: z.union([z.literal(58), z.literal(80)]),
        taxMode: z.enum(["INCLUSIVE", "EXCLUSIVE"]).optional(),
        branchName: z.string().max(200).optional(),
        taxNumber: z.string().max(80).optional(),
        commercialRegister: z.string().max(80).optional(),
        invoicePrefix: z
          .string()
          .regex(/^[A-Za-z0-9_-]{1,12}$/)
          .optional(),
        returnPolicy: z.string().min(3).max(5000).optional(),
      })
      .parse(req.body);
    await transaction(async (tx) => {
      const previous = await tx.systemSetting.findUnique({
        where: { key: "store" },
      });
      const value = {
        taxMode: "EXCLUSIVE",
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
  });
