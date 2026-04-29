import { FastifyInstance } from "fastify";
import { requirePermission } from "../../services/rbac";
import { recordAuditEvent } from "../../services/auditLog";

const NUMBER_SEQUENCE_OPTIONS = [
  { appId: "incident-manager", appName: "Incident Command Center", tableName: "incidents", recordType: "Incident", defaultPrefix: "INC" },
  { appId: "change-manager", appName: "Change Manager", tableName: "change_requests", recordType: "Change Request", defaultPrefix: "CHG" },
  { appId: "knowledge-core", appName: "Knowledge Core", tableName: "knowledge_items", recordType: "Knowledge", defaultPrefix: "KB" },
  { appId: "prevention-center", appName: "Prevention Center", tableName: "prevention_records", recordType: "Prevention Record", defaultPrefix: "PRV" },
  { appId: "asset-command", appName: "Asset Command Center", tableName: "asset_records", recordType: "Asset", defaultPrefix: "AST" },
  { appId: "customer-portal", appName: "Customer Portal", tableName: "catalog_requests", recordType: "Catalog Request", defaultPrefix: "REQ" },
  { appId: "discovery", appName: "Discovery", tableName: "discovery_pipelines", recordType: "Discovery Pipeline", defaultPrefix: "DISC" },
  { appId: "discovery", appName: "Discovery", tableName: "discovery_jobs", recordType: "Discovery Job", defaultPrefix: "DJOB" },
];

function findNumberSequenceOption(body: { appId?: string; tableName?: string; recordType?: string }) {
  return NUMBER_SEQUENCE_OPTIONS.find((option) =>
    option.appId === body.appId &&
    option.tableName === body.tableName &&
    option.recordType === body.recordType
  );
}

function normalizeSequenceConfig(body: { prefix?: string; nextValue?: number; padding?: number }) {
  const prefix = body.prefix?.trim().toUpperCase();
  const nextValue = Number(body.nextValue ?? 1);
  const padding = Number(body.padding ?? 6);
  if (!prefix || !/^[A-Z][A-Z0-9]{1,19}$/.test(prefix)) {
    return { error: "Prefix must be 2-20 uppercase letters or numbers and start with a letter" };
  }
  if (!Number.isInteger(nextValue) || nextValue < 1) {
    return { error: "nextValue must be a positive integer" };
  }
  if (!Number.isInteger(padding) || padding < 0 || padding > 12) {
    return { error: "padding must be an integer from 0 to 12" };
  }
  return { prefix, nextValue, padding };
}

export function registerAdminNumberSequenceRoutes(fastify: FastifyInstance) {
  fastify.get("/api/admin/number-sequences", { onRequest: [fastify.authenticate, requirePermission("number-sequences", "read")] }, async (_request, reply) => {
    try {
      const result = await fastify.pg.query(
        `SELECT id, app_id, table_name, record_type, prefix, next_value, padding, enabled, created_at, updated_at
         FROM number_sequences
         ORDER BY table_name`
      );
      return { sequences: result.rows };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to fetch number sequences" });
    }
  });

  fastify.get("/api/admin/number-sequences/options", { onRequest: [fastify.authenticate, requirePermission("number-sequences", "read")] }, async (_request) => {
    return { options: NUMBER_SEQUENCE_OPTIONS };
  });

  fastify.post("/api/admin/number-sequences", { onRequest: [fastify.authenticate, requirePermission("number-sequences", "write")] }, async (request, reply) => {
    const body = request.body as { appId?: string; tableName?: string; recordType?: string; prefix?: string; nextValue?: number; padding?: number; enabled?: boolean };
    const option = findNumberSequenceOption(body);
    if (!option) {
      return reply.status(400).send({ error: "Number sequences can only be created for registered app/table/record type combinations" });
    }
    const config = normalizeSequenceConfig({ prefix: body.prefix || option.defaultPrefix, nextValue: body.nextValue, padding: body.padding });
    if ("error" in config) {
      return reply.status(400).send({ error: config.error });
    }
    try {
      const result = await fastify.pg.query(
        `INSERT INTO number_sequences (app_id, table_name, record_type, prefix, next_value, padding, enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, app_id, table_name, record_type, prefix, next_value, padding, enabled, created_at, updated_at`,
        [option.appId, option.tableName, option.recordType, config.prefix, config.nextValue, config.padding, body.enabled !== false]
      );
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "number_sequence.created",
        entityType: "NumberSequence",
        entityId: result.rows[0].id,
        newValues: result.rows[0],
        metadata: { source: "api.admin", surface: "admin-console" },
      });
      return { sequence: result.rows[0] };
    } catch (err: any) {
      if (err.code === "23505") return reply.status(409).send({ error: "Sequence table or prefix already exists" });
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to create number sequence" });
    }
  });

  fastify.patch("/api/admin/number-sequences/:id", { onRequest: [fastify.authenticate, requirePermission("number-sequences", "write")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { appId?: string; recordType?: string; prefix?: string; nextValue?: number; padding?: number; enabled?: boolean };
    if (body.appId !== undefined || body.recordType !== undefined) {
      return reply.status(400).send({ error: "Sequence app, table, and record type are registry-owned and cannot be edited" });
    }
    const config = normalizeSequenceConfig({
      prefix: body.prefix || "ZZ",
      nextValue: body.nextValue,
      padding: body.padding,
    });
    if (body.prefix !== undefined && "error" in config) {
      return reply.status(400).send({ error: config.error });
    }
    if (body.nextValue !== undefined && (!Number.isInteger(Number(body.nextValue)) || Number(body.nextValue) < 1)) {
      return reply.status(400).send({ error: "nextValue must be a positive integer" });
    }
    if (body.padding !== undefined && (!Number.isInteger(Number(body.padding)) || Number(body.padding) < 0 || Number(body.padding) > 12)) {
      return reply.status(400).send({ error: "padding must be an integer from 0 to 12" });
    }
    try {
      const result = await fastify.pg.query(
        `UPDATE number_sequences
         SET app_id = COALESCE($2, app_id),
             record_type = COALESCE($3, record_type),
             prefix = COALESCE($4, prefix),
             next_value = COALESCE($5, next_value),
             padding = COALESCE($6, padding),
             enabled = COALESCE($7, enabled),
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, app_id, table_name, record_type, prefix, next_value, padding, enabled, created_at, updated_at`,
        [id, body.appId ?? null, body.recordType ?? null, body.prefix?.toUpperCase() ?? null, body.nextValue ?? null, body.padding ?? null, body.enabled ?? null]
      );
      if (!result.rows.length) return reply.status(404).send({ error: "Sequence not found" });
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "number_sequence.updated",
        entityType: "NumberSequence",
        entityId: id,
        newValues: result.rows[0],
        metadata: { source: "api.admin", surface: "admin-console" },
      });
      return { sequence: result.rows[0] };
    } catch (err: any) {
      if (err.code === "23505") return reply.status(409).send({ error: "Prefix already exists" });
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to update number sequence" });
    }
  });
}
