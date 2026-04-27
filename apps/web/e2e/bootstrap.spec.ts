import { expect, test } from "@playwright/test";

test.describe("platform bootstrap", () => {
  test("authenticated home exits bootstrap loading", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("Loading Specora...")).toHaveCount(0, { timeout: 12_000 });
    await expect(page.getByText("Loading platform...")).toHaveCount(0, { timeout: 12_000 });
    await expect(page.getByTitle("All Apps")).toBeVisible();
  });
});
