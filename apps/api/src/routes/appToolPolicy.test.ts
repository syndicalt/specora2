import { describe, expect, it, vi } from "vitest";
import { auditAppToolOutcome, authorizeAppTool, resolveAppToolPolicy } from "./appToolPolicy";

describe("appToolPolicy", () => {
  it("maps known apps to resources and classifies tool actions", () => {
    expect(resolveAppToolPolicy("health-monitor", "find_cycles")).toMatchObject({
      fullName: "health-monitor_find_cycles",
      resource: "health-monitor",
      action: "read",
    });
    expect(resolveAppToolPolicy("discovery-insights", "suggest_next_scan")).toMatchObject({
      resource: "discovery",
      action: "read",
    });
    expect(resolveAppToolPolicy("incident-manager", "execute_remediation")).toMatchObject({
      resource: "incident-manager",
      action: "write",
    });
    expect(resolveAppToolPolicy("custom-app", "publish_record")).toMatchObject({
      resource: "custom-app",
      action: "write",
    });
  });

  it("denies non-portal app tool calls without a role and checks RBAC for user calls", async () => {
    const policy = resolveAppToolPolicy("incident-manager", "create_incident");
    const pg = { query: vi.fn(async () => ({ rows: [{ id: "p1" }] })) };
    const fastify = { pg } as any;

    await expect(authorizeAppTool(fastify, null, policy)).resolves.toMatchObject({ allowed: false });
    await expect(authorizeAppTool(fastify, { id: "u2" }, policy)).resolves.toMatchObject({ allowed: false });
    await expect(authorizeAppTool(fastify, { id: "u1", role: "operator" }, policy)).resolves.toMatchObject({ allowed: true });
    expect(pg.query).toHaveBeenCalled();
  });

  it("allows authenticated Customer Portal tool calls without a platform role", async () => {
    const policy = resolveAppToolPolicy("customer-portal", "resolve_intent");
    const pg = { query: vi.fn(async () => ({ rows: [] })) };
    const fastify = { pg } as any;

    await expect(authorizeAppTool(fastify, { id: "u1" }, policy)).resolves.toMatchObject({ allowed: true });
    await expect(authorizeAppTool(fastify, null, policy)).resolves.toMatchObject({ allowed: false });
    expect(pg.query).not.toHaveBeenCalled();
  });

  it("records denied, failed, executed, and queued audit outcomes with consistent metadata", async () => {
    const pg = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) };
    const fastify = { pg } as any;
    const policy = resolveAppToolPolicy("health-monitor", "apply_remediation");

    await auditAppToolOutcome(fastify, {
      user: { id: "u1", role: "viewer" },
      policy,
      outcome: "denied",
      transport: "post",
    });
    await auditAppToolOutcome(fastify, {
      user: { id: "u1", role: "operator" },
      policy,
      outcome: "failed",
      transport: "get",
      error: "boom",
    });
    await auditAppToolOutcome(fastify, {
      user: { id: "u1", role: "operator" },
      policy,
      outcome: "executed",
      transport: "post",
      result: { ok: true },
    });
    await auditAppToolOutcome(fastify, {
      user: { id: "u1", role: "operator" },
      policy,
      outcome: "queued",
      transport: "job",
      jobId: "job-1",
    });

    expect(pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["app_tool.denied", "AppTool", "health-monitor_apply_remediation"]));
    expect(pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["app_tool.failed", "AppTool", "health-monitor_apply_remediation"]));
    expect(pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["app_tool.executed", "AppTool", "health-monitor_apply_remediation", null, JSON.stringify({ result: { ok: true } })]));
    expect(pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["app_tool.queued", "AppTool", "health-monitor_apply_remediation", null, JSON.stringify({ jobId: "job-1" })]));
  });
});
