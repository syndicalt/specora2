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
  async function buildApp(user: { id?: string; role?: string } = { id: "admin-1", role: "admin" }) {
    const app = Fastify();
    app.decorate("pg", {
      query: vi.fn(async () => ({
        rows: [{
          id: "job-1",
          type: "app_tool",
          payload: {},
          status: "pending",
          priority: 0,
          retries: 0,
          max_retries: 3,
          created_at: "now",
          updated_at: "now",
        }],
      })),
    });
    app.decorate("authenticate", async (request: any) => {
      request.user = user;
    });
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
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["app_tool.executed", "AppTool", "health-monitor_find_cycles"]));
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

  it("queues a tool execution job for asynchronous processing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/apps/health-monitor/tools/find_cycles/jobs",
      payload: { maxDepth: 5 },
    });
    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.payload).job).toMatchObject({ id: "job-1", type: "app_tool" });
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO jobs"), [
      "app_tool",
      JSON.stringify({
        appId: "health-monitor",
        toolName: "find_cycles",
        args: { maxDepth: 5 },
        user: { id: "admin-1", role: "admin" },
      }),
      0,
    ]);
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["app_tool.queued", "AppTool", "health-monitor_find_cycles"]));
  });

  it("does not expose non-portal tools to users without roles", async () => {
    const app = await buildApp({ id: "basic-1" });

    const res = await app.inject({
      method: "GET",
      url: "/api/apps/health-monitor/tools",
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual([]);
  });

  it("denies non-portal tool execution for users without roles", async () => {
    const app = await buildApp({ id: "basic-1" });
    const res = await app.inject({
      method: "POST",
      url: "/api/apps/health-monitor/tools/find_cycles",
      payload: { maxDepth: 5 },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).error).toContain("cannot read health-monitor");
  });
});
