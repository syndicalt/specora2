import { FastifyInstance } from "fastify";
import { createHash } from "crypto";
import { subscribe } from "./eventBus";

type AuditEntry = {
  actor_id?: string;
  action: string;
  entity_type: string;
  entity_id: string;
  old_values?: Record<string, unknown>;
  new_values?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

type QueryablePg = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  connect?: () => Promise<QueryablePg & { release: () => void }>;
  totalCount?: number;
};

type AuditLogRow = {
  id: string;
  actor_id?: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  old_values?: unknown;
  new_values?: unknown;
  metadata?: unknown;
  previous_hash?: string | null;
  entry_hash?: string | null;
  created_at?: string | Date;
};

type AuditPayload = Record<string, unknown> & {
  actorId?: unknown;
  ciId?: unknown;
  sourceId?: unknown;
  targetId?: unknown;
  type?: unknown;
  oldValues?: unknown;
  newValues?: unknown;
  jobId?: unknown;
};

function auditPayload(payload: unknown): AuditPayload {
  return payload && typeof payload === "object" ? payload as AuditPayload : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeActorId(actorId?: string | null) {
  return actorId && UUID_PATTERN.test(actorId) ? actorId : null;
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashAuditPayload(payload: {
  previousHash?: string | null;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  oldValues?: unknown;
  newValues?: unknown;
  metadata?: unknown;
  createdAt: string;
}) {
  return createHash("sha256")
    .update([
      payload.previousHash || "",
      payload.actorId || "",
      payload.action,
      payload.entityType,
      payload.entityId,
      stableStringify(payload.oldValues),
      stableStringify(payload.newValues),
      stableStringify(payload.metadata),
      payload.createdAt,
    ].join("\n"))
    .digest("hex");
}

export async function persistAuditLog(fastify: FastifyInstance, entry: AuditEntry) {
  const pg = fastify.pg as QueryablePg;
  if (typeof pg.connect === "function" && typeof pg.totalCount === "number") {
    const client = await pg.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('specora.audit_log'))");
      await insertAuditLog(client, entry);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return;
  }
  await insertAuditLog(pg, entry);
}

async function insertAuditLog(pg: QueryablePg, entry: AuditEntry) {
  const actorId = normalizeActorId(entry.actor_id);
  const oldValues = entry.old_values || null;
  const newValues = entry.new_values || null;
  const metadata = entry.metadata || null;
  const previous = await pg.query("SELECT entry_hash FROM audit_log WHERE entry_hash IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT 1");
  const previousHash = (previous.rows[0] as { entry_hash?: string | null } | undefined)?.entry_hash || null;
  const createdAt = new Date().toISOString();
  const entryHash = hashAuditPayload({
    previousHash,
    actorId,
    action: entry.action,
    entityType: entry.entity_type,
    entityId: entry.entity_id,
    oldValues,
    newValues,
    metadata,
    createdAt,
  });
  await pg.query(
    `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, old_values, new_values, metadata, previous_hash, entry_hash, integrity_version, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10)`,
    [
      actorId,
      entry.action,
      entry.entity_type,
      entry.entity_id,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      metadata ? JSON.stringify(metadata) : null,
      previousHash,
      entryHash,
      createdAt,
    ]
  );
}

export type AuditEventInput = {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
};

export async function recordAuditEvent(fastify: FastifyInstance, input: AuditEventInput) {
  await persistAuditLog(fastify, {
    actor_id: input.actorId || undefined,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId,
    old_values: input.oldValues || undefined,
    new_values: input.newValues || undefined,
    metadata: {
      result: "success",
      ...input.metadata,
    },
  });
}

export function expectedAuditHash(row: AuditLogRow) {
  return hashAuditPayload({
    previousHash: row.previous_hash,
    actorId: row.actor_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    oldValues: row.old_values,
    newValues: row.new_values,
    metadata: row.metadata,
    createdAt: typeof row.created_at === "string" ? row.created_at : row.created_at?.toISOString?.() || String(row.created_at),
  });
}

export async function verifyAuditIntegrity(pg: QueryablePg, limit = 10000) {
  const result = await pg.query(
    `SELECT id, actor_id, action, entity_type, entity_id, old_values, new_values, metadata, previous_hash, entry_hash, created_at
     FROM audit_log
     ORDER BY created_at ASC, id ASC
     LIMIT $1`,
    [limit]
  );
  let previousHash: string | null = null;
  let legacyRows = 0;
  const failures: Array<{ id: string; reason: string; expected?: string; actual?: string }> = [];
  for (const row of result.rows as AuditLogRow[]) {
    if (!row.entry_hash) {
      legacyRows += 1;
      continue;
    }
    if (row.previous_hash !== previousHash) {
      failures.push({ id: row.id, reason: "previous_hash_mismatch", expected: previousHash || "", actual: row.previous_hash || "" });
    }
    const expected = expectedAuditHash(row);
    if (row.entry_hash !== expected) {
      failures.push({ id: row.id, reason: "entry_hash_mismatch", expected, actual: row.entry_hash || "" });
    }
    previousHash = row.entry_hash || null;
  }
  return {
    verified: failures.length === 0,
    checked: result.rows.length,
    legacyRows,
    headHash: previousHash,
    failures,
  };
}

export function initializeAuditLog(fastify: FastifyInstance) {
  subscribe("ci.created", async (payload) => {
    const event = auditPayload(payload);
    await persistAuditLog(fastify, {
      actor_id: stringValue(event.actorId),
      action: "ci.created",
      entity_type: "ConfigurationItem",
      entity_id: stringValue(event.ciId) || "unknown",
      new_values: payload as Record<string, unknown>,
    });
  });

  subscribe("ci.updated", async (payload) => {
    const event = auditPayload(payload);
    await persistAuditLog(fastify, {
      actor_id: stringValue(event.actorId),
      action: "ci.updated",
      entity_type: "ConfigurationItem",
      entity_id: stringValue(event.ciId) || "unknown",
      old_values: objectValue(event.oldValues),
      new_values: objectValue(event.newValues),
    });
  });

  subscribe("ci.deleted", async (payload) => {
    const event = auditPayload(payload);
    await persistAuditLog(fastify, {
      actor_id: stringValue(event.actorId),
      action: "ci.deleted",
      entity_type: "ConfigurationItem",
      entity_id: stringValue(event.ciId) || "unknown",
      old_values: objectValue(event.oldValues),
    });
  });

  subscribe("relationship.created", async (payload) => {
    const event = auditPayload(payload);
    const sourceId = stringValue(event.sourceId) || "unknown-source";
    const targetId = stringValue(event.targetId) || "unknown-target";
    const relationshipType = stringValue(event.type) || "unknown-type";
    await persistAuditLog(fastify, {
      actor_id: stringValue(event.actorId),
      action: "relationship.created",
      entity_type: "Relationship",
      entity_id: `${sourceId}-${targetId}-${relationshipType}`,
      new_values: payload as Record<string, unknown>,
    });
  });

  subscribe("relationship.updated", async (payload) => {
    const event = auditPayload(payload);
    const sourceId = stringValue(event.sourceId) || "unknown-source";
    const targetId = stringValue(event.targetId) || "unknown-target";
    const relationshipType = stringValue(event.type) || "unknown-type";
    await persistAuditLog(fastify, {
      actor_id: stringValue(event.actorId),
      action: "relationship.updated",
      entity_type: "Relationship",
      entity_id: `${sourceId}-${targetId}-${relationshipType}`,
      old_values: objectValue(event.oldValues),
      new_values: objectValue(event.newValues),
    });
  });

  subscribe("relationship.deleted", async (payload) => {
    const event = auditPayload(payload);
    const sourceId = stringValue(event.sourceId) || "unknown-source";
    const targetId = stringValue(event.targetId) || "unknown-target";
    const relationshipType = stringValue(event.type) || "unknown-type";
    await persistAuditLog(fastify, {
      actor_id: stringValue(event.actorId),
      action: "relationship.deleted",
      entity_type: "Relationship",
      entity_id: `${sourceId}-${targetId}-${relationshipType}`,
      old_values: objectValue(event.oldValues),
    });
  });

  subscribe("discovery.completed", async (payload) => {
    const event = auditPayload(payload);
    await persistAuditLog(fastify, {
      action: "discovery.completed",
      entity_type: "DiscoveryJob",
      entity_id: stringValue(event.jobId) || "unknown",
      new_values: payload as Record<string, unknown>,
    });
  });
}
