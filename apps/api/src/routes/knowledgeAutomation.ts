import { FastifyInstance } from "fastify";
import { executeTool } from "@specora/sdk";
import { hasPermission } from "../services/rbac";
import { recordRouteAudit, resultId } from "./auditHelpers";

async function requireKnowledgePermission(fastify: FastifyInstance, user: any, action: "read" | "write" | "govern") {
  if (!user?.role) return true;
  if (user.role === "admin" || user.role === "security_admin") return true;
  return hasPermission(fastify.pg, { role: user.role, resource: "knowledge-core", action });
}

export async function knowledgeAutomationRoutes(fastify: FastifyInstance) {
  fastify.post("/api/knowledge/answer", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user as any;
    if (!(await requireKnowledgePermission(fastify, user, "read"))) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const body = request.body as Record<string, unknown>;
    const result = await executeTool("knowledge-core_answer", { ...body, _userId: user?.id, _userRole: user?.role }, fastify);
    await recordRouteAudit(fastify, request, {
      action: "knowledge_automation.answer_requested",
      entityType: "KnowledgeQuery",
      entityId: String((body.query as string) || resultId(result, "query")),
      newValues: result as Record<string, unknown>,
      metadata: { source: "api.knowledge", surface: "automation" },
    });
    return result;
  });

  fastify.post("/api/knowledge/items", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user as any;
    if (!(await requireKnowledgePermission(fastify, user, "write"))) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const body = request.body as Record<string, unknown>;
    const result = await executeTool("knowledge-core_create_knowledge", { ...body, _userId: user?.id, _userRole: user?.role }, fastify);
    await recordRouteAudit(fastify, request, {
      action: "knowledge_automation.item_created",
      entityType: "KnowledgeItem",
      entityId: resultId(result, "unknown"),
      newValues: result as Record<string, unknown>,
      metadata: { source: "api.knowledge", surface: "automation" },
    });
    return result;
  });

  fastify.post("/api/knowledge/drafts/from-record", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user as any;
    if (!(await requireKnowledgePermission(fastify, user, "write"))) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const body = request.body as Record<string, unknown>;
    const result = await executeTool("knowledge-core_draft_from_record", { ...body, _userId: user?.id, _userRole: user?.role }, fastify);
    await recordRouteAudit(fastify, request, {
      action: "knowledge_automation.draft_created",
      entityType: "KnowledgeItem",
      entityId: resultId(result, String(body.sourceId || "unknown")),
      newValues: result as Record<string, unknown>,
      metadata: { source: "api.knowledge", surface: "automation", sourceType: body.sourceType || null, sourceId: body.sourceId || null },
    });
    return result;
  });

  fastify.post("/api/knowledge/items/:id/publish", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user as any;
    if (!(await requireKnowledgePermission(fastify, user, "govern"))) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const { id } = request.params as { id: string };
    const body = request.body as { status?: string; note?: string };
    const result = await executeTool("knowledge-core_publish_knowledge", {
      knowledgeId: id,
      status: body.status || "published",
      note: body.note,
      _userId: user?.id,
      _userRole: user?.role,
    }, fastify);
    await recordRouteAudit(fastify, request, {
      action: "knowledge_automation.item_published",
      entityType: "KnowledgeItem",
      entityId: id,
      newValues: result as Record<string, unknown>,
      metadata: { source: "api.knowledge", surface: "automation", status: body.status || "published" },
    });
    return result;
  });

  fastify.post("/api/knowledge/items/:id/feedback", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user as any;
    if (!(await requireKnowledgePermission(fastify, user, "read"))) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const result = await executeTool("knowledge-core_record_feedback", {
      ...body,
      knowledgeId: id,
      _userId: user?.id,
      _userRole: user?.role,
    }, fastify);
    await recordRouteAudit(fastify, request, {
      action: "knowledge_automation.feedback_recorded",
      entityType: "KnowledgeItem",
      entityId: id,
      newValues: result as Record<string, unknown>,
      metadata: { source: "api.knowledge", surface: "automation", outcome: body.outcome || null },
    });
    return result;
  });
}
