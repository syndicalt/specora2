import { FastifyInstance } from "fastify";
import { mkdirSync } from "fs";
import { join, resolve } from "path";
import { createHash, randomUUID } from "crypto";
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

function hashEnrollmentToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function authenticateCollectorOrUser(fastify: FastifyInstance, request: any, reply: any) {
  try {
    await fastify.authenticate(request, reply);
    request.authKind = "user";
    return;
  } catch {
    const header = request.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return reply.status(401).send({ error: "Unauthorized" });
    try {
      const payload = await (fastify as any).jwt.verify(token);
      if (payload?.typ !== "collector" || !payload.collectorId) {
        return reply.status(401).send({ error: "Invalid collector token" });
      }
      request.user = { role: "collector", type: "collector" };
      request.collector = payload;
      request.authKind = "collector";
    } catch {
      return reply.status(401).send({ error: "Invalid collector token" });
    }
  }
}

async function requireDiscoveryPermission(fastify: FastifyInstance, request: any, reply: any, action: "read" | "write") {
  if (request.authKind === "collector" && action === "write") return true;
  const role = await resolveUserRole(fastify.pg, request.user as any);
  if (!role || !(await hasPermission(fastify.pg, { role, resource: "discovery", action }))) {
    reply.status(403).send({ error: `Forbidden: cannot ${action} discovery` });
    return false;
  }
  return true;
}

type CollectorEnrollmentInput = {
  token?: string;
  registration_token?: string;
  enrollmentToken?: string;
  enrollment_token?: string;
  name?: string;
  hostname?: string;
  serverName?: string;
  version?: string;
  capabilities?: string[];
  labels?: Record<string, unknown>;
  stats?: Record<string, unknown>;
};

type EvidenceRecord = {
  schema?: string;
  source?: { type?: string; id?: string };
  subject?: { type?: string; id?: string };
  observed_at?: string;
  facts?: Record<string, unknown>;
  relationships?: unknown[];
  confidence?: number;
  metadata?: Record<string, unknown>;
  signature?: string;
  signing_key_id?: string;
};

function decodeUploadChunk(data: unknown): string {
  if (typeof data === "string") return Buffer.from(data, "base64").toString("utf8");
  if (Array.isArray(data)) return Buffer.from(data as number[]).toString("utf8");
  return "";
}

function parseEvidenceRecords(rawText: string): { records: EvidenceRecord[]; error?: string } {
  const text = rawText.trim();
  if (!text) return { records: [] };
  const lines = text.includes("\n") ? text.split(/\r?\n/) : [text];
  const records: EvidenceRecord[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const record = JSON.parse(line) as EvidenceRecord;
      if (record.schema !== "specora.evidence.v1") return { records: [], error: `record ${index + 1} schema is not specora.evidence.v1` };
      if (!record.source?.type || !record.source?.id) return { records: [], error: `record ${index + 1} source is incomplete` };
      if (!record.subject?.type || !record.subject?.id) return { records: [], error: `record ${index + 1} subject is incomplete` };
      if (!record.observed_at || Number.isNaN(new Date(record.observed_at).getTime())) return { records: [], error: `record ${index + 1} observed_at is invalid` };
      if (!record.facts || !Object.keys(record.facts).length) return { records: [], error: `record ${index + 1} facts are required` };
      records.push(record);
    } catch (err: any) {
      return { records: [], error: `record ${index + 1} is not valid JSON: ${err.message}` };
    }
  }
  return { records };
}

function naturalKeyForEvidence(record: EvidenceRecord) {
  const facts = record.facts || {};
  return String(facts.uuid || facts.hostname || facts.name || facts.address || facts.port || record.subject?.id || "unknown");
}

