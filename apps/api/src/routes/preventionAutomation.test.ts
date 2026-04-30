import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { preventionAutomationRoutes } from "./preventionAutomation";
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
  await app.register(preventionAutomationRoutes);
  return app;
}

describe("preventionAutomationRoutes", () => {
  beforeEach(() => {
    clearPermissionCache();
    executeTool.mockReset();
  });

  it("detects prevention candidates", async () => {
    executeTool.mockResolvedValueOnce({ count: 2, candidates: [] });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/prevention/detect",
      payload: { windowDays: 14 },
    });

    expect(res.statusCode).toBe(200);
    expect(executeTool).toHaveBeenCalledWith("prevention-center_detect_candidates", expect.objectContaining({ windowDays: 14 }), expect.anything());
  });

  it("rejects authenticated users without a platform role", async () => {
    const app = await buildApp({ id: "u1" } as any);
    const res = await app.inject({
      method: "POST",
      url: "/api/prevention/detect",
      payload: { windowDays: 14 },
    });
    expect(res.statusCode).toBe(403);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("creates prevention candidates", async () => {
    executeTool.mockResolvedValueOnce({ id: "prb-1", status: "candidate" });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/prevention/candidates",
      payload: { title: "Stop repeated API incidents" },
    });

    expect(res.statusCode).toBe(200);
    expect(executeTool).toHaveBeenCalledWith("prevention-center_create_candidate", expect.objectContaining({ title: "Stop repeated API incidents" }), expect.anything());
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["prevention_automation.candidate_created", "PreventionRecord", "prb-1"]));
  });

  it("proposes actions and can create known errors", async () => {
    executeTool.mockResolvedValueOnce({ actions: [{ id: "a1" }] });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/prevention/candidates/prb-1/actions",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(executeTool).toHaveBeenCalledWith("prevention-center_propose_actions", expect.objectContaining({ preventionId: "prb-1" }), expect.anything());

    executeTool.mockResolvedValueOnce({ id: "kb-1" });
    const known = await app.inject({
      method: "POST",
      url: "/api/prevention/candidates/prb-1/actions",
      payload: { knownError: true },
    });

    expect(known.statusCode).toBe(200);
    expect(executeTool).toHaveBeenLastCalledWith("prevention-center_create_known_error", expect.objectContaining({ preventionId: "prb-1" }), expect.anything());
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["prevention_automation.actions_proposed", "PreventionRecord", "prb-1"]));
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["prevention_automation.known_error_created", "PreventionRecord", "prb-1"]));
  });

  it("transitions prevention records", async () => {
    executeTool.mockResolvedValueOnce({ id: "prb-1", status: "prevented" });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/prevention/candidates/prb-1/transition",
      payload: { status: "prevented", verifiedReductionPct: 0.8 },
    });

    expect(res.statusCode).toBe(200);
    expect(executeTool).toHaveBeenCalledWith("prevention-center_transition_candidate", expect.objectContaining({
      preventionId: "prb-1",
      status: "prevented",
    }), expect.anything());
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["prevention_automation.candidate_transitioned", "PreventionRecord", "prb-1"]));
  });
});
