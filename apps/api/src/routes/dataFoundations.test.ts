import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dataFoundationRoutes } from "./dataFoundations";
import { clearPermissionCache } from "../services/rbac";

function makeRecord(values: Record<string, any>) {
  return { get: (key: string) => values[key] };
}

function makeNode(properties: Record<string, any>) {
  return { properties };
}

async function buildApp(user: any, permissionRows: any[] = [{ ok: 1 }]) {
  const app = Fastify();
  app.decorate("pg", {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM app_permissions")) return { rows: permissionRows };
      if (sql.includes("FROM ci_classes c")) {
        return {
          rows: [
            {
              name: "Location",
              display_name: "Location",
              attributes: [
                { name: "city", displayName: "City", isMandatory: true, isHealthRequired: true, isKeyAttribute: true },
              ],
            },
            {
              name: "Group",
              display_name: "Group",
              attributes: [],
            },
          ],
        };
      }
      return { rows: [] };
    }),
  });
  app.decorate("neo4j", {
    session: vi.fn(() => ({
      run: vi.fn(async (_query: string, params: any) => {
        if (_query.includes("SET n += $topLevelProps")) {
          return {
            records: [
              makeRecord({ n: makeNode({ id: params.id, name: "Unknown", class: "Location", city: params.topLevelProps.city, attributes: params.attributes }) }),
            ],
          };
        }
        if (_query.includes("MATCH (n:ConfigurationItem {id: $id})")) {
          return {
            records: [
              makeRecord({ n: makeNode({ id: params.id, name: "Unknown", class: "Location", attributes: "{}" }) }),
            ],
          };
        }
        if (params.className === "Location") {
          return {
            records: [
              makeRecord({ n: makeNode({ id: "loc-1", name: "HQ", class: "Location", city: "Austin", attributes: "{}" }) }),
              makeRecord({ n: makeNode({ id: "loc-2", name: "Unknown", class: "Location", attributes: "{}" }) }),
            ],
          };
        }
        return { records: [] };
      }),
      close: vi.fn(async () => {}),
    })),
  });
  app.decorate("authenticate", async (request: any) => {
    request.user = user;
  });
  await app.register(dataFoundationRoutes);
  return app;
}

describe("dataFoundationRoutes", () => {
  beforeEach(() => {
    clearPermissionCache();
  });

  it("returns foundation summary and completeness", async () => {
    const app = await buildApp({ id: "u1", role: "admin" });

    const res = await app.inject({ method: "GET", url: "/api/data-foundations/summary" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const location = body.tables.find((table: any) => table.className === "Location");
    expect(body.summary.totalTables).toBeGreaterThan(1);
    expect(location.recordCount).toBe(2);
    expect(location.completeness).toBe(0.5);
    expect(location.missingRequiredCount).toBe(1);
  });

  it("forbids users without data foundations read permission", async () => {
    const app = await buildApp({ id: "u1", role: "viewer" }, []);

    const res = await app.inject({ method: "GET", url: "/api/data-foundations/summary" });

    expect(res.statusCode).toBe(403);
  });

  it("returns a stewardship queue with missing required values", async () => {
    const app = await buildApp({ id: "u1", role: "admin" });

    const res = await app.inject({ method: "GET", url: "/api/data-foundations/stewardship" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.summary.openIssues).toBeGreaterThan(0);
    expect(body.issues).toContainEqual(expect.objectContaining({
      action: "edit_record",
      className: "Location",
      recordId: "loc-2",
      field: "city",
      severity: "high",
    }));
  });

  it("returns validation checks for CSDMv5 foundation completeness", async () => {
    const app = await buildApp({ id: "u1", role: "admin" });

    const res = await app.inject({ method: "GET", url: "/api/data-foundations/validation" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.checks).toContainEqual(expect.objectContaining({
      id: "completeness:Location",
      status: "fail",
      affectedCount: 1,
    }));
  });

  it("updates a foundation record through the RBAC-protected stewardship endpoint", async () => {
    const app = await buildApp({ id: "u1", role: "admin" });

    const res = await app.inject({
      method: "PATCH",
      url: "/api/data-foundations/foundation-records/Location/loc-2",
      payload: { fields: { city: "Austin", stewardNote: "Corrected from queue" } },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.record).toMatchObject({ id: "loc-2", city: "Austin" });
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["data_foundations.foundation_record_updated", "Location", "loc-2"]));
  });

  it("rejects foundation updates without write permission", async () => {
    const app = await buildApp({ id: "u1", role: "operator" }, []);

    const res = await app.inject({
      method: "PATCH",
      url: "/api/data-foundations/foundation-records/Location/loc-2",
      payload: { fields: { city: "Austin" } },
    });

    expect(res.statusCode).toBe(403);
  });
});
