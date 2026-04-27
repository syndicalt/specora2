import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportingRoutes } from "./reporting";
import { clearPermissionCache } from "../services/rbac";

function makePg(handler?: (sql: string, params?: any[]) => any) {
  return {
    query: vi.fn(async (sql: string, params?: any[]) => {
      const handled = handler?.(sql, params);
      if (handled) return handled;
      if (sql.includes("INSERT INTO audit_log")) return { rows: [{ id: "audit-1" }] };
      return { rows: [] };
    }),
  };
}

async function buildApp(user: any, pgHandler?: (sql: string, params?: any[]) => any) {
  const app = Fastify();
  app.decorate("pg", makePg(pgHandler));
  app.decorate("neo4j", {
    session: () => ({
      run: vi.fn(async () => ({
        records: [{
          get: (key: string) => {
            if (key === "total") return { toNumber: () => 10 };
            if (key === "complete") return { toNumber: () => 8 };
            return null;
          },
        }],
      })),
      close: vi.fn(async () => undefined),
    }),
  });
  app.decorate("authenticate", async (request: any) => {
    request.user = user;
  });
  await app.register(reportingRoutes);
  return app;
}

describe("reportingRoutes", () => {
  beforeEach(() => {
    clearPermissionCache();
  });

  it("lists governed datasets visible to the user", async () => {
    const app = await buildApp({ id: "u1", role: "admin" });

    const res = await app.inject({ method: "GET", url: "/api/reports/datasets" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.datasets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "incidents", label: "Incidents" }),
      expect.objectContaining({ id: "cab_briefs", label: "CAB Briefs" }),
      expect.objectContaining({ id: "knowledge_feedback", label: "Knowledge Feedback" }),
      expect.objectContaining({ id: "knowledge_gaps", label: "Knowledge Gaps" }),
      expect.objectContaining({ id: "audit", label: "Audit Events" }),
    ]));
    expect(body.datasets[0].columns[0]).not.toHaveProperty("expr");
  });

  it("queries grouped report data with filters and audits the read", async () => {
    const pgHandler = (sql: string, params?: any[]) => {
      if (sql.includes("FROM \"incidents\"") && sql.includes("GROUP BY")) {
        expect(sql).toContain("\"status\" = $3");
        expect(params?.[2]).toBe("new");
        return { rows: [{ status: "new", record_count: 3 }] };
      }
      return null;
    };
    const app = await buildApp({ id: "u1", role: "admin" }, pgHandler);
    const filters = encodeURIComponent(JSON.stringify([{ field: "status", operator: "equals", value: "new" }]));

    const res = await app.inject({
      method: "GET",
      url: `/api/reports/datasets/incidents/query?groupBy=status&filters=${filters}&from=2026-04-01T00:00:00.000Z&to=2026-04-30T00:00:00.000Z`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.grouped).toBe(true);
    expect(body.rows).toEqual([{ status: "new", record_count: 3 }]);
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["report.queried", "ReportDataset", "incidents"]));
  });

  it("exports report data as signed CSV", async () => {
    const pgHandler = (sql: string) => {
      if (sql.includes("FROM \"incidents\"") && !sql.includes("GROUP BY")) {
        return { rows: [{ id: "inc-1", number: "INC000001", title: "Checkout down", status: "new" }] };
      }
      return null;
    };
    const app = await buildApp({ id: "u1", role: "admin" }, pgHandler);

    const res = await app.inject({ method: "GET", url: "/api/reports/datasets/incidents/query?format=csv&limit=1" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["x-specora-export-digest"]).toMatch(/^[a-f0-9]{64}$/);
    expect(res.headers["x-specora-export-signature"]).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body).toContain("INC000001");
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["report.exported", "ReportDataset", "incidents"]));
  });

  it("returns target-specific integration contracts for visible datasets", async () => {
    const app = await buildApp({ id: "u1", role: "admin" });

    const res = await app.inject({ method: "GET", url: "/api/reports/contracts/powerbi" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.contract).toMatchObject({
      target: "powerbi",
      authentication: { type: "bearer", header: "Authorization" },
      client: { mode: "web-connector", preferredFormat: "csv" },
    });
    expect(body.contract.datasets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "incidents",
        endpoints: expect.objectContaining({ query: "/api/reports/datasets/incidents/query" }),
        filters: expect.arrayContaining([expect.objectContaining({ field: "status", operators: expect.arrayContaining(["equals", "contains"]) })]),
      }),
    ]));
    expect(body.contract.datasets[0].columns[0]).toHaveProperty("source");
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["report.contract.read", "ReportContract", "powerbi"]));
  });

  it("rejects unknown report contract targets", async () => {
    const app = await buildApp({ id: "u1", role: "admin" });

    const res = await app.inject({ method: "GET", url: "/api/reports/contracts/looker" });

    expect(res.statusCode).toBe(404);
  });

  it("returns governed KPI summaries for visible reporting domains", async () => {
    const pgHandler = (sql: string) => {
      if (sql.includes("FROM incidents") && sql.includes("total_open")) {
        return { rows: [{ total_open: 9, at_risk: 2 }] };
      }
      if (sql.includes("FROM change_requests") && sql.includes("collisions")) {
        return { rows: [{ collisions: 1, affected_cis: 1, max_ci_change_count: 2 }] };
      }
      if (sql.includes("FROM change_requests") && sql.includes("briefed")) {
        return { rows: [{ scheduled: 10, briefed: 9, approved: 7 }] };
      }
      if (sql.includes("FROM knowledge_items") && sql.includes("average_trust")) {
        return { rows: [{ published: 10, fresh: 9, average_trust: 0.82 }] };
      }
      if (sql.includes("FROM knowledge_items") && sql.includes("total_reuse")) {
        return { rows: [{ published: 10, trusted: 8, reused: 6, total_reuse: 44, total_deflections: 12 }] };
      }
      if (sql.includes("SUM(deflection_count)")) {
        return { rows: [{ deflections: 30, incidents: 70 }] };
      }
      if (sql.includes("FROM catalog_requests") && sql.includes("average_age_days")) {
        return { rows: [{ backlog: 12, average_age_days: 3.4, high_priority: 2 }] };
      }
      if (sql.includes("FROM audit_log") && sql.includes("hashed_events")) {
        return { rows: [{ total_events: 50, hashed_events: 50, privileged_events: 7, distinct_actors: 4 }] };
      }
      return null;
    };
    const app = await buildApp({ id: "u1", role: "admin" }, pgHandler);

    const res = await app.inject({
      method: "GET",
      url: "/api/reports/kpis?from=2026-04-01T00:00:00.000Z&to=2026-04-30T00:00:00.000Z",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.window).toEqual({ from: "2026-04-01T00:00:00.000Z", to: "2026-04-30T00:00:00.000Z" });
    expect(body.kpis).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "sla_risk", value: 2, unit: "count", status: "watch" }),
      expect.objectContaining({ id: "incident_deflection", value: 30, unit: "percent" }),
      expect.objectContaining({ id: "cmdb_completeness", value: 80, unit: "percent" }),
      expect.objectContaining({ id: "cab_brief_coverage", value: 90, unit: "percent" }),
      expect.objectContaining({ id: "knowledge_trust_reuse", value: 60, unit: "percent" }),
      expect.objectContaining({ id: "audit_security_posture", value: 100, status: "good" }),
    ]));
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["report.kpis.read", "ReportKpi", "summary"]));
  });

  it("returns operational readiness checks", async () => {
    const pgHandler = (sql: string) => {
      if (sql.includes("open_incidents") && sql.includes("high_priority")) {
        return { rows: [{ open_incidents: 6, high_priority: 2 }] };
      }
      if (sql.includes("high_risk") && sql.includes("change_cab_brief_snapshots")) {
        return { rows: [{ scheduled: 10, briefed: 8, high_risk: 1 }] };
      }
      if (sql.includes("open_gap_demand")) {
        return { rows: [{ average_trust: 0.8, published: 12, reused: 9, open_gap_demand: 3 }] };
      }
      if (sql.includes("FROM audit_log") && sql.includes("hashed_events")) {
        return { rows: [{ total_events: 50, hashed_events: 49 }] };
      }
      return null;
    };
    const app = await buildApp({ id: "u1", role: "admin" }, pgHandler);

    const res = await app.inject({
      method: "GET",
      url: "/api/reports/readiness?from=2026-04-01T00:00:00.000Z&to=2026-04-30T00:00:00.000Z",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toMatch(/good|watch|risk/);
    expect(body.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "incident_load", score: 80 }),
      expect.objectContaining({ id: "change_governance", details: expect.objectContaining({ coverage: 80 }) }),
      expect.objectContaining({ id: "knowledge_readiness" }),
      expect.objectContaining({ id: "cmdb_data_quality", score: 80 }),
      expect.objectContaining({ id: "audit_integrity", score: 98 }),
    ]));
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["report.readiness.read", "ReportReadiness", "operational"]));
  });

  it("returns a single KPI by id", async () => {
    const pgHandler = (sql: string) => {
      if (sql.includes("FROM catalog_requests") && sql.includes("average_age_days")) {
        return { rows: [{ backlog: 64, average_age_days: 8.2, high_priority: 6 }] };
      }
      return null;
    };
    const app = await buildApp({ id: "u1", role: "admin" }, pgHandler);

    const res = await app.inject({ method: "GET", url: "/api/reports/kpis/request_backlog" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.kpi).toMatchObject({
      id: "request_backlog",
      label: "Request Backlog",
      value: 64,
      status: "risk",
      details: { averageAgeDays: 8.2, highPriority: 6 },
    });
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["report.kpi.read", "ReportKpi", "request_backlog"]));
  });

  it("rejects unknown report KPIs", async () => {
    const app = await buildApp({ id: "u1", role: "admin" });

    const res = await app.inject({ method: "GET", url: "/api/reports/kpis/magic" });

    expect(res.statusCode).toBe(404);
  });

  it("saves and deletes report definitions", async () => {
    const pgHandler = (sql: string, params?: any[]) => {
      if (sql.includes("INSERT INTO report_saved_definitions")) {
        return {
          rows: [{
            id: "report-1",
            dataset_id: params?.[1],
            name: params?.[2],
            description: params?.[3],
            query: JSON.parse(String(params?.[4] || "{}")),
            created_at: "2026-04-27T00:00:00.000Z",
            updated_at: "2026-04-27T00:00:00.000Z",
          }],
        };
      }
      if (sql.includes("DELETE FROM report_saved_definitions")) {
        return {
          rows: [{
            id: params?.[0],
            dataset_id: "incidents",
            name: "Open incidents",
            description: "",
            query: { groupBy: ["status"] },
            created_at: "2026-04-27T00:00:00.000Z",
            updated_at: "2026-04-27T00:00:00.000Z",
          }],
        };
      }
      return null;
    };
    const app = await buildApp({ id: "u1", role: "admin" }, pgHandler);

    const saved = await app.inject({
      method: "POST",
      url: "/api/reports/saved",
      payload: { datasetId: "incidents", name: "Open incidents", query: { groupBy: ["status"] } },
    });
    expect(saved.statusCode).toBe(200);
    expect(JSON.parse(saved.body).report).toMatchObject({ id: "report-1", datasetId: "incidents", name: "Open incidents" });

    const deleted = await app.inject({ method: "DELETE", url: "/api/reports/saved/report-1" });
    expect(deleted.statusCode).toBe(200);
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["report.saved", "SavedReport", "report-1"]));
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["report.deleted", "SavedReport", "report-1"]));
  });

  it("forbids users without reporting permission", async () => {
    const app = await buildApp({ id: "u1", role: "unknown" });

    const res = await app.inject({ method: "GET", url: "/api/reports/datasets" });

    expect(res.statusCode).toBe(403);
  });
});
