import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const authFile = "e2e/.auth/user.json";
const apiURL = process.env.E2E_API_URL || "http://localhost:4000";

test("authenticate seeded admin user", async ({ page, request }) => {
  const response = await request.post(`${apiURL}/api/login`, {
    data: {
      email: process.env.E2E_USER_EMAIL || "alice@specora.dev",
      password: process.env.E2E_USER_PASSWORD || "secret123",
    },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.token).toEqual(expect.any(String));

  await page.goto("/login");
  await page.evaluate((token) => {
    localStorage.setItem("specora_token", token);
  }, body.token);

  mkdirSync(dirname(authFile), { recursive: true });
  await page.context().storageState({ path: authFile });
});
