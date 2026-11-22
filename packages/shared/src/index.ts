import { z } from "zod";
export {
  asciiPhone,
  customerPhoneKey,
  customerPhoneSchema,
  customerPhoneSearch,
} from "./customer-phone.js";
export { defaultReturnPolicy } from "./receipt-settings.js";
export const permissions = [
  "dashboard.view",
  "quick_access.view",
  "pos.access",
  "sales.create",
  "sales.view_own",
  "sales.view_all",
  "sales.refund",
  "sales.discount",
  "sales.discount_approve",
  "promotions.manage",
  "products.view",
  "products.create",
  "products.update",
  "products.archive",
  "products.change_price",
  "inventory.view",
  "inventory.adjust",
  "inventory.count",
  "purchases.view",
  "purchases.preview",
  "purchases.create",
  "purchases.receive",
  "suppliers.manage",
  "customers.manage",
  "expenses.create",
  "expenses.view",
  "expenses.approve",
  "reports.sales",
  "reports.profit",
  "reports.inventory",
  "cash.open_shift",
  "cash.close_shift",
  "cash.view_all",
  "users.manage",
  "roles.manage",
  "settings.manage",
  "audit.view",
] as const;
export type Permission = (typeof permissions)[number];
export const roleDefaults: Record<string, readonly Permission[]> = {
  OWNER: permissions,
  MANAGER: permissions.filter(
    (p) =>
      ![
        "users.manage",
        "roles.manage",
        "settings.manage",
        "audit.view",
        "reports.profit",
      ].includes(p),
  ),
  CASHIER: [
    "dashboard.view",
    "quick_access.view",
    "pos.access",
    "sales.create",
    "sales.view_own",
    "products.view",
    "inventory.view",
    "cash.open_shift",
    "cash.close_shift",
  ],
};
export const money = z
  .string()
  .regex(
    /^\d{1,10}(\.\d{1,2})?$/,
    "Use a positive decimal amount with at most two decimal places",
  );
export const id = z.string().uuid();
export const paymentMethods = ["CASH", "CARD", "WALLET", "BANK"] as const;
export const paymentSchema = z.object({
  method: z.enum(paymentMethods),
  amount: money,
  cardBrand: z.string().max(40).default(""),
  authorizationCode: z
    .string()
    .regex(/^[A-Za-z0-9 _-]{0,64}$/)
    .default(""),
  cardLast4: z.union([z.literal(""), z.string().regex(/^\d{4}$/)]).default(""),
});
export const saleLineSchema = z.object({
  variantId: id,
  quantity: z.number().int().positive().max(10000),
  discount: money.default("0"),
  discountType: z.enum(["FIXED", "PERCENT"]).default("FIXED"),
});
export const checkoutSchema = z.object({
  // Retired input must fail rather than silently become an unrelated normal sale.
  sharedCart: z.never().optional(),
  requireCustomer: z.literal(true).optional(),
  loyaltyPoints: z.number().int().min(0).max(1000000).optional(),
  discountApprovalId: id.optional(),
  shiftId: id,
  customerId: id.optional(),
  items: z.array(saleLineSchema).min(1).max(200),
  discount: money.default("0"),
  discountType: z.enum(["FIXED", "PERCENT"]).default("FIXED"),
  payments: z.array(paymentSchema).min(1).max(4),
  notes: z.string().max(1000).default(""),
});
