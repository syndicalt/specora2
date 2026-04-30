import type { FastifyInstance, FastifyRequest } from "fastify";
import { executeTool } from "@specora/sdk";
import { hasPermission } from "../services/rbac";
import { recordRouteAudit, resultId } from "./auditHelpers";

type PreventionAutomationAction = "read" | "write" | "govern";

type RouteUser = {
  id?: string;
  role?: string;
};

type ToolObjectResult = Record<string, unknown>;

type PreventionRequest = FastifyRequest & {
  user?: RouteUser;
};

function routeUser(request: FastifyRequest): RouteUser {
  return (request as PreventionRequest).user || {};
}

function toolObjectResult(value: unknown): ToolObjectResult {
  return value && typeof value === "object" ? value as ToolObjectResult : {};
}

async function requirePreventionPermission(fastify: FastifyInstance, user: RouteUser, action: PreventionAutomationAction) {
  if (!user?.role) return false;
  if (user.role === "admin" || user.role === "security_admin") return true;
  return hasPermission(fastify.pg, { role: user.role, resource: "prevention-center", action });
}

export async function preventionAutomationRoutes(fastify: FastifyInstance) {
  fastify.post("/api/prevention/detect", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = routeUser(request);
    if (!(await requirePreventionPermission(fastify, user, "write"))) return reply.status(403).send({ error: "Forbidden" });
    const body = request.body as Record<string, unknown>;
    const result = await executeTool("prevention-center_detect_candidates", { ...body, _userId: user?.id, _userRole: user?.role }, fastify);
    await recordRouteAudit(fastify, request, {
      action: "prevention_automation.candidates_detected",
      entityType: "PreventionDetection",
      entityId: "detect",
      newValues: toolObjectResult(result),
      metadata: { source: "api.prevention", surface: "automation" },
    });
    return result;
  });

  fastify.post("/api/prevention/candidates", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = routeUser(request);
    if (!(await requirePreventionPermission(fastify, user, "write"))) return reply.status(403).send({ error: "Forbidden" });
    const body = request.body as Record<string, unknown>;
    const result = await executeTool("prevention-center_create_candidate", { ...body, _userId: user?.id, _userRole: user?.role }, fastify);
    await recordRouteAudit(fastify, request, {
      action: "prevention_automation.candidate_created",
      entityType: "PreventionRecord",
      entityId: resultId(result, "unknown"),
      newValues: toolObjectResult(result),
      metadata: { source: "api.prevention", surface: "automation" },
    });
    return result;
  });

  fastify.post("/api/prevention/candidates/:id/actions", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = routeUser(request);
    if (!(await requirePreventionPermission(fastify, user, "write"))) return reply.status(403).send({ error: "Forbidden" });
    const { id } = request.params as { id: string };
    const body = request.body as { knownError?: boolean };
    if (body.knownError) {
      const result = await executeTool("prevention-center_create_known_error", { preventionId: id, _userId: user?.id, _userRole: user?.role }, fastify);
      await recordRouteAudit(fastify, request, {
        action: "prevention_automation.known_error_created",
        entityType: "PreventionRecord",
        entityId: id,
        newValues: toolObjectResult(result),
        metadata: { source: "api.prevention", surface: "automation" },
      });
      return result;
    }
    const result = await executeTool("prevention-center_propose_actions", { preventionId: id, _userId: user?.id, _userRole: user?.role }, fastify);
    await recordRouteAudit(fastify, request, {
      action: "prevention_automation.actions_proposed",
      entityType: "PreventionRecord",
      entityId: id,
      newValues: toolObjectResult(result),
      metadata: { source: "api.prevention", surface: "automation" },
    });
    return result;
  });

  fastify.post("/api/prevention/candidates/:id/transition", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = routeUser(request);
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
      newValues: toolObjectResult(result),
      metadata: { source: "api.prevention", surface: "automation", status: body.status || null },
    });
    return result;
  });
}
