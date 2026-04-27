import { FastifyInstance } from "fastify";
import { mkdirSync } from "fs";
import { join, resolve } from "path";
import { randomUUID } from "crypto";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";
import { enqueueJob } from "../services/jobQueue";
import { proposeTransform } from "../services/discoveryTransform";
import { applyDiscoveryRollback, approveAllSafeStagedRecords, commitStagedDiscoveryJob, getStagedDiscoveryJob, listDiscoveryRollbacks, previewDiscoveryPipelineWithReconciliation, updateStagedDiscoveryRecords } from "../services/discoveryExecution";
import { nextDiscoveryRunAt, normalizeScheduleInterval, runSavedDiscoveryPipeline } from "../services/discoveryScheduler";
import { hasPermission, resolveUserRole } from "../services/rbac";
import { recordRouteAudit } from "./auditHelpers";
import { redactCredentialConfig, validateDiscoveryCredential } from "../services/credentials";

const UPLOAD_DIR = resolve(process.env.UPLOAD_DIR || "./uploads");
mkdirSync(UPLOAD_DIR, { recursive: true });

function mappingProfileRow(row: any) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    sourceType: row.source_type,
    targetClasses: typeof row.target_classes === "string" ? JSON.parse(row.target_classes || "[]") : row.target_classes || [],
    mapping: typeof row.mapping === "string" ? JSON.parse(row.mapping || "{}") : row.mapping || {},
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function collectorRow(row: any) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    site: row.site || "",
    version: row.version || "",
    labels: typeof row.labels === "string" ? JSON.parse(row.labels || "{}") : row.labels || {},
    config: typeof row.config === "string" ? JSON.parse(row.config || "{}") : row.config || {},
    lastHeartbeatAt: row.last_heartbeat_at || null,
    lastSeenIp: row.last_seen_ip || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function requireDiscoveryPermission(fastify: FastifyInstance, request: any, reply: any, action: "read" | "write") {
  const role = await resolveUserRole(fastify.pg, request.user as any);
  if (!role || !(await hasPermission(fastify.pg, { role, resource: "discovery", action }))) {
    reply.status(403).send({ error: `Forbidden: cannot ${action} discovery` });
    return false;
  }
  return true;
}

