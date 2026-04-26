import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { incidentAutomationRoutes } from "./incidentAutomation";
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

async function buildApp(user = { id: "u1", role: "operator" }, allowed = true) {
  const app = Fastify();
  app.decorate("pg", makePg(allowed));
  app.decorate("authenticate", async (request: any) => {
    request.user = user;
  });
  await app.register(incidentAutomationRoutes);
  return app;
}

describe("incidentAutomationRoutes", () => {
  beforeEach(() => {
    clearPermissionCache();
    executeTool.mockReset();
  });

  it("ingests external signals and immediately triages the incident", async () => {
    executeTool
      .mockResolvedValueOnce({ id: "inc-1", status: "new" })
      .mockResolvedValueOnce({ incidentId: "inc-1", decision: "request-approval" });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/incident-automation/signals",
      payload: { title: "Checkout errors", severity: "high", source: "alert", externalRef: "alert-1" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).triage.decision).toBe("request-approval");
    expect(executeTool).toHaveBeenNthCalledWith(1, "incident-manager_create_incident", expect.objectContaining({
      title: "Checkout errors",
      _userId: "u1",
    }), expect.anything());
    expect(executeTool).toHaveBeenNthCalledWith(2, "incident-manager_triage_incident", expect.objectContaining({
      incidentId: "inc-1",
    }), expect.anything());
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["incident_automation.signal_ingested", "Incident", "inc-1"]));
  });

  it("creates managed incidents through an external workflow endpoint", async () => {
    executeTool.mockResolvedValueOnce({ id: "inc-2", status: "new" });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/incident-automation/incidents",
      payload: { title: "API latency", severity: "medium" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ id: "inc-2", status: "new" });
    expect(executeTool).toHaveBeenCalledWith("incident-manager_create_incident", expect.objectContaining({ title: "API latency" }), expect.anything());
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["incident_automation.incident_created", "Incident", "inc-2"]));
  });

  it("can recommend remediation actions for an incident", async () => {
    executeTool.mockResolvedValueOnce({ incidentId: "inc-1", actions: [{ id: "act-1" }] });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/incident-automation/incidents/inc-1/actions",
      payload: { recommend: true },
    });

    expect(res.statusCode).toBe(200);
    expect(executeTool).toHaveBeenCalledWith("incident-manager_recommend_remediation", expect.objectContaining({ incidentId: "inc-1" }), expect.anything());
  });

  it("approves and executes remediation actions", async () => {
    executeTool
      .mockResolvedValueOnce({ id: "act-1", status: "approved" })
      .mockResolvedValueOnce({ id: "act-1", status: "executed" });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/incident-automation/incidents/inc-1/actions",
      payload: { actionId: "act-1", approve: true, result: "Restart completed" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe("executed");
    expect(executeTool).toHaveBeenNthCalledWith(1, "incident-manager_approve_action", expect.objectContaining({ actionId: "act-1" }), expect.anything());
    expect(executeTool).toHaveBeenNthCalledWith(2, "incident-manager_execute_remediation", expect.objectContaining({ result: "Restart completed" }), expect.anything());
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["incident_automation.remediation_executed", "Incident", "inc-1"]));
  });

  it("resolves incidents and can generate a postmortem draft", async () => {
    executeTool
      .mockResolvedValueOnce({ id: "inc-1", status: "resolved" })
      .mockResolvedValueOnce({ id: "pm-1" });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/incident-automation/incidents/inc-1/resolve",
      payload: { note: "Recovered", generatePostmortem: true },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).postmortem).toEqual({ id: "pm-1" });
    expect(executeTool).toHaveBeenNthCalledWith(1, "incident-manager_transition_incident", expect.objectContaining({ status: "resolved" }), expect.anything());
    expect(executeTool).toHaveBeenNthCalledWith(2, "incident-manager_generate_postmortem", expect.objectContaining({ incidentId: "inc-1" }), expect.anything());
  });
});
