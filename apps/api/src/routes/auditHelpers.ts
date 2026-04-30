import type { FastifyInstance, FastifyRequest } from "fastify";
import { recordAuditEvent } from "../services/auditLog";

type RequestUser = {
  id?: string | null;
};

type AuditedRequest = Pick<FastifyRequest, "user"> & {
  user?: RequestUser | null;
};

type ResultWithIds = {
  id?: string | number | null;
  jobId?: string | number | null;
  asset?: { id?: string | number | null } | null;
  rack?: { id?: string | number | null } | null;
  object?: { id?: string | number | null } | null;
  connection?: { id?: string | number | null } | null;
  event?: { id?: string | number | null } | null;
};

function stringId(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function auditActorId(request: AuditedRequest) {
  return request.user?.id || undefined;
}

function resultWithIds(value: unknown): ResultWithIds | null {
  return value && typeof value === "object" ? value as ResultWithIds : null;
}

export function resultId(result: unknown, fallback: string) {
  const value = resultWithIds(result);
  return (
    stringId(value?.id) ||
    stringId(value?.jobId) ||
    stringId(value?.asset?.id) ||
    stringId(value?.rack?.id) ||
    stringId(value?.object?.id) ||
    stringId(value?.connection?.id) ||
    stringId(value?.event?.id) ||
    fallback
  );
}

export async function recordRouteAudit(
  fastify: FastifyInstance,
  request: AuditedRequest,
  input: {
    action: string;
    entityType: string;
    entityId: string;
    oldValues?: Record<string, unknown> | null;
    newValues?: Record<string, unknown> | null;
    metadata?: Record<string, unknown>;
  }
) {
  await recordAuditEvent(fastify, {
    actorId: auditActorId(request),
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    oldValues: input.oldValues,
    newValues: input.newValues,
    metadata: input.metadata,
  });
}
