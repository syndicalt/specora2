import { describe, it, expect, vi, beforeEach } from "vitest";
import { adminRoutes } from "./admin";
import Fastify from "fastify";
import jwt from "@fastify/jwt";
import { authPlugin } from "../plugins/jwt";
import { clearPermissionCache } from "../services/rbac";
import { clearFieldRestrictionCache } from "../services/fieldRbac";

vi.mock("../services/appTools", async () => {
  const actual = await vi.importActual<typeof import("../services/appTools")>("../services/appTools");
  return {
    ...actual,
    getAllAppToolDefinitions: vi.fn(() => [
      { name: "incident-manager_get_incident_details", description: "Get incident details", parameters: { type: "object", properties: {} } },
      { name: "incident-manager_create_incident", description: "Create incident", parameters: { type: "object", properties: {} } },
      { name: "health-monitor_apply_remediation", description: "Apply remediation", parameters: { type: "object", properties: {} } },
    ]),
  };
});

describe("adminRoutes", () => {
  beforeEach(() => {
    clearPermissionCache();
    clearFieldRestrictionCache();
  });

  async function buildApp(queryImpl?: (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number }>) {
    const app = Fastify();
    await app.register(jwt, { secret: "test-secret" });
    app.decorate("pg", {
      query: queryImpl ? vi.fn(queryImpl) : vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    });
    await app.register(authPlugin);
    await app.register(adminRoutes);
    return app;
  }

  function authHeader(app: Fastify.FastifyInstance, role: string = "security_admin") {
    const token = app.jwt.sign({ id: "user-1", email: "test@test.com", role });
    return { Authorization: `Bearer ${token}` };
  }

  it("GET /api/admin/permissions returns permissions", async () => {
    const app = await buildApp((sql: string) => {
      if (sql.includes("app_permissions WHERE role = $1")) {
        return Promise.resolve({ rows: [{ _: 1 }], rowCount: 1 });
      }
      if (sql.includes("SELECT id, role, resource, action FROM app_permissions")) {
        return Promise.resolve({ rows: [{ id: "perm-1", role: "viewer", resource: "cmdb", action: "read" }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/permissions",
      headers: authHeader(app),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.permissions).toHaveLength(1);
  });

  it("POST /api/admin/permissions creates a permission", async () => {
    const app = await buildApp((sql: string) => {
      if (sql.includes("app_permissions WHERE role = $1")) {
        return Promise.resolve({ rows: [{ _: 1 }], rowCount: 1 });
      }
      if (sql.includes("INSERT INTO app_permissions")) {
        return Promise.resolve({ rows: [{ id: "perm-1", role: "viewer", resource: "cmdb", action: "write" }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/permissions",
      headers: { ...authHeader(app), "Content-Type": "application/json" },
      payload: { role: "viewer", resource: "cmdb", action: "write" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.permission.role).toBe("viewer");
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["rbac.permission.created", "AppPermission", "perm-1"]));
  });

  it("POST /api/admin/permissions rejects duplicates", async () => {
    const app = await buildApp((sql: string) => {
      if (sql.includes("app_permissions WHERE role = $1")) {
        return Promise.resolve({ rows: [{ _: 1 }], rowCount: 1 });
      }
      if (sql.includes("INSERT INTO app_permissions")) {
        return Promise.reject({ code: "23505" });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/permissions",
      headers: { ...authHeader(app), "Content-Type": "application/json" },
      payload: { role: "viewer", resource: "cmdb", action: "read" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("DELETE /api/admin/permissions/:id deletes a permission", async () => {
    const app = await buildApp((sql: string) => {
      if (sql.includes("app_permissions WHERE role = $1")) {
        return Promise.resolve({ rows: [{ _: 1 }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const res = await app.inject({
      method: "DELETE",
      url: "/api/admin/permissions/perm-1",
      headers: authHeader(app),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).success).toBe(true);
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["rbac.permission.deleted", "AppPermission", "perm-1"]));
  });

  it("GET /api/admin/system-properties returns properties", async () => {
    const app = await buildApp((sql: string) => {
      if (sql.includes("app_permissions WHERE role = $1")) {
        return Promise.resolve({ rows: [{ _: 1 }], rowCount: 1 });
      }
      if (sql.includes("system_properties")) {
        return Promise.resolve({ rows: [{ key: "max_upload_size", value: "10485760", updated_at: "2024-01-01" }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/system-properties",
      headers: authHeader(app),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.properties).toHaveLength(1);
  });

  it("analyzes RBAC access decisions", async () => {
    const app = await buildApp((sql: string, params?: any[]) => {
      if (sql.includes("app_permissions WHERE role = $1 AND resource = $2 AND action = $3")) {
        return Promise.resolve({ rows: [{ id: "admin-rbac", role: "security_admin", resource: "rbac", action: "read" }], rowCount: 1 });
      }
      if (sql.includes("SELECT id, name, email, role FROM users WHERE id = $1")) {
        return Promise.resolve({ rows: [{ id: params?.[0], name: "Olivia Ops", email: "olivia@example.com", role: "operator" }], rowCount: 1 });
      }
      if (sql.includes("SELECT id, role, resource, action FROM app_permissions WHERE role = $1 ORDER BY")) {
        return Promise.resolve({ rows: [{ id: "perm-1", role: "operator", resource: "incident-manager", action: "write" }], rowCount: 1 });
      }
      if (sql.includes("FROM marketplace_apps")) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/rbac/analyze",
      headers: { ...authHeader(app), "Content-Type": "application/json" },
      payload: { userId: "u-ops", resource: "incident-manager", action: "write" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.result.allowed).toBe(true);
    expect(body.result.reason).toBe("direct_role_grant");
    expect(body.result.relatedApps[0].id).toBe("incident-manager");
  });

  it("explains app access requirements and missing grants", async () => {
    const app = await buildApp((sql: string, params?: any[]) => {
      if (sql.includes("app_permissions WHERE role = $1 AND resource = $2 AND action = $3")) {
        return Promise.resolve({ rows: [{ id: "admin-rbac", role: "security_admin", resource: "rbac", action: "read" }], rowCount: 1 });
      }
      if (sql.includes("SELECT id, name, email, role FROM users WHERE id = $1")) {
        return Promise.resolve({ rows: [{ id: params?.[0], name: "Olivia Ops", email: "olivia@example.com", role: "operator" }], rowCount: 1 });
      }
      if (sql.includes("SELECT id, role, resource, action FROM app_permissions WHERE role = $1 ORDER BY")) {
        return Promise.resolve({ rows: [{ id: "perm-1", role: "operator", resource: "incident-manager", action: "read" }], rowCount: 1 });
      }
      if (sql.includes("FROM marketplace_apps")) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/rbac/explain-access",
      headers: { ...authHeader(app), "Content-Type": "application/json" },
      payload: { userId: "u-ops", appId: "incident-manager" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.result.allowed).toBe(false);
    expect(body.result.app.id).toBe("incident-manager");
    expect(body.result.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ resource: "incident-manager", action: "read", allowed: true }),
      expect.objectContaining({ resource: "incident-manager", action: "write", allowed: false }),
    ]));
    expect(body.result.remediation[0]).toMatchObject({ role: "operator", resource: "incident-manager", action: "write" });
  });

  it("explains app tool access using the tool policy", async () => {
    const app = await buildApp((sql: string, params?: any[]) => {
      if (sql.includes("app_permissions WHERE role = $1 AND resource = $2 AND action = $3")) {
        return Promise.resolve({ rows: [{ id: "admin-rbac", role: "security_admin", resource: "rbac", action: "read" }], rowCount: 1 });
      }
      if (sql.includes("SELECT id, name, email, role FROM users WHERE id = $1")) {
        return Promise.resolve({ rows: [{ id: params?.[0], name: "Olivia Ops", email: "olivia@example.com", role: "operator" }], rowCount: 1 });
      }
      if (sql.includes("SELECT id, role, resource, action FROM app_permissions WHERE role = $1 ORDER BY")) {
        return Promise.resolve({ rows: [{ id: "perm-1", role: "operator", resource: "incident-manager", action: "read" }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/rbac/explain-tool-access",
      headers: { ...authHeader(app), "Content-Type": "application/json" },
      payload: { userId: "u-ops", appId: "incident-manager", toolName: "create_incident" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.result.allowed).toBe(false);
    expect(body.result.tool).toMatchObject({ fullName: "incident-manager_create_incident", resource: "incident-manager", action: "write" });
    expect(body.result.remediation[0]).toMatchObject({ role: "operator", resource: "incident-manager", action: "write" });
  });

  it("explains table and field access using table and field policy", async () => {
    const app = await buildApp((sql: string, params?: any[]) => {
      if (sql.includes("app_permissions WHERE role = $1 AND resource = $2 AND action = $3")) {
        if (params?.[1] === "rbac") {
          return Promise.resolve({ rows: [{ id: "admin-rbac", role: "security_admin", resource: "rbac", action: "read" }], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (sql.includes("SELECT id, name, email, role FROM users WHERE id = $1")) {
        return Promise.resolve({ rows: [{ id: params?.[0], name: "Olivia Ops", email: "olivia@example.com", role: "operator" }], rowCount: 1 });
      }
      if (sql.includes("SELECT id, role, resource, action FROM app_permissions WHERE role = $1 ORDER BY")) {
        return Promise.resolve({ rows: [{ id: "tables-read", role: "operator", resource: "tables", action: "read" }], rowCount: 1 });
      }
      if (sql.includes("FROM ci_classes")) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (sql.includes("information_schema.columns")) {
        return Promise.resolve({
          rows: [
            { table_name: "incidents", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO", column_default: null },
            { table_name: "incidents", column_name: "number", data_type: "text", udt_name: "text", is_nullable: "YES", column_default: null },
            { table_name: "incidents", column_name: "title", data_type: "text", udt_name: "text", is_nullable: "YES", column_default: null },
            { table_name: "incidents", column_name: "description", data_type: "text", udt_name: "text", is_nullable: "YES", column_default: null },
            { table_name: "incidents", column_name: "status", data_type: "text", udt_name: "text", is_nullable: "YES", column_default: null },
          ],
          rowCount: 5,
        });
      }
      if (sql.includes("security.field_restrictions")) {
        return Promise.resolve({ rows: [{ value: JSON.stringify([{ tableId: "pg.incidents", field: "description" }]) }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/rbac/explain-table-access",
      headers: { ...authHeader(app), "Content-Type": "application/json" },
      payload: { userId: "u-ops", tableId: "pg.incidents", fieldName: "description", accessMode: "write" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.result.allowed).toBe(false);
    expect(body.result.table).toMatchObject({ id: "pg.incidents", provider: "postgres-table" });
    expect(body.result.fields[0]).toMatchObject({
      field: "description",
      resource: "field:pg.incidents.description",
      restricted: true,
      read: false,
      write: false,
    });
    expect(body.result.missing).toEqual(expect.arrayContaining([
      expect.objectContaining({ resource: "tables", action: "write" }),
      expect.objectContaining({ resource: "field:pg.incidents.description", action: "read" }),
      expect.objectContaining({ resource: "field:pg.incidents.description", action: "write" }),
    ]));
  });

  it("manages field restrictions through validated table metadata", async () => {
    const app = await buildApp((sql: string, params?: any[]) => {
      if (sql.includes("app_permissions WHERE role = $1 AND resource = $2 AND action = $3")) {
        if (params?.[1] === "rbac") {
          return Promise.resolve({ rows: [{ id: "admin-rbac", role: "security_admin", resource: "rbac", action: params?.[2] }], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (sql.includes("FROM ci_classes")) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (sql.includes("information_schema.columns")) {
        return Promise.resolve({
          rows: [
            { table_name: "incidents", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO", column_default: null },
            { table_name: "incidents", column_name: "title", data_type: "text", udt_name: "text", is_nullable: "YES", column_default: null },
            { table_name: "incidents", column_name: "description", data_type: "text", udt_name: "text", is_nullable: "YES", column_default: null },
          ],
          rowCount: 3,
        });
      }
      if (sql.includes("SELECT value FROM system_properties WHERE key = 'security.field_restrictions'")) {
        return Promise.resolve({ rows: [{ value: JSON.stringify([{ tableId: "pg.incidents", field: "description" }]) }], rowCount: 1 });
      }
      if (sql.includes("INSERT INTO system_properties")) {
        return Promise.resolve({ rows: [{ key: "security.field_restrictions", value: params?.[0], updated_at: "2024-01-01" }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const listed = await app.inject({
      method: "GET",
      url: "/api/admin/rbac/field-restrictions",
      headers: authHeader(app),
    });
    expect(listed.statusCode).toBe(200);
    const body = JSON.parse(listed.payload);
    expect(body.restrictions).toEqual(expect.arrayContaining([
      expect.objectContaining({ resource: "field:pg.incidents.description" }),
    ]));
    expect(body.tables[0].fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "description", restricted: true }),
    ]));

    const updated = await app.inject({
      method: "PUT",
      url: "/api/admin/rbac/field-restrictions",
      headers: { ...authHeader(app), "Content-Type": "application/json" },
      payload: { tableId: "pg.incidents", field: "title", restricted: true },
    });

    expect(updated.statusCode).toBe(200);
    expect(JSON.parse(updated.payload).restriction).toMatchObject({ resource: "field:pg.incidents.title" });
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["rbac.field_restriction.created", "FieldRestriction", "field:pg.incidents.title"]));
  });

  it("manages number sequences", async () => {
    const app = await buildApp((sql: string) => {
      if (sql.includes("app_permissions WHERE role = $1")) {
        return Promise.resolve({ rows: [{ _: 1 }], rowCount: 1 });
      }
      if (sql.includes("SELECT id, app_id, table_name")) {
        return Promise.resolve({ rows: [{ id: "seq-1", app_id: "incident-manager", table_name: "incidents", record_type: "Incident", prefix: "INC", next_value: 10, padding: 6, enabled: true }], rowCount: 1 });
      }
      if (sql.includes("INSERT INTO number_sequences")) {
        return Promise.resolve({ rows: [{ id: "seq-2", app_id: "knowledge-core", table_name: "knowledge_items", record_type: "Knowledge", prefix: "KB", next_value: 1, padding: 6, enabled: true }], rowCount: 1 });
      }
      if (sql.includes("UPDATE number_sequences")) {
        return Promise.resolve({ rows: [{ id: "seq-1", table_name: "incidents", record_type: "Incident", prefix: "INC", next_value: 11, padding: 6, enabled: true }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const listed = await app.inject({ method: "GET", url: "/api/admin/number-sequences", headers: authHeader(app) });
    expect(listed.statusCode).toBe(200);
    expect(JSON.parse(listed.payload).sequences[0].prefix).toBe("INC");

    const options = await app.inject({ method: "GET", url: "/api/admin/number-sequences/options", headers: authHeader(app) });
    expect(options.statusCode).toBe(200);
    expect(JSON.parse(options.payload).options.some((option: any) => option.tableName === "incidents")).toBe(true);

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/number-sequences",
      headers: { ...authHeader(app), "Content-Type": "application/json" },
      payload: { appId: "knowledge-core", tableName: "knowledge_items", recordType: "Knowledge", prefix: "kb" },
    });
    expect(created.statusCode).toBe(200);
    expect(JSON.parse(created.payload).sequence.prefix).toBe("KB");
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["number_sequence.created", "NumberSequence", "seq-2"]));

    const invalid = await app.inject({
      method: "POST",
      url: "/api/admin/number-sequences",
      headers: { ...authHeader(app), "Content-Type": "application/json" },
      payload: { appId: "unknown", tableName: "arbitrary_table", recordType: "Anything", prefix: "ANY" },
    });
    expect(invalid.statusCode).toBe(400);

    const updated = await app.inject({
      method: "PATCH",
      url: "/api/admin/number-sequences/seq-1",
      headers: { ...authHeader(app), "Content-Type": "application/json" },
      payload: { nextValue: 11 },
    });
    expect(updated.statusCode).toBe(200);
    expect(JSON.parse(updated.payload).sequence.next_value).toBe(11);
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["number_sequence.updated", "NumberSequence", "seq-1"]));
  });

  it("POST /api/admin/system-properties creates a property", async () => {
    const app = await buildApp((sql: string) => {
      if (sql.includes("app_permissions WHERE role = $1")) {
        return Promise.resolve({ rows: [{ _: 1 }], rowCount: 1 });
      }
      if (sql.includes("INSERT INTO system_properties")) {
        return Promise.resolve({ rows: [{ key: "new_prop", value: "123", updated_at: "2024-01-01" }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/system-properties",
      headers: { ...authHeader(app), "Content-Type": "application/json" },
      payload: { key: "new_prop", value: "123" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.property.key).toBe("new_prop");
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["system_property.created", "SystemProperty", "new_prop"]));
  });

  it("PUT /api/admin/system-properties/:key updates a property", async () => {
    const app = await buildApp((sql: string) => {
      if (sql.includes("app_permissions WHERE role = $1")) {
        return Promise.resolve({ rows: [{ _: 1 }], rowCount: 1 });
      }
      if (sql.includes("UPDATE system_properties")) {
        return Promise.resolve({ rows: [{ key: "max_upload_size", value: "999", updated_at: "2024-01-01" }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const res = await app.inject({
      method: "PUT",
      url: "/api/admin/system-properties/max_upload_size",
      headers: { ...authHeader(app), "Content-Type": "application/json" },
      payload: { value: "999" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.property.value).toBe("999");
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["system_property.updated", "SystemProperty", "max_upload_size"]));
  });

  it("PUT /api/admin/system-properties/:key returns 404 for missing property", async () => {
    const app = await buildApp((sql: string) => {
      if (sql.includes("app_permissions WHERE role = $1")) {
        return Promise.resolve({ rows: [{ _: 1 }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const res = await app.inject({
      method: "PUT",
      url: "/api/admin/system-properties/missing",
      headers: { ...authHeader(app), "Content-Type": "application/json" },
      payload: { value: "999" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE /api/admin/system-properties/:key deletes a property", async () => {
    const app = await buildApp((sql: string) => {
      if (sql.includes("app_permissions WHERE role = $1")) {
        return Promise.resolve({ rows: [{ _: 1 }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const res = await app.inject({
      method: "DELETE",
      url: "/api/admin/system-properties/max_upload_size",
      headers: authHeader(app),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).success).toBe(true);
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["system_property.deleted", "SystemProperty", "max_upload_size"]));
  });

  it("GET /api/admin/panels returns visible panels", async () => {
    const app = await buildApp((sql: string) => {
      if (sql.includes("app_permissions WHERE role = $1")) {
        return Promise.resolve({ rows: [{ _: 1 }], rowCount: 1 });
      }
      if (sql.includes("marketplace_apps")) {
        return Promise.resolve({ rows: [{ id: "change-manager", admin_panels: JSON.stringify([{ id: "cm-panel", name: "CM", icon: "GitBranch", permissions: ["system-properties:read"] }]) }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/panels",
      headers: authHeader(app),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.panels.some((p: any) => p.id === "rbac")).toBe(true);
    expect(body.panels.some((p: any) => p.id === "change-manager-state-machine")).toBe(true);
  });

  it("GET /api/admin/state-machine/:appId returns config", async () => {
    const app = await buildApp((sql: string) => {
      if (sql.includes("app_permissions WHERE role = $1")) {
        return Promise.resolve({ rows: [{ _: 1 }], rowCount: 1 });
      }
      if (sql.includes("system_properties WHERE key")) {
        return Promise.resolve({ rows: [{ value: JSON.stringify({ states: ["draft"], transitions: [] }) }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/state-machine/change-manager",
      headers: authHeader(app),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.config.states).toContain("draft");
  });

  it("GET /api/admin/state-machine/:appId returns 404 when missing", async () => {
    const app = await buildApp((sql: string) => {
      if (sql.includes("app_permissions WHERE role = $1")) {
        return Promise.resolve({ rows: [{ _: 1 }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/state-machine/change-manager",
      headers: authHeader(app),
    });
    expect(res.statusCode).toBe(404);
  });

  it("PUT /api/admin/state-machine/:appId updates config", async () => {
    const app = await buildApp((sql: string) => {
      if (sql.includes("app_permissions WHERE role = $1")) {
        return Promise.resolve({ rows: [{ _: 1 }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const res = await app.inject({
      method: "PUT",
      url: "/api/admin/state-machine/change-manager",
      headers: { ...authHeader(app), "Content-Type": "application/json" },
      payload: { config: { states: ["draft", "approved"], transitions: [] } },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["system_property.updated", "SystemProperty", "change-manager.state_machine"]));
  });

  it("GET /api/admin/operational-intelligence returns cross-module readiness signals", async () => {
    const app = await buildApp((sql: string) => {
      if (sql.includes("FROM incidents")) {
        return Promise.resolve({ rows: [{ total: 3, open: 2, high_open: 1, ai_pending: 1, avg_ai_confidence: 0.82 }], rowCount: 1 });
      }
      if (sql.includes("FROM change_requests")) {
        return Promise.resolve({ rows: [{ total: 4, pending_approval: 1, high_risk_active: 1, upcoming: 2, pending_without_brief: 1 }], rowCount: 1 });
      }
      if (sql.includes("FROM knowledge_items")) {
        return Promise.resolve({ rows: [{ total: 5, published: 4, stale: 1, avg_health: 0.72, open_gaps: 2 }], rowCount: 1 });
      }
      if (sql.includes("FROM catalog_requests")) {
        return Promise.resolve({ rows: [{ total: 6, open: 3, high_priority: 1, active_handoffs: 1 }], rowCount: 1 });
      }
      if (sql.includes("FROM asset_records")) {
        return Promise.resolve({ rows: [{ total: 7, active: 6, weak_evidence: 1, open_exceptions: 2, entitlement_overage: 0 }], rowCount: 1 });
      }
      if (sql.includes("FROM discovery_pipelines")) {
        return Promise.resolve({ rows: [{ pipelines: 2, published_pipelines: 1, unhealthy_sources: 1, failed_jobs_7d: 1, staged_records: 3 }], rowCount: 1 });
      }
      if (sql.includes("FROM app_permissions")) {
        return Promise.resolve({ rows: [{ permission_grants: 20, active_sequences: 7, audit_events_24h: 11, active_package_jobs: 0 }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/admin/operational-intelligence",
      headers: authHeader(app),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.overall.score).toBeGreaterThan(0);
    expect(body.domains.map((domain: any) => domain.id)).toContain("incidents");
    expect(body.signals.some((signal: any) => signal.appId === "incident-manager")).toBe(true);
    expect(body.governance.permissionGrants).toBe(20);
  });

  it("rejects non-security_admin users", async () => {
    const app = await buildApp((sql: string) => {
      if (sql.includes("app_permissions WHERE role = $1")) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/permissions",
      headers: authHeader(app, "viewer"),
    });
    expect(res.statusCode).toBe(403);
  });
});
