import { expect, type Page, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

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

async function ensureDcimInstalled(page: Page, request: APIRequestContext) {
  await request.post("http://localhost:4000/api/apps/it-visibility-dcim/install", {
    headers: await authHeaders(page),
  });
}

test.describe("demo spine smoke coverage", () => {
  test("CMDB Explorer opens with searchable investigation surface", async ({ page }) => {
    await openApp(page, "cmdb-explorer", "cmdb");

    await expect(page.getByRole("heading", { name: "CMDB Explorer" })).toBeVisible();
    await expect(page.getByPlaceholder("Search name, asset, host...")).toBeVisible();
  });

  test("Tables opens with filterable registered table access", async ({ page }) => {
    await openApp(page, "tables", "tables");

    await expect(page.getByRole("heading", { name: "Tables" })).toBeVisible();
    await expect(page.getByPlaceholder("Search name, ID, or environment")).toBeVisible();
  });

  test("Tables can create, edit, filter, and delete a CMDB record", async ({ page }) => {
    await openApp(page, "tables", "tables");

    const suffix = Date.now().toString().slice(-5);
    const name = `ZZ E2E Location ${suffix}`;
    const updatedName = `${name} Updated`;
    const editor = page.getByTestId("tables-record-editor");

    await page.getByTestId("tables-table-cmdb.Location").click();
    await page.getByRole("button", { name: "Columns" }).click();
    await page.getByRole("checkbox", { name: "City" }).check();
    await page.getByRole("button", { name: "Columns" }).click();
    await page.getByRole("button", { name: "New" }).click();
    await expect(editor.getByRole("heading", { name: "New Record" })).toBeVisible();
    await editor.getByLabel("Name").fill(name);
    await editor.getByLabel("Environment").fill("test");
    await editor.getByRole("combobox", { name: /Location Type/ }).selectOption("office");
    await editor.getByRole("textbox", { name: "Region" }).fill("uat");
    await editor.getByRole("textbox", { name: "City" }).fill("Austin");
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(editor).toHaveCount(0);

    await page.getByPlaceholder("Search name, ID, or environment").fill(name);
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();

    await page.getByRole("button", { name: `Edit ${name}` }).click();
    await editor.getByLabel("Name").fill(updatedName);
    await editor.getByRole("textbox", { name: "City" }).fill("Dallas");
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(editor).toHaveCount(0);

    await page.getByPlaceholder("Search name, ID, or environment").fill(updatedName);
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("cell", { name: updatedName, exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Dallas" })).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: `Delete ${updatedName}` }).click();
    await expect(page.getByText("No records found.")).toBeVisible();
  });

  test("Incident Command Center opens with AI operator workflow", async ({ page }) => {
    await openApp(page, "incident-manager", "incident");

    await expect(page.getByRole("heading", { name: "Incident Command Center" })).toBeVisible();
    await expect(page.getByText("AI Operations Queue")).toBeVisible();
    await expect(page.getByText("Human Decision Queue")).toBeVisible();
  });

  test("Knowledge Core opens with governed answer workflow", async ({ page }) => {
    await openApp(page, "knowledge-core", "knowledge");

    await expect(page.getByRole("heading", { name: "Knowledge Core" })).toBeVisible();
    await expect(page.getByPlaceholder("Ask about an outage, service, runbook, policy, or known error")).toBeVisible();
  });

  test("Admin Access Analyzer explains an RBAC decision", async ({ page }) => {
    await openApp(page, "admin-console", "admin");

    await expect(page.getByRole("heading", { name: "Admin Console" })).toBeVisible();
    await page.getByRole("button", { name: "RBAC" }).click();
    await expect(page.getByRole("heading", { name: "Access Analyzer" })).toBeVisible();
    await page.getByLabel("User").selectOption("");
    await page.getByLabel("Role").selectOption("security_admin");
    await page.getByLabel("Permission").selectOption("rbac:read");
    await page.getByRole("button", { name: "Analyze" }).click();
    await expect(page.getByText("security_admin can read rbac")).toBeVisible();
    await expect(page.getByText("Security admin override")).toBeVisible();
  });

  test("Arc package provisioning uninstalls, reinstalls, and appears in Admin", async ({ page, request }) => {
    await ensureDcimInstalled(page, request);
    await openApp(page, "arc", "arc");

    await expect(page.locator("h2", { hasText: "Specora Arc" })).toBeVisible();
    await page.getByRole("button", { name: "Installed" }).click();
    await expect(page.getByRole("heading", { name: "DCIM Command Center" })).toBeVisible();

    await page.getByRole("button", { name: "Uninstall" }).click();
    await expect(page.getByText("No premium package apps installed")).toBeVisible();

    await page.getByRole("button", { name: "Discover", exact: true }).click();
    await expect(page.getByRole("heading", { name: "DCIM Command Center" })).toBeVisible();
    await page.getByTestId("arc-install-it-visibility-dcim").click();
    await page.getByRole("button", { name: "Installed", exact: true }).click();
    await expect(page.getByRole("heading", { name: "DCIM Command Center" })).toBeVisible();

    await openApp(page, "admin-console", "admin");
    await page.getByRole("button", { name: "Package Provisioning" }).click();
    await expect(page.getByRole("cell", { name: "it-visibility-dcim" }).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: "install" }).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: "uninstall" }).first()).toBeVisible();
  });

  test("Discovery can source, preview, publish, stage, and commit a pipeline", async ({ page, request }) => {
    await openApp(page, "discovery", "discovery");

    await expect(page.getByRole("heading", { name: "Discovery Builder" })).toBeVisible();
    const suffix = Date.now().toString().slice(-5);
    const host = `e2e-host-${suffix}`;
    const sourceName = `E2E Discovery Source ${suffix}`;
    const editedSourceName = `${sourceName} edited`;

    await page.getByRole("button", { name: "Sources" }).click();
    await page.getByPlaceholder("Production server inventory").fill(sourceName);
    await page.locator("textarea").fill(`hostname,environment,ip_addr\n${host},prod,10.44.1.9`);
    await page.getByRole("button", { name: "Create source" }).click();
    await expect(page.getByText(sourceName)).toBeVisible();
    await page.getByRole("button", { name: "Edit" }).first().click();
    await page.getByPlaceholder("Production server inventory").fill(editedSourceName);
    await page.getByRole("button", { name: "Save source" }).click();
    await expect(page.getByText(editedSourceName)).toBeVisible();

    await page.getByRole("button", { name: "Builder" }).click();
    await expect(page.locator("textarea")).toHaveValue(new RegExp(host));
    await page.getByRole("button", { name: "Add Pipeline Step" }).click();
    await expect(page.getByText("Builder steps")).toBeVisible();
    await page.getByRole("button", { name: "Validate" }).click();
    await expect(page.getByText("Canvas Inspector")).toBeVisible();
    await page.getByLabel("Title").fill("Schema Gate");
    await expect(page.getByText("Schema Gate")).toBeVisible();
    await page.getByRole("button", { name: "Duplicate" }).click();
    await expect(page.getByText("Schema Gate copy")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("Schema Gate copy")).toHaveCount(0);
    await page.getByRole("button", { name: "AI Draft Transform" }).click();
    await expect(page.getByText("Field Mappings")).toBeVisible();
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByText("Records")).toBeVisible();

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("button", { name: "Publish" })).toBeEnabled();
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("Pipeline published")).toBeVisible();
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByText(/Staged Commit/)).toBeVisible();
    await page.getByRole("button", { name: "Approve Safe" }).click();
    await page.getByRole("button", { name: "Commit" }).click();
    await expect(page.getByText("committed").first()).toBeVisible();

    const token = await page.evaluate(() => localStorage.getItem("specora_token"));
    const authHeaders = { Authorization: `Bearer ${token}` };
    const pipelines = await request.get("http://localhost:4000/discovery/pipelines", { headers: authHeaders });
    if (pipelines.ok()) {
      const pipeline = (await pipelines.json()).find((item: { name: string }) => item.name.includes(sourceName));
      if (pipeline?.id) {
        await request.delete(`http://localhost:4000/discovery/pipelines/${pipeline.id}`, { headers: authHeaders });
      }
    }
    const sources = await request.post("http://localhost:4000/graphql", {
      headers: authHeaders,
      data: { query: "{ discoverySources { id name } }" },
    });
    if (sources.ok()) {
      const source = (await sources.json()).data.discoverySources.find((item: { name: string }) => item.name === editedSourceName);
      if (source?.id) {
        await request.post("http://localhost:4000/graphql", {
          headers: authHeaders,
          data: { query: "mutation DeleteSource($id: ID!) { deleteDiscoverySource(id: $id) }", variables: { id: source.id } },
        });
      }
    }
    await request.post("http://localhost:4000/graphql", {
      headers: authHeaders,
      data: {
        query: "mutation DeleteCI($id: ID!) { deleteCI(id: $id) }",
        variables: { id: `disc-server-production-${host}` },
      },
    });
  });

  test("DCIM opens floorplan workspace", async ({ page, request }) => {
    await ensureDcimInstalled(page, request);
    await openApp(page, "it-visibility-dcim", "dcim");

    await expect(page.getByRole("heading", { name: "DCIM Command Center" })).toBeVisible();
    await page.getByRole("button", { name: "Floorplan" }).click();
    await expect(page.getByText("Floorplan Objects")).toBeVisible();
    await expect(page.getByText("Object Inspector")).toBeVisible();
  });

  test("DCIM can create and edit a floorplan object", async ({ page, request }) => {
    await ensureDcimInstalled(page, request);
    await openApp(page, "it-visibility-dcim", "dcim");

    await page.getByRole("button", { name: "Floorplan" }).click();
    await page.getByTestId("dcim-object-palette").getByRole("button", { name: "CRAC" }).click();
    const editor = page.getByTestId("dcim-object-editor");
    await expect(editor.getByText("cooling · floorplan object")).toBeVisible();

    const label = `CRAC E2E ${Date.now().toString().slice(-5)}`;
    await editor.getByLabel("Label").fill(label);
    await editor.getByLabel("Width").fill("210");
    await editor.getByLabel("Rotation").fill("90");
    await editor.getByRole("button", { name: "Save" }).click();

    await expect(page.getByTestId(`dcim-floorplan-object-${label}`)).toBeVisible();
    await openApp(page, "it-visibility-dcim", "dcim");
    await page.getByRole("button", { name: "Floorplan" }).click();
    await expect(page.getByTestId(`dcim-floorplan-object-${label}`)).toBeVisible();
    await page.locator("aside").first().getByRole("button", { name: new RegExp(label) }).click();
    await expect(editor.getByText("cooling · floorplan object")).toBeVisible();
    await editor.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByTestId(`dcim-floorplan-object-${label}`)).toHaveCount(0);
  });
});
