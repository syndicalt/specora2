import { expect, type Locator, type Page, test } from "@playwright/test";

async function openApp(page: Page, appId: string, search: string, visibleMarker: Locator) {
  await page.goto("/");
  await expect(page.getByTitle("All Apps")).toBeVisible();
  await page.getByTitle("All Apps").click();
  await page.getByPlaceholder("Search applications").fill(search);
  await page.getByTestId(`app-launcher-item-${appId}`).click();
  await expect(visibleMarker).toBeVisible();
}

test.describe("public demo path", () => {
  test("opens the core demo applications from the launcher", async ({ page }) => {
    await openApp(page, "cmdb-explorer", "cmdb", page.getByRole("heading", { name: "CMDB Explorer" }));
    await expect(page.getByPlaceholder("Search name, asset, host...")).toBeVisible();

    await openApp(page, "service-map", "service map", page.getByRole("button", { name: "Save View" }));
    await expect(page.getByPlaceholder("Search CI...")).toBeVisible();

    await openApp(page, "tables", "tables", page.getByRole("heading", { name: "Tables" }));
    await expect(page.getByPlaceholder("Search name, ID, or environment")).toBeVisible();

    await openApp(page, "discovery", "discovery", page.getByRole("heading", { name: "Discovery Builder" }));
    await expect(page.getByRole("button", { name: "AI Draft Transform" })).toBeVisible();

    await openApp(page, "admin-console", "admin", page.getByRole("heading", { name: "Admin Console" }));
    await expect(page.getByPlaceholder("Search admin duties")).toBeVisible();

    await openApp(page, "customer-portal", "customer", page.getByRole("heading", { name: "Customer Portal" }));
    await expect(page.getByPlaceholder("Tell Specora what you need...")).toBeVisible();

    await openApp(page, "arc", "arc", page.getByRole("heading", { name: "Specora Arc" }));
    await expect(page.getByRole("button", { name: "Installed" })).toBeVisible();

    await openApp(page, "settings", "settings", page.getByRole("heading", { name: "Settings" }));
    await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
  });

  test("opens global chat with contextual capabilities", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTitle("Chat")).toBeVisible();

    await page.getByTitle("Chat").click();
    await expect(page.getByText("Welcome to Specora. How can I help you today?")).toBeVisible();
    await expect(page.getByText("Start with platform context")).toBeVisible();
    await expect(page.getByText("What you can do")).toBeVisible();
    await expect(page.getByRole("button", { name: "Customer Portal" })).toBeVisible();
    await expect(page.getByPlaceholder("Ask about your CMDB, incidents, or services...")).toBeVisible();
  });
});
