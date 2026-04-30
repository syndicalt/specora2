import type { FastifyInstance, FastifyRequest } from "fastify";
import { executeTool } from "@specora/sdk";
import { hasPermission } from "../services/rbac";
import { recordRouteAudit, resultId } from "./auditHelpers";

type AssetAutomationAction = "read" | "write" | "govern";

type RouteUser = {
  id?: string;
  role?: string;
};

type AssetToolResult = Record<string, unknown> & {
  contract?: { id?: string | number | null } | null;
};

type AssetRequest = FastifyRequest & {
  user?: RouteUser;
};

function routeUser(request: FastifyRequest): RouteUser {
  return (request as AssetRequest).user || {};
}

function toolObjectResult(value: unknown): AssetToolResult {
  return value && typeof value === "object" ? value as AssetToolResult : {};
}

async function requireAssetPermission(fastify: FastifyInstance, user: RouteUser, action: AssetAutomationAction) {
  if (!user?.role) return false;
  if (user.role === "admin" || user.role === "security_admin") return true;
  return hasPermission(fastify.pg, { role: user.role, resource: "asset-command", action });
}

export async function assetAutomationRoutes(fastify: FastifyInstance) {
  fastify.post("/api/assets/procurement/orders", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = routeUser(request);
    if (!(await requireAssetPermission(fastify, user, "write"))) return reply.status(403).send({ error: "Forbidden" });
    const body = request.body as Record<string, unknown>;
    const result = await executeTool("asset-command_ingest_procurement", { ...body, _userId: user?.id, _userRole: user?.role }, fastify);
    await recordRouteAudit(fastify, request, {
      action: "asset_automation.procurement_ingested",
      entityType: "ProcurementOrder",
      entityId: String(body.purchaseOrder || resultId(result, "unknown")),
      newValues: toolObjectResult(result),
      metadata: { source: "api.assets", surface: "automation" },
    });
    return result;
  });

  fastify.post("/api/assets/contracts", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = routeUser(request);
    if (!(await requireAssetPermission(fastify, user, "write"))) return reply.status(403).send({ error: "Forbidden" });
    const body = request.body as Record<string, unknown>;
    const result = toolObjectResult(await executeTool("asset-command_ingest_contract", { ...body, _userId: user?.id, _userRole: user?.role }, fastify));
    await recordRouteAudit(fastify, request, {
      action: "asset_automation.contract_ingested",
      entityType: "AssetContract",
      entityId: String(result.contract?.id || resultId(result, String(body.name || "unknown"))),
      newValues: result,
      metadata: { source: "api.assets", surface: "automation", vendor: body.vendor || null },
    });
    return result;
  });

  fastify.post("/api/assets/scans", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = routeUser(request);
    if (!(await requireAssetPermission(fastify, user, "write"))) return reply.status(403).send({ error: "Forbidden" });
    const body = request.body as Record<string, unknown>;
    const result = await executeTool("asset-command_record_scan", { ...body, _userId: user?.id, _userRole: user?.role }, fastify);
    await recordRouteAudit(fastify, request, {
      action: "asset_automation.scan_recorded",
      entityType: "AssetScan",
      entityId: resultId(result, String(body.value || "unknown")),
      newValues: toolObjectResult(result),
      metadata: { source: "api.assets", surface: "automation", scanType: body.scanType || null },
    });
    return result;
  });

  fastify.post("/api/assets/software/usage", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = routeUser(request);
    if (!(await requireAssetPermission(fastify, user, "write"))) return reply.status(403).send({ error: "Forbidden" });
    const body = request.body as Record<string, unknown>;
    const result = await executeTool("asset-command_record_software_usage", { ...body, _userId: user?.id, _userRole: user?.role }, fastify);
    await recordRouteAudit(fastify, request, {
      action: "asset_automation.software_usage_recorded",
      entityType: "SoftwareUsage",
      entityId: resultId(result, String(body.product || "unknown")),
      newValues: toolObjectResult(result),
      metadata: { source: "api.assets", surface: "automation", publisher: body.publisher || null, product: body.product || null },
    });
    return result;
  });

  fastify.post("/api/assets/reconcile", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = routeUser(request);
    if (!(await requireAssetPermission(fastify, user, "govern"))) return reply.status(403).send({ error: "Forbidden" });
    const body = request.body as Record<string, unknown>;
    const result = await executeTool("asset-command_reconcile_sam", { ...body, _userId: user?.id, _userRole: user?.role }, fastify);
    await recordRouteAudit(fastify, request, {
      action: "asset_automation.sam_reconciled",
      entityType: "SoftwareAssetPosition",
      entityId: String(body.publisher || body.product || "sam"),
      newValues: toolObjectResult(result),
      metadata: { source: "api.assets", surface: "automation", publisher: body.publisher || null, product: body.product || null },
    });
    return result;
  });
}
