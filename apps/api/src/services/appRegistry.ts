import type { FastifyInstance } from "fastify";
import { hasPermission, resolveUserRole } from "./rbac";

type AppMode = "canvas" | "window";
type AppSource = "built-in" | "external";
type InstallStatus = NonNullable<ServerAppRegistryEntry["installStatus"]>;
type EntitlementMode = NonNullable<ServerAppRegistryEntry["entitlementMode"]>;

export type ServerAppRegistryEntry = {
  id: string;
  name: string;
  description?: string;
  icon: string;
  version: string;
  permissions: string[];
  defaultMode: AppMode;
  installKey: string;
  source: AppSource;
  publisher: string;
  installedAt: number;
  url?: string;
  reactVersion?: string;
  clearDataOnUninstall?: boolean;
  chatCapabilities?: unknown[];
  chatTools?: unknown[];
  events?: string[];
  adminPanels?: unknown[];
  packageId?: string;
  packageName?: string;
  premium?: boolean;
  entitlementMode?: "included" | "trial" | "paid" | "placeholder";
  bundledWithPlatform?: boolean;
  installStatus?: "available" | "installed" | "installing" | "uninstalling" | "failed" | "uninstalled";
  provisioningJobId?: string;
};

const BUILT_IN_APPS: ServerAppRegistryEntry[] = [
  { id: "service-map", name: "Service Map", description: "Visualize service dependencies with interactive graph layouts.", icon: "Map", version: "1.0.0", permissions: ["read:cmdb", "read:relationships"], defaultMode: "canvas", installKey: "builtin_service-map", source: "built-in", publisher: "Specora", installedAt: 0 },
  {
    id: "cmdb-explorer",
    name: "CMDB Explorer",
    description: "Search, filter, and inspect Configuration Items in your CMDB.",
    icon: "Database",
    version: "1.0.0",
    permissions: ["read:cmdb", "read:relationships"],
    defaultMode: "canvas",
    installKey: "builtin_cmdb-explorer",
    source: "built-in",
    publisher: "Specora",
    installedAt: 0,
    chatCapabilities: [
      { id: "cmdb.investigate-ci", label: "Investigate CI", description: "Find a CI, summarize its details, and open it in CMDB Explorer", prompt: "Find and investigate a configuration item", icon: "Database" },
      { id: "cmdb.browse", label: "Browse CMDB", description: "Open the CMDB Explorer workspace", prompt: "Open CMDB Explorer", icon: "Search" },
      { id: "cmdb.find-risk", label: "Find risky CIs", description: "Find low-health, stale, or incomplete CIs", prompt: "Find risky CIs in the CMDB", icon: "AlertTriangle" },
      { id: "cmdb.find-orphans", label: "Find orphaned CIs", description: "Find CIs with missing relationship context", prompt: "Find orphaned CIs in the CMDB", icon: "Unlink" },
      { id: "cmdb.find-path", label: "Find dependency path", description: "Find the graph path between two CIs", prompt: "Find the dependency path between two CIs", icon: "Route" },
    ],
  },
  { id: "settings", name: "Settings", description: "Manage profile, theme, and platform preferences.", icon: "Settings", version: "1.0.0", permissions: ["read:profile", "write:profile"], defaultMode: "window", installKey: "builtin_settings", source: "built-in", publisher: "Specora", installedAt: 0 },
  { id: "discovery", name: "Discovery", description: "Upload and ingest infrastructure data into the graph.", icon: "Upload", version: "1.0.0", permissions: ["read:discovery", "write:discovery"], defaultMode: "canvas", installKey: "builtin_discovery", source: "built-in", publisher: "Specora", installedAt: 0 },
  { id: "arc", name: "Specora Arc", description: "Discover and manage apps in the Specora ecosystem.", icon: "Compass", version: "1.0.0", permissions: ["app:install", "app:uninstall"], defaultMode: "window", installKey: "builtin_arc", source: "built-in", publisher: "Specora", installedAt: 0 },
  { id: "change-manager", name: "Change Manager", description: "Create and manage change requests with approval workflows.", icon: "GitPullRequest", version: "1.0.0", permissions: ["itsm:change:read", "itsm:change:write"], defaultMode: "canvas", installKey: "builtin_change-manager", source: "built-in", publisher: "Specora ITSM", installedAt: 0, adminPanels: [{ id: "change-manager-state-machine", name: "Change State Machine", icon: "GitBranch", permissions: ["system-properties:write"] }] },
  {
    id: "incident-manager",
    name: "Incident Command Center",
    description: "AI-first incident triage, command, remediation, and learning workflows.",
    icon: "Siren",
    version: "1.0.0",
    permissions: ["itsm:incident:read", "itsm:incident:write"],
    defaultMode: "canvas",
    installKey: "builtin_incident-manager",
    source: "built-in",
    publisher: "Specora ITSM",
    installedAt: 0,
    chatCapabilities: [
      { id: "incident-manager.triage", label: "Triage incident", description: "Create, correlate, and triage an incident with AI context", prompt: "Triage a new incident", icon: "Siren" },
      { id: "incident-manager.command", label: "Open command center", description: "Open active incidents and major incident command", prompt: "Open Incident Command Center", icon: "Activity" },
      { id: "incident-manager.remediate", label: "Recommend remediation", description: "Suggest safe remediation actions for an active incident", prompt: "Recommend remediation for an incident", icon: "Bot" },
    ],
    events: ["incident.created", "incident.triaged", "incident.status_changed"],
  },
  {
    id: "knowledge-core",
    name: "Knowledge Core",
    description: "AI-governed knowledge graph for answers, runbooks, stewardship, and operational learning.",
    icon: "Brain",
    version: "1.0.0",
    permissions: ["itsm:knowledge:read", "itsm:knowledge:write"],
    defaultMode: "canvas",
    installKey: "builtin_knowledge-core",
    source: "built-in",
    publisher: "Specora ITSM",
    installedAt: 0,
    chatCapabilities: [
      { id: "knowledge-core.answer", label: "Answer from knowledge", description: "Answer with governed knowledge, citations, and confidence", prompt: "Answer this using Knowledge Core", icon: "Brain" },
      { id: "knowledge-core.stewardship", label: "Stewardship queue", description: "Review stale, risky, missing, and draft knowledge", prompt: "Show the Knowledge Core stewardship queue", icon: "Library" },
      { id: "knowledge-core.draft", label: "Draft knowledge", description: "Create reusable knowledge from an incident, change, or operational note", prompt: "Draft a knowledge article from recent work", icon: "Sparkles" },
    ],
    events: ["knowledge.created", "knowledge.published", "knowledge.gap_detected", "knowledge.feedback_recorded"],
  },
  {
    id: "prevention-center",
    name: "Prevention Center",
    description: "Reliability prevention engine for recurring incidents, known errors, corrective actions, and measured reduction.",
    icon: "ShieldCheck",
    version: "1.0.0",
    permissions: ["itsm:prevention:read", "itsm:prevention:write"],
    defaultMode: "canvas",
    installKey: "builtin_prevention-center",
    source: "built-in",
    publisher: "Specora ITSM",
    installedAt: 0,
    chatCapabilities: [
      { id: "prevention-center.detect", label: "Detect prevention work", description: "Find recurring incident and reliability patterns worth fixing", prompt: "Detect prevention candidates", icon: "ShieldCheck" },
      { id: "prevention-center.actions", label: "Propose corrective actions", description: "Create known-error, health, change, and automation prevention work", prompt: "Propose corrective actions for prevention candidates", icon: "Target" },
    ],
    events: ["prevention.created", "prevention.candidates_detected", "prevention.status_changed"],
  },
  {
    id: "asset-command",
    name: "Asset Command Center",
    description: "AI-first ITAM for hardware custody, software entitlements, contract extraction, reconciliation, and savings.",
    icon: "PackageSearch",
    version: "1.0.0",
    permissions: ["itsm:asset:read", "itsm:asset:write"],
    defaultMode: "canvas",
    installKey: "builtin_asset-command",
    source: "built-in",
    publisher: "Specora ITSM",
    installedAt: 0,
    chatCapabilities: [
      { id: "asset-command.reconcile", label: "Reconcile SAM", description: "Compare software usage against entitlements and surface license risk", prompt: "Run SAM reconciliation", icon: "Scale" },
      { id: "asset-command.contract", label: "Extract entitlements", description: "Create contract and entitlement records from agreement data", prompt: "Extract software entitlements from this contract", icon: "FileText" },
      { id: "asset-command.scans", label: "Review asset scans", description: "Inspect mobile-ready barcode/RFID scan and custody evidence", prompt: "Review asset scan exceptions", icon: "ScanLine" },
    ],
    events: ["asset.created", "asset.contract_ingested", "asset.sam_reconciled", "asset.scanned"],
  },
  {
    id: "customer-portal",
    name: "Customer Portal",
    description: "AI-first self-service front door for knowledge deflection, catalog requests, request status, and support handoffs.",
    icon: "MessageSquare",
    version: "0.1.0",
    permissions: ["customer-portal:read", "customer-portal:write"],
    defaultMode: "canvas",
    installKey: "builtin_customer-portal",
    source: "built-in",
    publisher: "Specora Experience",
    installedAt: 0,
    chatCapabilities: [
      { id: "customer-portal.ask", label: "Ask for help", description: "Resolve intent, answer, request, or escalate from one conversational front door", prompt: "I need help with something", icon: "MessageSquare" },
      { id: "customer-portal.catalog", label: "Browse catalog", description: "Find requestable services and submit governed catalog requests", prompt: "Show me the service catalog", icon: "ShoppingCart" },
      { id: "customer-portal.support", label: "Contact support", description: "Create a contextual support handoff or callback request", prompt: "I need to talk to support", icon: "PhoneCall" },
    ],
    events: ["catalog.request.submitted", "support.handoff.requested"],
  },
  {
    id: "engage-agent-workspace",
    name: "Engage Agent Workspace",
    description: "Unified agent command center for catalog request fulfillment, AI briefs, knowledge, links, handoffs, and requester updates.",
    icon: "ClipboardList",
    version: "0.1.0",
    permissions: ["engage:agent:read", "engage:agent:write", "customer-portal:read"],
    defaultMode: "canvas",
    installKey: "builtin_engage-agent-workspace",
    source: "built-in",
    publisher: "Specora Experience",
    installedAt: 0,
    chatCapabilities: [
      { id: "engage-agent.queue", label: "Review request queue", description: "Summarize catalog request queue health and aging work", prompt: "Review the Engage Agent request queue", icon: "ClipboardList" },
      { id: "engage-agent.brief", label: "Draft agent brief", description: "Summarize selected request context and next best action", prompt: "Draft an agent brief for the selected catalog request", icon: "Sparkles" },
      { id: "engage-agent.update", label: "Draft requester update", description: "Create a clear requester-facing update from current request state", prompt: "Draft a requester update for this catalog request", icon: "MessageSquare" },
    ],
    events: ["catalog.request.submitted", "catalog.request.updated", "support.handoff.requested"],
  },
  { id: "discovery-insights", name: "Discovery Insights", description: "Analyze discovery coverage and suggest next scans.", icon: "Radar", version: "1.0.0", permissions: ["itsm:discovery:read", "read:cmdb"], defaultMode: "canvas", installKey: "builtin_discovery-insights", source: "built-in", publisher: "Specora ITSM", installedAt: 0, events: ["discovery.completed"] },
  { id: "health-monitor", name: "Health Monitor", description: "Detect anomalies and monitor CI health scores.", icon: "HeartPulse", version: "1.0.0", permissions: ["itsm:health:read", "itsm:health:write", "read:cmdb", "read:relationships"], defaultMode: "canvas", installKey: "builtin_health-monitor", source: "built-in", publisher: "Specora ITSM", installedAt: 0, events: ["ci.updated"] },
  {
    id: "it-visibility-dcim",
    name: "DCIM Command Center",
    description: "Premium IT Visibility package app for facility topology, rack intelligence, power/cooling risk, and event correlation.",
    icon: "Network",
    version: "0.1.0",
    permissions: ["it-visibility:read", "it-visibility:write", "it-visibility:operate"],
    defaultMode: "canvas",
    installKey: "package_it-visibility_dcim",
    source: "built-in",
    publisher: "Specora IT Visibility",
    installedAt: 0,
    packageId: "it-visibility",
    packageName: "IT Visibility",
    premium: true,
    entitlementMode: "placeholder",
    bundledWithPlatform: false,
    chatCapabilities: [
      { id: "dcim.plan-install", label: "Plan rack install", description: "Find viable rack placement and power/network constraints", prompt: "Plan a data center rack install", icon: "Network" },
      { id: "dcim.failure-impact", label: "Simulate facility failure", description: "Explain service impact from PDU, UPS, cooling, or rack failure", prompt: "Simulate a data center failure impact", icon: "Zap" },
      { id: "dcim.event-story", label: "Explain facility events", description: "Correlate facility events into an operational story", prompt: "Explain current DCIM events", icon: "Activity" },
    ],
    events: ["dcim.event.ingested", "dcim.capacity.changed", "dcim.risk.detected"],
  },
  { id: "audit-log", name: "Audit Log", description: "View audit trail of CMDB mutations and ITSM changes.", icon: "ScrollText", version: "1.0.0", permissions: ["audit-log:read"], defaultMode: "canvas", installKey: "builtin_audit-log", source: "built-in", publisher: "Specora", installedAt: 0 },
  { id: "reporting", name: "Reporting", description: "Operational KPI dashboards, governed report previews, and BI contract handoff.", icon: "LayoutDashboard", version: "1.0.0", permissions: ["reporting:read", "reporting:write"], defaultMode: "canvas", installKey: "builtin_reporting", source: "built-in", publisher: "Specora", installedAt: 0 },
  { id: "admin-console", name: "Admin Console", description: "Govern access, registries, counters, system properties, and app-owned admin panels.", icon: "Shield", version: "1.0.0", permissions: ["rbac:read", "rbac:write", "number-sequences:read", "number-sequences:write", "system-properties:read", "system-properties:write"], defaultMode: "canvas", installKey: "builtin_admin-console", source: "built-in", publisher: "Specora", installedAt: 0 },
  { id: "ci-class-manager", name: "CI Class Manager", description: "Define CI classes, attributes, and data quality rules.", icon: "Layers", version: "1.0.0", permissions: ["admin:cmdb"], defaultMode: "window", installKey: "builtin_ci-class-manager", source: "built-in", publisher: "Specora", installedAt: 0 },
  { id: "tables", name: "Tables", description: "Browse and maintain platform tables through RBAC-aware CRUD APIs.", icon: "TableProperties", version: "1.0.0", permissions: ["tables:read", "tables:write"], defaultMode: "canvas", installKey: "builtin_tables", source: "built-in", publisher: "Specora", installedAt: 0 },
  { id: "data-foundations", name: "Data Foundations", description: "Govern CSDMv5 foundation data quality, ownership, and readiness.", icon: "Building2", version: "1.0.0", permissions: ["data-foundations:read", "data-foundations:write", "tables:read"], defaultMode: "canvas", installKey: "builtin_data-foundations", source: "built-in", publisher: "Specora", installedAt: 0 },
];

