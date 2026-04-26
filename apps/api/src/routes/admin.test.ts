import { describe, it, expect, vi, beforeEach } from "vitest";
import { adminRoutes } from "./admin";
import Fastify from "fastify";
import jwt from "@fastify/jwt";
import { authPlugin } from "../plugins/jwt";
import { clearPermissionCache } from "../services/rbac";

describe("adminRoutes", () => {
  beforeEach(() => {
    clearPermissionCache();
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
