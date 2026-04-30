import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash, randomBytes } from "crypto";
import { requirePermission } from "../../services/rbac";
import { recordAuditEvent } from "../../services/auditLog";
import { buildEdgeRuntimeConfig, edgeJobPublicKeyBase64 } from "../../services/edgeRuntimeConfig";

type TimestampValue = string | Date | number | null | undefined;

type EnrollmentTokenDbRow = {
  id: string;
  name: string;
  token_prefix: string;
  site?: string | null;
  labels?: unknown;
  expires_at?: TimestampValue;
  max_uses?: string | number | null;
  uses?: string | number | null;
  collector_id?: string | null;
  collector_name?: string | null;
  revoked_at?: TimestampValue;
  created_by?: string | null;
  created_at?: TimestampValue;
};

type CollectorDbRow = {
  id: string;
  name: string;
  status: string;
  site?: string | null;
  version?: string | null;
  labels?: unknown;
  last_heartbeat_at?: TimestampValue;
  last_seen_ip?: string | null;
  source_count?: string | number | null;
  created_at?: TimestampValue;
  updated_at?: TimestampValue;
};

type EnrollmentTokenBody = { name?: string; site?: string; labels?: Record<string, unknown>; expiresInHours?: number; maxUses?: number };

function timestampString(value: TimestampValue) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isExpired(value: TimestampValue) {
  return Boolean(value && new Date(value).getTime() <= Date.now());
}

function hashEnrollmentToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function enrollmentTokenRow(row: EnrollmentTokenDbRow) {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    site: row.site || "",
    labels: objectValue(row.labels),
    expiresAt: timestampString(row.expires_at),
    maxUses: Number(row.max_uses || 0),
    uses: Number(row.uses || 0),
    collectorId: row.collector_id || null,
    collectorName: row.collector_name || null,
    revokedAt: timestampString(row.revoked_at),
    createdBy: row.created_by || null,
    createdAt: timestampString(row.created_at),
    status: row.revoked_at
      ? "revoked"
      : isExpired(row.expires_at)
        ? "expired"
        : Number(row.uses || 0) >= Number(row.max_uses || 0)
          ? "used"
          : "active",
  };
}

function adminCollectorRow(row: CollectorDbRow) {
  const lastHeartbeatAt = timestampString(row.last_heartbeat_at);
  const heartbeatAgeMinutes = lastHeartbeatAt ? Math.round((Date.now() - new Date(lastHeartbeatAt).getTime()) / 60000) : null;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    site: row.site || "",
    version: row.version || "",
    labels: objectValue(row.labels),
    lastHeartbeatAt,
    heartbeatAgeMinutes,
    lastSeenIp: row.last_seen_ip || null,
    sourceCount: Number(row.source_count || 0),
    createdAt: timestampString(row.created_at),
    updatedAt: timestampString(row.updated_at),
  };
}

async function createEnrollmentToken(fastify: FastifyInstance, request: FastifyRequest, reply: FastifyReply) {
  try {
    const actor = request.user;
    const body = request.body as EnrollmentTokenBody;
    const name = body.name?.trim();
    if (!name) return reply.status(400).send({ error: "name is required" });
    const expiresInHours = Math.min(Math.max(Number(body.expiresInHours || 24), 1), 24 * 30);
    const maxUses = Math.min(Math.max(Number(body.maxUses || 1), 1), 25);
    const token = `se_${randomBytes(32).toString("base64url")}`;
    const tokenPrefix = token.slice(0, 10);
    const result = await fastify.pg.query(
      `INSERT INTO discovery_collector_enrollment_tokens
         (name, token_prefix, token_hash, site, labels, expires_at, max_uses, created_by)
       VALUES ($1, $2, $3, $4, $5, NOW() + ($6::text || ' hours')::interval, $7, $8)
       RETURNING id, name, token_prefix, site, labels, expires_at, max_uses, uses, collector_id, revoked_at, created_by, created_at`,
      [
        name.slice(0, 160),
        tokenPrefix,
        hashEnrollmentToken(token),
        body.site?.trim() || null,
        JSON.stringify(body.labels || {}),
        expiresInHours,
        maxUses,
        actor?.id || null,
      ]
    );
    const row = enrollmentTokenRow(result.rows[0] as EnrollmentTokenDbRow);
    await recordAuditEvent(fastify, {
      actorId: actor?.id,
      action: "edge.enrollment_token.created",
      entityType: "DiscoveryEnrollmentToken",
      entityId: row.id,
      newValues: { ...row, token: undefined },
      metadata: { source: "api.admin", surface: "edge-enrollment" },
    });
    return { token, enrollmentToken: row };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: errorMessage(err, "Failed to create edge enrollment token") });
  }
}