export function permissionToResourceAction(permission: string): { resource: string; action: string } | null {
  const parts = permission.split(":");
  if (parts.length === 3 && parts[0] === "itsm") {
    const [, domain, action] = parts;
    const resourceMap: Record<string, string> = {
      change: "change-manager",
      incident: "incident-manager",
      knowledge: "knowledge-core",
      prevention: "prevention-center",
      asset: "asset-command",
      discovery: "discovery",
      health: "health-monitor",
    };
    return { resource: resourceMap[domain] || domain, action };
  }
  const [left, right] = parts;
  if (!left || !right) return null;
  if (["read", "write", "admin"].includes(left)) return { resource: right, action: left };
  return { resource: left, action: right };
}

export async function getAllRegisteredApps(fastify: FastifyInstance): Promise<ServerAppRegistryEntry[]> {
  return [...BUILT_IN_APPS, ...(await getApprovedMarketplaceApps(fastify))]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

async function getInstallationRows(fastify: FastifyInstance) {
  type InstallationRow = { app_id: string; status?: string; last_job_id?: string | null };
  try {
    const result = await fastify.pg.query(
      `SELECT app_id, status, last_job_id
       FROM app_installations`
    );
    return new Map((result.rows as InstallationRow[]).map((row) => [row.app_id, row]));
  } catch {
    return new Map<string, InstallationRow>();
  }
}

export async function getAppCatalog(
  fastify: FastifyInstance,
  user: { id?: string; role?: string } | null
): Promise<ServerAppRegistryEntry[]> {
  const role = await resolveUserRole(fastify.pg, user);
  const allApps = await getAllRegisteredApps(fastify);
  const installations = await getInstallationRows(fastify);
  const catalog = [];
  for (const app of allApps) {
    if (!(await canAccessApp(fastify, role, app))) continue;
    const installation = installations.get(app.id);
    const coreInstalled = app.source === "built-in" && app.bundledWithPlatform !== false;
    const status = (coreInstalled ? "installed" : (installation?.status || "available")) as InstallStatus;
    catalog.push({
      ...app,
      installStatus: status,
      provisioningJobId: installation?.last_job_id || undefined,
    });
  }
  return catalog.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

async function canAccessApp(fastify: FastifyInstance, role: string | null, app: ServerAppRegistryEntry): Promise<boolean> {
  if (app.id === "customer-portal") return true;
  if (app.id === "settings") return true;
  if (app.id === "arc") return role === "admin" || role === "security_admin";
  if (!role) return false;
  if (role === "admin" || role === "security_admin") return true;
  for (const permission of app.permissions) {
    const check = permissionToResourceAction(permission);
    if (!check) continue;
    if (check.resource === "profile" || check.resource === "chat") continue;
    if (await hasPermission(fastify.pg, { role, resource: check.resource, action: check.action })) {
      return true;
    }
  }
  return false;
}

async function getApprovedMarketplaceApps(fastify: FastifyInstance): Promise<ServerAppRegistryEntry[]> {
  type MarketplaceAppRow = {
    id: string;
    name: string;
    description?: string;
    url?: string;
    icon?: string | null;
    version?: string | null;
    permissions?: unknown;
    react_version?: string | null;
    author?: string | null;
    created_at?: string | Date | null;
    package_id?: string | null;
    package_name?: string | null;
    premium?: boolean | null;
    entitlement_mode?: string | null;
    bundled_with_platform?: boolean | null;
  };
  const result = await fastify.pg.query(
    `SELECT id, name, description, url, icon, version, permissions, react_version, author, created_at,
            package_id, package_name, premium, entitlement_mode, bundled_with_platform
     FROM marketplace_apps WHERE status = 'approved' ORDER BY name`
  );
  return (result.rows as MarketplaceAppRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon || "Compass",
    version: row.version || "1.0.0",
    permissions: Array.isArray(row.permissions) ? row.permissions.map(String) : JSON.parse(String(row.permissions || "[]")),
    defaultMode: "window" as const,
    installKey: `server_${row.id}`,
    source: "external" as const,
    publisher: row.author || "Unknown",
    installedAt: row.created_at ? new Date(row.created_at).getTime() : 0,
    url: row.url,
    reactVersion: row.react_version || "^18.0.0",
    clearDataOnUninstall: true,
    packageId: row.package_id || undefined,
    packageName: row.package_name || undefined,
    premium: Boolean(row.premium),
    entitlementMode: (row.entitlement_mode || "included") as EntitlementMode,
    bundledWithPlatform: row.bundled_with_platform !== false,
  }));
}

export async function getVisibleApps(
  fastify: FastifyInstance,
  user: { id?: string; role?: string } | null
): Promise<ServerAppRegistryEntry[]> {
  const role = await resolveUserRole(fastify.pg, user);
  const allApps = await getAllRegisteredApps(fastify);
  const installations = await getInstallationRows(fastify);
  const visible = [];
  for (const app of allApps) {
    const coreInstalled = app.source === "built-in" && app.bundledWithPlatform !== false;
    const installation = installations.get(app.id);
    const installed = coreInstalled || installation?.status === "installed";
    if (!installed) continue;
    if (await canAccessApp(fastify, role, app)) {
      visible.push({
        ...app,
        installStatus: "installed" as const,
        provisioningJobId: installation?.last_job_id || undefined,
      });
    }
  }
  return visible.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
