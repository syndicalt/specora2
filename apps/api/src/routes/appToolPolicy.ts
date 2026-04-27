import { FastifyInstance } from "fastify";
import { hasPermission } from "../services/rbac";
import { recordAuditEvent } from "../services/auditLog";

export type AppToolUser = { id?: string; role?: string } | null;
export type AppToolTransport = "get" | "post" | "job";
export type AppToolRequestedAction = "read" | "write";
export type AppToolAuditOutcome = "executed" | "queued" | "denied" | "failed";

const APP_RESOURCE_MAP: Record<string, string> = {
  "change-manager": "change-manager",
  "incident-manager": "incident-manager",
  "knowledge-core": "knowledge-core",
  "prevention-center": "prevention-center",
  "asset-command": "asset-command",
  "discovery-insights": "discovery",
  "health-monitor": "health-monitor",
  "customer-portal": "customer-portal",
  "engage-agent-workspace": "engage-agent-workspace",
};

const WRITE_PREFIXES = [
  "create",
  "update",
  "delete",
  "approve",
  "apply",
  "fix",
  "execute",
  "triage",
  "transition",
  "record",
  "request",
  "route",
  "resolve",
  "submit",
  "draft",
  "publish",
];

export type AppToolPolicy = {
  appId: string;
  toolName: string;
  fullName: string;
  resource: string;
  action: AppToolRequestedAction;
};

export function resolveAppToolPolicy(appId: string, toolName: string): AppToolPolicy {
  return {
    appId,
    toolName,
    fullName: `${appId}_${toolName}`,
    resource: APP_RESOURCE_MAP[appId] || appId,
    action: WRITE_PREFIXES.some((prefix) => toolName.startsWith(prefix)) ? "write" : "read",
  };
}

export async function authorizeAppTool(fastify: FastifyInstance, user: AppToolUser, policy: AppToolPolicy) {
  if (!user?.role) return { allowed: true, ...policy };
  const allowed = await hasPermission(fastify.pg, { role: user.role, resource: policy.resource, action: policy.action });
  return { allowed, ...policy };
}

export async function auditAppToolOutcome(
  fastify: FastifyInstance,
  input: {
    user: AppToolUser;
    policy: AppToolPolicy;
    outcome: AppToolAuditOutcome;
    transport: AppToolTransport;
    result?: unknown;
    error?: string;
    jobId?: string;
  }
) {
  const metadata: Record<string, unknown> = {
    source: "api.app-tools",
    appId: input.policy.appId,
    toolName: input.policy.toolName,
    resource: input.policy.resource,
    requestedAction: input.policy.action,
    transport: input.transport,
  };

  if (input.outcome === "denied") {
    metadata.result = "denied";
    metadata.role = input.user?.role || null;
  }
  if (input.outcome === "failed") {
    metadata.result = "error";
    metadata.error = input.error || "App tool execution failed";
  }

  await recordAuditEvent(fastify, {
    actorId: input.user?.id,
    action: `app_tool.${input.outcome}`,
    entityType: "AppTool",
    entityId: input.policy.fullName,
    newValues: input.outcome === "executed"
      ? { result: input.result }
      : input.outcome === "queued"
        ? { jobId: input.jobId }
        : undefined,
    metadata,
  });
}
