import type { FastifyInstance, FastifyRequest } from "fastify";
import { executeTool } from "@specora/sdk";
import { hasPermission } from "../services/rbac";
import { recordAuditEvent } from "../services/auditLog";

type IncidentAutomationAction = "read" | "write" | "remediate" | "command";

type RouteUser = {
  id?: string;
  role?: string;
};

type IncidentToolResult = Record<string, unknown> & {
  id?: string;
};

type IncidentRequest = FastifyRequest & {
  user?: RouteUser;
};

function routeUser(request: FastifyRequest): RouteUser {
  return (request as IncidentRequest).user || {};
}

function incidentResult(value: unknown): IncidentToolResult {
  return value && typeof value === "object" ? value as IncidentToolResult : {};
}

async function requireIncidentPermission(fastify: FastifyInstance, user: RouteUser, action: IncidentAutomationAction) {
  if (!user?.role) return false;
  if (user.role === "admin" || user.role === "security_admin") return true;
  return hasPermission(fastify.pg, { role: user.role, resource: "incident-manager", action });
}

export async function incidentAutomationRoutes(fastify: FastifyInstance) {
  fastify.post("/api/incident-automation/signals", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = routeUser(request);
    if (!(await requireIncidentPermission(fastify, user, "write"))) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const body = request.body as Record<string, unknown>;
    const incident = incidentResult(await executeTool("incident-manager_create_incident", {
      ...body,
      source: body.source || "external",
      _userId: user?.id,
      _userRole: user?.role,
    }, fastify));
    const triage = incident?.id
      ? await executeTool("incident-manager_triage_incident", { incidentId: incident.id, _userId: user?.id, _userRole: user?.role }, fastify)
      : null;
    await recordAuditEvent(fastify, {
      actorId: user?.id,
      action: "incident_automation.signal_ingested",
      entityType: "Incident",
      entityId: incident?.id || String(body.externalRef || "unknown"),
      newValues: { incident, triage },
      metadata: { source: "api.incident-automation", surface: "external-signal", signalSource: body.source || "external" },
    });
    return { incident, triage };
  });

  fastify.post("/api/incident-automation/incidents", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = routeUser(request);
    if (!(await requireIncidentPermission(fastify, user, "write"))) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const body = request.body as Record<string, unknown>;
    const incident = incidentResult(await executeTool("incident-manager_create_incident", { ...body, _userId: user?.id, _userRole: user?.role }, fastify));
    await recordAuditEvent(fastify, {
      actorId: user?.id,
      action: "incident_automation.incident_created",
      entityType: "Incident",
      entityId: incident?.id || "unknown",
      newValues: incident,
      metadata: { source: "api.incident-automation", surface: "external-workflow" },
    });
    return incident;
  });

  fastify.post("/api/incident-automation/incidents/:id/actions", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = routeUser(request);
    if (!(await requireIncidentPermission(fastify, user, "remediate"))) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const { id } = request.params as { id: string };
    const body = request.body as { actionId?: string; approve?: boolean; result?: string; recommend?: boolean };
    if (body.recommend) {
      const recommendation = await executeTool("incident-manager_recommend_remediation", { incidentId: id, _userId: user?.id, _userRole: user?.role }, fastify);
      await recordAuditEvent(fastify, {
        actorId: user?.id,
        action: "incident_automation.remediation_recommended",
        entityType: "Incident",
        entityId: id,
        newValues: incidentResult(recommendation),
        metadata: { source: "api.incident-automation", surface: "external-workflow" },
      });
      return recommendation;
    }
    if (!body.actionId) return reply.status(400).send({ error: "actionId is required unless recommend is true" });
    if (body.approve) {
      await executeTool("incident-manager_approve_action", { actionId: body.actionId, _userId: user?.id, _userRole: user?.role }, fastify);
    }
    const result = await executeTool("incident-manager_execute_remediation", {
      actionId: body.actionId,
      result: body.result,
      _userId: user?.id,
      _userRole: user?.role,
    }, fastify);
    await recordAuditEvent(fastify, {
      actorId: user?.id,
      action: "incident_automation.remediation_executed",
      entityType: "Incident",
      entityId: id,
      newValues: incidentResult(result),
      metadata: { source: "api.incident-automation", surface: "external-workflow", actionId: body.actionId, approved: !!body.approve },
    });
    return result;
  });

  fastify.post("/api/incident-automation/incidents/:id/resolve", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = routeUser(request);
    if (!(await requireIncidentPermission(fastify, user, "write"))) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const { id } = request.params as { id: string };
    const body = request.body as { note?: string; generatePostmortem?: boolean };
    const incident = await executeTool("incident-manager_transition_incident", {
      incidentId: id,
      status: "resolved",
      note: body.note || "Resolved through automation endpoint",
      _userId: user?.id,
      _userRole: user?.role,
    }, fastify);
    const postmortem = body.generatePostmortem
      ? await executeTool("incident-manager_generate_postmortem", { incidentId: id, _userId: user?.id, _userRole: user?.role }, fastify)
      : null;
    await recordAuditEvent(fastify, {
      actorId: user?.id,
      action: "incident_automation.incident_resolved",
      entityType: "Incident",
      entityId: id,
      newValues: { incident, postmortem },
      metadata: { source: "api.incident-automation", surface: "external-workflow", generatedPostmortem: !!body.generatePostmortem },
    });
    return { incident, postmortem };
  });
}