async function ingestEvidenceDocument(fastify: FastifyInstance, document: any) {
  const parsed = parseEvidenceRecords(document.raw_text || "");
  if (parsed.error) {
    await fastify.pg.query(
      `UPDATE edge_evidence_documents
       SET verification_status = 'invalid_evidence', updated_at = NOW()
       WHERE id = $1`,
      [document.id]
    );
    return { records: 0, status: "invalid_evidence", error: parsed.error };
  }

  await fastify.pg.query("DELETE FROM discovery_observations WHERE document_id = $1", [document.id]);
  for (const record of parsed.records) {
    await fastify.pg.query(
      `INSERT INTO discovery_observations
         (collector_id, document_id, run_id, source_type, source_id, subject_type, subject_id, entity_type, natural_key, observed_at, facts, relationships, confidence, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $6, $8, $9, $10, $11, $12, $13)`,
      [
        document.collector_id,
        document.id,
        document.run_id,
        record.source?.type,
        record.source?.id,
        record.subject?.type,
        record.subject?.id,
        naturalKeyForEvidence(record),
        record.observed_at,
        JSON.stringify(record.facts || {}),
        JSON.stringify(record.relationships || []),
        typeof record.confidence === "number" ? record.confidence : null,
        JSON.stringify(record.metadata || {}),
      ]
    );
  }

  await fastify.pg.query(
    `UPDATE edge_evidence_documents
     SET schema_version = $2,
         record_count = $3,
         verification_status = $4,
         signature = $5,
         signing_key_id = $6,
         updated_at = NOW()
     WHERE id = $1`,
    [
      document.id,
      parsed.records[0]?.schema || null,
      parsed.records.length,
      parsed.records.length ? "parsed" : "empty",
      parsed.records.find((record) => record.signature)?.signature || null,
      parsed.records.find((record) => record.signing_key_id)?.signing_key_id || null,
    ]
  );
  return { records: parsed.records.length, status: parsed.records.length ? "parsed" : "empty" };
}

async function enrollCollector(fastify: FastifyInstance, request: any, reply: any) {
  const body = request.body as CollectorEnrollmentInput;
  const rawToken = (body.token || body.registration_token || body.enrollmentToken || body.enrollment_token || "").trim();
  if (!rawToken) {
    reply.status(400).send({ error: "registration_token is required" });
    return null;
  }

  const tokenResult = await fastify.pg.query(
    `SELECT id, name, site, labels, uses, max_uses, collector_id
     FROM discovery_collector_enrollment_tokens
     WHERE token_hash = $1
       AND revoked_at IS NULL
       AND expires_at > NOW()
       AND uses < max_uses
     FOR UPDATE`,
    [hashEnrollmentToken(rawToken)]
  );
  const enrollment = tokenResult.rows[0];
  if (!enrollment) {
    reply.status(401).send({ error: "Enrollment token is invalid or expired" });
    return null;
  }

  const enrollmentLabels = typeof enrollment.labels === "string" ? JSON.parse(enrollment.labels || "{}") : enrollment.labels || {};
  const labels = { ...enrollmentLabels, ...(body.labels || {}) };
  const name = (body.name || body.hostname || body.serverName || enrollment.name || `edge-${randomUUID()}`).trim();
  const collectorResult = await fastify.pg.query(
    `INSERT INTO discovery_collectors (name, status, site, version, labels, config, created_by, updated_by, last_heartbeat_at, last_seen_ip)
     VALUES ($1, 'healthy', $2, $3, $4, $5, NULL, NULL, NOW(), $6)
     ON CONFLICT (name) DO UPDATE SET
       status = 'healthy',
       site = COALESCE(EXCLUDED.site, discovery_collectors.site),
       version = COALESCE(EXCLUDED.version, discovery_collectors.version),
       labels = discovery_collectors.labels || EXCLUDED.labels,
       config = discovery_collectors.config || EXCLUDED.config,
       last_heartbeat_at = NOW(),
       last_seen_ip = EXCLUDED.last_seen_ip,
       updated_at = NOW()
     RETURNING id, name, status, site, version, labels, config, last_heartbeat_at, last_seen_ip, created_at, updated_at`,
    [
      name.slice(0, 160),
      enrollment.site || null,
      body.version?.trim() || null,
      JSON.stringify(labels),
      JSON.stringify({ enrollmentTokenId: enrollment.id, capabilities: body.capabilities || [], lastStats: body.stats || {} }),
      request.ip,
    ]
  );
  const collector = collectorRow(collectorResult.rows[0]);
  await fastify.pg.query(
    `UPDATE discovery_collector_enrollment_tokens
     SET uses = uses + 1, collector_id = $2, updated_at = NOW()
     WHERE id = $1`,
    [enrollment.id, collector.id]
  );
  const collectorToken = await (fastify as any).jwt.sign(
    { typ: "collector", collectorId: collector.id, collectorName: collector.name, scope: "discovery" },
    { expiresIn: process.env.COLLECTOR_TOKEN_EXPIRES_IN || "30d" }
  );
  await recordRouteAudit(fastify, request, {
    action: "discovery.collector_enrolled",
    entityType: "DiscoveryCollector",
    entityId: collector.id,
    newValues: collector,
    metadata: { source: "api.discovery", surface: "edge-enrollment", enrollmentTokenId: enrollment.id },
  });
  return { collector, collectorToken, tokenType: "Bearer", expiresIn: process.env.COLLECTOR_TOKEN_EXPIRES_IN || "30d" };
}

