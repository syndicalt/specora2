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

test("Tables imports JSON records through mapped columns", async ({ page, request }) => {
  const headers = await authHeaders(page);
  const suffix = Date.now().toString().slice(-5);
  const name = `ZZ E2E Import ${suffix}`;
  let recordId = "";

  try {
    await openApp(page, "tables", "tables");
    await page.getByTestId("tables-table-cmdb.Location").click();
    await page.getByRole("button", { name: "Import" }).click();
    await page.setInputFiles("input[type='file']", {
      name: "locations.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify([{ name, environment: "uat", city: "Austin", locationType: "office", region: "test" }])),
    });

    await expect(page.getByText("Loaded 1 import row")).toBeVisible();
    await expect(page.getByText(name)).toBeVisible();
    await page.getByRole("button", { name: "Commit import" }).click();
    await expect(page.getByText("Imported 1 created, 0 updated")).toBeVisible();

    const listed = await request.get(`http://localhost:4000/api/tables/cmdb.Location/records?q=${encodeURIComponent(name)}`, { headers });
    expect(listed.ok()).toBeTruthy();
    const data = await listed.json();
    recordId = data.records?.[0]?.id || "";
    expect(recordId).toBeTruthy();

    await page.getByPlaceholder("Search name, ID, or environment").fill(name);
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByTestId(`tables-record-${recordId}`)).toBeVisible();
  } finally {
    if (recordId) {
      await request.delete(`http://localhost:4000/api/tables/cmdb.Location/records/${recordId}`, { headers });
    }
  }
});

test("Tables previews and commits upsert imports with match keys", async ({ page, request }) => {
  const headers = await authHeaders(page);
  const suffix = Date.now().toString().slice(-5);
  const existingName = `ZZ E2E Upsert Existing ${suffix}`;
  const newName = `ZZ E2E Upsert New ${suffix}`;
  let existingId = "";
  let newId = "";

  try {
    const created = await request.post("http://localhost:4000/api/tables/cmdb.Location/records", {
      headers,
      data: {
        name: existingName,
        environment: "uat",
        attributes: { city: "Dallas", locationType: "office", region: "test" },
      },
    });
    expect(created.ok()).toBeTruthy();
    existingId = (await created.json()).record.id;

    await openApp(page, "tables", "tables");
    await page.getByTestId("tables-table-cmdb.Location").click();
    await page.getByRole("button", { name: "Import" }).click();
    await page.setInputFiles("input[type='file']", {
      name: "locations-upsert.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify([
        { name: existingName, environment: "uat", city: "Austin", locationType: "office", region: "test" },
        { name: newName, environment: "uat", city: "Plano", locationType: "office", region: "test" },
      ])),
    });

    await page.getByTestId("tables-import-mode").selectOption("upsert");
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByText("Import preview generated")).toBeVisible();
    await expect(page.getByText("1 create")).toBeVisible();
    await expect(page.getByText("1 update")).toBeVisible();
    await page.getByRole("button", { name: "Commit import" }).click();
    await expect(page.getByText("Imported 1 created, 1 updated")).toBeVisible();

    const existing = await request.get(`http://localhost:4000/api/tables/cmdb.Location/records/${existingId}`, { headers });
    expect(existing.ok()).toBeTruthy();
    expect((await existing.json()).record.attributes.city).toBe("Austin");

    const listed = await request.get(`http://localhost:4000/api/tables/cmdb.Location/records?q=${encodeURIComponent(newName)}`, { headers });
    expect(listed.ok()).toBeTruthy();
    newId = (await listed.json()).records?.[0]?.id || "";
    expect(newId).toBeTruthy();
  } finally {
    if (newId) {
      await request.delete(`http://localhost:4000/api/tables/cmdb.Location/records/${newId}`, { headers });
    }
    if (existingId) {
      await request.delete(`http://localhost:4000/api/tables/cmdb.Location/records/${existingId}`, { headers });
    }
  }
});
