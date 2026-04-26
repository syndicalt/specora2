import { FastifyInstance } from "fastify";
import { executeTool, getToolsForSession } from "@specora/sdk";
import { completeJob, enqueueJob, failJob } from "../services/jobQueue";
import { auditAppToolOutcome, authorizeAppTool, resolveAppToolPolicy } from "./appToolPolicy";

export async function appToolRoutes(fastify: FastifyInstance) {
  fastify.get("/api/apps/:appId/tools", { onRequest: [fastify.authenticate] }, async (request, _reply) => {
    const { appId } = request.params as { appId: string };
    const user = request.user as { id?: string; role?: string } | null;
    const tools = [];
    for (const tool of getToolsForSession("system").filter((t) => t.name.startsWith(`${appId}_`))) {
      const toolName = tool.name.slice(`${appId}_`.length);
      const policy = resolveAppToolPolicy(appId, toolName);
      const authorization = await authorizeAppTool(fastify, user, policy);
      if (authorization.allowed) {
        tools.push(tool);
      }
    }
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  });

  fastify.post("/api/apps/:appId/tools/:toolName", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { appId, toolName } = request.params as { appId: string; toolName: string };
    const user = request.user as { id?: string; role?: string } | null;
    const policy = resolveAppToolPolicy(appId, toolName);
    const { allowed } = await authorizeAppTool(fastify, user, policy);

    if (!allowed) {
      await auditAppToolOutcome(fastify, { user, policy, outcome: "denied", transport: "post" });
      return reply.status(403).send({ error: `Forbidden: ${user?.role} cannot ${policy.action} ${policy.resource}` });
    }

    const body = request.body as Record<string, unknown>;
    const enrichedBody = { ...body, _userId: user?.id, _userRole: user?.role };

    try {
      const result = await executeTool(policy.fullName, enrichedBody, fastify);
      await auditAppToolOutcome(fastify, { user, policy, outcome: "executed", transport: "post", result });
      return result;
    } catch (err: any) {
      await auditAppToolOutcome(fastify, { user, policy, outcome: "failed", transport: "post", error: err.message });
      fastify.log.error({ err, appId, toolName }, "App tool execution failed");
      return reply.status(500).send({ error: err.message });
    }
  });

  fastify.post("/api/apps/:appId/tools/:toolName/jobs", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { appId, toolName } = request.params as { appId: string; toolName: string };
    const user = request.user as { id?: string; role?: string } | null;
    const policy = resolveAppToolPolicy(appId, toolName);
    const { allowed } = await authorizeAppTool(fastify, user, policy);

    if (!allowed) {
      await auditAppToolOutcome(fastify, { user, policy, outcome: "denied", transport: "job" });
      return reply.status(403).send({ error: `Forbidden: ${user?.role} cannot ${policy.action} ${policy.resource}` });
    }

    const args = request.body || {};
    const job = await enqueueJob(fastify, "app_tool", {
      appId,
      toolName,
      args,
      user: { id: user?.id, role: user?.role },
    }, policy.action === "write" ? 5 : 0);
    await auditAppToolOutcome(fastify, { user, policy, outcome: "queued", transport: "job", jobId: job.id });
    setImmediate(async () => {
      try {
        await executeTool(policy.fullName, { ...(args as Record<string, unknown>), _userId: user?.id, _userRole: user?.role }, fastify);
        await completeJob(fastify, job.id);
      } catch (err: any) {
        fastify.log.error({ err, appId, toolName, jobId: job.id }, "Queued app tool execution failed");
        await failJob(fastify, job.id, err.message || "Queued app tool execution failed");
      }
    });
    return reply.status(202).send({ job });
  });

  fastify.get("/api/apps/:appId/tools/:toolName", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { appId, toolName } = request.params as { appId: string; toolName: string };
    const user = request.user as { id?: string; role?: string } | null;
    const policy = resolveAppToolPolicy(appId, toolName);
    const { allowed } = await authorizeAppTool(fastify, user, policy);

    if (!allowed) {
      await auditAppToolOutcome(fastify, { user, policy, outcome: "denied", transport: "get" });
      return reply.status(403).send({ error: `Forbidden: ${user?.role} cannot ${policy.action} ${policy.resource}` });
    }

    const query = request.query as Record<string, unknown>;
    const enrichedQuery = { ...query, _userId: user?.id, _userRole: user?.role };

    try {
      const result = await executeTool(policy.fullName, enrichedQuery, fastify);
      await auditAppToolOutcome(fastify, { user, policy, outcome: "executed", transport: "get", result });
      return result;
    } catch (err: any) {
      await auditAppToolOutcome(fastify, { user, policy, outcome: "failed", transport: "get", error: err.message });
      fastify.log.error({ err, appId, toolName }, "App tool execution failed");
      return reply.status(500).send({ error: err.message });
    }
  });
}
