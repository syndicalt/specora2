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
