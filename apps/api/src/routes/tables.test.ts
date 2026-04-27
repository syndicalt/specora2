import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tableRoutes } from "./tables";
import { clearPermissionCache } from "../services/rbac";
import { clearFieldRestrictionCache } from "../services/fieldRbac";

function makeRecord(values: Record<string, any>) {
  return {
    get: (key: string) => values[key],
  };
}

function makeNode(properties: Record<string, any>) {
  return { properties };
}

function makeNeo4j(recordsByRun: any[][] = []) {
  const run = vi.fn(async () => ({ records: recordsByRun.shift() || [] }));
  return {
    session: vi.fn(() => ({
      run,
      close: vi.fn(async () => {}),
    })),
    run,
  };
}

function makePg(handler?: (sql: string, params?: any[]) => any) {
  const pg = {
    query: vi.fn(async (sql: string, params?: any[]) => {
      const handled = handler?.(sql, params);
      if (handled) return handled;
      if (sql.includes("FROM ci_classes c")) {
        return {
          rows: [
            {
              id: "class-1",
              name: "Location",
              display_name: "Location",
              attributes: [
                {
                  name: "city",
                  displayName: "City",
                  attrType: "string",
                  isMandatory: true,
                  isHealthRequired: true,
                  isKeyAttribute: true,
                },
              ],
            },
          ],
        };
      }
      if (sql.includes("information_schema.columns")) {
        return { rows: [] };
      }
      return { rows: [] };
    }),
    connect: vi.fn(async () => ({
      query: vi.fn(async (sql: string, params?: any[]) => {
        const handled = handler?.(sql, params);
        return handled || { rows: [] };
      }),
      release: vi.fn(),
    })),
  };
  return pg;
}

async function buildApp(user: any, neo4j = makeNeo4j(), pgHandler?: (sql: string, params?: any[]) => any) {
  const app = Fastify();
  app.decorate("pg", makePg(pgHandler));
  app.decorate("neo4j", neo4j);
  app.decorate("authenticate", async (request: any) => {
    request.user = user;
  });
  await app.register(tableRoutes);
  return { app, neo4j };
}

