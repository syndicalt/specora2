import type { FastifyInstance, FastifyRequest } from "fastify";
import { executeTool } from "@specora/sdk";
import { hasPermission } from "../services/rbac";
import { recordRouteAudit, resultId } from "./auditHelpers";

type ChangeAutomationAction = "read" | "write";

type RouteUser = {
  id?: string;
  role?: string;
};

type ChangeRequest = FastifyRequest & {
  user?: RouteUser;
};

type ToolObjectResult = Record<string, unknown>;

type GateSignal = {
  riskScore?: number;
  conflictCount?: number;
  healthy?: boolean;
};

function routeUser(request: FastifyRequest): RouteUser {
  return (request as ChangeRequest).user || {};
}

function toolObjectResult(value: unknown): ToolObjectResult {
  return value && typeof value === "object" ? value as ToolObjectResult : {};
}

function gateSignal(value: unknown): GateSignal {
  return value && typeof value === "object" ? value as GateSignal : {};
}

async function requireChangePermission(fastify: FastifyInstance, user: RouteUser, action: ChangeAutomationAction) {
  if (!user?.role) return false;
  return hasPermission(fastify.pg, { role: user.role, resource: "change-manager", action });
}

function gateDecision(inputs: { grade?: GateSignal; conflicts?: GateSignal; health?: GateSignal; preview?: GateSignal }) {
  const risk = inputs.grade?.riskScore ?? inputs.preview?.riskScore ?? 0;
  const conflictCount = inputs.conflicts?.conflictCount ?? 0;
  const unhealthy = inputs.health?.healthy === false;
  const gates = [
    { id: "risk", status: risk >= 80 ? "block" : risk >= 55 ? "warn" : "pass", detail: `Risk score ${risk || 0}` },
    { id: "conflicts", status: conflictCount > 0 ? "warn" : "pass", detail: `${conflictCount} schedule conflict${conflictCount === 1 ? "" : "s"}` },
    { id: "ci-health", status: unhealthy ? "warn" : "pass", detail: unhealthy ? "One or more affected CIs need health review" : "Affected CIs passed health checks" },
  ];
  const decision = gates.some((g) => g.status === "block") ? "block" : gates.some((g) => g.status === "warn") ? "review" : "pass";
  return { decision, gates };
}

export async function changeAutomationRoutes(fastify: FastifyInstance) {
  fastify.post("/api/change-automation/requests", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = routeUser(request);
    if (!(await requireChangePermission(fastify, user, "write"))) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const body = request.body as Record<string, unknown>;
    const result = await executeTool("change-manager_create_rfc", { ...body, _userId: user?.id, _userRole: user?.role }, fastify);
    await recordRouteAudit(fastify, request, {
      action: "change_automation.request_created",
      entityType: "ChangeRequest",
      entityId: resultId(result, "unknown"),
      newValues: toolObjectResult(result),
      metadata: { source: "api.change-automation", surface: "automation" },
    });
    return result;
  });

  fastify.post("/api/change-automation/gate", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = routeUser(request);
    if (!(await requireChangePermission(fastify, user, "read"))) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const body = request.body as { rfcId?: string; ciId?: string; affectedCiIds?: string[]; windowHours?: number };
    if (!body.rfcId && !body.ciId) {
      return reply.status(400).send({ error: "Provide rfcId or ciId" });
    }

    if (body.rfcId) {
      const [grade, conflicts, health, criticalPath] = await Promise.all([
        executeTool("change-manager_grade_change_rfc", { rfcId: body.rfcId, _userId: user?.id, _userRole: user?.role }, fastify),
        executeTool("change-manager_check_change_conflicts", { rfcId: body.rfcId, windowHours: body.windowHours || 48, _userId: user?.id, _userRole: user?.role }, fastify),
        executeTool("change-manager_check_ci_health_before_change", { rfcId: body.rfcId, _userId: user?.id, _userRole: user?.role }, fastify),
        executeTool("change-manager_find_critical_path", { rfcId: body.rfcId, _userId: user?.id, _userRole: user?.role }, fastify),
      ]);
      const result = { rfcId: body.rfcId, ...gateDecision({ grade: gateSignal(grade), conflicts: gateSignal(conflicts), health: gateSignal(health) }), grade, conflicts, health, criticalPath };
      await recordRouteAudit(fastify, request, {
        action: "change_automation.gate_evaluated",
        entityType: "ChangeRequest",
        entityId: body.rfcId,
        newValues: result,
        metadata: { source: "api.change-automation", surface: "automation" },
      });
      return result;
    }

    const preview = await executeTool("change-manager_preview_impact", {
      ciId: body.ciId,
      affectedCiIds: body.affectedCiIds || [],
      _userId: user?.id,
      _userRole: user?.role,
    }, fastify);
    const result = { preview: true, ...gateDecision({ preview: gateSignal(preview) }), impact: preview };
    await recordRouteAudit(fastify, request, {
      action: "change_automation.gate_previewed",
      entityType: "ConfigurationItem",
      entityId: body.ciId || "unknown",
      newValues: result,
      metadata: { source: "api.change-automation", surface: "automation" },
    });
    return result;
  });

  fastify.post("/api/change-automation/requests/:id/transition", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = routeUser(request);
    if (!(await requireChangePermission(fastify, user, "write"))) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const { id } = request.params as { id: string };
    const body = request.body as { status?: string; comment?: string };
    if (!body.status) return reply.status(400).send({ error: "status is required" });

    const result = await executeTool("change-manager_edit_rfc", {
      rfcId: id,
      status: body.status,
      _userId: user?.id,
      _userRole: user?.role,
    }, fastify);
    if (body.comment) {
      await executeTool("change-manager_add_rfc_comment", {
        rfcId: id,
        content: body.comment,
        _userId: user?.id,
        _userRole: user?.role,
      }, fastify);
    }
    await recordRouteAudit(fastify, request, {
      action: "change_automation.request_transitioned",
      entityType: "ChangeRequest",
      entityId: id,
      newValues: toolObjectResult(result),
      metadata: { source: "api.change-automation", surface: "automation", status: body.status, commented: !!body.comment },
    });
    return result;
  });
}
