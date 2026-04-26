import { expect, test } from "@playwright/test";

test("seeded user can sign in", async ({ page }) => {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill("alice@specora.dev");
  await page.locator('input[type="password"]').fill("secret123");
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTitle("All Apps")).toBeVisible();
});