describe("tableRoutes", () => {
  beforeEach(() => {
    clearPermissionCache();
    clearFieldRestrictionCache();
  });

  it("lists CI-class backed tables for admins", async () => {
    const { app } = await buildApp({ id: "u1", role: "admin" });

    const res = await app.inject({ method: "GET", url: "/api/tables" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.tables[0]).toMatchObject({ id: "cmdb.Location", provider: "cmdb-class", category: "foundation" });
  });

  it("returns table records with total count", async () => {
    const neo4j = makeNeo4j([
      [makeRecord({ n: makeNode({ id: "loc-1", name: "HQ", class: "Location", attributes: "{\"city\":\"Austin\"}" }) })],
      [makeRecord({ total: { toNumber: () => 1 } })],
    ]);
    const { app } = await buildApp({ id: "u1", role: "admin" }, neo4j);

    const res = await app.inject({ method: "GET", url: "/api/tables/cmdb.Location/records?q=H" });

    expect(res.statusCode).toBe(200);
    const [, params] = neo4j.run.mock.calls[0];
    expect(params.limit.toNumber()).toBe(50);
    expect(params.offset.toNumber()).toBe(0);
    const body = JSON.parse(res.body);
    expect(body.records[0].attributes.city).toBe("Austin");
    expect(body.total).toBe(1);
  });

  it("applies structured filters using whitelisted table fields", async () => {
    const neo4j = makeNeo4j([
      [makeRecord({ n: makeNode({ id: "loc-1", name: "HQ", class: "Location", city: "Austin", attributes: "{\"city\":\"Austin\"}" }) })],
      [makeRecord({ total: { toNumber: () => 1 } })],
    ]);
    const { app } = await buildApp({ id: "u1", role: "admin" }, neo4j);
    const filters = encodeURIComponent(JSON.stringify([{ field: "city", operator: "equals", value: "Austin" }]));

    const res = await app.inject({ method: "GET", url: `/api/tables/cmdb.Location/records?filters=${filters}` });

    expect(res.statusCode).toBe(200);
    const [cypher, params] = neo4j.run.mock.calls[0];
    expect(cypher).toContain("n.`city` = $filter_0");
    expect(params.filter_0).toBe("Austin");
  });

  it("applies relationship-aware filters to CMDB tables", async () => {
    const neo4j = makeNeo4j([
      [makeRecord({ n: makeNode({ id: "loc-1", name: "HQ", class: "Location", attributes: "{\"city\":\"Austin\"}" }) })],
      [makeRecord({ total: { toNumber: () => 1 } })],
    ]);
    const { app } = await buildApp({ id: "u1", role: "admin" }, neo4j);
    const filters = encodeURIComponent(JSON.stringify([
      { field: "__relationshipState", operator: "equals", value: "orphaned" },
      { field: "__relationshipType", operator: "equals", value: "LOCATED_AT" },
      { field: "__relatedCiId", operator: "equals", value: "ci-1" },
    ]));

    const res = await app.inject({ method: "GET", url: `/api/tables/cmdb.Location/records?filters=${filters}` });

    expect(res.statusCode).toBe(200);
    const [cypher, params] = neo4j.run.mock.calls[0];
    expect(cypher).toContain("NOT EXISTS { MATCH (n)-[:PART_OF|DEPENDS_ON|HOSTED_ON|MANAGED_BY|OWNED_BY|LOCATED_AT]-() }");
    expect(cypher).toContain("type(r) = $relationship_filter_1");
    expect(cypher).toContain("related:ConfigurationItem {id: $relationship_filter_2}");
    expect(params.relationship_filter_1).toBe("LOCATED_AT");
    expect(params.relationship_filter_2).toBe("ci-1");
  });

  it("returns authoritative table validation issues", async () => {
    const neo4j = makeNeo4j([
      [makeRecord({
        n: makeNode({ id: "loc-1", name: "HQ", class: "Location", attributes: "{}" }),
        relationshipCount: { toNumber: () => 0 },
      })],
    ]);
    const { app } = await buildApp({ id: "u1", role: "admin" }, neo4j);

    const res = await app.inject({ method: "GET", url: "/api/tables/cmdb.Location/records/loc-1/validation" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.summary).toMatchObject({ issueCount: 2, errors: 1, warnings: 1, relationshipCount: 0 });
    expect(body.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "city", severity: "error", reason: "missing_required" }),
      expect.objectContaining({ field: "relationships", severity: "warn", reason: "missing_relationship" }),
    ]));
  });

  it("saves and deletes table stewardship views", async () => {
    const pgHandler = (sql: string, params?: any[]) => {
      if (sql.includes("INSERT INTO table_saved_views")) {
        return {
          rows: [{
            id: "view-1",
            user_id: params?.[0],
            table_id: params?.[1],
            name: params?.[2],
            search_query: params?.[3],
            filters: JSON.parse(String(params?.[4] || "[]")),
            columns: JSON.parse(String(params?.[5] || "[]")),
            density: params?.[6],
            sort_field: params?.[7],
            sort_direction: params?.[8],
            created_at: "2026-04-27T00:00:00.000Z",
            updated_at: "2026-04-27T00:00:00.000Z",
          }],
        };
      }
      if (sql.includes("DELETE FROM table_saved_views")) {
        return {
          rows: [{
            id: params?.[0],
            table_id: "cmdb.Location",
            name: "Locations",
            search_query: "HQ",
            filters: [],
            columns: ["name", "city"],
            density: "compact",
            sort_field: "city",
            sort_direction: "desc",
            created_at: "2026-04-27T00:00:00.000Z",
            updated_at: "2026-04-27T00:00:00.000Z",
          }],
        };
      }
      if (sql.includes("FROM table_saved_views")) {
        return { rows: [], rowCount: 0 };
      }
      return null;
    };
    const { app } = await buildApp({ id: "u1", role: "admin" }, makeNeo4j(), pgHandler);

    const saved = await app.inject({
      method: "POST",
      url: "/api/tables/views",
      payload: {
        tableId: "cmdb.Location",
        name: "Locations",
        searchQuery: "HQ",
        filters: [{ field: "city", operator: "equals", value: "Austin" }],
        columns: ["name", "city", "not_a_field"],
        density: "compact",
        sortField: "city",
        sortDirection: "desc",
      },
    });
    expect(saved.statusCode).toBe(200);
    const body = JSON.parse(saved.body);
    expect(body.view).toMatchObject({ tableId: "cmdb.Location", name: "Locations", columns: ["name", "city"], sortField: "city", sortDirection: "desc" });
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["table.view.saved", "TableSavedView", "view-1"]));

    const deleted = await app.inject({ method: "DELETE", url: "/api/tables/views/view-1" });
    expect(deleted.statusCode).toBe(200);
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["table.view.deleted", "TableSavedView", "view-1"]));
  });

  it("sorts table records through whitelisted readable fields", async () => {
    const neo4j = makeNeo4j([
      [makeRecord({ n: makeNode({ id: "loc-1", name: "HQ", class: "Location", city: "Austin", attributes: "{\"city\":\"Austin\"}" }) })],
      [makeRecord({ total: { toNumber: () => 1 } })],
    ]);
    const { app } = await buildApp({ id: "u1", role: "admin" }, neo4j);

    const res = await app.inject({ method: "GET", url: "/api/tables/cmdb.Location/records?sortField=city&sortDirection=desc" });

    expect(res.statusCode).toBe(200);
    const [cypher] = neo4j.run.mock.calls[0];
    expect(cypher).toContain("ORDER BY n.`city` DESC");
  });

  it("returns table record audit history", async () => {
    const pgHandler = (sql: string, params?: any[]) => {
      if (sql.includes("FROM audit_log")) {
        return {
          rows: [{
            id: "audit-1",
            actor_id: "00000000-0000-4000-8000-000000000001",
            action: "table.record.updated",
            entity_type: params?.[0],
            entity_id: params?.[1],
            old_values: { name: "Old" },
            new_values: { name: "New" },
            metadata: { source: "api.tables" },
            previous_hash: "prev",
            entry_hash: "hash",
            integrity_version: 1,
            created_at: "2026-04-27T00:00:00.000Z",
          }],
        };
      }
      return null;
    };
    const { app } = await buildApp({ id: "u1", role: "admin" }, makeNeo4j(), pgHandler);

    const res = await app.inject({ method: "GET", url: "/api/tables/cmdb.Location/records/loc-1/audit" });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).entries[0]).toMatchObject({ action: "table.record.updated", entryHash: "hash", createdAt: "2026-04-27T00:00:00.000Z" });
  });

  it("exports selected table records as audited CSV", async () => {
    const neo4j = makeNeo4j([
      [makeRecord({ n: makeNode({ id: "loc-1", name: "HQ", class: "Location", environment: "Production", attributes: "{\"city\":\"Austin\"}" }) })],
    ]);
    const { app } = await buildApp({ id: "u1", role: "admin" }, neo4j);

    const res = await app.inject({
      method: "POST",
      url: "/api/tables/cmdb.Location/export",
      payload: { recordIds: ["loc-1"], columns: ["name", "city", "environment"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.body).toContain("name,city,environment");
    expect(res.body).toContain("HQ,Austin,Production");
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["table.records.exported", "cmdb.Location", "cmdb.Location"]));
  });

  it("queues selected records for cleanup review", async () => {
    const neo4j = makeNeo4j([
      [makeRecord({ n: makeNode({ id: "loc-1", name: "HQ", class: "Location", attributes: "{\"city\":\"Austin\"}" }) })],
    ]);
    const pgHandler = (sql: string, params?: any[]) => {
      if (sql.includes("INSERT INTO table_cleanup_reviews")) {
        return {
          rows: [{
            id: "review-1",
            table_id: params?.[0],
            record_id: params?.[1],
            record_label: params?.[2],
            reason: params?.[3],
            severity: params?.[4],
            status: "open",
            requested_by: params?.[5],
            created_at: "2026-04-27T00:00:00.000Z",
            updated_at: "2026-04-27T00:00:00.000Z",
          }],
        };
      }
      return null;
    };
    const { app } = await buildApp({ id: "550e8400-e29b-41d4-a716-446655440001", role: "admin" }, neo4j, pgHandler);

    const res = await app.inject({
      method: "POST",
      url: "/api/tables/cmdb.Location/cleanup-reviews",
      payload: { recordIds: ["loc-1"], reason: "Missing stewardship evidence", severity: "high" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).reviews[0]).toMatchObject({
      tableId: "cmdb.Location",
      recordId: "loc-1",
      recordLabel: "HQ",
      reason: "Missing stewardship evidence",
      severity: "high",
      status: "open",
      createdAt: "2026-04-27T00:00:00.000Z",
    });
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["table.cleanup_review.queued", "TableCleanupReview", "cmdb.Location"]));
  });

  it("lists and transitions cleanup reviews", async () => {
    const pgHandler = (sql: string, params?: any[]) => {
      if (sql.includes("FROM table_cleanup_reviews r") && sql.includes("COUNT")) {
        return { rows: [{ total: 1 }], rowCount: 1 };
      }
      if (sql.includes("FROM table_cleanup_reviews r")) {
        return {
          rows: [{
            id: "review-1",
            table_id: "cmdb.Location",
            record_id: "loc-1",
            record_label: "HQ",
            reason: "Missing evidence",
            severity: "high",
            status: "open",
            requested_by: null,
            requester_name: null,
            requester_email: null,
            created_at: "2026-04-27T00:00:00.000Z",
            updated_at: "2026-04-27T00:00:00.000Z",
          }],
        };
      }
      if (sql.includes("FROM table_cleanup_reviews") && sql.includes("WHERE id = $1")) {
        return {
          rows: [{
            id: params?.[0],
            table_id: "cmdb.Location",
            record_id: "loc-1",
            record_label: "HQ",
            reason: "Missing evidence",
            severity: "high",
            status: "open",
            requested_by: null,
            created_at: "2026-04-27T00:00:00.000Z",
            updated_at: "2026-04-27T00:00:00.000Z",
          }],
        };
      }
      if (sql.includes("UPDATE table_cleanup_reviews")) {
        return {
          rows: [{
            id: params?.[0],
            table_id: "cmdb.Location",
            record_id: "loc-1",
            record_label: "HQ",
            reason: "Missing evidence",
            severity: "high",
            status: params?.[1],
            requested_by: null,
            created_at: "2026-04-27T00:00:00.000Z",
            updated_at: "2026-04-27T01:00:00.000Z",
          }],
        };
      }
      return null;
    };
    const { app } = await buildApp({ id: "u1", role: "admin" }, makeNeo4j(), pgHandler);

    const listed = await app.inject({ method: "GET", url: "/api/tables/cleanup-reviews?status=open" });
    expect(listed.statusCode).toBe(200);
    expect(JSON.parse(listed.body).reviews[0]).toMatchObject({ id: "review-1", tableId: "cmdb.Location", tableLabel: "Location", status: "open" });

    const updated = await app.inject({ method: "PATCH", url: "/api/tables/cleanup-reviews/review-1", payload: { status: "resolved" } });
    expect(updated.statusCode).toBe(200);
    expect(JSON.parse(updated.body).review).toMatchObject({ id: "review-1", status: "resolved" });
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["table.cleanup_review.status_updated", "TableCleanupReview", "review-1"]));
  });

  it("creates, updates, reads, and deletes a table record", async () => {
    const neo4j = makeNeo4j([
      [makeRecord({ n: makeNode({ id: "loc-2", name: "Remote", class: "Location", attributes: "{\"city\":\"Denver\"}" }) })],
      [makeRecord({ n: makeNode({ id: "loc-2", name: "Remote", class: "Location", attributes: "{\"city\":\"Denver\"}" }) })],
      [makeRecord({ n: makeNode({ id: "loc-2", name: "Remote 2", class: "Location", attributes: "{\"city\":\"Boulder\"}" }) })],
      [makeRecord({ n: makeNode({ id: "loc-2", name: "Remote 2", class: "Location", attributes: "{\"city\":\"Boulder\"}" }) })],
      [],
    ]);
    const { app } = await buildApp({ id: "u1", role: "admin" }, neo4j);

    const created = await app.inject({
      method: "POST",
      url: "/api/tables/cmdb.Location/records",
      payload: { id: "loc-2", name: "Remote", attributes: { city: "Denver" } },
    });
    expect(created.statusCode).toBe(201);

    const updated = await app.inject({
      method: "PATCH",
      url: "/api/tables/cmdb.Location/records/loc-2",
      payload: { name: "Remote 2", attributes: { city: "Boulder" } },
    });
    expect(updated.statusCode).toBe(200);

    const read = await app.inject({ method: "GET", url: "/api/tables/cmdb.Location/records/loc-2" });
    expect(JSON.parse(read.body).record.name).toBe("Remote 2");

    const deleted = await app.inject({ method: "DELETE", url: "/api/tables/cmdb.Location/records/loc-2" });
    expect(deleted.statusCode).toBe(200);
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["table.record.created", "cmdb.Location", "loc-2"]));
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["table.record.updated", "cmdb.Location", "loc-2"]));
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["table.record.deleted", "cmdb.Location", "loc-2"]));
  });

  it("forbids users without table read permission", async () => {
    const { app } = await buildApp({ id: "u1", role: "unknown" });

    const res = await app.inject({ method: "GET", url: "/api/tables" });

    expect(res.statusCode).toBe(403);
  });

  it("redacts restricted fields unless the role has a field read grant", async () => {
    const neo4j = makeNeo4j([
      [makeRecord({ n: makeNode({ id: "loc-1", name: "HQ", class: "Location", city: "Austin", attributes: "{\"city\":\"Austin\"}" }) })],
      [makeRecord({ total: { toNumber: () => 1 } })],
    ]);
    const pgHandler = (sql: string, params?: any[]) => {
      if (sql.includes("FROM app_permissions")) {
        const resource = params?.[1];
        const action = params?.[2];
        const allowed = resource === "tables" && action === "read";
        return { rows: allowed ? [{ ok: 1 }] : [] };
      }
      if (sql.includes("security.field_restrictions")) {
        return { rows: [{ value: JSON.stringify(["field:cmdb.Location.city"]) }] };
      }
      return null;
    };
    const { app } = await buildApp({ id: "u1", role: "analyst" }, neo4j, pgHandler);

    const res = await app.inject({ method: "GET", url: "/api/tables/cmdb.Location/records" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.table.attributes[0]).toMatchObject({ name: "city", canRead: false, canWrite: false, isRestricted: true });
    expect(body.records[0].attributes.city).toBeNull();
    expect(body.records[0]._redactedFields).toContain("city");
  });

  it("rejects writes to restricted fields without a field write grant", async () => {
    const pgHandler = (sql: string, params?: any[]) => {
      if (sql.includes("FROM app_permissions")) {
        const resource = params?.[1];
        const action = params?.[2];
        const allowed = resource === "tables" && (action === "read" || action === "write");
        return { rows: allowed ? [{ ok: 1 }] : [] };
      }
      if (sql.includes("security.field_restrictions")) {
        return { rows: [{ value: JSON.stringify(["field:cmdb.Location.city"]) }] };
      }
      return null;
    };
    const { app } = await buildApp({ id: "u1", role: "analyst" }, makeNeo4j(), pgHandler);

    const res = await app.inject({
      method: "PATCH",
      url: "/api/tables/cmdb.Location/records/loc-1",
      payload: { attributes: { city: "Austin" } },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toContain("cannot write city");
  });

  it("registers and CRUDs allowlisted Postgres operational tables", async () => {
    const pgHandler = (sql: string, params?: any[]) => {
      if (sql.includes("information_schema.columns")) {
        return {
          rows: [
            { table_name: "incidents", column_name: "id", data_type: "uuid", is_nullable: "NO", column_default: "gen_random_uuid()" },
            { table_name: "incidents", column_name: "title", data_type: "character varying", is_nullable: "NO", column_default: null },
            { table_name: "incidents", column_name: "status", data_type: "character varying", is_nullable: "NO", column_default: "'new'::character varying" },
            { table_name: "incidents", column_name: "severity", data_type: "character varying", is_nullable: "NO", column_default: "'medium'::character varying" },
            { table_name: "incidents", column_name: "priority", data_type: "integer", is_nullable: "NO", column_default: "3" },
            { table_name: "incidents", column_name: "created_at", data_type: "timestamp with time zone", is_nullable: "NO", column_default: "now()" },
            { table_name: "incidents", column_name: "updated_at", data_type: "timestamp with time zone", is_nullable: "NO", column_default: "now()" },
          ],
        };
      }
      if (sql.startsWith("SELECT * FROM \"incidents\"")) {
        return { rows: [{ id: "inc-1", title: "Checkout latency", status: "new", severity: "high", priority: 1 }] };
      }
      if (sql.startsWith("SELECT COUNT(*)::int AS total FROM \"incidents\"")) {
        return { rows: [{ total: 1 }] };
      }
      if (sql.startsWith("INSERT INTO \"incidents\"")) {
        return { rows: [{ id: "inc-2", title: params?.[0], status: params?.[1], severity: params?.[2], priority: params?.[3] }] };
      }
      if (sql.startsWith("UPDATE \"incidents\"")) {
        return { rows: [{ id: "inc-1", title: params?.[0], status: params?.[1], severity: "high", priority: 1 }] };
      }
      if (sql.startsWith("DELETE FROM \"incidents\"")) {
        return { rows: [] };
      }
      return null;
    };
    const { app } = await buildApp({ id: "u1", role: "admin" }, makeNeo4j(), pgHandler);

    const tables = await app.inject({ method: "GET", url: "/api/tables" });
    expect(JSON.parse(tables.body).tables).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "pg.incidents", provider: "postgres-table", label: "Incidents" }),
    ]));

    const listed = await app.inject({ method: "GET", url: "/api/tables/pg.incidents/records?q=checkout" });
    expect(JSON.parse(listed.body).records[0]).toMatchObject({ id: "inc-1", name: "Checkout latency", attributes: { status: "new" } });

    const created = await app.inject({
      method: "POST",
      url: "/api/tables/pg.incidents/records",
      payload: { name: "New incident", attributes: { status: "new", severity: "medium", priority: 3 } },
    });
    expect(created.statusCode).toBe(201);

    const updated = await app.inject({
      method: "PATCH",
      url: "/api/tables/pg.incidents/records/inc-1",
      payload: { name: "Updated incident", attributes: { status: "triaging" } },
    });
    expect(JSON.parse(updated.body).record).toMatchObject({ name: "Updated incident", attributes: { status: "triaging" } });

    const deleted = await app.inject({ method: "DELETE", url: "/api/tables/pg.incidents/records/inc-1" });
    expect(deleted.statusCode).toBe(200);
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["table.record.created", "pg.incidents", "inc-2"]));
  });
});
