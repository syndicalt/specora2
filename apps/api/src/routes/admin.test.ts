import { describe, it, expect, vi, beforeEach } from "vitest";
import { adminRoutes } from "./admin";
import Fastify from "fastify";
import jwt from "@fastify/jwt";
import { authPlugin } from "../plugins/jwt";
import { clearPermissionCache } from "../services/rbac";
import { clearFieldRestrictionCache } from "../services/fieldRbac";
import { encryptCredentialSecret } from "../services/credentials";
import { expectedAuditHash } from "../services/auditLog";

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

  it("manages credential references without returning secret values", async () => {
    const app = await buildApp((sql: string) => {
      if (sql.includes("app_permissions WHERE role = $1")) {
        return Promise.resolve({ rows: [{ _: 1 }], rowCount: 1 });
      }
      if (sql.includes("FROM credential_references") && sql.includes("ORDER BY scope")) {
        return Promise.resolve({
          rows: [{
            id: "cred-1",
            ref: "managed://discovery/inventory-api",
            name: "Inventory API",
            provider: "managed",
            status: "active",
            scope: "discovery",
            secret_present: true,
            secret_env_key: null,
            external_ref: null,
            metadata: {},
            created_at: "2026-04-27",
            updated_at: "2026-04-27",
          }],
          rowCount: 1,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/admin/credentials",
      headers: authHeader(app),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.credentials[0]).toMatchObject({ ref: "managed://discovery/inventory-api", secretEnvKey: "", secretPresent: true });
    expect(JSON.stringify(body)).not.toContain("secretValue");
  });

  it("creates and tests credential references", async () => {
    const app = await buildApp((sql: string) => {
      if (sql.includes("app_permissions WHERE role = $1")) {
        return Promise.resolve({ rows: [{ _: 1 }], rowCount: 1 });
      }
      if (sql.includes("INSERT INTO credential_references")) {
        return Promise.resolve({
          rows: [{
            id: "cred-1",
            ref: "managed://discovery/inventory-api",
            name: "Inventory API",
            provider: "managed",
            status: "active",
            scope: "discovery",
            secret_present: true,
            metadata: {},
            created_at: "2026-04-27",
            updated_at: "2026-04-27",
          }],
          rowCount: 1,
        });
      }
      if (sql.includes("SELECT ref FROM credential_references WHERE id = $1")) {
        return Promise.resolve({ rows: [{ ref: "managed://discovery/inventory-api" }], rowCount: 1 });
      }
      if (sql.includes("FROM credential_references") && sql.includes("WHERE ref = $1")) {
        return Promise.resolve({
          rows: [{
            id: "cred-1",
            ref: "managed://discovery/inventory-api",
            name: "Inventory API",
            provider: "managed",
            status: "active",
            scope: "discovery",
            encrypted_secret: encryptCredentialSecret("secret-token"),
            metadata: {},
            created_at: "2026-04-27",
            updated_at: "2026-04-27",
          }],
          rowCount: 1,
        });
      }
      if (sql.includes("UPDATE credential_references")) {
        return Promise.resolve({
          rows: [{
            id: "cred-1",
            ref: "managed://discovery/inventory-api",
            name: "Inventory API",
            provider: "managed",
            status: "active",
            scope: "discovery",
            secret_present: true,
            metadata: {},
            last_status: "ok",
            created_at: "2026-04-27",
            updated_at: "2026-04-27",
          }],
          rowCount: 1,
        });
      }
      if (sql.includes("SELECT entry_hash FROM audit_log") || sql.includes("INSERT INTO audit_log")) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const createRes = await app.inject({
      method: "POST",
      url: "/api/admin/credentials",
      headers: { ...authHeader(app), "Content-Type": "application/json" },
      payload: { name: "Inventory API", provider: "managed", scope: "discovery", secretValue: "secret-token" },
    });
    expect(createRes.statusCode).toBe(200);
    expect(JSON.parse(createRes.payload).credential.ref).toBe("managed://discovery/inventory-api");

    const testRes = await app.inject({
      method: "POST",
      url: "/api/admin/credentials/cred-1/test",
      headers: authHeader(app),
    });
    expect(testRes.statusCode).toBe(200);
    expect(JSON.parse(testRes.payload)).toMatchObject({ ok: true, status: "ok" });
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["credential.reference.tested", "CredentialReference", "cred-1"]));
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

  it("manages multi-provider SSO configs", async () => {
    const ssoRows: any[] = [];
    const app = await buildApp((sql: string, params?: any[]) => {
      if (sql.includes("app_permissions WHERE role = $1")) {
        return Promise.resolve({ rows: [{ _: 1 }], rowCount: 1 });
      }
      if (sql.includes("INSERT INTO sso_configs")) {
        const row = {
          id: "sso-1",
          name: params?.[0],
          provider: params?.[1],
          status: params?.[2],
          email_domains: JSON.parse(params?.[3]),
          idp_entity_id: params?.[4],
          idp_sso_url: params?.[5],
          idp_cert: params?.[6],
          sp_entity_id: params?.[7],
          metadata_url: params?.[8],
          metadata_xml: params?.[9],
          jit_enabled: params?.[10],
          client_id: params?.[11],
          client_secret_ref: params?.[12],
          issuer_url: params?.[13],
          authorization_url: params?.[14],
          token_url: params?.[15],
          userinfo_url: params?.[16],
          scopes: JSON.parse(params?.[17]),
          enforce_sso: params?.[18],
          default_role: params?.[19],
          attribute_mapping: JSON.parse(params?.[20]),
          created_at: "2026-01-01",
          updated_at: "2026-01-01",
        };
        ssoRows.push(row);
        return Promise.resolve({ rows: [row], rowCount: 1 });
      }
      if (sql.includes("FROM sso_configs") && sql.includes("ORDER BY status")) {
        return Promise.resolve({ rows: ssoRows, rowCount: ssoRows.length });
      }
      if (sql.includes("UPDATE sso_configs")) {
        const row = { ...ssoRows[0], status: "active", enforce_sso: true };
        ssoRows[0] = row;
        return Promise.resolve({ rows: [row], rowCount: 1 });
      }
      if (sql.includes("FROM sso_configs WHERE id = $1")) {
        return Promise.resolve({ rows: ssoRows[0] ? [ssoRows[0]] : [], rowCount: ssoRows[0] ? 1 : 0 });
      }
      if (sql.includes("SELECT entry_hash FROM audit_log")) return Promise.resolve({ rows: [], rowCount: 0 });
      if (sql.includes("INSERT INTO audit_log")) return Promise.resolve({ rows: [], rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/identity/sso-configs",
      headers: { ...authHeader(app), "Content-Type": "application/json" },
      payload: {
        name: "Okta Workforce",
        provider: "oidc",
        status: "inactive",
        emailDomains: ["example.com"],
        issuerUrl: "https://okta.example/oauth2/default",
        authorizationUrl: "https://okta.example/oauth2/v1/authorize",
        tokenUrl: "https://okta.example/oauth2/v1/token",
        userinfoUrl: "https://okta.example/oauth2/v1/userinfo",
        clientId: "client-1",
        clientSecretRef: "env:OKTA_CLIENT_SECRET",
        scopes: ["openid", "email", "profile"],
        enforceSso: false,
      },
    });
    expect(created.statusCode).toBe(200);
    expect(JSON.parse(created.payload).config.provider).toBe("oidc");
    expect(JSON.parse(created.payload).config.spAcsUrl).toContain("/api/auth/sso/sso-1/acs");

    const listed = await app.inject({ method: "GET", url: "/api/admin/identity/sso-configs", headers: authHeader(app) });
    expect(listed.statusCode).toBe(200);
    expect(JSON.parse(listed.payload).configs[0].emailDomains).toEqual(["example.com"]);

    const updated = await app.inject({
      method: "PATCH",
      url: "/api/admin/identity/sso-configs/sso-1",
      headers: { ...authHeader(app), "Content-Type": "application/json" },
      payload: { status: "active", enforceSso: true },
    });
    expect(updated.statusCode).toBe(200);
    expect(JSON.parse(updated.payload).config.enforceSso).toBe(true);
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["identity.sso_config.created", "SsoConfig", "sso-1"]));
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["identity.sso_config.updated", "SsoConfig", "sso-1"]));
  });

  it("blocks activation of incomplete SSO providers", async () => {
    const app = await buildApp((sql: string) => {
      if (sql.includes("app_permissions WHERE role = $1")) {
        return Promise.resolve({ rows: [{ _: 1 }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/identity/sso-configs",
      headers: { ...authHeader(app), "Content-Type": "application/json" },
      payload: {
        name: "Incomplete Okta",
        provider: "oidc",
        status: "active",
        emailDomains: ["example.com"],
        authorizationUrl: "https://okta.example/oauth2/v1/authorize",
        clientId: "client-1",
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.validation.errors).toEqual(expect.arrayContaining([
      "OIDC issuer URL is required before activation",
      "OIDC token URL is required before activation",
      "OIDC client secret reference is required before activation",
    ]));
  });

  it("rejects invalid SSO providers", async () => {
    const app = await buildApp((sql: string) => {
      if (sql.includes("app_permissions WHERE role = $1")) {
        return Promise.resolve({ rows: [{ _: 1 }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/identity/sso-configs",
      headers: { ...authHeader(app), "Content-Type": "application/json" },
      payload: { name: "Bad", provider: "ldap", emailDomains: ["example.com"] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("creates identity groups, memberships, and inherited grants", async () => {
    const app = await buildApp((sql: string, params?: any[]) => {
      if (sql.includes("app_permissions WHERE role = $1")) {
        return Promise.resolve({ rows: [{ _: 1 }], rowCount: 1 });
      }
      if (sql.includes("INSERT INTO identity_groups")) {
        return Promise.resolve({ rows: [{ id: "group-1", name: params?.[0], slug: params?.[1], description: params?.[2], source: params?.[3], external_id: params?.[4], cmdb_ci_id: params?.[5] }], rowCount: 1 });
      }
      if (sql.includes("INSERT INTO identity_group_memberships")) {
        return Promise.resolve({ rows: [{ id: "member-1", group_id: params?.[0], user_id: params?.[1], source: params?.[2] }], rowCount: 1 });
      }
      if (sql.includes("INSERT INTO identity_group_permissions")) {
        return Promise.resolve({ rows: [{ id: "grant-1", group_id: params?.[0], resource: params?.[1], action: params?.[2] }], rowCount: 1 });
      }
      if (sql.includes("SELECT id, name, slug, description, source, external_id, cmdb_ci_id FROM identity_groups WHERE id = $1")) {
        return Promise.resolve({ rows: [{ id: "group-1", name: "Network Operations", slug: "network-operations", description: null, source: "local", external_id: null, cmdb_ci_id: "grp-network-ops" }], rowCount: 1 });
      }
      if (sql.includes("membership_count")) {
        return Promise.resolve({ rows: [{ membership_count: 1, permission_count: 1 }], rowCount: 1 });
      }
      if (sql.includes("DELETE FROM identity_groups")) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      if (sql.includes("SELECT entry_hash FROM audit_log")) return Promise.resolve({ rows: [], rowCount: 0 });
      if (sql.includes("INSERT INTO audit_log")) return Promise.resolve({ rows: [], rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const group = await app.inject({
      method: "POST",
      url: "/api/admin/identity/groups",
      headers: { ...authHeader(app), "Content-Type": "application/json" },
      payload: { name: "Network Operations", cmdbCiId: "grp-network-ops" },
    });
    expect(group.statusCode).toBe(200);
    expect(JSON.parse(group.payload).group.slug).toBe("network-operations");

    const member = await app.inject({
      method: "POST",
      url: "/api/admin/identity/groups/group-1/members",
      headers: { ...authHeader(app), "Content-Type": "application/json" },
      payload: { userId: "550e8400-e29b-41d4-a716-446655440001" },
    });
    expect(member.statusCode).toBe(200);

    const grant = await app.inject({
      method: "POST",
      url: "/api/admin/identity/groups/group-1/permissions",
      headers: { ...authHeader(app), "Content-Type": "application/json" },
      payload: { resource: "discovery", action: "write" },
    });
    expect(grant.statusCode).toBe(200);

    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/admin/identity/groups/group-1",
      headers: authHeader(app),
    });
    expect(deleted.statusCode).toBe(200);
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["identity_group.permission_granted", "IdentityGroup", "group-1"]));
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["identity_group.deleted", "IdentityGroup", "group-1"]));
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

  it("reports RBAC policy drift across registered app requirements", async () => {
    const app = await buildApp((sql: string) => {
      if (sql.includes("SELECT id, role, resource, action FROM app_permissions ORDER BY role")) {
        return Promise.resolve({
          rows: [
            { id: "perm-1", role: "operator", resource: "incident-manager", action: "read" },
            { id: "perm-2", role: "operator", resource: "legacy-app", action: "write" },
          ],
          rowCount: 2,
        });
      }
      if (sql.includes("FROM marketplace_apps")) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/admin/rbac/policy-drift",
      headers: authHeader(app),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.summary.registeredTargets).toBeGreaterThan(0);
    expect(body.summary.orphaned).toBe(1);
    expect(body.orphaned[0]).toMatchObject({ role: "operator", resource: "legacy-app", action: "write" });
    expect(body.roleCoverage[0].missing.length).toBeGreaterThan(0);
  });

  it("bulk grants permissions with dedupe and audit", async () => {
    const app = await buildApp((sql: string, params?: any[]) => {
      if (sql.includes("INSERT INTO app_permissions")) {
        if (params?.[1] === "incident-manager" && params?.[2] === "read") {
          return Promise.resolve({ rows: [{ id: "perm-1", role: params?.[0], resource: params?.[1], action: params?.[2] }], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/rbac/bulk-permissions",
      headers: { ...authHeader(app), "Content-Type": "application/json" },
      payload: {
        role: "operator",
        grants: [
          { resource: "incident-manager", action: "read" },
          { resource: "incident-manager", action: "read" },
          { resource: "incident-manager", action: "write" },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.created).toHaveLength(1);
    expect(body.skipped).toEqual([expect.objectContaining({ resource: "incident-manager", action: "write", reason: "already_granted" })]);
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["rbac.permission.bulk_created", "AppPermission", "operator"]));
  });

  it("searches and exports audit events", async () => {
    const app = await buildApp((sql: string) => {
      if (sql.includes("FROM audit_log a") && sql.includes("COUNT")) {
        return Promise.resolve({ rows: [{ total: 1 }], rowCount: 1 });
      }
      if (sql.includes("FROM audit_log a")) {
        return Promise.resolve({
          rows: [{
            id: "audit-1",
            actor_id: "00000000-0000-4000-8000-000000000001",
            actor_email: "admin@example.com",
            actor_name: "Admin",
            action: "rbac.permission.created",
            entity_type: "AppPermission",
            entity_id: "perm-1",
            old_values: null,
            new_values: { role: "operator" },
            metadata: { source: "api.admin" },
            previous_hash: null,
            entry_hash: "abc123",
            integrity_version: 1,
            created_at: "2026-04-26T12:00:00.000Z",
          }],
          rowCount: 1,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const listed = await app.inject({
      method: "GET",
      url: "/api/admin/audit-log?q=rbac&limit=25",
      headers: authHeader(app),
    });
    expect(listed.statusCode).toBe(200);
    expect(JSON.parse(listed.payload).entries[0]).toMatchObject({
      action: "rbac.permission.created",
      actorEmail: "admin@example.com",
      createdAt: "2026-04-26T12:00:00.000Z",
    });

    const exported = await app.inject({
      method: "GET",
      url: "/api/admin/audit-log?q=rbac&format=csv",
      headers: authHeader(app),
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers["content-type"]).toContain("text/csv");
    expect(exported.headers["x-specora-export-digest"]).toMatch(/^[a-f0-9]{64}$/);
    expect(exported.headers["x-specora-export-signature"]).toMatch(/^[a-f0-9]{64}$/);
    expect(exported.payload).toContain("rbac.permission.created");
  });

  it("verifies audit log integrity from admin route", async () => {
    const app = await buildApp((sql: string) => {
      if (sql.includes("FROM audit_log") && sql.includes("ORDER BY created_at ASC")) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/admin/audit-log/integrity",
      headers: authHeader(app),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toMatchObject({ verified: true, checked: 0 });
  });

  it("creates and lists audit head anchors", async () => {
    const auditRow = {
      id: "audit-1",
      actor_id: null,
      action: "rbac.permission.created",
      entity_type: "AppPermission",
      entity_id: "perm-1",
      old_values: null,
      new_values: { role: "operator" },
      metadata: { result: "success" },
      previous_hash: null,
      entry_hash: "",
      created_at: "2026-04-26T12:00:00.000Z",
    };
    auditRow.entry_hash = expectedAuditHash(auditRow);
    const anchors: any[] = [];
    const app = await buildApp((sql: string, params?: any[]) => {
      if (sql.includes("FROM audit_log") && sql.includes("ORDER BY created_at ASC")) {
        return Promise.resolve({ rows: [auditRow], rowCount: 1 });
      }
      if (sql.includes("INSERT INTO audit_head_anchors")) {
        const row = {
          id: "anchor-1",
          head_hash: params?.[0],
          checked_rows: params?.[1],
          legacy_rows: params?.[2],
          provider: params?.[3],
          external_ref: params?.[4],
          payload: JSON.parse(params?.[5]),
          payload_digest: params?.[6],
          created_by: params?.[7],
          created_at: "2026-04-27T00:00:00.000Z",
        };
        anchors.push(row);
        return Promise.resolve({ rows: [row], rowCount: 1 });
      }
      if (sql.includes("FROM audit_head_anchors")) {
        return Promise.resolve({ rows: anchors, rowCount: anchors.length });
      }
      if (sql.includes("SELECT entry_hash FROM audit_log")) return Promise.resolve({ rows: [], rowCount: 0 });
      if (sql.includes("INSERT INTO audit_log")) return Promise.resolve({ rows: [], rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/audit-log/anchors",
      headers: { ...authHeader(app), "Content-Type": "application/json" },
      payload: { provider: "object-storage", externalRef: "s3://evidence/audit-head.json" },
    });

    expect(created.statusCode).toBe(200);
    expect(JSON.parse(created.payload).anchor).toMatchObject({
      id: "anchor-1",
      headHash: auditRow.entry_hash,
      provider: "object-storage",
      externalRef: "s3://evidence/audit-head.json",
    });

    const listed = await app.inject({ method: "GET", url: "/api/admin/audit-log/anchors", headers: authHeader(app) });
    expect(listed.statusCode).toBe(200);
    expect(JSON.parse(listed.payload).anchors).toHaveLength(1);
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
