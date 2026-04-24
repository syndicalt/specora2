import { FastifyInstance } from "fastify";
import { executeTool, getToolsForSession } from "@specora/sdk";
import { hasPermission } from "../services/rbac";

const APP_RESOURCE_MAP: Record<string, string> = {
  "change-manager": "change-manager",
  "discovery-insights": "discovery",
  "health-monitor": "health-monitor",
};

function toolToAction(toolName: string): string {
  const writePrefixes = ["create", "update", "delete", "approve", "fix", "execute"];
  if (writePrefixes.some((p) => toolName.startsWith(p))) return "write";
  return "read";
}

export async function appToolRoutes(fastify: FastifyInstance) {
  fastify.get("/api/apps/:appId/tools", { onRequest: [fastify.authenticate] }, async (request, _reply) => {
    const { appId } = request.params as { appId: string };
    const tools = getToolsForSession("system").filter((t) => t.name.startsWith(`${appId}_`));
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  });

  fastify.post("/api/apps/:appId/tools/:toolName", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { appId, toolName } = request.params as { appId: string; toolName: string };
    const user = request.user as { id?: string; role?: string } | null;
    const resource = APP_RESOURCE_MAP[appId] || appId;
    const action = toolToAction(toolName);

    if (user?.role) {
      const allowed = await hasPermission(fastify.pg, { role: user.role, resource, action });
      if (!allowed) {
        return reply.status(403).send({ error: `Forbidden: ${user.role} cannot ${action} ${resource}` });
      }
    }

    const fullName = `${appId}_${toolName}`;
    const body = request.body as Record<string, unknown>;
    const enrichedBody = { ...body, _userId: user?.id, _userRole: user?.role };

    try {
      const result = await executeTool(fullName, enrichedBody, fastify);
      return result;
    } catch (err: any) {
      fastify.log.error({ err, appId, toolName }, "App tool execution failed");
      return reply.status(500).send({ error: err.message });
    }
  });

  fastify.get("/api/apps/:appId/tools/:toolName", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { appId, toolName } = request.params as { appId: string; toolName: string };
    const user = request.user as { id?: string; role?: string } | null;
    const resource = APP_RESOURCE_MAP[appId] || appId;
    const action = toolToAction(toolName);

    if (user?.role) {
      const allowed = await hasPermission(fastify.pg, { role: user.role, resource, action });
      if (!allowed) {
        return reply.status(403).send({ error: `Forbidden: ${user.role} cannot ${action} ${resource}` });
      }
    }

    const fullName = `${appId}_${toolName}`;
    const query = request.query as Record<string, unknown>;
    const enrichedQuery = { ...query, _userId: user?.id, _userRole: user?.role };

    try {
      const result = await executeTool(fullName, enrichedQuery, fastify);
      return result;
    } catch (err: any) {
      fastify.log.error({ err, appId, toolName }, "App tool execution failed");
      return reply.status(500).send({ error: err.message });
    }
  });
}
