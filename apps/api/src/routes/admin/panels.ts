import { FastifyInstance } from "fastify";

const CORE_ADMIN_PANELS = [
  { id: "users", name: "User Management", icon: "Users", permissions: ["users:read"] },
  { id: "edge-enrollment", name: "Edge Enrollment", icon: "Radio", permissions: ["edge-enrollment:read"] },
  { id: "rbac", name: "RBAC", icon: "Shield", permissions: ["rbac:read"] },
  { id: "credentials", name: "Credentials", icon: "KeyRound", permissions: ["credentials:read"] },
  { id: "identity", name: "Identity Providers", icon: "KeyRound", permissions: ["identity:read"] },
  { id: "number-sequences", name: "Number Sequences", icon: "Hash", permissions: ["number-sequences:read"] },
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

export function registerAdminPanelRoutes(fastify: FastifyInstance) {
  fastify.get("/api/admin/panels", { onRequest: [fastify.authenticate] }, async (_request, reply) => {
    try {
      const user = (_request as any).user as { id?: string; role?: string } | null;
      const { hasPermission, resolveUserRole } = await import("../../services/rbac");
      const role = await resolveUserRole(fastify.pg, user);

      const visibleCore = [];
      for (const panel of CORE_ADMIN_PANELS) {
        const firstPerm = panel.permissions?.[0];
        const allowed = role && firstPerm
          ? await hasPermission(fastify.pg, { role, resource: firstPerm.split(":")[0], action: "read" })
          : false;
        if (allowed) visibleCore.push(panel);
      }

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
        if (err.message?.includes("admin_panels")) {
          fastify.log.warn("admin_panels column not found in marketplace_apps");
        } else {
          throw err;
        }
      }

      const allAppPanels = [...BUILT_IN_APP_PANELS, ...dbPanels];
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
}
