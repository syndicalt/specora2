import { FastifyInstance } from "fastify";
import { executeTool } from "@specora/sdk";
import { hasPermission } from "../services/rbac";
import { recordRouteAudit, resultId } from "./auditHelpers";

async function requirePreventionPermission(fastify: FastifyInstance, user: any, action: "read" | "write" | "govern") {
  if (!user?.role) return true;
  if (user.role === "admin" || user.role === "security_admin") return true;
  return hasPermission(fastify.pg, { role: user.role, resource: "prevention-center", action });
}

export async function preventionAutomationRoutes(fastify: FastifyInstance) {
  fastify.post("/api/prevention/detect", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user as any;
    if (!(await requirePreventionPermission(fastify, user, "write"))) return reply.status(403).send({ error: "Forbidden" });
    const body = request.body as Record<string, unknown>;
    const result = await executeTool("prevention-center_detect_candidates", { ...body, _userId: user?.id, _userRole: user?.role }, fastify);
    await recordRouteAudit(fastify, request, {
      action: "prevention_automation.candidates_detected",
      entityType: "PreventionDetection",
      entityId: "detect",
      newValues: result as Record<string, unknown>,
      metadata: { source: "api.prevention", surface: "automation" },
    });
    return result;
  });

  fastify.post("/api/prevention/candidates", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user as any;
    if (!(await requirePreventionPermission(fastify, user, "write"))) return reply.status(403).send({ error: "Forbidden" });
    const body = request.body as Record<string, unknown>;
    const result = await executeTool("prevention-center_create_candidate", { ...body, _userId: user?.id, _userRole: user?.role }, fastify);
    await recordRouteAudit(fastify, request, {
      action: "prevention_automation.candidate_created",
      entityType: "PreventionRecord",
      entityId: resultId(result, "unknown"),
      newValues: result as Record<string, unknown>,
      metadata: { source: "api.prevention", surface: "automation" },
    });
    return result;
  });

  fastify.post("/api/prevention/candidates/:id/actions", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user as any;
    if (!(await requirePreventionPermission(fastify, user, "write"))) return reply.status(403).send({ error: "Forbidden" });
    const { id } = request.params as { id: string };
    const body = request.body as { knownError?: boolean };
    if (body.knownError) {
      const result = await executeTool("prevention-center_create_known_error", { preventionId: id, _userId: user?.id, _userRole: user?.role }, fastify);
      await recordRouteAudit(fastify, request, {
        action: "prevention_automation.known_error_created",
        entityType: "PreventionRecord",
        entityId: id,
        newValues: result as Record<string, unknown>,
        metadata: { source: "api.prevention", surface: "automation" },
      });
      return result;
    }
    const result = await executeTool("prevention-center_propose_actions", { preventionId: id, _userId: user?.id, _userRole: user?.role }, fastify);
    await recordRouteAudit(fastify, request, {
      action: "prevention_automation.actions_proposed",
      entityType: "PreventionRecord",
      entityId: id,
      newValues: result as Record<string, unknown>,
      metadata: { source: "api.prevention", surface: "automation" },
    });
    return result;
  });

  fastify.post("/api/prevention/candidates/:id/transition", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user as any;
    if (!(await requirePreventionPermission(fastify, user, "govern"))) return reply.status(403).send({ error: "Forbidden" });
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const result = await executeTool("prevention-center_transition_candidate", {
      ...body,
      preventionId: id,
      _userId: user?.id,
      _userRole: user?.role,
    }, fastify);
    await recordRouteAudit(fastify, request, {
      action: "prevention_automation.candidate_transitioned",
      entityType: "PreventionRecord",
      entityId: id,
      newValues: result as Record<string, unknown>,
      metadata: { source: "api.prevention", surface: "automation", status: body.status || null },
    });
    return result;
  });
}
