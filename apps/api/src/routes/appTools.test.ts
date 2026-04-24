import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { appToolRoutes } from "./appTools";

vi.mock("@specora/sdk", () => ({
  getToolsForSession: vi.fn(() => [
    { name: "health-monitor_find_cycles", description: "Find cycles", parameters: { type: "object", properties: {} } },
  ]),
  executeTool: vi.fn(() => Promise.resolve({ found: true })),
}));

describe("appToolRoutes", () => {
  async function buildApp() {
    const app = Fastify();
    app.decorate("authenticate", async () => {});
    await app.register(appToolRoutes);
    return app;
  }

  it("lists tools for an app", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/apps/health-monitor/tools",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("health-monitor_find_cycles");
  });

  it("executes a tool via POST", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/apps/health-monitor/tools/find_cycles",
      payload: { maxDepth: 5 },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toEqual({ found: true });
  });

  it("executes a tool via GET", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/apps/health-monitor/tools/find_cycles?maxDepth=5",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toEqual({ found: true });
  });
});
