import { z } from "zod";
import { money } from "@az/shared";

// This endpoint grants price/minimum-stock changes, not general variant editing.
// Never reuse creation defaults in a PATCH: omitted fields must remain untouched.
export const updateVariantSchema = z
  .strictObject({
    price: money.optional(),
    minStock: z.number().int().nonnegative().optional(),
  })
  .refine(
    (value) => value.price !== undefined || value.minStock !== undefined,
    {
      message: "Provide a price or minimum stock change",
    },
  );
