import { z } from "zod";
const text = z.string().max(5000);
export const sharedCartBinding = z.object({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  token: z.string().regex(/^[a-f0-9]{64}$/),
});
export const cartDraftSchema = z.object({
  sharedCart: sharedCartBinding.optional(),
  customerSearch: z.string().max(100).optional(),
  customerNameDraft: z.string().max(200).optional(),
  loyaltyPoints: z.number().int().min(0).max(1000000).optional(),
  discountApprovalId: z.string().uuid().optional(),
  items: z
    .array(
      z.object({
        variant: z.object({
          id: z.string().uuid(),
          sku: text,
          barcode: text.nullish(),
          price: text,
          options: z.record(z.string(), text),
          product: z.object({ nameAr: text }),
        }),
        quantity: z.number().int().positive().max(10000),
      }),
    )
    .max(200),
  discount: text,
  discountType: z.enum(["FIXED", "PERCENT"]),
  itemDiscounts: z.record(
    z.string(),
    z.object({ value: text, type: z.enum(["FIXED", "PERCENT"]) }),
  ),
  notes: text,
  customer: text,
  payments: z
    .array(
      z.object({
        method: z.enum(["CASH", "CARD", "WALLET", "BANK"]),
        amount: text,
        cardBrand: text,
        authorizationCode: text,
        cardLast4: text,
      }),
    )
    .min(1)
    .max(4),
});
