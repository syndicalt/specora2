import { expect, type Page, test } from "@playwright/test";

async function openApp(page: Page, appId: string, search: string) {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.removeItem("specora_uninstalled_optional_apps");
  });
  await page.reload();
  await page.getByTitle("All Apps").click();
  await page.getByPlaceholder("Search applications").fill(search);
  await page.getByTestId(`app-launcher-item-${appId}`).click();
}

async function authHeaders(page: Page) {
  await page.goto("/");
  const token = await page.evaluate(() => localStorage.getItem("specora_token"));
  return { Authorization: `Bearer ${token}` };
}

test.describe("Tables stewardship cockpit", () => {
  test("surfaces record issues in the grid popover and edit drawer", async ({ page, request }) => {
    const headers = await authHeaders(page);
    const suffix = Date.now().toString().slice(-5);
    const name = `ZZ E2E Stewardship ${suffix}`;
    let recordId = "";

    try {
      const created = await request.post("http://localhost:4000/api/tables/cmdb.Location/records", {
        headers,
        data: {
          name,
          environment: "test",
          attributes: {
            city: "",
            locationType: "office",
            region: "uat",
          },
        },
      });
      expect(created.ok()).toBeTruthy();
      recordId = (await created.json()).record.id;

      await openApp(page, "tables", "tables");
      await page.getByTestId("tables-table-cmdb.Location").click();

      await page.getByRole("button", { name: "Add filter" }).click();
      await page.getByPlaceholder("Value").fill(name);
      const filterChip = page.getByRole("button", { name: new RegExp(`Name contains ${name}`) });
      await expect(filterChip).toBeVisible();
      await filterChip.click();
      await expect(filterChip).toHaveCount(0);

      await page.getByPlaceholder("Search name, ID, or environment").fill(name);
      await page.getByRole("button", { name: "Apply" }).click();

      const row = page.getByTestId(`tables-record-${recordId}`);
      await expect(row).toBeVisible();
      await expect(row.getByText(name)).toBeVisible();
      await row.getByRole("checkbox", { name: `Select record ${recordId}` }).check();
      await page.getByRole("button", { name: "Queue cleanup" }).click();
      await page.getByPlaceholder("Reason for cleanup review").fill("E2E stewardship cleanup review");
      await page.getByRole("button", { name: "Queue review" }).click();
      await expect(page.getByText("Queued 1 cleanup review")).toBeVisible();

      await row.getByRole("button", { name: /issues?/ }).click();
      await expect(page.getByText("Validation issues")).toBeVisible();
      await expect(page.getByText("City is missing")).toBeVisible();

      await page.getByRole("button", { name: `Edit ${name}` }).click();
      const editor = page.getByTestId("tables-record-editor");
      await expect(editor.getByText(/stewardship issues? to resolve/)).toBeVisible();
      await expect(editor.getByText("Server validation snapshot")).toBeVisible();
      await expect(editor.getByText("No CMDB relationships are linked to this record.")).toBeVisible();
      await expect(editor.getByText("City").first()).toBeVisible();
      await expect(editor.getByText("Health field").first()).toBeVisible();

      await editor.getByRole("textbox", { name: "City" }).fill("Austin");
      await editor.getByRole("button", { name: "Save" }).click();
      await expect(editor).toHaveCount(0);
    } finally {
      if (recordId) {
        const reviews = await request.get(`http://localhost:4000/api/tables/pg.table_cleanup_reviews/records?q=${encodeURIComponent(recordId)}`, { headers });
        if (reviews.ok()) {
          const data = await reviews.json();
          for (const item of data.records || []) {
            await request.delete(`http://localhost:4000/api/tables/pg.table_cleanup_reviews/records/${item.id}`, { headers });
          }
        }
      }
      if (recordId) {
        await request.delete(`http://localhost:4000/api/tables/cmdb.Location/records/${recordId}`, { headers });
      }
    }
  });
});
