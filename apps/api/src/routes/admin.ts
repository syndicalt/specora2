import { FastifyInstance } from "fastify";
import { requirePermission, clearPermissionCache } from "../services/rbac";

const CORE_ADMIN_PANELS = [
  { id: "rbac", name: "RBAC", icon: "Shield", permissions: ["rbac:read"] },
  { id: "system-properties", name: "System Properties", icon: "Settings", permissions: ["system-properties:read"] },
];

const BUILT_IN_APP_PANELS = [
  {
    id: "change-manager-state-machine",
    name: "Change State Machine",
    icon: "GitBranch",
    permissions: ["system-properties:write"],
    appId: "change-manager",
  },
];

export async function getStateMachineConfig(pg: any): Promise<any> {
  const result = await pg.query("SELECT value FROM system_properties WHERE key = 'change_manager.state_machine'");
  if (!result.rows.length) return null;
  try {
    return JSON.parse(result.rows[0].value);
  } catch {
    return null;
  }
}

export async function adminRoutes(fastify: FastifyInstance) {
  // Admin Panels Registry
  fastify.get("/api/admin/panels", { onRequest: [fastify.authenticate] }, async (_request, reply) => {
    try {
      const user = (_request as any).user as { id?: string; role?: string } | null;
      const { hasPermission, resolveUserRole } = await import("../services/rbac");
      const role = await resolveUserRole(fastify.pg, user);

      // Filter core panels by permission
      const visibleCore = [];
      for (const panel of CORE_ADMIN_PANELS) {
        const firstPerm = panel.permissions?.[0];
        const allowed = role && firstPerm
          ? await hasPermission(fastify.pg, { role, resource: firstPerm.split(":")[0], action: "read" })
          : false;
        if (allowed) visibleCore.push(panel);
      }

      // Get app-published panels from marketplace table
      let dbPanels: any[] = [];
      try {
        const appPanelsResult = await fastify.pg.query(
          `SELECT id, admin_panels FROM marketplace_apps WHERE admin_panels IS NOT NULL`
        );
        dbPanels = appPanelsResult.rows.flatMap((app: any) => {
          try {
            const panels = JSON.parse(app.admin_panels || "[]");
            return panels.map((p: any) => ({ ...p, appId: app.id }));
          } catch {
            return [];
          }
        });
      } catch (err: any) {
        // Column may not exist yet; ignore
        if (err.message?.includes("admin_panels")) {
          fastify.log.warn("admin_panels column not found in marketplace_apps");
        } else {
          throw err;
        }
      }

      // Merge built-in app panels
      const allAppPanels = [...BUILT_IN_APP_PANELS, ...dbPanels];

      // Filter app panels by permission
      const visibleAppPanels = [];
      for (const panel of allAppPanels) {
        const firstPerm = panel.permissions?.[0];
        const allowed = role && firstPerm
          ? await hasPermission(fastify.pg, { role, resource: firstPerm.split(":")[0], action: "read" })
          : false;
        if (allowed) visibleAppPanels.push(panel);
      }

      return { panels: [...visibleCore, ...visibleAppPanels] };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to fetch admin panels" });
    }
  });

  // State Machine Config
  fastify.get("/api/admin/state-machine/:appId", { onRequest: [fastify.authenticate, requirePermission("system-properties", "read")] }, async (request, reply) => {
    const { appId } = request.params as { appId: string };
    try {
      const config = await getStateMachineConfig(fastify.pg);
      if (!config) return reply.status(404).send({ error: "State machine config not found" });
      return { appId, config };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to fetch state machine config" });
    }
  });

  fastify.put("/api/admin/state-machine/:appId", { onRequest: [fastify.authenticate, requirePermission("system-properties", "write")] }, async (request, reply) => {
    const { appId } = request.params as { appId: string };
    const body = request.body as { config?: any };
    if (!body.config) return reply.status(400).send({ error: "config required" });
    try {
      const value = JSON.stringify(body.config);
      await fastify.pg.query(
        `INSERT INTO system_properties (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [`${appId}.state_machine`, value]
      );
      return { success: true, appId, config: body.config };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to update state machine config" });
    }
  });

  // RBAC Permissions
  fastify.get("/api/admin/permissions", { onRequest: [fastify.authenticate, requirePermission("rbac", "read")] }, async (_request, reply) => {
    try {
      const result = await fastify.pg.query(
        "SELECT id, role, resource, action FROM app_permissions ORDER BY role, resource, action"
      );
      return { permissions: result.rows };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to fetch permissions" });
    }
  });

  fastify.post("/api/admin/permissions", { onRequest: [fastify.authenticate, requirePermission("rbac", "write")] }, async (request, reply) => {
    const body = request.body as { role?: string; resource?: string; action?: string };
    if (!body.role || !body.resource || !body.action) {
      return reply.status(400).send({ error: "role, resource, and action required" });
    }
    try {
      const result = await fastify.pg.query(
        "INSERT INTO app_permissions (role, resource, action) VALUES ($1, $2, $3) RETURNING id, role, resource, action",
        [body.role, body.resource, body.action]
      );
      clearPermissionCache();
      return { permission: result.rows[0] };
    } catch (err: any) {
      if (err.code === "23505") {
        return reply.status(409).send({ error: "Permission already exists" });
      }
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to create permission" });
    }
  });

  fastify.delete("/api/admin/permissions/:id", { onRequest: [fastify.authenticate, requirePermission("rbac", "write")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await fastify.pg.query("DELETE FROM app_permissions WHERE id = $1", [id]);
      clearPermissionCache();
      return { success: true };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to delete permission" });
    }
  });

  // System Properties
  fastify.get("/api/admin/system-properties", { onRequest: [fastify.authenticate, requirePermission("system-properties", "read")] }, async (_request, reply) => {
    try {
      const result = await fastify.pg.query(
        "SELECT key, value, updated_at FROM system_properties ORDER BY key"
      );
      return { properties: result.rows };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to fetch system properties" });
    }
  });

  fastify.post("/api/admin/system-properties", { onRequest: [fastify.authenticate, requirePermission("system-properties", "write")] }, async (request, reply) => {
    const body = request.body as { key?: string; value?: string };
    if (!body.key || !body.value) {
      return reply.status(400).send({ error: "key and value required" });
    }
    try {
      const result = await fastify.pg.query(
        "INSERT INTO system_properties (key, value) VALUES ($1, $2) RETURNING key, value, updated_at",
        [body.key, body.value]
      );
      return { property: result.rows[0] };
    } catch (err: any) {
      if (err.code === "23505") {
        return reply.status(409).send({ error: "Property already exists" });
      }
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to create property" });
    }
  });

  fastify.put("/api/admin/system-properties/:key", { onRequest: [fastify.authenticate, requirePermission("system-properties", "write")] }, async (request, reply) => {
    const { key } = request.params as { key: string };
    const body = request.body as { value?: string };
    if (!body.value) {
      return reply.status(400).send({ error: "value required" });
    }
    try {
      const result = await fastify.pg.query(
        "UPDATE system_properties SET value = $1, updated_at = NOW() WHERE key = $2 RETURNING key, value, updated_at",
        [body.value, key]
      );
      if (result.rows.length === 0) {
        return reply.status(404).send({ error: "Property not found" });
      }
      return { property: result.rows[0] };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to update property" });
    }
  });

  fastify.delete("/api/admin/system-properties/:key", { onRequest: [fastify.authenticate, requirePermission("system-properties", "write")] }, async (request, reply) => {
    const { key } = request.params as { key: string };
    try {
      await fastify.pg.query("DELETE FROM system_properties WHERE key = $1", [key]);
      return { success: true };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to delete property" });
    }
  });
}
