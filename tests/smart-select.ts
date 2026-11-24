import type { Locator, Page } from "@playwright/test";

/**
 * Drives a SmartSelect combobox (a text input with role=combobox backed by a
 * listbox): opens it, types the search text, then clicks the first option
 * whose accessible name contains that text.
 */
export async function pickSmartOption(
  scope: Page | Locator,
  label: string,
  search: string,
) {
  const input = scope.getByRole("combobox", { name: label, exact: true });
  await input.click();
  await input.fill(search);
  await scope
    .getByRole("option", { name: search })
    .first()
    .click();
}