export async function discoveryRoutes(fastify: FastifyInstance) {
  fastify.get("/discovery/collectors", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "read"))) return;
    const result = await fastify.pg.query(
      `SELECT id, name, status, site, version, labels, config, last_heartbeat_at, last_seen_ip, created_at, updated_at
       FROM discovery_collectors
       ORDER BY COALESCE(last_heartbeat_at, created_at) DESC, name`
    );
    return { collectors: result.rows.map(collectorRow) };
  });

  fastify.post("/discovery/collectors", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "write"))) return;
    const body = request.body as { name?: string; site?: string; version?: string; labels?: Record<string, unknown>; config?: Record<string, unknown> };
    const name = body.name?.trim();
    if (!name) return reply.status(400).send({ error: "name is required" });
    const result = await fastify.pg.query(
      `INSERT INTO discovery_collectors (name, status, site, version, labels, config, created_by, updated_by)
       VALUES ($1, 'registered', $2, $3, $4, $5, $6, $6)
       ON CONFLICT (name) DO UPDATE SET
         site = EXCLUDED.site,
         version = EXCLUDED.version,
         labels = EXCLUDED.labels,
         config = EXCLUDED.config,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING id, name, status, site, version, labels, config, last_heartbeat_at, last_seen_ip, created_at, updated_at`,
      [
        name.slice(0, 160),
        body.site?.trim() || null,
        body.version?.trim() || null,
        JSON.stringify(body.labels || {}),
        JSON.stringify(body.config || {}),
        (request.user as any)?.id || null,
      ]
    );
    const collector = collectorRow(result.rows[0]);
    await recordRouteAudit(fastify, request, {
      action: "discovery.collector_registered",
      entityType: "DiscoveryCollector",
      entityId: collector.id,
      newValues: collector,
      metadata: { source: "api.discovery", surface: "discovery" },
    });
    return { collector };
  });

  fastify.post("/discovery/collectors/:id/heartbeat", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "write"))) return;
    const { id } = request.params as { id: string };
    const body = request.body as { status?: string; version?: string; labels?: Record<string, unknown>; stats?: Record<string, unknown> };
    const status = ["healthy", "degraded", "offline"].includes(body.status || "") ? body.status as string : "healthy";
    const result = await fastify.pg.query(
      `UPDATE discovery_collectors
       SET status = $2,
           version = COALESCE($3, version),
           labels = COALESCE($4::jsonb, labels),
           config = config || $5::jsonb,
           last_heartbeat_at = NOW(),
           last_seen_ip = $6,
           updated_by = $7,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, status, site, version, labels, config, last_heartbeat_at, last_seen_ip, created_at, updated_at`,
      [
        id,
        status,
        body.version?.trim() || null,
        body.labels ? JSON.stringify(body.labels) : null,
        JSON.stringify({ lastStats: body.stats || {} }),
        request.ip,
        (request.user as any)?.id || null,
      ]
    );
    if (!result.rows.length) return reply.status(404).send({ error: "Collector not found" });
    const collector = collectorRow(result.rows[0]);
    await recordRouteAudit(fastify, request, {
      action: "discovery.collector_heartbeat",
      entityType: "DiscoveryCollector",
      entityId: collector.id,
      newValues: collector,
      metadata: { source: "api.discovery", surface: "discovery", status },
    });
    return { collector };
  });

  fastify.get("/discovery/credential-references", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "read"))) return;
    const result = await fastify.pg.query(
      `SELECT id, ref, name, provider, last_tested_at, last_status, last_error
       FROM credential_references
       WHERE status = 'active' AND scope = 'discovery'
       ORDER BY name, ref`
    );
    return {
      credentials: result.rows.map((row: any) => ({
        id: row.id,
        ref: row.ref,
        name: row.name,
        provider: row.provider,
        lastTestedAt: row.last_tested_at || null,
        lastStatus: row.last_status || null,
        lastError: row.last_error || null,
      })),
    };
  });

  fastify.get("/discovery/mapping-profiles", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "read"))) return;
    const result = await fastify.pg.query(
      `SELECT id, name, description, source_type, target_classes, mapping, created_by, updated_by, created_at, updated_at
       FROM discovery_mapping_profiles
       ORDER BY updated_at DESC, name
       LIMIT 100`
    );
    return { profiles: result.rows.map(mappingProfileRow) };
  });

  fastify.post("/discovery/mapping-profiles", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "write"))) return;
    const body = request.body as { name?: string; description?: string; sourceType?: string; targetClasses?: unknown[]; mapping?: unknown };
    if (!body.name?.trim() || !body.mapping || typeof body.mapping !== "object") {
      return reply.status(400).send({ error: "name and mapping are required" });
    }
    const result = await fastify.pg.query(
      `INSERT INTO discovery_mapping_profiles (name, description, source_type, target_classes, mapping, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       ON CONFLICT (name) DO UPDATE SET
         description = EXCLUDED.description,
         source_type = EXCLUDED.source_type,
         target_classes = EXCLUDED.target_classes,
         mapping = EXCLUDED.mapping,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING id, name, description, source_type, target_classes, mapping, created_by, updated_by, created_at, updated_at`,
      [
        body.name.trim().slice(0, 160),
        body.description?.trim() || "",
        body.sourceType?.trim() || "generic",
        JSON.stringify(body.targetClasses || []),
        JSON.stringify(body.mapping),
        (request.user as any)?.id || null,
      ]
    );
    const profile = mappingProfileRow(result.rows[0]);
    await recordRouteAudit(fastify, request, {
      action: "discovery.mapping_profile_saved",
      entityType: "DiscoveryMappingProfile",
      entityId: profile.id,
      newValues: profile,
      metadata: { source: "api.discovery", surface: "discovery", sourceType: profile.sourceType },
    });
    return { profile };
  });

  fastify.put("/discovery/mapping-profiles/:id", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "write"))) return;
    const { id } = request.params as { id: string };
    const body = request.body as { name?: string; description?: string; sourceType?: string; targetClasses?: unknown[]; mapping?: unknown };
    if (!body.name?.trim() || !body.mapping || typeof body.mapping !== "object") {
      return reply.status(400).send({ error: "name and mapping are required" });
    }
    const result = await fastify.pg.query(
      `UPDATE discovery_mapping_profiles
       SET name = $2,
           description = $3,
           source_type = $4,
           target_classes = $5,
           mapping = $6,
           updated_by = $7,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, description, source_type, target_classes, mapping, created_by, updated_by, created_at, updated_at`,
      [
        id,
        body.name.trim().slice(0, 160),
        body.description?.trim() || "",
        body.sourceType?.trim() || "generic",
        JSON.stringify(body.targetClasses || []),
        JSON.stringify(body.mapping),
        (request.user as any)?.id || null,
      ]
    );
    if (!result.rows.length) return reply.status(404).send({ error: "Mapping profile not found" });
    const profile = mappingProfileRow(result.rows[0]);
    await recordRouteAudit(fastify, request, {
      action: "discovery.mapping_profile_updated",
      entityType: "DiscoveryMappingProfile",
      entityId: id,
      newValues: profile,
      metadata: { source: "api.discovery", surface: "discovery", sourceType: profile.sourceType },
    });
    return { profile };
  });

  fastify.delete("/discovery/mapping-profiles/:id", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "write"))) return;
    const { id } = request.params as { id: string };
    const result = await fastify.pg.query(
      `DELETE FROM discovery_mapping_profiles
       WHERE id = $1
       RETURNING id, name, description, source_type, target_classes, mapping, created_by, updated_by, created_at, updated_at`,
      [id]
    );
    if (!result.rows.length) return reply.status(404).send({ error: "Mapping profile not found" });
    const profile = mappingProfileRow(result.rows[0]);
    await recordRouteAudit(fastify, request, {
      action: "discovery.mapping_profile_deleted",
      entityType: "DiscoveryMappingProfile",
      entityId: id,
      oldValues: profile,
      metadata: { source: "api.discovery", surface: "discovery" },
    });
    return { ok: true };
  });

  fastify.post("/discovery/mapping-profiles/:id/apply", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "read"))) return;
    const { id } = request.params as { id: string };
    const result = await fastify.pg.query(
      `SELECT id, name, description, source_type, target_classes, mapping, created_by, updated_by, created_at, updated_at
       FROM discovery_mapping_profiles
       WHERE id = $1`,
      [id]
    );
    if (!result.rows.length) return reply.status(404).send({ error: "Mapping profile not found" });
    const profile = mappingProfileRow(result.rows[0]);
    await recordRouteAudit(fastify, request, {
      action: "discovery.mapping_profile_applied",
      entityType: "DiscoveryMappingProfile",
      entityId: id,
      metadata: { source: "api.discovery", surface: "discovery", sourceType: profile.sourceType },
    });
    return { profile, definitionPatch: { proposal: profile.mapping, targetClasses: profile.targetClasses } };
  });

  fastify.get("/discovery/pipelines", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "read"))) return;
    const result = await fastify.pg.query(
      `SELECT id, name, description, status, version, definition, published_definition, last_published_at, last_run_at, created_at, updated_at
       FROM discovery_pipelines
       ORDER BY updated_at DESC
       LIMIT 50`
    );
    return result.rows;
  });

  fastify.get("/discovery/pipelines/:id", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "read"))) return;
    const { id } = request.params as { id: string };
    const result = await fastify.pg.query(
      `SELECT id, name, description, status, version, definition, published_definition, last_published_at, last_run_at, created_at, updated_at
       FROM discovery_pipelines
       WHERE id = $1`,
      [id]
    );
    if (!result.rows.length) return reply.status(404).send({ error: "Pipeline not found" });
    return result.rows[0];
  });

  fastify.post("/discovery/pipelines", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "write"))) return;
    const body = request.body as { name?: string; description?: string; status?: string; definition?: unknown };
    const result = await fastify.pg.query(
      `INSERT INTO discovery_pipelines (name, description, status, definition, version)
       VALUES ($1, $2, $3, $4, 1)
       RETURNING id, name, description, status, version, definition, published_definition, last_published_at, last_run_at, created_at, updated_at`,
      [body.name || "Untitled discovery pipeline", body.description || null, body.status || "draft", body.definition || {}]
    );
    await recordRouteAudit(fastify, request, {
      action: "discovery.pipeline_created",
      entityType: "DiscoveryPipeline",
      entityId: result.rows[0].id,
      newValues: result.rows[0],
      metadata: { source: "api.discovery", surface: "discovery" },
    });
    return result.rows[0];
  });

  fastify.put("/discovery/pipelines/:id", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "write"))) return;
    const { id } = request.params as { id: string };
    const body = request.body as { name?: string; description?: string; status?: string; definition?: unknown };
    const result = await fastify.pg.query(
      `UPDATE discovery_pipelines
       SET name = $2,
           description = $3,
           status = $4,
           definition = $5,
           version = version + 1,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, description, status, version, definition, published_definition, last_published_at, last_run_at, created_at, updated_at`,
      [id, body.name || "Untitled discovery pipeline", body.description || null, body.status || "draft", body.definition || {}]
    );
    if (!result.rows.length) return reply.status(404).send({ error: "Pipeline not found" });
    await recordRouteAudit(fastify, request, {
      action: "discovery.pipeline_updated",
      entityType: "DiscoveryPipeline",
      entityId: id,
      newValues: result.rows[0],
      metadata: { source: "api.discovery", surface: "discovery" },
    });
    return result.rows[0];
  });

  fastify.delete("/discovery/pipelines/:id", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "write"))) return;
    const { id } = request.params as { id: string };
    const result = await fastify.pg.query("DELETE FROM discovery_pipelines WHERE id = $1 RETURNING id", [id]);
    await recordRouteAudit(fastify, request, {
      action: "discovery.pipeline_deleted",
      entityType: "DiscoveryPipeline",
      entityId: id,
      oldValues: result.rows[0] || { id },
      metadata: { source: "api.discovery", surface: "discovery", deleted: result.rows.length > 0 },
    });
    return { deleted: result.rows.length > 0 };
  });

  fastify.post("/discovery/pipelines/:id/publish", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "write"))) return;
    const { id } = request.params as { id: string };
    const result = await fastify.pg.query(
      `UPDATE discovery_pipelines
       SET published_definition = definition,
           status = 'published',
           last_published_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, description, status, version, definition, published_definition, last_published_at, last_run_at, created_at, updated_at`,
      [id]
    );
    if (!result.rows.length) return reply.status(404).send({ error: "Pipeline not found" });
    await recordRouteAudit(fastify, request, {
      action: "discovery.pipeline_published",
      entityType: "DiscoveryPipeline",
      entityId: id,
      newValues: result.rows[0],
      metadata: { source: "api.discovery", surface: "discovery" },
    });
    return result.rows[0];
  });

  fastify.post("/discovery/sources/:id/test", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "write"))) return;
    const { id } = request.params as { id: string };
    const result = await fastify.pg.query("SELECT id, type, config, credential_ref FROM discovery_sources WHERE id = $1", [id]);
    if (!result.rows.length) return reply.status(404).send({ error: "Source not found" });
    const source = result.rows[0];
    const config = source.config || {};
    const validation = await validateDiscoveryCredential(fastify, source.type, config, source.credential_ref || config.credentialRef);
    const status = validation.status;
    const error = validation.message;
    const updated = await fastify.pg.query(
      `UPDATE discovery_sources
       SET last_tested_at = NOW(), last_status = $2, last_error = $3, updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, type, config, credential_ref, last_tested_at, last_status, last_error, created_at, updated_at`,
      [id, status, error]
    );
    await recordRouteAudit(fastify, request, {
      action: "discovery.source_tested",
      entityType: "DiscoverySource",
      entityId: id,
      newValues: {
        ok: validation.ok,
        source: {
          ...updated.rows[0],
          config: redactCredentialConfig(updated.rows[0]?.config || {}),
        },
        credential: validation.credential,
      },
      metadata: { source: "api.discovery", surface: "discovery", status },
    });
    return { ok: validation.ok, status, message: error, credential: validation.credential, source: updated.rows[0] };
  });

  fastify.get("/discovery/pipelines/:id/schedule", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "read"))) return;
    const { id } = request.params as { id: string };
    const result = await fastify.pg.query(
      `SELECT pipeline_id, enabled, interval, next_run_at, last_run_at, last_discovery_job_id, last_status, last_error, updated_at
       FROM discovery_pipeline_schedules WHERE pipeline_id = $1`,
      [id]
    );
    return result.rows[0] || { pipeline_id: id, enabled: false, interval: "manual", next_run_at: null, last_run_at: null, last_discovery_job_id: null, last_status: null, last_error: null };
  });

  fastify.put("/discovery/pipelines/:id/schedule", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "write"))) return;
    const { id } = request.params as { id: string };
    const body = request.body as { enabled?: boolean; interval?: string; nextRunAt?: string | null };
    const interval = normalizeScheduleInterval(body.interval);
    const nextRunAt = interval === "manual"
      ? null
      : body.nextRunAt || (body.enabled ? nextDiscoveryRunAt(interval)?.toISOString() : null);
    const result = await fastify.pg.query(
      `INSERT INTO discovery_pipeline_schedules (pipeline_id, enabled, interval, next_run_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (pipeline_id) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         interval = EXCLUDED.interval,
         next_run_at = EXCLUDED.next_run_at,
         updated_at = NOW()
       RETURNING pipeline_id, enabled, interval, next_run_at, last_run_at, last_discovery_job_id, last_status, last_error, updated_at`,
      [id, !!body.enabled, interval, nextRunAt]
    );
    await recordRouteAudit(fastify, request, {
      action: "discovery.schedule_updated",
      entityType: "DiscoveryPipeline",
      entityId: id,
      newValues: result.rows[0],
      metadata: { source: "api.discovery", surface: "discovery", interval, enabled: !!body.enabled },
    });
    return result.rows[0];
  });

  fastify.post("/discovery/pipelines/preview", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "read"))) return;
    const body = request.body as {
      definition?: any;
      targetClasses?: Array<{ name: string; displayName?: string; attributes?: Array<{ name: string; isMandatory?: boolean; isKeyAttribute?: boolean }> }>;
    };
    return previewDiscoveryPipelineWithReconciliation(fastify, body.definition || {}, body.targetClasses || []);
  });

  fastify.post("/discovery/pipelines/:id/preview", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "read"))) return;
    const { id } = request.params as { id: string };
    const body = request.body as {
      targetClasses?: Array<{ name: string; displayName?: string; attributes?: Array<{ name: string; isMandatory?: boolean; isKeyAttribute?: boolean }> }>;
    };
    const result = await fastify.pg.query("SELECT definition FROM discovery_pipelines WHERE id = $1", [id]);
    if (!result.rows.length) return reply.status(404).send({ error: "Pipeline not found" });
    return previewDiscoveryPipelineWithReconciliation(fastify, result.rows[0].definition || {}, body.targetClasses || []);
  });

  fastify.post("/discovery/pipelines/:id/run", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "write"))) return;
    const { id } = request.params as { id: string };
    const body = request.body as {
      targetClasses?: Array<{ name: string; displayName?: string; attributes?: Array<{ name: string; isMandatory?: boolean; isKeyAttribute?: boolean }> }>;
    };
    const result = await runSavedDiscoveryPipeline(fastify, id, body.targetClasses || [], "manual");
    if (!result.ok && result.status === "not_found") return reply.status(404).send({ error: result.error });
    if (!result.ok) return reply.status(400).send({ error: result.error, preview: result.preview });
    await recordRouteAudit(fastify, request, {
      action: "discovery.pipeline_run_staged",
      entityType: "DiscoveryJob",
      entityId: result.discoveryJobId,
      newValues: { jobId: result.discoveryJobId, status: "staged", preview: result.preview },
      metadata: { source: "api.discovery", surface: "discovery", pipelineId: id },
    });
    return { jobId: result.discoveryJobId, status: "staged", preview: result.preview };
  });

  fastify.get("/discovery/jobs/:id/staged", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "read"))) return;
    const { id } = request.params as { id: string };
    const staged = await getStagedDiscoveryJob(fastify, id);
    if (!staged) return reply.status(404).send({ error: "Job not found" });
    return staged;
  });

  fastify.post("/discovery/jobs/:id/staged/approve-safe", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "write"))) return;
    const { id } = request.params as { id: string };
    const result = await approveAllSafeStagedRecords(fastify, id);
    await recordRouteAudit(fastify, request, {
      action: "discovery.staged_records_approved",
      entityType: "DiscoveryJob",
      entityId: id,
      newValues: result as Record<string, unknown>,
      metadata: { source: "api.discovery", surface: "discovery" },
    });
    return result;
  });

  fastify.post("/discovery/jobs/:id/staged/status", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "write"))) return;
    const { id } = request.params as { id: string };
    const body = request.body as { recordIds?: string[]; status?: "approved" | "skipped" };
    if (!body.recordIds?.length || !["approved", "skipped"].includes(body.status || "")) {
      return reply.status(400).send({ error: "recordIds and valid status are required" });
    }
    const result = await updateStagedDiscoveryRecords(fastify, id, body.recordIds, body.status!);
    await recordRouteAudit(fastify, request, {
      action: "discovery.staged_records_status_updated",
      entityType: "DiscoveryJob",
      entityId: id,
      newValues: result as Record<string, unknown>,
      metadata: { source: "api.discovery", surface: "discovery", status: body.status, recordCount: body.recordIds.length },
    });
    return result;
  });

  fastify.post("/discovery/jobs/:id/commit", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "write"))) return;
    const { id } = request.params as { id: string };
    const result = await commitStagedDiscoveryJob(fastify, id, (request.user as any)?.id);
    if (!result) return reply.status(404).send({ error: "Job not found" });
    if (result.blocked) return reply.status(409).send({ error: "Staged discovery has blocking issues", ...result });
    await recordRouteAudit(fastify, request, {
      action: "discovery.job_committed",
      entityType: "DiscoveryJob",
      entityId: id,
      newValues: result,
      metadata: { source: "api.discovery", surface: "discovery" },
    });
    return result;
  });

  fastify.get("/discovery/rollbacks", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "read"))) return;
    const query = request.query as { jobId?: string };
    return { rollbacks: await listDiscoveryRollbacks(fastify, query.jobId) };
  });

  fastify.get("/discovery/jobs/:id/rollback", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "read"))) return;
    const { id } = request.params as { id: string };
    return { rollbacks: await listDiscoveryRollbacks(fastify, id) };
  });

  fastify.post("/discovery/rollbacks/:id/apply", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "write"))) return;
    const { id } = request.params as { id: string };
    const result = await applyDiscoveryRollback(fastify, id, (request.user as any)?.id);
    if (!result) return reply.status(404).send({ error: "Rollback not found" });
    await recordRouteAudit(fastify, request, {
      action: "discovery.rollback_applied",
      entityType: "DiscoveryRollback",
      entityId: id,
      newValues: result,
      metadata: { source: "api.discovery", surface: "discovery", alreadyApplied: result.alreadyApplied },
    });
    return result;
  });

  fastify.post("/discovery/ai/propose-transform", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "read"))) return;
    const body = request.body as {
      sourceName?: string;
      columns?: string[];
      sampleRows?: Record<string, unknown>[];
      targetClasses?: Array<{ name: string; displayName?: string; attributes?: Array<{ name: string; isMandatory?: boolean; isKeyAttribute?: boolean }> }>;
    };
    if (!body.columns?.length) {
      return reply.status(400).send({ error: "At least one source column is required" });
    }
    return proposeTransform(
      {
        sourceName: body.sourceName || "Discovery source",
        columns: body.columns,
        sampleRows: (body.sampleRows || []).slice(0, 20),
      },
      body.targetClasses || []
    );
  });

  fastify.post("/discovery/upload", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "write"))) return;
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: "No file uploaded" });
    }

    const fileName = `${randomUUID()}-${data.filename}`;
    const filePath = join(UPLOAD_DIR, fileName);
    await pipeline(data.file, createWriteStream(filePath));

    const result = await fastify.pg.query(
      "INSERT INTO discovery_jobs (file_path, status) VALUES ($1, 'pending') RETURNING id",
      [filePath]
    );
    const discoveryJobId = result.rows[0].id;

    // Also enqueue in the unified job queue for worker processing
    await enqueueJob(fastify, "discovery", { filePath, discoveryJobId }, 0);
    await recordRouteAudit(fastify, request, {
      action: "discovery.upload_queued",
      entityType: "DiscoveryJob",
      entityId: discoveryJobId,
      newValues: { jobId: discoveryJobId, fileName, status: "pending" },
      metadata: { source: "api.discovery", surface: "discovery" },
    });

    return { jobId: discoveryJobId, fileName, status: "pending" };
  });

  fastify.get("/discovery/jobs/:id", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "read"))) return;
    const { id } = request.params as { id: string };
    const result = await fastify.pg.query(
      "SELECT id, file_path, status, stats, created_at, updated_at FROM discovery_jobs WHERE id = $1",
      [id]
    );
    if (!result.rows.length) {
      return reply.status(404).send({ error: "Job not found" });
    }
    return result.rows[0];
  });
}
