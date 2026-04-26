import { FastifyInstance } from "fastify";
import { executeTool } from "@specora/sdk";
import { hasPermission } from "../services/rbac";
import { recordRouteAudit, resultId } from "./auditHelpers";

async function requireAssetPermission(fastify: FastifyInstance, user: any, action: "read" | "write" | "govern") {
  if (!user?.role) return true;
  if (user.role === "admin" || user.role === "security_admin") return true;
  return hasPermission(fastify.pg, { role: user.role, resource: "asset-command", action });
}

export async function assetAutomationRoutes(fastify: FastifyInstance) {
  fastify.post("/api/assets/procurement/orders", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user as any;
    if (!(await requireAssetPermission(fastify, user, "write"))) return reply.status(403).send({ error: "Forbidden" });
    const body = request.body as Record<string, unknown>;
    const result = await executeTool("asset-command_ingest_procurement", { ...body, _userId: user?.id, _userRole: user?.role }, fastify);
    await recordRouteAudit(fastify, request, {
      action: "asset_automation.procurement_ingested",
      entityType: "ProcurementOrder",
      entityId: String(body.purchaseOrder || resultId(result, "unknown")),
      newValues: result as Record<string, unknown>,
      metadata: { source: "api.assets", surface: "automation" },
    });
    return result;
  });

  fastify.post("/api/assets/contracts", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user as any;
    if (!(await requireAssetPermission(fastify, user, "write"))) return reply.status(403).send({ error: "Forbidden" });
    const body = request.body as Record<string, unknown>;
    const result = await executeTool("asset-command_ingest_contract", { ...body, _userId: user?.id, _userRole: user?.role }, fastify) as any;
    await recordRouteAudit(fastify, request, {
      action: "asset_automation.contract_ingested",
      entityType: "AssetContract",
      entityId: result?.contract?.id || resultId(result, String(body.name || "unknown")),
      newValues: result as Record<string, unknown>,
      metadata: { source: "api.assets", surface: "automation", vendor: body.vendor || null },
    });
    return result;
  });

  fastify.post("/api/assets/scans", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user as any;
    if (!(await requireAssetPermission(fastify, user, "write"))) return reply.status(403).send({ error: "Forbidden" });
    const body = request.body as Record<string, unknown>;
    const result = await executeTool("asset-command_record_scan", { ...body, _userId: user?.id, _userRole: user?.role }, fastify);
    await recordRouteAudit(fastify, request, {
      action: "asset_automation.scan_recorded",
      entityType: "AssetScan",
      entityId: resultId(result, String(body.value || "unknown")),
      newValues: result as Record<string, unknown>,
      metadata: { source: "api.assets", surface: "automation", scanType: body.scanType || null },
    });
    return result;
  });

  fastify.post("/api/assets/software/usage", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user as any;
    if (!(await requireAssetPermission(fastify, user, "write"))) return reply.status(403).send({ error: "Forbidden" });
    const body = request.body as Record<string, unknown>;
    const result = await executeTool("asset-command_record_software_usage", { ...body, _userId: user?.id, _userRole: user?.role }, fastify);
    await recordRouteAudit(fastify, request, {
      action: "asset_automation.software_usage_recorded",
      entityType: "SoftwareUsage",
      entityId: resultId(result, String(body.product || "unknown")),
      newValues: result as Record<string, unknown>,
      metadata: { source: "api.assets", surface: "automation", publisher: body.publisher || null, product: body.product || null },
    });
    return result;
  });

  fastify.post("/api/assets/reconcile", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user as any;
    if (!(await requireAssetPermission(fastify, user, "govern"))) return reply.status(403).send({ error: "Forbidden" });
    const body = request.body as Record<string, unknown>;
    const result = await executeTool("asset-command_reconcile_sam", { ...body, _userId: user?.id, _userRole: user?.role }, fastify);
    await recordRouteAudit(fastify, request, {
      action: "asset_automation.sam_reconciled",
      entityType: "SoftwareAssetPosition",
      entityId: String(body.publisher || body.product || "sam"),
      newValues: result as Record<string, unknown>,
      metadata: { source: "api.assets", surface: "automation", publisher: body.publisher || null, product: body.product || null },
    });
    return result;
  });
}
