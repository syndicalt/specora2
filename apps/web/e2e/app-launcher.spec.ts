import { expect, test } from "@playwright/test";

test("app launcher is alphabetized, searchable, and opens apps", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTitle("All Apps")).toBeVisible();

  await page.getByTitle("All Apps").click();
  const launcher = page.getByTestId("app-launcher");
  await expect(page.getByPlaceholder("Search applications")).toBeFocused();

  const appNames = await launcher.locator("button p").allTextContents();
  const sortedNames = [...appNames].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  expect(appNames).toEqual(sortedNames);

  await page.getByPlaceholder("Search applications").fill("knowledge");
  await expect(page.getByRole("button", { name: /Knowledge Core/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Change Manager/ })).toHaveCount(0);

  await page.getByRole("button", { name: /Knowledge Core/ }).click();
  await expect(page.getByRole("heading", { name: "Knowledge Core" })).toBeVisible();
});

test("tables and cmdb explorer are available from the launcher", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("All Apps").click();

  await page.getByPlaceholder("Search applications").fill("tables");
  await page.getByTestId("app-launcher-item-tables").click();
  await expect(page.getByRole("heading", { name: "Tables" })).toBeVisible();

  await page.getByTitle("All Apps").click();
  await page.getByPlaceholder("Search applications").fill("cmdb");
  await page.getByTestId("app-launcher-item-cmdb-explorer").click();
  await expect(page.getByRole("heading", { name: "CMDB Explorer" })).toBeVisible();
});
