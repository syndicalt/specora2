import { FastifyInstance } from "fastify";
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeActorId(actorId?: string | null) {
  return actorId && UUID_PATTERN.test(actorId) ? actorId : null;
}

export async function persistAuditLog(fastify: FastifyInstance, entry: AuditEntry) {
  await fastify.pg.query(
    `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, old_values, new_values, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      normalizeActorId(entry.actor_id),
      entry.action,
      entry.entity_type,
      entry.entity_id,
      entry.old_values ? JSON.stringify(entry.old_values) : null,
      entry.new_values ? JSON.stringify(entry.new_values) : null,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
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

export function initializeAuditLog(fastify: FastifyInstance) {
  subscribe("ci.created", async (payload) => {
    await persistAuditLog(fastify, {
      actor_id: (payload as any).actorId,
      action: "ci.created",
      entity_type: "ConfigurationItem",
      entity_id: (payload as any).ciId,
      new_values: payload as Record<string, unknown>,
    });
  });

  subscribe("ci.updated", async (payload) => {
    await persistAuditLog(fastify, {
      actor_id: (payload as any).actorId,
      action: "ci.updated",
      entity_type: "ConfigurationItem",
      entity_id: (payload as any).ciId,
      old_values: (payload as any).oldValues,
      new_values: (payload as any).newValues,
    });
  });

  subscribe("ci.deleted", async (payload) => {
    await persistAuditLog(fastify, {
      actor_id: (payload as any).actorId,
      action: "ci.deleted",
      entity_type: "ConfigurationItem",
      entity_id: (payload as any).ciId,
      old_values: (payload as any).oldValues,
    });
  });

  subscribe("relationship.created", async (payload) => {
    await persistAuditLog(fastify, {
      actor_id: (payload as any).actorId,
      action: "relationship.created",
      entity_type: "Relationship",
      entity_id: `${(payload as any).sourceId}-${(payload as any).targetId}-${(payload as any).type}`,
      new_values: payload as Record<string, unknown>,
    });
  });

  subscribe("relationship.updated", async (payload) => {
    await persistAuditLog(fastify, {
      actor_id: (payload as any).actorId,
      action: "relationship.updated",
      entity_type: "Relationship",
      entity_id: `${(payload as any).sourceId}-${(payload as any).targetId}-${(payload as any).type}`,
      old_values: (payload as any).oldValues,
      new_values: (payload as any).newValues,
    });
  });

  subscribe("relationship.deleted", async (payload) => {
    await persistAuditLog(fastify, {
      actor_id: (payload as any).actorId,
      action: "relationship.deleted",
      entity_type: "Relationship",
      entity_id: `${(payload as any).sourceId}-${(payload as any).targetId}-${(payload as any).type}`,
      old_values: (payload as any).oldValues,
    });
  });

  subscribe("discovery.completed", async (payload) => {
    await persistAuditLog(fastify, {
      action: "discovery.completed",
      entity_type: "DiscoveryJob",
      entity_id: (payload as any).jobId,
      new_values: payload as Record<string, unknown>,
    });
  });
}
