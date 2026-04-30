import type { FastifyInstance } from "fastify";
import { createHash, createHmac } from "crypto";
import { requirePermission } from "../../services/rbac";
import { recordAuditEvent, verifyAuditIntegrity } from "../../services/auditLog";

type TimestampValue = string | Date | number | null | undefined;

type AuditLogDbRow = {
  id: string;
  actor_id?: string | null;
  actor_email?: string | null;
  actor_name?: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  old_values?: unknown;
  new_values?: unknown;
  metadata?: unknown;
  previous_hash?: string | null;
  entry_hash?: string | null;
  integrity_version?: string | number | null;
  created_at?: TimestampValue;
};

type AuditAnchorDbRow = {
  id: string;
  head_hash: string;
  checked_rows?: string | number | null;
  legacy_rows?: string | number | null;
  provider?: string | null;
  external_ref?: string | null;
  payload?: unknown;
  payload_digest?: string | null;
  created_by?: string | null;
  created_at?: TimestampValue;
};

function parsePositiveInt(value: unknown, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function timestampString(value: TimestampValue) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

function parseObjectPayload(value: unknown) {
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

function auditRow(row: AuditLogDbRow) {
  return {
    id: row.id,
    actorId: row.actor_id,
    actorEmail: row.actor_email || null,
    actorName: row.actor_name || null,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    oldValues: row.old_values,
    newValues: row.new_values,
    metadata: row.metadata,
    previousHash: row.previous_hash || null,
    entryHash: row.entry_hash || null,
    integrityVersion: row.integrity_version || 1,
    createdAt: timestampString(row.created_at),
  };
}

function auditAnchorRow(row: AuditAnchorDbRow) {
  return {
    id: row.id,
    headHash: row.head_hash,
    checkedRows: Number(row.checked_rows || 0),
    legacyRows: Number(row.legacy_rows || 0),
    provider: row.provider || "manual",
    externalRef: row.external_ref || "",
    payload: parseObjectPayload(row.payload),
    payloadDigest: row.payload_digest,
    createdBy: row.created_by || null,
    createdAt: timestampString(row.created_at),
  };
}

function exportSignature(body: string, secret?: string) {
  const digest = createHash("sha256").update(body).digest("hex");
  const signature = createHmac("sha256", secret || "specora-dev-secret").update(digest).digest("hex");
  return { digest, signature, algorithm: "sha256+hmac-sha256" };
}

export function registerAdminAuditLogRoutes(fastify: FastifyInstance) {
  fastify.get("/api/admin/audit-log", { onRequest: [fastify.authenticate, requirePermission("audit-log", "read")] }, async (request, reply) => {
    const query = request.query as { q?: string; action?: string; entityType?: string; actorId?: string; format?: string; limit?: string; offset?: string };
    const limit = parsePositiveInt(query.limit, query.format === "csv" ? 500 : 50, 1000);
    const offset = parsePositiveInt(query.offset, 1, 1000000) - 1;
    const where = ["1=1"];
    const params: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      params.push(value);
      where.push(clause.replace("?", `$${params.length}`));
    };
    if (query.q?.trim()) {
      const q = `%${query.q.trim()}%`;
      params.push(q, q, q, q);
      where.push(`(a.action ILIKE $${params.length - 3} OR a.entity_type ILIKE $${params.length - 2} OR a.entity_id ILIKE $${params.length - 1} OR u.email ILIKE $${params.length})`);
    }
    if (query.action?.trim()) add("a.action = ?", query.action.trim());
    if (query.entityType?.trim()) add("a.entity_type = ?", query.entityType.trim());
    if (query.actorId?.trim()) add("a.actor_id = ?::uuid", query.actorId.trim());
    try {
      const result = await fastify.pg.query(
        `SELECT a.id, a.actor_id, u.email AS actor_email, u.name AS actor_name, a.action, a.entity_type, a.entity_id,
                a.old_values, a.new_values, a.metadata, a.previous_hash, a.entry_hash, a.integrity_version, a.created_at
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_id
         WHERE ${where.join(" AND ")}
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );
      const count = await fastify.pg.query(
        `SELECT COUNT(*)::int AS total
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_id
         WHERE ${where.join(" AND ")}`,
        params
      );
      const rows = (result.rows as AuditLogDbRow[]).map(auditRow);
      if (query.format === "csv") {
        const csv = [
          ["id", "createdAt", "actorId", "actorEmail", "action", "entityType", "entityId", "previousHash", "entryHash", "integrityVersion", "metadata"].join(","),
          ...rows.map((row) => [row.id, row.createdAt, row.actorId, row.actorEmail, row.action, row.entityType, row.entityId, row.previousHash, row.entryHash, row.integrityVersion, row.metadata].map(csvCell).join(",")),
        ].join("\n");
        const signature = exportSignature(csv, process.env.JWT_SECRET);
        return reply
          .header("content-type", "text/csv; charset=utf-8")
          .header("content-disposition", "attachment; filename=\"specora-audit-log.csv\"")
          .header("x-specora-export-digest", signature.digest)
          .header("x-specora-export-signature", signature.signature)
          .header("x-specora-export-algorithm", signature.algorithm)
          .send(csv);
      }
      return { entries: rows, total: Number((count.rows[0] as { total?: string | number } | undefined)?.total || 0), limit, offset };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to fetch audit log") });
    }
  });

  fastify.get("/api/admin/audit-log/integrity", { onRequest: [fastify.authenticate, requirePermission("audit-log", "read")] }, async (request, reply) => {
    const query = request.query as { limit?: string };
    try {
      return await verifyAuditIntegrity(fastify.pg, parsePositiveInt(query.limit, 10000, 100000));
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to verify audit integrity") });
    }
  });

  fastify.get("/api/admin/audit-log/anchors", { onRequest: [fastify.authenticate, requirePermission("audit-log", "read")] }, async (_request, reply) => {
    try {
      const result = await fastify.pg.query(
        `SELECT id, head_hash, checked_rows, legacy_rows, provider, external_ref, payload, payload_digest, created_by, created_at
         FROM audit_head_anchors
         ORDER BY created_at DESC
         LIMIT 50`
      );
      return { anchors: (result.rows as AuditAnchorDbRow[]).map(auditAnchorRow) };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to fetch audit anchors") });
    }
  });

  fastify.post("/api/admin/audit-log/anchors", { onRequest: [fastify.authenticate, requirePermission("audit-log", "write")] }, async (request, reply) => {
    const body = request.body as { provider?: string; externalRef?: string; limit?: number } | undefined;
    try {
      const integrity = await verifyAuditIntegrity(fastify.pg, parsePositiveInt(body?.limit, 10000, 100000));
      if (!integrity.verified) return reply.status(409).send({ error: "Audit chain must verify before anchoring", integrity });
      if (!integrity.headHash) return reply.status(400).send({ error: "No audit head hash is available to anchor", integrity });
      const payload = {
        version: 1,
        product: "specora",
        kind: "audit-head-anchor",
        headHash: integrity.headHash,
        checkedRows: integrity.checked,
        legacyRows: integrity.legacyRows,
        anchoredAt: new Date().toISOString(),
      };
      const payloadText = JSON.stringify(payload);
      const payloadDigest = createHash("sha256").update(payloadText).digest("hex");
      const result = await fastify.pg.query(
        `INSERT INTO audit_head_anchors (head_hash, checked_rows, legacy_rows, provider, external_ref, payload, payload_digest, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, head_hash, checked_rows, legacy_rows, provider, external_ref, payload, payload_digest, created_by, created_at`,
        [
          integrity.headHash,
          integrity.checked,
          integrity.legacyRows,
          body?.provider?.trim() || "manual",
          body?.externalRef?.trim() || null,
          payloadText,
          payloadDigest,
          request.user?.id || null,
        ]
      );
      const anchor = auditAnchorRow(result.rows[0] as AuditAnchorDbRow);
      await recordAuditEvent(fastify, {
        actorId: request.user?.id,
        action: "audit.anchor.created",
        entityType: "AuditHeadAnchor",
        entityId: anchor.id,
        newValues: anchor,
        metadata: { source: "api.admin", surface: "admin-console", provider: anchor.provider },
      });
      return { anchor };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to anchor audit head") });
    }
  });
}
