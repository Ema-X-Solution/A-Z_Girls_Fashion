import { z } from "zod";
import { checkoutSchema } from "@az/shared";
import { emptyPayment } from "./PaymentEditor";
const text = z.string().max(5000);
const payment = z.object({
  method: z.enum(["CASH", "CARD", "WALLET", "BANK"]),
  amount: text,
  cardBrand: text,
  authorizationCode: text,
  cardLast4: text,
});
const draftSchema = z.object({
  cashierId: z.string().uuid().optional(),
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
        quantity: z.number().int().positive().max(100000),
      }),
    )
    .max(500),
  discount: text,
  discountType: z.enum(["FIXED", "PERCENT"]),
  itemDiscounts: z.record(
    z.string(),
    z.object({ value: text, type: z.enum(["FIXED", "PERCENT"]) }),
  ),
  notes: text,
  customer: text,
  payments: z.array(payment).min(1).max(4),
});
export type CartDraft = z.infer<typeof draftSchema>;
const workspaceSchema = z.object({
  version: z.literal(1),
  active: draftSchema,
  suspended: z
    .array(draftSchema.extend({ id: z.string().uuid(), savedAt: text }))
    .max(50),
  pending: z
    .object({
      key: z.string().uuid(),
      // Preserve the exact body of pre-upgrade attempts for check/cancel/retry.
      // The API rejects retired fields on new requests, but must not change old identities.
      body: checkoutSchema.omit({ sharedCart: true }).passthrough(),
      createdAt: text,
    })
    .nullable(),
  receiptId: z.string().uuid().nullable(),
});
export type Workspace = z.infer<typeof workspaceSchema>;
export const emptyDraft = (): CartDraft => ({
  items: [],
  discount: "0",
  discountType: "FIXED",
  itemDiscounts: {},
  notes: "",
  customer: "",
  payments: [emptyPayment()],
});
export const emptyWorkspace = (): Workspace => ({
  version: 1,
  active: emptyDraft(),
  suspended: [],
  pending: null,
  receiptId: null,
});
export const workspaceKey = (userId: string) => `az-pos:v1:${userId}`;
export function readWorkspace(
  storage: Pick<Storage, "getItem">,
  userId: string,
): Workspace {
  const raw = storage.getItem(workspaceKey(userId));
  return raw === null
    ? emptyWorkspace()
    : workspaceSchema.parse(JSON.parse(raw));
}
export function saveWorkspace(
  storage: Pick<Storage, "setItem">,
  userId: string,
  value: Workspace,
): Workspace {
  // Persist only display fields, quantities and the exact pending request.
  // Zod strips variant costs and unrelated API fields; prices remain estimates.
  const clean = workspaceSchema.parse(value),
    encoded = JSON.stringify(clean);
  if (encoded.length > 2_000_000) throw new Error("Workspace too large");
  storage.setItem(workspaceKey(userId), encoded);
  return clean;
}
