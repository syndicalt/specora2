import { FastifyInstance } from "fastify";
import { recordAuditEvent } from "../services/auditLog";

export function auditActorId(request: any) {
  return (request.user as any)?.id;
}

export function resultId(result: any, fallback: string) {
  return result?.id || result?.jobId || result?.asset?.id || result?.rack?.id || result?.object?.id || result?.connection?.id || result?.event?.id || fallback;
}

export async function recordRouteAudit(
  fastify: FastifyInstance,
  request: any,
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
