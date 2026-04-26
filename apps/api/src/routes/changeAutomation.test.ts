import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { changeAutomationRoutes } from "./changeAutomation";
import { clearPermissionCache } from "../services/rbac";

const executeTool = vi.fn();

vi.mock("@specora/sdk", () => ({
  executeTool: (...args: any[]) => executeTool(...args),
}));

function makePg(allowed = true) {
  return {
    query: vi.fn(async () => ({ rows: allowed ? [{ 1: 1 }] : [] })),
  };
}

async function buildApp(user = { id: "u1", role: "admin" }, allowed = true) {
  const app = Fastify();
  app.decorate("pg", makePg(allowed));
  app.decorate("authenticate", async (request: any) => {
    request.user = user;
  });
  await app.register(changeAutomationRoutes);
  return app;
}

describe("changeAutomationRoutes", () => {
  beforeEach(() => {
    clearPermissionCache();
    executeTool.mockReset();
  });

  it("creates change requests through a CI/CD friendly endpoint", async () => {
    executeTool.mockResolvedValueOnce({ id: "rfc-1", status: "draft" });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/change-automation/requests",
      payload: { ciId: "ci-1", title: "Deploy release" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ id: "rfc-1", status: "draft" });
    expect(executeTool).toHaveBeenCalledWith("change-manager_create_rfc", expect.objectContaining({
      ciId: "ci-1",
      _userId: "u1",
    }), expect.anything());
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["change_automation.request_created", "ChangeRequest", "rfc-1"]));
  });

  it("returns a gate decision for existing RFCs", async () => {
    executeTool
      .mockResolvedValueOnce({ riskScore: 64 })
      .mockResolvedValueOnce({ conflictCount: 1 })
      .mockResolvedValueOnce({ healthy: true })
      .mockResolvedValueOnce({ criticalPath: null });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/change-automation/gate",
      payload: { rfcId: "rfc-1" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.decision).toBe("review");
    expect(body.gates).toContainEqual(expect.objectContaining({ id: "conflicts", status: "warn" }));
  });

  it("blocks high-risk proposed changes", async () => {
    executeTool.mockResolvedValueOnce({ riskScore: 92, priority: "critical" });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/change-automation/gate",
      payload: { ciId: "ci-1" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).decision).toBe("block");
  });

  it("transitions RFCs and writes optional automation comments", async () => {
    executeTool.mockResolvedValueOnce({ id: "rfc-1", status: "implemented" }).mockResolvedValueOnce({ id: "comment-1" });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/change-automation/requests/rfc-1/transition",
      payload: { status: "implemented", comment: "Pipeline deploy succeeded" },
    });

    expect(res.statusCode).toBe(200);
    expect(executeTool).toHaveBeenNthCalledWith(1, "change-manager_edit_rfc", expect.objectContaining({ rfcId: "rfc-1", status: "implemented" }), expect.anything());
    expect(executeTool).toHaveBeenNthCalledWith(2, "change-manager_add_rfc_comment", expect.objectContaining({ content: "Pipeline deploy succeeded" }), expect.anything());
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["change_automation.request_transitioned", "ChangeRequest", "rfc-1"]));
  });
});
