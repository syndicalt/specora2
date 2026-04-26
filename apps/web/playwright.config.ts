import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";
const apiURL = process.env.E2E_API_URL || "http://localhost:4000";
const shouldStartServers = process.env.E2E_START_SERVERS === "1";
const reuseExistingServer = !process.env.CI;
const reuseExistingWebServer = !shouldStartServers && !process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  // The demo spine walks a shared seeded stack and API rate limiter. Keep it
  // serial so readiness failures point to product behavior, not test pressure.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["html"], ["list"]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: shouldStartServers ? [
    {
      command: "pnpm --dir ../.. --filter @specora/api dev",
      url: `${apiURL}/health`,
      reuseExistingServer,
      timeout: 60_000,
    },
    {
      command: "pnpm --dir ../.. --filter @specora/web dev",
      url: baseURL,
      reuseExistingServer: reuseExistingWebServer,
      timeout: 60_000,
      env: {
        NEXT_PUBLIC_API_URL: `${apiURL}/graphql`,
      },
    },
  ] : undefined,
  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
      dependencies: ["setup"],
      testIgnore: /.*\.setup\.ts/,
    },
  ],
});
