import { z } from "zod";

export function asciiPhone(value: string) {
  return value
    .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[٠-٩۰-۹]/g, (c) =>
      String(c.charCodeAt(0) - (c >= "۰" ? 0x6f0 : 0x660)),
    )
    .trim();
}
export function customerPhoneKey(value: string) {
  let digits = asciiPhone(value).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^0\d{9,10}$/.test(digits)) return `20${digits.slice(1)}`;
  if (/^(10|11|12|15)\d{8}$/.test(digits)) return `20${digits}`;
  return digits;
}
export const customerPhoneSchema = z
  .string()
  .trim()
  .max(40)
  .transform(asciiPhone)
  .refine((value) => {
    if (!/^\+?[\d\s().-]+$/.test(value)) return false;
    const digits = value.replace(/\D/g, "").replace(/^00/, "");
    if (digits.startsWith("0")) return /^0\d{9,10}$/.test(digits);
    if (digits.startsWith("20")) return /^20\d{9,10}$/.test(digits);
    return /^\d{7,15}$/.test(digits);
  }, "اكتب رقم تليفون صحيحًا وكاملًا")
  .transform((value) => {
    const digits = customerPhoneKey(value);
    return value.startsWith("+") ||
      value.startsWith("00") ||
      digits.startsWith("20")
      ? `+${digits}`
      : digits;
  });
export function customerPhoneSearch(value: string) {
  const ascii = asciiPhone(value),
    digits = ascii.replace(/\D/g, "");
  if (!digits || /[\p{L}]/u.test(ascii)) return null;
  return digits.startsWith("00") ? digits.slice(2) : digits;
}
