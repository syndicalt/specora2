import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webPackagePath = join(repoRoot, "apps/web/package.json");
const require = createRequire(webPackagePath);
const { chromium } = require("@playwright/test");

const baseURL = process.env.SPECORA_DOCS_BASE_URL || "https://specora-dev.specora.org";
const email = process.env.SPECORA_DOCS_EMAIL || "admin@specora.org";
const password = process.env.SPECORA_DOCS_PASSWORD;
const outDir = resolve(process.env.SPECORA_DOCS_SCREENSHOT_DIR || join(repoRoot, "docs/screenshots"));
const headed = process.env.SPECORA_DOCS_HEADED === "1";

if (!existsSync(webPackagePath)) {
  throw new Error(`Cannot find web package at ${webPackagePath}`);
}

if (!password) {
  throw new Error("Set SPECORA_DOCS_PASSWORD before capturing authenticated documentation screenshots.");
}

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(12_000);

async function waitForQuiet() {
  await page.waitForTimeout(900);
}

async function shot(name) {
  await waitForQuiet();
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: false });
  console.log(`captured ${name}.png`);
}

async function maybeClick(locator) {
  try {
    await locator.click({ timeout: 2500 });
    return true;
  } catch {
    return false;
  }
}

async function closeActiveApp() {
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+X" : "Control+Shift+X");
  await waitForQuiet();
}

async function login() {
  await page.goto(`${baseURL}/login`, { waitUntil: "networkidle" });
  await shot("login-page");
  await page.locator('input[type="email"], input[name="email"]').first().fill(email);
  await page.locator('input[type="password"], input[name="password"]').first().fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 20_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await waitForQuiet();
}

async function openLauncher() {
  const search = page.getByPlaceholder("Search applications");
  if (await search.isVisible().catch(() => false)) return;
  await page.getByTitle("All Apps").click();
  await search.waitFor({ state: "visible" });
}

async function openApp(appId, searchText) {
  await openLauncher();
  await page.getByPlaceholder("Search applications").fill(searchText);
  await page.getByTestId(`app-launcher-item-${appId}`).click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await waitForQuiet();
}

async function openAdminSection(label) {
  await openApp("admin-console", "admin");
  await maybeClick(page.getByRole("button", { name: label }));
  await page.waitForTimeout(2_500);
}

async function main() {
  await login();

  await openApp("service-map", "service map");
  await shot("workspace-overview");

  await openLauncher();
  await shot("workspace-launcher");
  await page.keyboard.press("Escape");
  await waitForQuiet();
  await shot("workspace-navigation");

  await page.keyboard.press(process.platform === "darwin" ? "Meta+/" : "Control+/");
  await waitForQuiet();
  await shot("chat-panel");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+/" : "Control+/");

  await openApp("settings", "settings");
  await shot("settings-profile");
  await closeActiveApp();

  await openApp("cmdb-explorer", "cmdb");
  await page.getByPlaceholder("Search name, asset, host...").fill("nb-lenovo");
  await waitForQuiet();
  await shot("cmdb-explorer-search");
  await maybeClick(page.getByText("nb-lenovo").first());
  await waitForQuiet();
  await shot("cmdb-explorer-ci-detail");

  await maybeClick(page.getByRole("button", { name: "Service Map" }).first());
  await waitForQuiet();
  await shot("service-map-overview");
  await maybeClick(page.getByRole("button", { name: "Link" }).first());
  await waitForQuiet();
  await shot("service-map-relationship-edit");

  await openApp("tables", "tables");
  await shot("tables-record-list");
  await maybeClick(page.getByRole("button", { name: /Edit nb-lenovo/i }).first());
  await waitForQuiet();
  await shot("tables-record-edit");
  await shot("tables-reference-typeahead");

  await openApp("discovery", "discovery");
  await shot("discovery-pipeline-builder");
  await shot("discovery-preview");
  await shot("discovery-commit-review");
  await maybeClick(page.getByRole("button", { name: /Add Source|New Source|Create Source/i }).first());
  await waitForQuiet();
  await shot("discovery-source-form");

  await openApp("data-foundations", "data");
  await shot("data-foundations-overview");

  await openApp("reporting", "reporting");
  await shot("reporting-dashboard");

  await openAdminSection("Overview");
  await shot("admin-console-overview");
  await openAdminSection("User Management");
  await shot("admin-user-management");
  await openAdminSection("RBAC");
  await shot("admin-rbac");
  await openAdminSection("Credentials");
  await shot("admin-credentials");
  await openAdminSection("Edge Enrollment");
  await shot("admin-edge-enrollment");
  await openAdminSection("Environments");
  await shot("admin-environments");

  await openApp("ci-class-manager", "class");
  await shot("ci-class-manager-class-edit");
  await closeActiveApp();

  await openApp("arc", "arc");
  await shot("arc-catalog");
  await closeActiveApp();

  await openApp("incident-manager", "incident");
  await shot("incident-command-center");
  await openApp("change-manager", "change");
  await shot("change-manager-overview");
  await openApp("knowledge-core", "knowledge");
  await shot("knowledge-core-overview");
  await openApp("prevention-center", "prevention");
  await shot("prevention-center-overview");
  await openApp("asset-command", "asset");
  await shot("asset-command-center");
  await openApp("customer-portal", "customer");
  await shot("customer-portal-home");
  await openApp("engage-agent-workspace", "engage");
  await shot("engage-agent-workspace");
  await openApp("discovery-insights", "discovery insights");
  await shot("discovery-insights");
  await openApp("health-monitor", "health");
  await shot("health-monitor");
  await openApp("it-visibility-dcim", "dcim");
  await shot("dcim-command-center");
  await openApp("audit-log", "audit");
  await shot("audit-log");
}

try {
  await main();
} finally {
  await browser.close();
}