export function registerAdminEdgeEnrollmentRoutes(fastify: FastifyInstance) {
  fastify.get("/api/admin/edge-enrollment/tokens", { onRequest: [fastify.authenticate, requirePermission("edge-enrollment", "read")] }, async (_request, reply) => {
    try {
      const result = await fastify.pg.query(
        `SELECT t.id, t.name, t.token_prefix, t.site, t.labels, t.expires_at, t.max_uses, t.uses,
                t.collector_id, c.name AS collector_name, t.revoked_at, t.created_by, t.created_at
         FROM discovery_collector_enrollment_tokens t
         LEFT JOIN discovery_collectors c ON c.id = t.collector_id
         ORDER BY t.created_at DESC
         LIMIT 100`
      );
      return { tokens: (result.rows as EnrollmentTokenDbRow[]).map(enrollmentTokenRow) };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to fetch edge enrollment tokens") });
    }
  });

  fastify.get("/api/admin/edge-enrollment/collectors", { onRequest: [fastify.authenticate, requirePermission("edge-enrollment", "read")] }, async (_request, reply) => {
    try {
      const result = await fastify.pg.query(
        `SELECT c.id, c.name, c.status, c.site, c.version, c.labels, c.last_heartbeat_at, c.last_seen_ip, c.created_at, c.updated_at,
                COUNT(s.id)::int AS source_count
         FROM discovery_collectors c
         LEFT JOIN discovery_sources s ON s.collector_id = c.id
         GROUP BY c.id
         ORDER BY COALESCE(c.last_heartbeat_at, c.created_at) DESC, c.name`
      );
      return { collectors: (result.rows as CollectorDbRow[]).map(adminCollectorRow) };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to fetch edge collectors") });
    }
  });

  fastify.get("/api/admin/edge-enrollment/runtime-config", { onRequest: [fastify.authenticate, requirePermission("edge-enrollment", "read")] }, async (_request, reply) => {
    try {
      return {
        publicSigningKey: edgeJobPublicKeyBase64(),
        runtimeConfig: buildEdgeRuntimeConfig(),
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to build edge runtime config") });
    }
  });

  fastify.post("/api/admin/edge-enrollment/tokens", { onRequest: [fastify.authenticate, requirePermission("edge-enrollment", "write")] }, async (request, reply) => createEnrollmentToken(fastify, request, reply));
  fastify.post("/discovery/collectors/enrollment-tokens", { onRequest: [fastify.authenticate, requirePermission("edge-enrollment", "write")] }, async (request, reply) => createEnrollmentToken(fastify, request, reply));
  fastify.post("/discovery/enrollment-tokens", { onRequest: [fastify.authenticate, requirePermission("edge-enrollment", "write")] }, async (request, reply) => createEnrollmentToken(fastify, request, reply));

  fastify.post("/api/admin/edge-enrollment/tokens/:id/revoke", { onRequest: [fastify.authenticate, requirePermission("edge-enrollment", "write")] }, async (request, reply) => {
    try {
      const actor = request.user;
      const { id } = request.params as { id: string };
      const result = await fastify.pg.query(
        `UPDATE discovery_collector_enrollment_tokens
         SET revoked_at = COALESCE(revoked_at, NOW()), updated_at = NOW()
         WHERE id = $1
         RETURNING id, name, token_prefix, site, labels, expires_at, max_uses, uses, collector_id, revoked_at, created_by, created_at`,
        [id]
      );
      if (!result.rows.length) return reply.status(404).send({ error: "Enrollment token not found" });
      const row = enrollmentTokenRow(result.rows[0] as EnrollmentTokenDbRow);
      await recordAuditEvent(fastify, {
        actorId: actor?.id,
        action: "edge.enrollment_token.revoked",
        entityType: "DiscoveryEnrollmentToken",
        entityId: id,
        newValues: row,
        metadata: { source: "api.admin", surface: "edge-enrollment" },
      });
      return { enrollmentToken: row };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to revoke edge enrollment token") });
    }
  });

  fastify.delete("/api/admin/edge-enrollment/collectors/:id", { onRequest: [fastify.authenticate, requirePermission("edge-enrollment", "write")] }, async (request, reply) => {
    try {
      const actor = request.user;
      const { id } = request.params as { id: string };
      const result = await fastify.pg.query(
        `DELETE FROM discovery_collectors
         WHERE id = $1
         RETURNING id, name, status, site, version`,
        [id]
      );
      if (!result.rows.length) return reply.status(404).send({ error: "Edge collector not found" });
      await recordAuditEvent(fastify, {
        actorId: actor?.id,
        action: "edge.collector_deleted",
        entityType: "DiscoveryCollector",
        entityId: id,
        oldValues: result.rows[0],
        metadata: { source: "api.admin", surface: "edge-enrollment" },
      });
      return { deleted: true, collector: result.rows[0] };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to delete edge collector") });
    }
  });
}
