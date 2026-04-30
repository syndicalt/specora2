import { FastifyInstance } from "fastify";
import { requirePermission, clearPermissionCache } from "../../services/rbac";
import { recordAuditEvent } from "../../services/auditLog";

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function errorCode(err: unknown) {
  return typeof err === "object" && err !== null && "code" in err ? String(err.code) : null;
}

function actorId(user: unknown) {
  return typeof user === "object" && user !== null && "id" in user ? String(user.id) : undefined;
}

export function registerAdminPermissionRoutes(fastify: FastifyInstance) {
  fastify.get("/api/admin/permissions", { onRequest: [fastify.authenticate, requirePermission("rbac", "read")] }, async (_request, reply) => {
    try {
      const result = await fastify.pg.query(
        "SELECT id, role, resource, action FROM app_permissions ORDER BY role, resource, action"
      );
      return { permissions: result.rows };
    } catch (err: unknown) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to fetch permissions") });
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
      await recordAuditEvent(fastify, {
        actorId: actorId(request.user),
        action: "rbac.permission.created",
        entityType: "AppPermission",
        entityId: result.rows[0].id,
        newValues: result.rows[0],
        metadata: { source: "api.admin", surface: "admin-console" },
      });
      return { permission: result.rows[0] };
    } catch (err: unknown) {
      if (errorCode(err) === "23505") {
        return reply.status(409).send({ error: "Permission already exists" });
      }
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to create permission") });
    }
  });

  fastify.delete("/api/admin/permissions/:id", { onRequest: [fastify.authenticate, requirePermission("rbac", "write")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const existing = await fastify.pg.query("SELECT id, role, resource, action FROM app_permissions WHERE id = $1", [id]);
      await fastify.pg.query("DELETE FROM app_permissions WHERE id = $1", [id]);
      clearPermissionCache();
      await recordAuditEvent(fastify, {
        actorId: actorId(request.user),
        action: "rbac.permission.deleted",
        entityType: "AppPermission",
        entityId: id,
        oldValues: existing.rows[0] || { id },
        metadata: { source: "api.admin", surface: "admin-console" },
      });
      return { success: true };
    } catch (err: unknown) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to delete permission") });
    }
  });
}
