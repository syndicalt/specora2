import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildEnterpriseSeedConfig } from "../../../../packages/db/src/enterpriseSeed";
import { clearPermissionCache } from "../services/rbac";
import { reportingRoutes } from "./reporting";

function seededCounts() {
  const config = buildEnterpriseSeedConfig({ ENTERPRISE_SEED_PROFILE: "smoke" });
  return {
    config,
    incidents: {
      new: Math.floor(config.coreRecords / 5),
      investigating: Math.floor(config.coreRecords / 5),
      mitigating: Math.floor(config.coreRecords / 5),
      resolved: Math.floor(config.coreRecords / 5),
      closed: Math.floor(config.coreRecords / 5),
    },
    kpis: {
      atRiskIncidents: 42,
      deflections: config.coreRecords * 12,
      collisions: 8,
      freshKnowledge: 23,
      publishedKnowledge: 25,
      requestBacklog: 75,
      completeCis: 86,
      totalCis: 100,
      auditEvents: config.coreRecords * config.eventsPerRecord,
    },
  };
}

function makeEnterprisePg() {
  const seed = seededCounts();
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("INSERT INTO audit_log")) return { rows: [{ id: "audit-1" }] };
      if (sql.includes("FROM \"incidents\"") && sql.includes("GROUP BY")) {
        return {
          rows: [
            { status: "new", record_count: seed.incidents.new },
            { status: "investigating", record_count: seed.incidents.investigating },
            { status: "mitigating", record_count: seed.incidents.mitigating },
            { status: "resolved", record_count: seed.incidents.resolved },
            { status: "closed", record_count: seed.incidents.closed },
          ],
        };
      }
      if (sql.includes("FROM \"knowledge_items\"") && !sql.includes("GROUP BY")) {
        return {
          rows: [
            {
              id: "d64b4f0a-7d9a-42e4-a3bf-d32ec6bca001",
              number: "KBST00000001",
              title: "Stress knowledge article 1",
              status: "published",
              type: "article",
              service: "Service 1",
              trust_score: "0.82",
              owner_id: "seeded-owner",
              updated_at: "2026-04-27T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM incidents") && sql.includes("total_open")) {
        return { rows: [{ total_open: seed.incidents.new + seed.incidents.investigating + seed.incidents.mitigating, at_risk: seed.kpis.atRiskIncidents }] };
      }
      if (sql.includes("SUM(deflection_count)")) {
        return { rows: [{ deflections: seed.kpis.deflections, incidents: seed.config.coreRecords }] };
      }
      if (sql.includes("FROM change_requests") && sql.includes("collisions")) {
        return { rows: [{ collisions: seed.kpis.collisions, affected_cis: 6, max_ci_change_count: 4 }] };
      }
      if (sql.includes("FROM knowledge_items") && sql.includes("average_trust")) {
        return { rows: [{ published: seed.kpis.publishedKnowledge, fresh: seed.kpis.freshKnowledge, average_trust: 0.78 }] };
      }
      if (sql.includes("FROM catalog_requests") && sql.includes("average_age_days")) {
        return { rows: [{ backlog: seed.kpis.requestBacklog, average_age_days: 6.5, high_priority: 18 }] };
      }
      if (sql.includes("FROM audit_log") && sql.includes("hashed_events")) {
        return { rows: [{ total_events: seed.kpis.auditEvents, hashed_events: seed.kpis.auditEvents, privileged_events: 22, distinct_actors: 14 }] };
      }
      return { rows: [] };
    }),
  };
}

async function buildApp() {
  const app = Fastify();
  app.decorate("pg", makeEnterprisePg());
  app.decorate("neo4j", {
    session: () => ({
      run: vi.fn(async () => ({
        records: [{
          get: (key: string) => {
            const seed = seededCounts();
            if (key === "total") return { toNumber: () => seed.kpis.totalCis };
            if (key === "complete") return { toNumber: () => seed.kpis.completeCis };
            return null;
          },
        }],
      })),
      close: vi.fn(async () => undefined),
    }),
  });
  app.decorate("authenticate", async (request: any) => {
    request.user = { id: "seed-admin", role: "admin" };
  });
  await app.register(reportingRoutes);
  return app;
}

describe("reportingRoutes enterprise seed coverage", () => {
  beforeEach(() => {
    clearPermissionCache();
  });

  it("queries grouped incident reporting over smoke enterprise seed volumes", async () => {
    const app = await buildApp();
    const seed = seededCounts();

    const res = await app.inject({
      method: "GET",
      url: "/api/reports/datasets/incidents/query?groupBy=status&from=2026-04-01T00:00:00.000Z&to=2026-04-30T00:00:00.000Z&limit=1000",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.grouped).toBe(true);
    expect(body.rows.reduce((sum: number, row: any) => sum + row.record_count, 0)).toBe(seed.config.coreRecords);
    expect(body.rows).toContainEqual({ status: "new", record_count: seed.incidents.new });
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["report.queried", "ReportDataset", "incidents"]));
  });

  it("exports a seed-backed knowledge dataset row as signed CSV", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/reports/datasets/knowledge/query?format=csv&from=2026-04-01T00:00:00.000Z&to=2026-04-30T00:00:00.000Z&limit=1",
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-specora-export-digest"]).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body).toContain("KBST00000001");
    expect(res.body).toContain("Stress knowledge article 1");
  });

  it("returns KPI summaries aligned to enterprise seed domains", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/reports/kpis?from=2026-04-01T00:00:00.000Z&to=2026-04-30T00:00:00.000Z",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.kpis.map((kpi: any) => kpi.id).sort()).toEqual([
      "audit_security_posture",
      "change_collision_risk",
      "cmdb_completeness",
      "incident_deflection",
      "knowledge_freshness",
      "request_backlog",
      "sla_risk",
    ]);
    expect(body.kpis).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "incident_deflection", value: 92.3, status: "good" }),
      expect.objectContaining({ id: "knowledge_freshness", value: 92, status: "good" }),
      expect.objectContaining({ id: "cmdb_completeness", value: 86, status: "watch" }),
      expect.objectContaining({ id: "audit_security_posture", value: 100, status: "good" }),
    ]));
  });

  it("publishes BI contracts for every seed-backed reporting dataset", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/api/reports/contracts/warehouse" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.contract.client).toMatchObject({ mode: "warehouse-extract", preferredFormat: "json" });
    expect(body.contract.datasets.map((dataset: any) => dataset.id).sort()).toEqual([
      "assets",
      "audit",
      "changes",
      "discovery",
      "incidents",
      "knowledge",
      "requests",
    ]);
    expect(body.contract.datasets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "incidents", endpoints: expect.objectContaining({ csv: "/api/reports/datasets/incidents/query?format=csv" }) }),
      expect.objectContaining({ id: "knowledge", filters: expect.arrayContaining([expect.objectContaining({ field: "trust_score" })]) }),
    ]));
  });
});
