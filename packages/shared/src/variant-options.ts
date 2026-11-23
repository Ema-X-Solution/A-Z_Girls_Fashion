const optionKeys = {
  size: ["size", "المقاس"],
  color: ["color", "اللون"],
} as const;

// The product form writes Arabic keys; older/imported variants may use English.
// Read both without rewriting stored options or guessing from product names.
export function variantOption(
  options: unknown,
  kind: keyof typeof optionKeys,
): string {
  if (!options || typeof options !== "object" || Array.isArray(options))
    return "";
  const values = options as Record<string, unknown>;
  for (const key of optionKeys[kind]) {
    const value = values[key];
    if (
      (typeof value === "string" || typeof value === "number") &&
      String(value).trim() !== ""
    )
      return String(value);
  }
  return "";
}