export async function discoveryRoutes(fastify: FastifyInstance) {
  fastify.post("/edge/enroll", async (request, reply) => {
    const enrollment = await enrollCollector(fastify, request, reply);
    if (!enrollment) return;
    return {
      tenant_id: process.env.SPECORA_TENANT_ID || process.env.PROVARA_TENANT_ID || "default",
      relay_id: enrollment.collector.id,
      key_id: enrollment.collector.id,
      policy_version: process.env.EDGE_POLICY_VERSION || "policy-v1",
      collector_token: enrollment.collectorToken,
    };
  });

  fastify.post("/edge/heartbeat", async (request, reply) => {
    const body = request.body as {
      tenant_id?: string;
      relay_id?: string;
      version?: string;
      capabilities?: string[];
      queue_depth?: number;
      uptime_seconds?: number;
      healthy?: boolean;
    };
    const relayId = body.relay_id?.trim();
    if (!relayId) return reply.status(400).send({ error: "relay_id is required" });
    const status = body.healthy === false ? "degraded" : "healthy";
    const result = await fastify.pg.query(
      `UPDATE discovery_collectors
       SET status = $2,
           version = COALESCE($3, version),
           config = config || $4::jsonb,
           last_heartbeat_at = NOW(),
           last_seen_ip = $5,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, status, site, version, labels, config, last_heartbeat_at, last_seen_ip, created_at, updated_at`,
      [
        relayId,
        status,
        body.version?.trim() || null,
        JSON.stringify({
          capabilities: body.capabilities || [],
          lastStats: {
            queueDepth: Number(body.queue_depth || 0),
            uptimeSeconds: Number(body.uptime_seconds || 0),
            healthy: body.healthy !== false,
          },
          tenantId: body.tenant_id || null,
        }),
        request.ip,
      ]
    );
    if (!result.rows.length) return reply.status(404).send({ error: "Collector not found" });
    const collector = collectorRow(result.rows[0]);
    await recordRouteAudit(fastify, request, {
      action: "discovery.collector_heartbeat",
      entityType: "DiscoveryCollector",
      entityId: collector.id,
      newValues: collector,
      metadata: { source: "api.edge", surface: "edge", status },
    });
    return { accepted: true, policy_version: process.env.EDGE_POLICY_VERSION || "policy-v1" };
  });

  fastify.post("/edge/uploads/session", async (request, reply) => {
    const body = request.body as { tenant_id?: string; relay_id?: string; upload_id?: string; run_id?: string; digest?: string; byte_count?: number };
    const relayId = body.relay_id?.trim();
    const uploadId = body.upload_id?.trim();
    const runId = body.run_id?.trim();
    if (!relayId || !uploadId || !runId) return reply.status(400).send({ error: "relay_id, upload_id, and run_id are required" });

    const collector = await fastify.pg.query("SELECT id FROM discovery_collectors WHERE id = $1", [relayId]);
    if (!collector.rows.length) return reply.status(404).send({ error: "Collector not found" });

    const result = await fastify.pg.query(
      `INSERT INTO edge_evidence_documents
         (tenant_id, collector_id, upload_id, run_id, digest, byte_count, storage_class)
       VALUES ($1, $2, $3, $4, $5, $6, 'database')
       ON CONFLICT (collector_id, upload_id) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id,
         run_id = EXCLUDED.run_id,
         digest = COALESCE(EXCLUDED.digest, edge_evidence_documents.digest),
         byte_count = GREATEST(edge_evidence_documents.byte_count, EXCLUDED.byte_count),
         updated_at = NOW()
       RETURNING id, upload_id, accepted_offset, complete, storage_class`,
      [
        body.tenant_id || null,
        relayId,
        uploadId,
        runId,
        body.digest || null,
        Number(body.byte_count || 0),
      ]
    );
    const row = result.rows[0];
    return {
      accepted: true,
      upload_id: row.upload_id,
      document_id: row.id,
      accepted_offset: Number(row.accepted_offset || 0),
      complete: Boolean(row.complete),
      storage_class: row.storage_class || "database",
    };
  });

  fastify.post("/edge/uploads/:id/chunks", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { tenant_id?: string; relay_id?: string; run_id?: string; offset?: number; data?: unknown; final?: boolean; digest?: string; byte_count?: number };
    const relayId = body.relay_id?.trim();
    const runId = body.run_id?.trim();
    if (!relayId || !runId) return reply.status(400).send({ error: "relay_id and run_id are required" });

    const existing = await fastify.pg.query(
      `SELECT id, collector_id, upload_id, run_id, accepted_offset, raw_text
       FROM edge_evidence_documents
       WHERE collector_id = $1 AND upload_id = $2`,
      [relayId, id]
    );
    const document = existing.rows[0];
    if (!document) return reply.status(404).send({ error: "Upload session not found" });
    const offset = Number(body.offset || 0);
    const acceptedOffset = Number(document.accepted_offset || 0);
    if (offset !== acceptedOffset) {
      return reply.status(409).send({ error: "Upload offset does not match accepted offset", accepted_offset: acceptedOffset });
    }

    const chunk = decodeUploadChunk(body.data);
    const nextText = `${document.raw_text || ""}${chunk}`;
    const nextOffset = acceptedOffset + Buffer.byteLength(chunk);
    const updated = await fastify.pg.query(
      `UPDATE edge_evidence_documents
       SET raw_text = $2,
           accepted_offset = $3,
           byte_count = GREATEST(byte_count, $4),
           digest = COALESCE($5, digest),
           complete = $6,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, collector_id, upload_id, run_id, raw_text, accepted_offset, complete`,
      [document.id, nextText, nextOffset, Number(body.byte_count || nextOffset), body.digest || null, Boolean(body.final)]
    );
    let ingest: { records: number; status: string; error?: string } = { records: 0, status: "pending" };
    if (body.final) {
      ingest = await ingestEvidenceDocument(fastify, updated.rows[0]);
      await recordRouteAudit(fastify, request, {
        action: "edge.evidence_uploaded",
        entityType: "EdgeEvidenceDocument",
        entityId: document.id,
        newValues: { uploadId: id, runId, collectorId: relayId, records: ingest.records, status: ingest.status, error: ingest.error },
        metadata: { source: "api.edge", surface: "edge", uploadId: id },
      });
    }

    return {
      accepted_offset: nextOffset,
      complete: Boolean(body.final),
      document_id: document.id,
      records: ingest.records,
      status: ingest.status,
      error: ingest.error,
    };
  });

  fastify.post("/discovery/collectors/enroll", async (request, reply) => {
    const enrollment = await enrollCollector(fastify, request, reply);
    if (!enrollment) return;
    return enrollment;
  });

  fastify.get("/discovery/collectors", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "read"))) return;
    const result = await fastify.pg.query(
      `SELECT id, name, status, site, version, labels, config, last_heartbeat_at, last_seen_ip, created_at, updated_at
       FROM discovery_collectors
       ORDER BY COALESCE(last_heartbeat_at, created_at) DESC, name`
    );
    return { collectors: result.rows.map(collectorRow) };
  });

  fastify.get("/discovery/collectors/:id/observations", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "read"))) return;
    const { id } = request.params as { id: string };
    const result = await fastify.pg.query(
      `SELECT id, document_id, run_id, source_type, source_id, subject_type, subject_id, entity_type, natural_key,
              observed_at, facts, relationships, confidence, metadata, freshness_status, created_at
       FROM discovery_observations
       WHERE collector_id = $1
       ORDER BY observed_at DESC, created_at DESC
       LIMIT 500`,
      [id]
    );
    return {
      observations: result.rows.map((row: any) => ({
        id: row.id,
        documentId: row.document_id,
        runId: row.run_id,
        sourceType: row.source_type,
        sourceId: row.source_id,
        subjectType: row.subject_type,
        subjectId: row.subject_id,
        entityType: row.entity_type,
        naturalKey: row.natural_key,
        observedAt: row.observed_at,
        facts: typeof row.facts === "string" ? JSON.parse(row.facts || "{}") : row.facts || {},
        relationships: typeof row.relationships === "string" ? JSON.parse(row.relationships || "[]") : row.relationships || [],
        confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
        metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata || "{}") : row.metadata || {},
        freshnessStatus: row.freshness_status,
        createdAt: row.created_at,
      })),
    };
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

  fastify.post("/discovery/collectors/:id/heartbeat", { onRequest: [(request: any, reply: any) => authenticateCollectorOrUser(fastify, request, reply)] }, async (request, reply) => {
    if (!(await requireDiscoveryPermission(fastify, request, reply, "write"))) return;
    const { id } = request.params as { id: string };
    if ((request as any).authKind === "collector" && (request as any).collector?.collectorId !== id) {
      return reply.status(403).send({ error: "Collector token cannot heartbeat another collector" });
    }
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
