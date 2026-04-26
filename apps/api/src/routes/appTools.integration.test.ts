import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unregisterAppTools } from "@specora/sdk";
import { appToolRoutes } from "./appTools";
import { registerAllAppTools } from "../services/appTools";
import { clearPermissionCache } from "../services/rbac";

vi.mock("../services/eventBus", () => ({
  emit: vi.fn(),
}));

vi.mock("../routes/admin", () => ({
  getStateMachineConfig: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("../services/impactScoring", () => ({
  computeImpactScore: vi.fn(() => Promise.resolve({
    riskScore: 25,
    blastRadius: 10,
    priority: "low",
    breakdown: {},
    affectedCis: [],
  })),
  previewImpactScore: vi.fn(() => Promise.resolve({
    riskScore: 25,
    blastRadius: 10,
    priority: "low",
    breakdown: {},
    affectedCis: [],
  })),
  recordRiskScoreHistory: vi.fn(() => Promise.resolve()),
  getRiskScoreHistory: vi.fn(() => Promise.resolve([])),
}));

const APP_IDS = [
  "change-manager",
  "incident-manager",
  "knowledge-core",
  "prevention-center",
  "asset-command",
  "discovery-insights",
  "health-monitor",
];

function resetRegisteredTools() {
  for (const appId of APP_IDS) {
    unregisterAppTools(appId);
  }
}

function makePg(allowed = true) {
  return {
    query: vi.fn(async (sql: string, params?: any[]) => {
      if (sql.includes("SELECT 1 FROM app_permissions")) {
        return { rows: allowed ? [{ 1: 1 }] : [] };
      }
      if (sql.includes("INSERT INTO incidents")) {
        return {
          rows: [{
            id: "incident-route-1",
            title: params?.[0],
            severity: params?.[2],
            source: params?.[4],
            external_ref: params?.[5],
            ci_id: params?.[7],
            owner_id: params?.[9],
            status: "new",
          }],
        };
      }
      if (sql.includes("INSERT INTO incident_cis")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO incident_events")) {
        return { rows: [] };
      }
      if (sql.includes("SELECT * FROM knowledge_items") && sql.includes("status = 'published'")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO knowledge_gaps")) {
        return { rows: [{ id: "gap-route-1", query: params?.[0] }] };
      }
      if (sql.includes("SELECT id FROM asset_records")) {
        return { rows: [{ id: "asset-route-1" }] };
      }
      if (sql.includes("INSERT INTO asset_scan_events")) {
        return {
          rows: [{
            id: "scan-route-1",
            asset_id: params?.[0],
            value: params?.[2],
            scanned_by: params?.[6],
          }],
        };
      }
      if (sql.includes("UPDATE asset_records SET location")) {
        return { rows: [] };
      }
      return { rows: [] };
    }),
  };
}

async function buildApp(options: {
  role?: string;
  allowed?: boolean;
} = {}) {
  const app = Fastify();
  app.decorate("pg", makePg(options.allowed ?? true));
  app.decorate("authenticate", async (request: any) => {
    request.user = {
      id: "550e8400-e29b-41d4-a716-446655440001",
      role: options.role || "operator",
    };
  });
  await app.register(appToolRoutes);
  return app;
}

describe("appToolRoutes with registered native app tools", () => {
  beforeEach(() => {
    clearPermissionCache();
    resetRegisteredTools();
    registerAllAppTools();
  });

  afterEach(() => {
    resetRegisteredTools();
  });

  it("lists RBAC-filtered tools registered by a native app", async () => {
    const app = await buildApp({ role: "operator" });

    const res = await app.inject({
      method: "GET",
      url: "/api/apps/incident-manager/tools",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.some((tool: any) => tool.name === "incident-manager_create_incident")).toBe(true);
    expect(body.some((tool: any) => tool.name === "incident-manager_get_incident_details")).toBe(true);
  });

  it("executes an incident creation workflow through RBAC and the tool registry", async () => {
    const app = await buildApp({ role: "operator" });

    const res = await app.inject({
      method: "POST",
      url: "/api/apps/incident-manager/tools/create_incident",
      payload: {
        title: "Checkout latency",
        severity: "high",
        source: "monitoring",
        externalRef: "route-alert-1",
        ciId: "demo-applicationservice-0001",
        affectedCiIds: ["demo-server-0001"],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toMatchObject({
      id: "incident-route-1",
      title: "Checkout latency",
      owner_id: "550e8400-e29b-41d4-a716-446655440001",
    });
    expect((app as any).pg.query).toHaveBeenCalledWith(
      "SELECT 1 FROM app_permissions WHERE role = $1 AND resource = $2 AND action = $3",
      ["operator", "incident-manager", "write"]
    );
  });

  it("returns 403 before executing a write tool when RBAC denies access", async () => {
    const app = await buildApp({ role: "viewer", allowed: false });

    const res = await app.inject({
      method: "POST",
      url: "/api/apps/incident-manager/tools/create_incident",
      payload: { title: "Denied incident" },
    });

    expect(res.statusCode).toBe(403);
    expect((app as any).pg.query).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO incidents"),
      expect.anything()
    );
  });

  it("treats apply-prefixed maintenance tools as write actions", async () => {
    const app = await buildApp({ role: "viewer", allowed: false });

    const res = await app.inject({
      method: "POST",
      url: "/api/apps/health-monitor/tools/apply_remediation",
      payload: { sourceId: "a", targetId: "b", relType: "DEPENDS_ON" },
    });

    expect(res.statusCode).toBe(403);
    expect((app as any).pg.query).toHaveBeenCalledWith(
      "SELECT 1 FROM app_permissions WHERE role = $1 AND resource = $2 AND action = $3",
      ["viewer", "health-monitor", "write"]
    );
  });

  it("queues app tool jobs through the same RBAC gate", async () => {
    const app = await buildApp({ role: "operator" });
    (app as any).pg.query.mockResolvedValueOnce({ rows: [{ 1: 1 }] });
    (app as any).pg.query.mockResolvedValueOnce({
      rows: [{
        id: "job-route-1",
        type: "app_tool",
        payload: {},
        status: "pending",
        priority: 5,
        retries: 0,
        max_retries: 3,
        created_at: "now",
        updated_at: "now",
      }],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/apps/health-monitor/tools/apply_remediation/jobs",
      payload: { sourceId: "a", targetId: "b", relType: "DEPENDS_ON" },
    });

    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.payload).job).toMatchObject({ id: "job-route-1", priority: 5 });
  });

  it("captures a knowledge demand gap through the same app tool route", async () => {
    const app = await buildApp({ role: "operator" });

    const res = await app.inject({
      method: "POST",
      url: "/api/apps/knowledge-core/tools/answer",
      payload: { query: "How do we remediate ledger backup drift?" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toMatchObject({ confidence: 0, citations: [] });
    expect((app as any).pg.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO knowledge_gaps"),
      expect.arrayContaining(["How do we remediate ledger backup drift?"])
    );
  });

  it("records mobile-ready asset scans with injected actor context", async () => {
    const app = await buildApp({ role: "operator" });

    const res = await app.inject({
      method: "POST",
      url: "/api/apps/asset-command/tools/record_scan",
      payload: {
        value: "SPC-SRV-0001",
        location: "Dallas DC1",
        payload: { source: "e2e-test" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toMatchObject({
      id: "scan-route-1",
      asset_id: "asset-route-1",
      scanned_by: "550e8400-e29b-41d4-a716-446655440001",
    });
  });
});
