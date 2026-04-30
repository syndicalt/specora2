import { FastifyInstance } from "fastify";
import { requirePermission, clearPermissionCache } from "../../services/rbac";
import { recordAuditEvent } from "../../services/auditLog";

async function loadCmdbGroupOptions(fastify: FastifyInstance) {
  if (!(fastify as any).neo4j?.session) return [];
  const session = (fastify as any).neo4j.session();
  try {
    const result = await session.run(
      `MATCH (n:Group:ConfigurationItem)
       RETURN n.id AS id, coalesce(n.name, n.displayName, n.id) AS name
       ORDER BY toLower(name)
       LIMIT 500`
    );
    return result.records
      .map((record: any) => ({
        id: String(record.get("id") || ""),
        name: String(record.get("name") || record.get("id") || ""),
      }))
      .filter((item: { id: string }) => item.id);
  } catch (err: any) {
    fastify.log.warn({ err: err.message }, "Failed to load CMDB group options");
    return [];
  } finally {
    await session.close();
  }
}

export function registerAdminIdentityGroupRoutes(fastify: FastifyInstance) {
  fastify.get("/api/admin/identity/groups", { onRequest: [fastify.authenticate, requirePermission("identity-groups", "read")] }, async (_request, reply) => {
    try {
      const [groups, memberships, permissions, cmdbGroupOptions] = await Promise.all([
        fastify.pg.query(
          `SELECT id, name, slug, description, source, external_id, cmdb_ci_id, created_at, updated_at
           FROM identity_groups ORDER BY name`
        ),
        fastify.pg.query(
          `SELECT gm.id, gm.group_id, gm.user_id, gm.source, u.name AS user_name, u.email AS user_email
           FROM identity_group_memberships gm
           JOIN users u ON u.id = gm.user_id
           ORDER BY u.name, u.email`
        ),
        fastify.pg.query(
          `SELECT gp.id, gp.group_id, gp.resource, gp.action
           FROM identity_group_permissions gp
           ORDER BY gp.resource, gp.action`
        ),
        loadCmdbGroupOptions(fastify),
      ]);
      return { groups: groups.rows, memberships: memberships.rows, permissions: permissions.rows, cmdbGroupOptions };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to fetch identity groups" });
    }
  });

  fastify.post("/api/admin/identity/groups", { onRequest: [fastify.authenticate, requirePermission("identity-groups", "write")] }, async (request, reply) => {
    const body = request.body as { name?: string; slug?: string; description?: string; cmdbCiId?: string; source?: string; externalId?: string };
    const name = body.name?.trim();
    const slug = (body.slug || name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!name || !slug) return reply.status(400).send({ error: "name required" });
    try {
      const result = await fastify.pg.query(
        `INSERT INTO identity_groups (name, slug, description, source, external_id, cmdb_ci_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, slug, description, source, external_id, cmdb_ci_id, created_at, updated_at`,
        [name, slug, body.description || null, body.source || "local", body.externalId || null, body.cmdbCiId || null]
      );
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "identity_group.created",
        entityType: "IdentityGroup",
        entityId: result.rows[0].id,
        newValues: result.rows[0],
        metadata: { source: "api.admin", surface: "admin-console" },
      });
      return { group: result.rows[0] };
    } catch (err: any) {
      if (err.code === "23505") return reply.status(409).send({ error: "Identity group already exists" });
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to create identity group" });
    }
  });

  fastify.patch("/api/admin/identity/groups/:id", { onRequest: [fastify.authenticate, requirePermission("identity-groups", "write")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { name?: string; description?: string; cmdbCiId?: string | null };
    try {
      const existing = await fastify.pg.query("SELECT id, name, slug, description, source, external_id, cmdb_ci_id FROM identity_groups WHERE id = $1", [id]);
      const result = await fastify.pg.query(
        `UPDATE identity_groups
         SET name = COALESCE($2, name),
             description = COALESCE($3, description),
             cmdb_ci_id = $4,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, name, slug, description, source, external_id, cmdb_ci_id, created_at, updated_at`,
        [id, body.name || null, body.description || null, body.cmdbCiId ?? existing.rows[0]?.cmdb_ci_id ?? null]
      );
      if (!result.rows.length) return reply.status(404).send({ error: "Identity group not found" });
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "identity_group.updated",
        entityType: "IdentityGroup",
        entityId: id,
        oldValues: existing.rows[0] || undefined,
        newValues: result.rows[0],
        metadata: { source: "api.admin", surface: "admin-console" },
      });
      clearPermissionCache();
      return { group: result.rows[0] };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to update identity group" });
    }
  });

  fastify.delete("/api/admin/identity/groups/:id", { onRequest: [fastify.authenticate, requirePermission("identity-groups", "write")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const existing = await fastify.pg.query("SELECT id, name, slug, description, source, external_id, cmdb_ci_id FROM identity_groups WHERE id = $1", [id]);
      if (!existing.rows.length) return reply.status(404).send({ error: "Identity group not found" });
      const childCounts = await fastify.pg.query(
        `SELECT
           (SELECT COUNT(*)::int FROM identity_group_memberships WHERE group_id = $1) AS membership_count,
           (SELECT COUNT(*)::int FROM identity_group_permissions WHERE group_id = $1) AS permission_count`,
        [id]
      );
      await fastify.pg.query("DELETE FROM identity_groups WHERE id = $1", [id]);
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "identity_group.deleted",
        entityType: "IdentityGroup",
        entityId: id,
        oldValues: existing.rows[0],
        metadata: {
          source: "api.admin",
          surface: "admin-console",
          removedMemberships: childCounts.rows[0]?.membership_count || 0,
          removedPermissions: childCounts.rows[0]?.permission_count || 0,
        },
      });
      clearPermissionCache();
      return { success: true };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to delete identity group" });
    }
  });

  fastify.post("/api/admin/identity/groups/:id/members", { onRequest: [fastify.authenticate, requirePermission("identity-groups", "write")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { userId?: string; source?: string };
    if (!body.userId) return reply.status(400).send({ error: "userId required" });
    try {
      const result = await fastify.pg.query(
        `INSERT INTO identity_group_memberships (group_id, user_id, source)
         VALUES ($1, $2, $3)
         ON CONFLICT (group_id, user_id) DO UPDATE SET source = EXCLUDED.source
         RETURNING id, group_id, user_id, source, created_at`,
        [id, body.userId, body.source || "local"]
      );
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "identity_group.member_added",
        entityType: "IdentityGroup",
        entityId: id,
        newValues: result.rows[0],
        metadata: { source: "api.admin", surface: "admin-console" },
      });
      clearPermissionCache();
      return { membership: result.rows[0] };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to add group member" });
    }
  });

  fastify.delete("/api/admin/identity/groups/:groupId/members/:userId", { onRequest: [fastify.authenticate, requirePermission("identity-groups", "write")] }, async (request) => {
    const { groupId, userId } = request.params as { groupId: string; userId: string };
    await fastify.pg.query("DELETE FROM identity_group_memberships WHERE group_id = $1 AND user_id = $2", [groupId, userId]);
    await recordAuditEvent(fastify, {
      actorId: (request.user as any)?.id,
      action: "identity_group.member_removed",
      entityType: "IdentityGroup",
      entityId: groupId,
      oldValues: { groupId, userId },
      metadata: { source: "api.admin", surface: "admin-console" },
    });
    clearPermissionCache();
    return { success: true };
  });

  fastify.post("/api/admin/identity/groups/:id/permissions", { onRequest: [fastify.authenticate, requirePermission("identity-groups", "write")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { resource?: string; action?: string };
    if (!body.resource || !body.action) return reply.status(400).send({ error: "resource and action required" });
    try {
      const result = await fastify.pg.query(
        `INSERT INTO identity_group_permissions (group_id, resource, action)
         VALUES ($1, $2, $3)
         ON CONFLICT (group_id, resource, action) DO NOTHING
         RETURNING id, group_id, resource, action`,
        [id, body.resource, body.action]
      );
      const grant = result.rows[0] || { group_id: id, resource: body.resource, action: body.action };
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "identity_group.permission_granted",
        entityType: "IdentityGroup",
        entityId: id,
        newValues: grant,
        metadata: { source: "api.admin", surface: "admin-console" },
      });
      clearPermissionCache();
      return { permission: grant };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to grant group permission" });
    }
  });

  fastify.delete("/api/admin/identity/groups/:groupId/permissions/:permissionId", { onRequest: [fastify.authenticate, requirePermission("identity-groups", "write")] }, async (request) => {
    const { groupId, permissionId } = request.params as { groupId: string; permissionId: string };
    const existing = await fastify.pg.query("SELECT id, group_id, resource, action FROM identity_group_permissions WHERE id = $1 AND group_id = $2", [permissionId, groupId]);
    await fastify.pg.query("DELETE FROM identity_group_permissions WHERE id = $1 AND group_id = $2", [permissionId, groupId]);
    await recordAuditEvent(fastify, {
      actorId: (request.user as any)?.id,
      action: "identity_group.permission_revoked",
      entityType: "IdentityGroup",
      entityId: groupId,
      oldValues: existing.rows[0] || { permissionId, groupId },
      metadata: { source: "api.admin", surface: "admin-console" },
    });
    clearPermissionCache();
    return { success: true };
  });
}
