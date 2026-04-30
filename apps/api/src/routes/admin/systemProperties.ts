import type { FastifyInstance } from "fastify";
import { requirePermission } from "../../services/rbac";
import { clearFieldRestrictionCache } from "../../services/fieldRbac";
import { recordAuditEvent } from "../../services/auditLog";

type QueryablePg = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
};

type SystemPropertyRow = {
  key: string;
  value: string;
  updated_at?: string | Date | null;
};

type StateMachineConfig = Record<string, unknown> & {
  transitions?: Array<{ from: string; to: string; roles?: string[] }>;
};

type DbError = Error & { code?: string };

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

function dbError(err: unknown): DbError {
  return err instanceof Error ? err as DbError : new Error(String(err)) as DbError;
}

export async function getStateMachineConfig(pg: QueryablePg): Promise<StateMachineConfig | null> {
  const result = await pg.query("SELECT value FROM system_properties WHERE key = 'change_manager.state_machine'");
  if (!result.rows.length) return null;
  try {
    const parsed = JSON.parse(String((result.rows[0] as SystemPropertyRow).value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as StateMachineConfig : null;
  } catch {
    return null;
  }
}

export function registerAdminSystemPropertyRoutes(fastify: FastifyInstance) {
  fastify.get("/api/admin/state-machine/:appId", { onRequest: [fastify.authenticate, requirePermission("system-properties", "read")] }, async (request, reply) => {
    const { appId } = request.params as { appId: string };
    try {
      const config = await getStateMachineConfig(fastify.pg);
      if (!config) return reply.status(404).send({ error: "State machine config not found" });
      return { appId, config };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to fetch state machine config") });
    }
  });

  fastify.put("/api/admin/state-machine/:appId", { onRequest: [fastify.authenticate, requirePermission("system-properties", "write")] }, async (request, reply) => {
    const { appId } = request.params as { appId: string };
    const body = request.body as { config?: unknown };
    if (!body.config) return reply.status(400).send({ error: "config required" });
    try {
      const value = JSON.stringify(body.config);
      await fastify.pg.query(
        `INSERT INTO system_properties (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [`${appId}.state_machine`, value]
      );
      await recordAuditEvent(fastify, {
        actorId: request.user?.id,
        action: "system_property.updated",
        entityType: "SystemProperty",
        entityId: `${appId}.state_machine`,
        newValues: { key: `${appId}.state_machine`, value },
        metadata: { source: "api.admin", surface: "admin-console", appId },
      });
      return { success: true, appId, config: body.config };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to update state machine config") });
    }
  });

  fastify.get("/api/admin/system-properties", { onRequest: [fastify.authenticate, requirePermission("system-properties", "read")] }, async (_request, reply) => {
    try {
      const result = await fastify.pg.query(
        "SELECT key, value, updated_at FROM system_properties ORDER BY key"
      );
      return { properties: result.rows };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to fetch system properties") });
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
      await recordAuditEvent(fastify, {
        actorId: request.user?.id,
        action: "system_property.created",
        entityType: "SystemProperty",
        entityId: result.rows[0].key,
        newValues: result.rows[0],
        metadata: { source: "api.admin", surface: "admin-console" },
      });
      if (body.key === "security.field_restrictions") clearFieldRestrictionCache();
      return { property: result.rows[0] };
    } catch (err) {
      const error = dbError(err);
      if (error.code === "23505") {
        return reply.status(409).send({ error: "Property already exists" });
      }
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to create property") });
    }
  });

  fastify.put("/api/admin/system-properties/:key", { onRequest: [fastify.authenticate, requirePermission("system-properties", "write")] }, async (request, reply) => {
    const { key } = request.params as { key: string };
    const body = request.body as { value?: string };
    if (!body.value) {
      return reply.status(400).send({ error: "value required" });
    }
    try {
      const existing = await fastify.pg.query("SELECT key, value, updated_at FROM system_properties WHERE key = $1", [key]);
      const result = await fastify.pg.query(
        "UPDATE system_properties SET value = $1, updated_at = NOW() WHERE key = $2 RETURNING key, value, updated_at",
        [body.value, key]
      );
      if (result.rows.length === 0) {
        return reply.status(404).send({ error: "Property not found" });
      }
      await recordAuditEvent(fastify, {
        actorId: request.user?.id,
        action: "system_property.updated",
        entityType: "SystemProperty",
        entityId: key,
        oldValues: (existing.rows[0] as Record<string, unknown> | undefined) || undefined,
        newValues: result.rows[0],
        metadata: { source: "api.admin", surface: "admin-console" },
      });
      if (key === "security.field_restrictions") clearFieldRestrictionCache();
      return { property: result.rows[0] };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to update property") });
    }
  });

  fastify.delete("/api/admin/system-properties/:key", { onRequest: [fastify.authenticate, requirePermission("system-properties", "write")] }, async (request, reply) => {
    const { key } = request.params as { key: string };
    try {
      const existing = await fastify.pg.query("SELECT key, value, updated_at FROM system_properties WHERE key = $1", [key]);
      await fastify.pg.query("DELETE FROM system_properties WHERE key = $1", [key]);
      await recordAuditEvent(fastify, {
        actorId: request.user?.id,
        action: "system_property.deleted",
        entityType: "SystemProperty",
        entityId: key,
        oldValues: (existing.rows[0] as Record<string, unknown> | undefined) || { key },
        metadata: { source: "api.admin", surface: "admin-console" },
      });
      if (key === "security.field_restrictions") clearFieldRestrictionCache();
      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to delete property") });
    }
  });
}
