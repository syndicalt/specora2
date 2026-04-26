import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { appsRoutes } from "./apps";

function mockPg(role: string, permissions: Array<{ resource: string; action: string }> = []) {
  return {
    query: vi.fn(async (sql: string, params?: any[]) => {
      if (sql.includes("SELECT role FROM users")) {
        return { rows: [{ role }] };
      }
      if (sql.includes("FROM marketplace_apps")) {
        return {
          rows: [
            {
              id: "external-app",
              name: "External App",
              description: "External",
              url: "https://example.com/app.js",
              icon: "Compass",
              version: "1.0.0",
              permissions: ["read:cmdb"],
              react_version: "^18.0.0",
              author: "Vendor",
              created_at: "2026-01-01T00:00:00Z",
            },
          ],
        };
      }
      if (sql.includes("FROM app_installations")) {
        return { rows: [{ app_id: "external-app", status: "installed", last_job_id: null }] };
      }
      if (sql.includes("INSERT INTO app_provisioning_jobs")) {
        return { rows: [{ id: "job-1", app_id: params?.[0], action: params?.[1], status: "completed" }] };
      }
      if (sql.includes("INSERT INTO app_installations")) {
        return { rows: [] };
      }
      if (sql.includes("FROM app_permissions")) {
        const [, resource, action] = params || [];
        return {
          rows: permissions.some((p) => p.resource === resource && p.action === action)
            ? [{ ok: 1 }]
            : [],
        };
      }
      return { rows: [] };
    }),
  };
}

async function buildApp(pg: any, user: any) {
  const app = Fastify();
  app.decorate("pg", pg);
  app.decorate("authenticate", async (request: any) => {
    request.user = user;
  });
  await app.register(appsRoutes);
  return app;
}

describe("appsRoutes", () => {
  it("returns RBAC-visible apps from the server registry", async () => {
    const app = await buildApp(mockPg("viewer", [{ resource: "cmdb", action: "read" }]), { id: "u1" });

    const res = await app.inject({ method: "GET", url: "/api/apps/registry" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const ids = body.apps.map((app: any) => app.id);
    expect(ids).toContain("service-map");
    expect(ids).toContain("cmdb-explorer");
    expect(ids).toContain("external-app");
    expect(ids).not.toContain("ci-class-manager");
  });

  it("returns all registered apps for admins", async () => {
    const app = await buildApp(mockPg("admin"), { id: "u1", role: "admin" });

    const res = await app.inject({ method: "GET", url: "/api/apps/registry" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const ids = body.apps.map((app: any) => app.id);
    expect(ids).toContain("ci-class-manager");
    expect(ids).toContain("external-app");
  });

  it("returns catalog entries with install status", async () => {
    const app = await buildApp(mockPg("admin"), { id: "u1", role: "admin" });

    const res = await app.inject({ method: "GET", url: "/api/apps/catalog" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.apps.find((entry: any) => entry.id === "external-app")).toMatchObject({ installStatus: "installed" });
    expect(body.apps.find((entry: any) => entry.id === "it-visibility-dcim")).toMatchObject({ installStatus: "available" });
  });

  it("installs optional apps through provisioning jobs", async () => {
    const pg = mockPg("admin");
    const app = await buildApp(pg, { id: "u1", role: "admin" });

    const res = await app.inject({ method: "POST", url: "/api/apps/it-visibility-dcim/install" });

    expect(res.statusCode).toBe(200);
    expect(pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO app_provisioning_jobs"), expect.arrayContaining(["it-visibility-dcim", "install", "u1"]));
    expect(pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO app_installations"), expect.arrayContaining(["it-visibility-dcim", "u1"]));
    expect(pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["app.install", "AppInstallation", "it-visibility-dcim"]));
  });

  it("blocks uninstalling core platform apps", async () => {
    const app = await buildApp(mockPg("admin"), { id: "u1", role: "admin" });

    const res = await app.inject({ method: "POST", url: "/api/apps/service-map/uninstall", payload: { clearData: true } });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe("Core platform apps cannot be uninstalled");
  });
});
