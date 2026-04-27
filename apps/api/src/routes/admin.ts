import { FastifyInstance } from "fastify";
import { createHash, createHmac } from "crypto";
import { requirePermission, clearPermissionCache } from "../services/rbac";
import { getAllRegisteredApps, permissionToResourceAction } from "../services/appRegistry";
import { clearFieldRestrictionCache, fieldTargetsForTable, resolveFieldAccess } from "../services/fieldRbac";
import { getTables } from "./tables";
import { recordAuditEvent, verifyAuditIntegrity } from "../services/auditLog";
import { getAllAppToolDefinitions } from "../services/appTools";
import { resolveAppToolPolicy } from "./appToolPolicy";

const API_PUBLIC_URL = process.env.API_PUBLIC_URL || (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/graphql").replace("/graphql", "");

const CORE_ADMIN_PANELS = [
  { id: "rbac", name: "RBAC", icon: "Shield", permissions: ["rbac:read"] },
  { id: "identity", name: "Identity Providers", icon: "KeyRound", permissions: ["identity:read"] },
  { id: "number-sequences", name: "Number Sequences", icon: "Hash", permissions: ["number-sequences:read"] },
  { id: "system-properties", name: "System Properties", icon: "Settings", permissions: ["system-properties:read"] },
];

const CORE_PERMISSION_TARGETS = [
  permissionTarget("identity-groups", "read", {
    label: "Identity Groups",
    category: "Admin",
    source: "Core admin panel",
    description: "Allows a role to view identity groups, memberships, and inherited grants.",
    risk: "high",
  }),
  permissionTarget("identity-groups", "write", {
    label: "Identity Groups",
    category: "Admin",
    source: "Core admin panel",
    description: "Allows a role to manage identity groups, memberships, CMDB links, and inherited grants.",
    risk: "critical",
  }),
  permissionTarget("identity", "read", {
    label: "Identity Provider Administration",
    category: "Admin",
    source: "Core admin panel",
    description: "Allows a role to view SSO and OAuth provider configuration posture.",
    risk: "high",
  }),
  permissionTarget("identity", "write", {
    label: "Identity Provider Administration",
    category: "Admin",
    source: "Core admin panel",
    description: "Allows a role to create, update, activate, or disable enterprise identity providers.",
    risk: "critical",
  }),
];

const BUILT_IN_APP_PANELS = [
  {
    id: "change-manager-state-machine",
    name: "Change State Machine",
    icon: "GitBranch",
    permissions: ["system-properties:write"],
    appId: "change-manager",
  },
];

const NUMBER_SEQUENCE_OPTIONS = [
  { appId: "incident-manager", appName: "Incident Command Center", tableName: "incidents", recordType: "Incident", defaultPrefix: "INC" },
  { appId: "change-manager", appName: "Change Manager", tableName: "change_requests", recordType: "Change Request", defaultPrefix: "CHG" },
  { appId: "knowledge-core", appName: "Knowledge Core", tableName: "knowledge_items", recordType: "Knowledge", defaultPrefix: "KB" },
  { appId: "prevention-center", appName: "Prevention Center", tableName: "prevention_records", recordType: "Prevention Record", defaultPrefix: "PRV" },
  { appId: "asset-command", appName: "Asset Command Center", tableName: "asset_records", recordType: "Asset", defaultPrefix: "AST" },
  { appId: "customer-portal", appName: "Customer Portal", tableName: "catalog_requests", recordType: "Catalog Request", defaultPrefix: "REQ" },
  { appId: "discovery", appName: "Discovery", tableName: "discovery_pipelines", recordType: "Discovery Pipeline", defaultPrefix: "DISC" },
  { appId: "discovery", appName: "Discovery", tableName: "discovery_jobs", recordType: "Discovery Job", defaultPrefix: "DJOB" },
];

function findNumberSequenceOption(body: { appId?: string; tableName?: string; recordType?: string }) {
  return NUMBER_SEQUENCE_OPTIONS.find((option) =>
    option.appId === body.appId &&
    option.tableName === body.tableName &&
    option.recordType === body.recordType
  );
}

function normalizeSequenceConfig(body: { prefix?: string; nextValue?: number; padding?: number }) {
  const prefix = body.prefix?.trim().toUpperCase();
  const nextValue = Number(body.nextValue ?? 1);
  const padding = Number(body.padding ?? 6);
  if (!prefix || !/^[A-Z][A-Z0-9]{1,19}$/.test(prefix)) {
    return { error: "Prefix must be 2-20 uppercase letters or numbers and start with a letter" };
  }
  if (!Number.isInteger(nextValue) || nextValue < 1) {
    return { error: "nextValue must be a positive integer" };
  }
  if (!Number.isInteger(padding) || padding < 0 || padding > 12) {
    return { error: "padding must be an integer from 0 to 12" };
  }
  return { prefix, nextValue, padding };
}

function permissionRisk(resource: string, action: string) {
  if (resource === "rbac" || resource === "system-properties" || resource === "identity" || resource === "identity-groups") return "critical";
  if (resource.startsWith("field:") && action === "write") return "high";
  if (resource.startsWith("field:")) return "medium";
  if (["admin", "govern", "approve", "remediate", "delete"].includes(action)) return "high";
  if (["write", "mutate"].includes(action)) return "medium";
  return "low";
}

function permissionCategory(resource: string, action: string) {
  if (resource.startsWith("field:")) return "Field";
  if (resource === "tables" || resource.startsWith("pg.") || resource.startsWith("cmdb.")) return "Table";
  if (resource === "rbac" || resource === "system-properties" || resource === "number-sequences" || resource === "identity" || resource === "identity-groups") return "Admin";
  if (resource.includes("package") || resource.includes("provision")) return "Package";
  if (["operate", "execute", "approve", "remediate"].includes(action)) return "Automation";
  return "Application";
}

function actionPhrase(action: string) {
  switch (action) {
    case "read": return "view";
    case "write": return "create or update";
    case "delete": return "delete";
    case "operate": return "operate";
    case "approve": return "approve";
    case "admin": return "administer";
    default: return action;
  }
}

function permissionDescription(resource: string, action: string, label?: string) {
  if (resource.startsWith("field:")) {
    const field = label || resource.replace(/^field:/, "");
    return `Allows a role to ${actionPhrase(action)} the ${field} field wherever field-level RBAC is enforced.`;
  }
  if (resource === "tables") {
    return `Allows a role to ${actionPhrase(action)} records through the Tables application and table-backed APIs.`;
  }
  if (resource === "rbac") {
    return "Controls access to role grants, access analysis, and security administration.";
  }
  if (resource === "system-properties") {
    return "Controls platform configuration values and app-owned administrative settings.";
  }
  if (resource === "number-sequences") {
    return "Controls record-number sequence registration and counter maintenance.";
  }
  if (resource === "identity") {
    return "Controls enterprise identity provider configuration, SSO discovery, and login governance.";
  }
  if (resource === "identity-groups") {
    return "Controls platform identity groups, memberships, inherited grants, and CMDB group links.";
  }
  return `Allows a role to ${actionPhrase(action)} ${label || resource}.`;
}

function permissionTarget(resource: string, action: string, overrides: Record<string, any> = {}) {
  const label = overrides.label || resource;
  return {
    resource,
    action,
    label,
    description: overrides.description || permissionDescription(resource, action, label),
    category: overrides.category || permissionCategory(resource, action),
    source: overrides.source || "Permission Registry",
    risk: overrides.risk || permissionRisk(resource, action),
  };
}

function parsePositiveInt(value: any, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function csvCell(value: any) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function auditRow(row: any) {
  return {
    id: row.id,
    actorId: row.actor_id,
    actorEmail: row.actor_email || null,
    actorName: row.actor_name || null,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    oldValues: row.old_values,
    newValues: row.new_values,
    metadata: row.metadata,
    previousHash: row.previous_hash || null,
    entryHash: row.entry_hash || null,
    integrityVersion: row.integrity_version || 1,
    createdAt: row.created_at,
  };
}

function exportSignature(body: string, secret?: string) {
  const digest = createHash("sha256").update(body).digest("hex");
  const signature = createHmac("sha256", secret || "specora-dev-secret").update(digest).digest("hex");
  return { digest, signature, algorithm: "sha256+hmac-sha256" };
}

function normalizeStringArray(value: unknown, fallback: string[] = []) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\n]/)
      : fallback;
  return Array.from(new Set(raw.map((item) => String(item).trim()).filter(Boolean)));
}

function parseSamlMetadata(metadataXml?: string) {
  if (!metadataXml) return {};
  const entityMatch = metadataXml.match(/<[^>]*EntityDescriptor\b[^>]*\bentityID=["']([^"']+)["']/i);
  const ssoMatch = metadataXml.match(/<[^>]*SingleSignOnService\b[^>]*\bLocation=["']([^"']+)["']/i);
  const certMatch = metadataXml.match(/<[^>]*X509Certificate[^>]*>([\s\S]*?)<\/[^>]*X509Certificate>/i);
  return {
    idpEntityId: entityMatch?.[1]?.trim(),
    idpSsoUrl: ssoMatch?.[1]?.trim(),
    idpCert: certMatch?.[1]?.replace(/\s+/g, ""),
  };
}

function spEntityIdFor(configId: string, configured?: string | null) {
  return configured || `${API_PUBLIC_URL}/saml/sp/${configId}`;
}

function spAcsUrlFor(configId: string) {
  return `${API_PUBLIC_URL}/api/auth/sso/${configId}/acs`;
}

function normalizeSsoConfigBody(body: any, partial = false) {
  const provider = body.provider === undefined ? undefined : String(body.provider).toLowerCase();
  if (provider !== undefined && !["saml", "oidc"].includes(provider)) {
    return { error: "provider must be saml or oidc" };
  }
  const status = body.status === undefined ? undefined : String(body.status).toLowerCase();
  if (status !== undefined && !["active", "inactive"].includes(status)) {
    return { error: "status must be active or inactive" };
  }
  const domains = body.emailDomains === undefined ? undefined : normalizeStringArray(body.emailDomains).map((domain) => domain.toLowerCase());
  if (!partial && (!body.name || !provider || !domains?.length)) {
    return { error: "name, provider, and at least one email domain are required" };
  }
  if (domains?.some((domain) => !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain))) {
    return { error: "email domains must be valid domain names" };
  }
  const scopes = body.scopes === undefined ? undefined : normalizeStringArray(body.scopes, ["openid", "email", "profile"]);
  const metadataXml = body.metadataXml === undefined ? undefined : String(body.metadataXml).trim();
  const metadataValues = parseSamlMetadata(metadataXml);
  const attributeMapping = body.attributeMapping === undefined ? undefined : {
    email: String(body.attributeMapping?.email || "email"),
    name: String(body.attributeMapping?.name || "name"),
    groups: String(body.attributeMapping?.groups || "groups"),
  };
  return {
    name: body.name === undefined ? undefined : String(body.name).trim(),
    provider,
    status,
    emailDomains: domains,
    idpEntityId: body.idpEntityId === undefined ? metadataValues.idpEntityId : String(body.idpEntityId).trim() || metadataValues.idpEntityId,
    idpSsoUrl: body.idpSsoUrl === undefined ? metadataValues.idpSsoUrl : String(body.idpSsoUrl).trim() || metadataValues.idpSsoUrl,
    idpCert: body.idpCert === undefined ? metadataValues.idpCert : String(body.idpCert).trim() || metadataValues.idpCert,
    spEntityId: body.spEntityId === undefined ? undefined : String(body.spEntityId).trim(),
    metadataUrl: body.metadataUrl === undefined ? undefined : String(body.metadataUrl).trim(),
    metadataXml,
    clientId: body.clientId === undefined ? undefined : String(body.clientId).trim(),
    clientSecretRef: body.clientSecretRef === undefined ? undefined : String(body.clientSecretRef).trim(),
    issuerUrl: body.issuerUrl === undefined ? undefined : String(body.issuerUrl).trim(),
    authorizationUrl: body.authorizationUrl === undefined ? undefined : String(body.authorizationUrl).trim(),
    tokenUrl: body.tokenUrl === undefined ? undefined : String(body.tokenUrl).trim(),
    userinfoUrl: body.userinfoUrl === undefined ? undefined : String(body.userinfoUrl).trim(),
    scopes,
    enforceSso: body.enforceSso === undefined ? undefined : body.enforceSso === true,
    jitEnabled: body.jitEnabled === undefined ? undefined : body.jitEnabled !== false,
    defaultRole: body.defaultRole === undefined ? undefined : String(body.defaultRole || "user").trim(),
    attributeMapping,
  };
}

function ssoConfigRow(row: any) {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    status: row.status,
    emailDomains: row.email_domains || [],
    idpEntityId: row.idp_entity_id || "",
    idpSsoUrl: row.idp_sso_url || "",
    idpCertPresent: Boolean(row.idp_cert),
    spEntityId: spEntityIdFor(row.id, row.sp_entity_id),
    spAcsUrl: spAcsUrlFor(row.id),
    metadataUrl: row.metadata_url || "",
    metadataXmlPresent: Boolean(row.metadata_xml),
    jitEnabled: row.jit_enabled,
    clientId: row.client_id || "",
    clientSecretRef: row.client_secret_ref || "",
    issuerUrl: row.issuer_url || "",
    authorizationUrl: row.authorization_url || "",
    tokenUrl: row.token_url || "",
    userinfoUrl: row.userinfo_url || "",
    scopes: row.scopes || ["openid", "email", "profile"],
    enforceSso: row.enforce_sso,
    defaultRole: row.default_role || "user",
    attributeMapping: row.attribute_mapping || { email: "email", name: "name", groups: "groups" },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type AdminTableField = { name: string; label: string; writable: boolean };

function tableFieldsForExplanation(table: any): AdminTableField[] {
  const seen = new Set<string>();
  const fields: AdminTableField[] = [];
  const add = (field: AdminTableField) => {
    if (!field.name || seen.has(field.name)) return;
    seen.add(field.name);
    fields.push(field);
  };
  add({ name: "id", label: "ID", writable: false });
  add({ name: table.nameField || "name", label: table.nameField ? permissionLabel(table.nameField) : "Name", writable: true });
  if (table.hasNumber) add({ name: "number", label: "Number", writable: false });
  if (table.provider === "cmdb-class") add({ name: "environment", label: "Environment", writable: true });
  for (const attr of table.attributes || []) {
    add({ name: attr.name, label: attr.displayName || permissionLabel(attr.name), writable: true });
  }
  return fields;
}

async function loadFieldRestrictions(pg: any): Promise<Array<{ resource: string; tableId?: string; field?: string }>> {
  const result = await pg.query("SELECT value FROM system_properties WHERE key = 'security.field_restrictions'");
  const raw = result.rows[0]?.value;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (typeof item === "string" && item.startsWith("field:")) return { resource: item };
        if (item && typeof item === "object") {
          const resource = typeof item.resource === "string" ? item.resource : null;
          const tableId = typeof item.tableId === "string" ? item.tableId : null;
          const field = typeof item.field === "string" ? item.field : null;
          if (resource) return { resource };
          if (tableId && field) return { resource: `field:${tableId}.${field}`, tableId, field };
        }
        return null;
      })
      .filter((item): item is { resource: string; tableId?: string; field?: string } => Boolean(item?.resource));
  } catch {
    return [];
  }
}

function normalizeFieldRestriction(tableId: string, field: string) {
  return { tableId, field, resource: `field:${tableId}.${field}` };
}

async function saveFieldRestrictions(pg: any, restrictions: Array<{ resource: string; tableId?: string; field?: string }>) {
  const normalized = Array.from(new Map(restrictions
    .filter((item) => item.resource?.startsWith("field:"))
    .map((item) => [item.resource, item])).values())
    .sort((a, b) => a.resource.localeCompare(b.resource));
  const value = JSON.stringify(normalized.map((item) => item.tableId && item.field ? { tableId: item.tableId, field: item.field } : item.resource));
  await pg.query(
    `INSERT INTO system_properties (key, value)
     VALUES ('security.field_restrictions', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
     RETURNING key, value, updated_at`,
    [value]
  );
  clearFieldRestrictionCache();
  return normalized;
}

function permissionLabel(value: string) {
  return value
    .replace(/^field:/, "")
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function n(value: any) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  return Number(value) || 0;
}

function pct(value: any) {
  const score = n(value);
  if (score <= 1) return Math.round(score * 100);
  return Math.round(score);
}

function scoreFromRisks(risks: number[]) {
  const score = Math.max(0, Math.min(100, Math.round(100 - risks.reduce((sum, risk) => sum + risk, 0))));
  if (score >= 85) return { score, posture: "healthy" };
  if (score >= 65) return { score, posture: "watch" };
  return { score, posture: "attention" };
}

async function loadCmdbStats(fastify: FastifyInstance) {
  if (!(fastify as any).neo4j?.session) return null;
  const session = (fastify as any).neo4j.session();
  try {
    const result = await session.run(
      `MATCH (n:ConfigurationItem)
       WITH count(n) AS ciCount
       OPTIONAL MATCH ()-[r]-()
       RETURN ciCount, count(r) AS relationshipCount`
    );
    const row = result.records[0];
    return {
      ciCount: row?.get("ciCount")?.toNumber?.() ?? n(row?.get("ciCount")),
      relationshipCount: row?.get("relationshipCount")?.toNumber?.() ?? n(row?.get("relationshipCount")),
    };
  } catch (err: any) {
    fastify.log.warn({ err: err.message }, "Failed to load CMDB operational intelligence stats");
    return null;
  } finally {
    await session.close();
  }
}

async function buildOperationalIntelligence(fastify: FastifyInstance) {
  const [
    incident,
    change,
    knowledge,
    request,
    asset,
    discovery,
    governance,
    cmdb,
  ] = await Promise.all([
    fastify.pg.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed'))::int AS open,
         COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed') AND severity IN ('critical', 'high'))::int AS high_open,
         COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed') AND ai_state IN ('queued', 'analyzing'))::int AS ai_pending,
         AVG(ai_confidence)::float AS avg_ai_confidence
       FROM incidents`
    ),
    fastify.pg.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'pending_approval')::int AS pending_approval,
         COUNT(*) FILTER (WHERE status NOT IN ('closed', 'rejected', 'rolled_back') AND COALESCE(risk_score, 0) >= 60)::int AS high_risk_active,
         COUNT(*) FILTER (WHERE status NOT IN ('closed', 'rejected', 'rolled_back') AND COALESCE(planned_start_at, scheduled_at) BETWEEN NOW() AND NOW() + INTERVAL '7 days')::int AS upcoming,
         COUNT(*) FILTER (WHERE status = 'pending_approval' AND NOT EXISTS (
           SELECT 1 FROM change_cab_brief_snapshots s WHERE s.change_request_id = change_requests.id
         ))::int AS pending_without_brief
       FROM change_requests`
    ),
    fastify.pg.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'published')::int AS published,
         COUNT(*) FILTER (WHERE status = 'published' AND (last_validated_at IS NULL OR last_validated_at < NOW() - INTERVAL '90 days'))::int AS stale,
         COALESCE(AVG(health_score), 0)::float AS avg_health,
         (SELECT COUNT(*)::int FROM knowledge_gaps WHERE status = 'open') AS open_gaps
       FROM knowledge_items`
    ),
    fastify.pg.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status NOT IN ('fulfilled', 'cancelled', 'closed'))::int AS open,
         COUNT(*) FILTER (WHERE status NOT IN ('fulfilled', 'cancelled', 'closed') AND priority <= 2)::int AS high_priority,
         (SELECT COUNT(*)::int FROM support_handoffs WHERE status NOT IN ('completed', 'cancelled', 'closed')) AS active_handoffs
       FROM catalog_requests`
    ),
    fastify.pg.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE lifecycle_state NOT IN ('retired', 'disposed'))::int AS active,
         COUNT(*) FILTER (WHERE evidence_score < 0.5)::int AS weak_evidence,
         (SELECT COUNT(*)::int FROM asset_exceptions WHERE status = 'open') AS open_exceptions,
         (SELECT COALESCE(SUM(GREATEST(consumed - quantity, 0)), 0)::float FROM software_entitlements WHERE status = 'active') AS entitlement_overage
       FROM asset_records`
    ),
    fastify.pg.query(
      `SELECT
         (SELECT COUNT(*)::int FROM discovery_pipelines) AS pipelines,
         (SELECT COUNT(*)::int FROM discovery_pipelines WHERE published_definition IS NOT NULL) AS published_pipelines,
         (SELECT COUNT(*)::int FROM discovery_sources WHERE COALESCE(last_status, 'unknown') NOT IN ('ok', 'healthy', 'success')) AS unhealthy_sources,
         (SELECT COUNT(*)::int FROM discovery_jobs WHERE status IN ('failed', 'error') AND created_at > NOW() - INTERVAL '7 days') AS failed_jobs_7d,
         (SELECT COUNT(*)::int FROM discovery_staged_records WHERE status = 'staged') AS staged_records`
    ),
    fastify.pg.query(
      `SELECT
         (SELECT COUNT(*)::int FROM app_permissions) AS permission_grants,
         (SELECT COUNT(*)::int FROM number_sequences WHERE enabled = true) AS active_sequences,
         (SELECT COUNT(*)::int FROM audit_log WHERE created_at > NOW() - INTERVAL '24 hours') AS audit_events_24h,
         (SELECT COUNT(*)::int FROM app_provisioning_jobs WHERE status NOT IN ('completed', 'cancelled')) AS active_package_jobs`
    ),
    loadCmdbStats(fastify),
  ]);

  const incidentRow = incident.rows[0] || {};
  const changeRow = change.rows[0] || {};
  const knowledgeRow = knowledge.rows[0] || {};
  const requestRow = request.rows[0] || {};
  const assetRow = asset.rows[0] || {};
  const discoveryRow = discovery.rows[0] || {};
  const governanceRow = governance.rows[0] || {};

  const domains = [
    {
      id: "incidents",
      label: "Incident Autonomy",
      score: scoreFromRisks([n(incidentRow.high_open) * 15, n(incidentRow.ai_pending) * 3]).score,
      posture: scoreFromRisks([n(incidentRow.high_open) * 15, n(incidentRow.ai_pending) * 3]).posture,
      metrics: [
        { label: "Open", value: n(incidentRow.open) },
        { label: "High severity", value: n(incidentRow.high_open) },
        { label: "AI pending", value: n(incidentRow.ai_pending) },
        { label: "Avg AI confidence", value: `${pct(incidentRow.avg_ai_confidence)}%` },
      ],
    },
    {
      id: "change",
      label: "Change Risk",
      score: scoreFromRisks([n(changeRow.high_risk_active) * 12, n(changeRow.pending_without_brief) * 8]).score,
      posture: scoreFromRisks([n(changeRow.high_risk_active) * 12, n(changeRow.pending_without_brief) * 8]).posture,
      metrics: [
        { label: "Pending CAB", value: n(changeRow.pending_approval) },
        { label: "High-risk active", value: n(changeRow.high_risk_active) },
        { label: "Upcoming", value: n(changeRow.upcoming) },
        { label: "Pending without brief", value: n(changeRow.pending_without_brief) },
      ],
    },
    {
      id: "knowledge",
      label: "Knowledge Health",
      score: scoreFromRisks([n(knowledgeRow.stale) * 4, n(knowledgeRow.open_gaps) * 6, Math.max(0, 80 - pct(knowledgeRow.avg_health)) / 2]).score,
      posture: scoreFromRisks([n(knowledgeRow.stale) * 4, n(knowledgeRow.open_gaps) * 6, Math.max(0, 80 - pct(knowledgeRow.avg_health)) / 2]).posture,
      metrics: [
        { label: "Published", value: n(knowledgeRow.published) },
        { label: "Stale", value: n(knowledgeRow.stale) },
        { label: "Open gaps", value: n(knowledgeRow.open_gaps) },
        { label: "Avg health", value: `${pct(knowledgeRow.avg_health)}%` },
      ],
    },
    {
      id: "engage",
      label: "Engage Flow",
      score: scoreFromRisks([n(requestRow.high_priority) * 8, n(requestRow.active_handoffs) * 4]).score,
      posture: scoreFromRisks([n(requestRow.high_priority) * 8, n(requestRow.active_handoffs) * 4]).posture,
      metrics: [
        { label: "Open requests", value: n(requestRow.open) },
        { label: "High priority", value: n(requestRow.high_priority) },
        { label: "Active handoffs", value: n(requestRow.active_handoffs) },
        { label: "Total requests", value: n(requestRow.total) },
      ],
    },
    {
      id: "asset",
      label: "Asset Trust",
      score: scoreFromRisks([n(assetRow.open_exceptions) * 7, n(assetRow.weak_evidence) * 3, n(assetRow.entitlement_overage) * 2]).score,
      posture: scoreFromRisks([n(assetRow.open_exceptions) * 7, n(assetRow.weak_evidence) * 3, n(assetRow.entitlement_overage) * 2]).posture,
      metrics: [
        { label: "Active assets", value: n(assetRow.active) },
        { label: "Open exceptions", value: n(assetRow.open_exceptions) },
        { label: "Weak evidence", value: n(assetRow.weak_evidence) },
        { label: "Entitlement overage", value: n(assetRow.entitlement_overage) },
      ],
    },
    {
      id: "discovery",
      label: "Discovery Readiness",
      score: scoreFromRisks([n(discoveryRow.unhealthy_sources) * 10, n(discoveryRow.failed_jobs_7d) * 8, n(discoveryRow.staged_records) > 0 ? 8 : 0]).score,
      posture: scoreFromRisks([n(discoveryRow.unhealthy_sources) * 10, n(discoveryRow.failed_jobs_7d) * 8, n(discoveryRow.staged_records) > 0 ? 8 : 0]).posture,
      metrics: [
        { label: "Pipelines", value: n(discoveryRow.pipelines) },
        { label: "Published", value: n(discoveryRow.published_pipelines) },
        { label: "Unhealthy sources", value: n(discoveryRow.unhealthy_sources) },
        { label: "Failed jobs 7d", value: n(discoveryRow.failed_jobs_7d) },
      ],
    },
  ];

  const signals = [
    n(incidentRow.high_open) > 0 && {
      severity: "critical",
      title: "High-severity incidents are open",
      detail: `${n(incidentRow.high_open)} high or critical incident${n(incidentRow.high_open) === 1 ? "" : "s"} need command attention.`,
      action: "Open Incident Command Center",
      appId: "incident-manager",
    },
    n(changeRow.pending_without_brief) > 0 && {
      severity: "warning",
      title: "CAB items missing persisted briefs",
      detail: `${n(changeRow.pending_without_brief)} pending change${n(changeRow.pending_without_brief) === 1 ? "" : "s"} should have a CAB snapshot before approval.`,
      action: "Open Change Manager",
      appId: "change-manager",
    },
    n(knowledgeRow.open_gaps) > 0 && {
      severity: "warning",
      title: "Knowledge gaps are accumulating",
      detail: `${n(knowledgeRow.open_gaps)} open knowledge gap${n(knowledgeRow.open_gaps) === 1 ? "" : "s"} reduce portal deflection and agent speed.`,
      action: "Open Knowledge Orchestrator",
      appId: "knowledge-core",
    },
    n(assetRow.open_exceptions) > 0 && {
      severity: "warning",
      title: "Asset exceptions need reconciliation",
      detail: `${n(assetRow.open_exceptions)} open ITAM exception${n(assetRow.open_exceptions) === 1 ? "" : "s"} can affect financial and compliance confidence.`,
      action: "Open Asset Command Center",
      appId: "asset-command",
    },
    n(discoveryRow.unhealthy_sources) > 0 && {
      severity: "warning",
      title: "Discovery sources are unhealthy",
      detail: `${n(discoveryRow.unhealthy_sources)} source${n(discoveryRow.unhealthy_sources) === 1 ? "" : "s"} failed or have not proven health.`,
      action: "Open Discovery",
      appId: "discovery",
    },
  ].filter(Boolean);

  const overall = Math.round(domains.reduce((sum, domain) => sum + domain.score, 0) / Math.max(1, domains.length));
  return {
    generatedAt: new Date().toISOString(),
    overall: {
      score: overall,
      posture: overall >= 85 ? "healthy" : overall >= 65 ? "watch" : "attention",
      summary: overall >= 85
        ? "Operational posture is demo-ready with no major cross-module risks."
        : overall >= 65
          ? "Operational posture is credible, with focused follow-up needed before enterprise review."
          : "Operational posture needs attention before strong enterprise positioning claims.",
    },
    domains,
    signals,
    governance: {
      permissionGrants: n(governanceRow.permission_grants),
      activeSequences: n(governanceRow.active_sequences),
      auditEvents24h: n(governanceRow.audit_events_24h),
      activePackageJobs: n(governanceRow.active_package_jobs),
    },
    cmdb: cmdb || { ciCount: null, relationshipCount: null },
  };
}

async function roleHasGrant(pg: any, role: string, resource: string, action: string) {
  const result = await pg.query(
    "SELECT id, role, resource, action FROM app_permissions WHERE role = $1 AND resource = $2 AND action = $3",
    [role, resource, action]
  );
  return result.rows[0] || null;
}

async function userGroupGrants(pg: any, userId?: string | null) {
  if (!userId) return { groups: [], grants: [] };
  const groups = await pg.query(
    `SELECT g.id, g.name, g.slug, g.description, g.source, g.external_id, g.cmdb_ci_id
     FROM identity_group_memberships gm
     JOIN identity_groups g ON g.id = gm.group_id
     WHERE gm.user_id = $1
     ORDER BY g.name`,
    [userId]
  );
  const grants = await pg.query(
    `SELECT gp.id, gp.group_id, g.name AS group_name, g.slug AS group_slug, gp.resource, gp.action
     FROM identity_group_memberships gm
     JOIN identity_groups g ON g.id = gm.group_id
     JOIN identity_group_permissions gp ON gp.group_id = g.id
     WHERE gm.user_id = $1
     ORDER BY g.name, gp.resource, gp.action`,
    [userId]
  );
  return { groups: groups.rows, grants: grants.rows };
}

function evaluateGrantWithGroups(role: string, grants: any[], groupGrants: any[], resource: string, action: string) {
  const base = evaluateGrant(role, grants, resource, action);
  if (base.allowed) return { ...base, inheritedGrant: null };
  const inheritedGrant = groupGrants.find((grant: any) => grant.resource === resource && grant.action === action) || null;
  if (inheritedGrant) {
    return { allowed: true, reason: "inherited_group_grant", directGrant: null, inheritedGrant };
  }
  return { ...base, inheritedGrant: null };
}

async function analyzeAccess(
  fastify: FastifyInstance,
  body: { userId?: string; email?: string; role?: string; resource?: string; action?: string }
) {
  const resource = body.resource?.trim();
  const action = body.action?.trim();
  if (!resource || !action) {
    return { error: "resource and action required" };
  }

  let user: any = null;
  if (body.userId) {
    const result = await fastify.pg.query("SELECT id, name, email, role FROM users WHERE id = $1", [body.userId]);
    user = result.rows[0] || null;
  } else if (body.email) {
    const result = await fastify.pg.query("SELECT id, name, email, role FROM users WHERE email = $1", [body.email]);
    user = result.rows[0] || null;
  }

  const role = body.role || user?.role;
  if (!role) {
    return { error: "user or role required" };
  }

  const trace: Array<{ status: "allow" | "deny" | "info"; label: string; detail: string }> = [];
  const grantsResult = await fastify.pg.query(
    "SELECT id, role, resource, action FROM app_permissions WHERE role = $1 ORDER BY resource, action",
    [role]
  );
  const grants = grantsResult.rows;
  const inherited = await userGroupGrants(fastify.pg, user?.id);
  const directGrant = grants.find((grant: any) => grant.resource === resource && grant.action === action) ||
    await roleHasGrant(fastify.pg, role, resource, action);
  const inheritedGrant = inherited.grants.find((grant: any) => grant.resource === resource && grant.action === action) || null;

  let allowed = false;
  let reason = "missing_permission";
  if (role === "security_admin") {
    allowed = true;
    reason = "security_admin_implicit_allow";
    trace.push({ status: "allow", label: "Security admin override", detail: "security_admin has universal platform access." });
  } else if (role === "admin" && resource !== "rbac") {
    allowed = true;
    reason = "admin_implicit_allow";
    trace.push({ status: "allow", label: "Admin implicit allow", detail: "admin can access all non-RBAC resources." });
  } else if (directGrant) {
    allowed = true;
    reason = "direct_role_grant";
    trace.push({ status: "allow", label: "Direct role grant", detail: `${role} has ${resource}:${action}.` });
  } else if (inheritedGrant) {
    allowed = true;
    reason = "inherited_group_grant";
    trace.push({ status: "allow", label: "Inherited group grant", detail: `${inheritedGrant.group_name} grants ${resource}:${action}.` });
  } else {
    trace.push({ status: "deny", label: "Missing role grant", detail: `${role} does not have ${resource}:${action}.` });
  }

  if (role === "admin" && resource === "rbac" && !directGrant) {
    trace.push({ status: "info", label: "RBAC protection", detail: "admin does not receive implicit RBAC administration; grant rbac permissions explicitly or use security_admin." });
  }

  const apps = await getAllRegisteredApps(fastify);
  const relatedApps = apps.filter((app) => app.permissions.some((permission) => {
    const check = permissionToResourceAction(permission);
    return check?.resource === resource && check.action === action;
  })).map((app) => ({ id: app.id, name: app.name, permissions: app.permissions }));
  if (relatedApps.length) {
    trace.push({ status: "info", label: "Related app access", detail: `${relatedApps.map((app) => app.name).join(", ")} declares this permission.` });
  }

  return {
    result: {
      allowed,
      reason,
      risk: permissionRisk(resource, action),
      user,
      role,
      resource,
      action,
      directGrant: directGrant || null,
      inheritedGrant,
      inheritedGroups: inherited.groups,
      inheritedGrants: inherited.grants,
      grants,
      relatedApps,
      missing: allowed ? [] : [{ resource, action }],
      trace,
    },
  };
}

async function resolveAccessSubject(
  fastify: FastifyInstance,
  body: { userId?: string; email?: string; role?: string }
) {
  let user: any = null;
  if (body.userId) {
    const result = await fastify.pg.query("SELECT id, name, email, role FROM users WHERE id = $1", [body.userId]);
    user = result.rows[0] || null;
  } else if (body.email) {
    const result = await fastify.pg.query("SELECT id, name, email, role FROM users WHERE email = $1", [body.email]);
    user = result.rows[0] || null;
  }
  const role = body.role || user?.role;
  return { user, role };
}

function evaluateGrant(role: string, grants: any[], resource: string, action: string) {
  const directGrant = grants.find((grant: any) => grant.resource === resource && grant.action === action) || null;
  if (role === "security_admin") {
    return { allowed: true, reason: "security_admin_implicit_allow", directGrant };
  }
  if (role === "admin" && resource !== "rbac") {
    return { allowed: true, reason: "admin_implicit_allow", directGrant };
  }
  if (directGrant) {
    return { allowed: true, reason: "direct_role_grant", directGrant };
  }
  return { allowed: false, reason: "missing_permission", directGrant };
}

async function explainAppAccess(
  fastify: FastifyInstance,
  body: { userId?: string; email?: string; role?: string; appId?: string }
) {
  const appId = body.appId?.trim();
  if (!appId) return { error: "appId required" };

  const { user, role } = await resolveAccessSubject(fastify, body);
  if (!role) return { error: "user or role required" };

  const apps = await getAllRegisteredApps(fastify);
  const app = apps.find((candidate) => candidate.id === appId);
  if (!app) return { error: "app not found" };

  const grantsResult = await fastify.pg.query(
    "SELECT id, role, resource, action FROM app_permissions WHERE role = $1 ORDER BY resource, action",
    [role]
  );
  const grants = grantsResult.rows;
  const inherited = await userGroupGrants(fastify.pg, user?.id);
  const requirements = app.permissions
    .map((permission) => {
      const parsed = permissionToResourceAction(permission);
      if (!parsed) return null;
      const evaluation = evaluateGrantWithGroups(role, grants, inherited.grants, parsed.resource, parsed.action);
      const target = permissionTarget(parsed.resource, parsed.action, {
        label: app.name,
        source: `Native app: ${app.name}`,
        category: "Application",
      });
      return {
        declaredPermission: permission,
        resource: parsed.resource,
        action: parsed.action,
        allowed: evaluation.allowed,
        reason: evaluation.reason,
        directGrant: evaluation.directGrant,
        inheritedGrant: evaluation.inheritedGrant,
        risk: target.risk,
        description: target.description,
      };
    })
    .filter((requirement): requirement is NonNullable<typeof requirement> => Boolean(requirement));
  const missing = requirements
    .filter((requirement) => !requirement.allowed)
    .map((requirement) => ({ resource: requirement.resource, action: requirement.action, risk: requirement.risk }));

  const trace: Array<{ status: "allow" | "deny" | "info"; label: string; detail: string }> = [
    {
      status: "info",
      label: "Registered app",
      detail: `${app.name} declares ${requirements.length} permission requirement${requirements.length === 1 ? "" : "s"}.`,
    },
  ];
  if (role === "security_admin") {
    trace.push({ status: "allow", label: "Security admin override", detail: "security_admin satisfies all app requirements implicitly." });
  } else if (role === "admin") {
    trace.push({ status: "info", label: "Admin implicit access", detail: "admin satisfies non-RBAC requirements implicitly; RBAC permissions still require explicit grants." });
  }
  if (missing.length) {
    trace.push({ status: "deny", label: "Missing grants", detail: `${role} is missing ${missing.map((item) => `${item.resource}:${item.action}`).join(", ")}.` });
  } else {
    trace.push({ status: "allow", label: "Requirements satisfied", detail: `${role} satisfies every declared permission for ${app.name}.` });
  }

  return {
    result: {
      allowed: missing.length === 0,
      user,
      role,
      app: {
        id: app.id,
        name: app.name,
        description: app.description,
        permissions: app.permissions,
        chatCapabilities: Array.isArray(app.chatCapabilities) ? app.chatCapabilities.length : 0,
        chatTools: Array.isArray(app.chatTools) ? app.chatTools.length : 0,
        events: Array.isArray(app.events) ? app.events : [],
        adminPanels: Array.isArray(app.adminPanels) ? app.adminPanels.length : 0,
      },
      requirements,
      missing,
      grants,
      inheritedGroups: inherited.groups,
      inheritedGrants: inherited.grants,
      trace,
      remediation: missing.map((item) => ({
        role,
        resource: item.resource,
        action: item.action,
        risk: item.risk,
        reason: `Grant ${item.resource}:${item.action} to ${role} to satisfy ${app.name} access.`,
      })),
    },
  };
}

function toolNameParts(fullName: string) {
  const splitAt = fullName.indexOf("_");
  if (splitAt === -1) return null;
  return { appId: fullName.slice(0, splitAt), toolName: fullName.slice(splitAt + 1) };
}

type RegisteredAppTool = {
  appId: string;
  toolName: string;
  fullName: string;
  description: string;
  parameters: any;
  resource: string;
  action: string;
};

function registeredAppTools(): RegisteredAppTool[] {
  return getAllAppToolDefinitions()
    .map((tool: any) => {
      const parts = toolNameParts(tool.name);
      if (!parts) return null;
      const policy = resolveAppToolPolicy(parts.appId, parts.toolName);
      return {
        appId: parts.appId,
        toolName: parts.toolName,
        fullName: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        resource: policy.resource,
        action: policy.action,
      };
    })
    .filter((tool: RegisteredAppTool | null): tool is RegisteredAppTool => Boolean(tool))
    .sort((a: RegisteredAppTool, b: RegisteredAppTool) => `${a.appId}:${a.toolName}`.localeCompare(`${b.appId}:${b.toolName}`));
}

async function buildPolicyDrift(fastify: FastifyInstance) {
  const [permissionsResult, apps] = await Promise.all([
    fastify.pg.query("SELECT id, role, resource, action FROM app_permissions ORDER BY role, resource, action"),
    getAllRegisteredApps(fastify),
  ]);
  const grants = permissionsResult.rows;
  const roles = Array.from(new Set(grants.map((grant: any) => grant.role).filter(Boolean))).sort();
  const requiredTargets = new Map<string, any>();

  for (const app of apps) {
    for (const permission of app.permissions || []) {
      const parsed = permissionToResourceAction(permission);
      if (!parsed) continue;
      const key = `${parsed.resource}\u0000${parsed.action}`;
      const current = requiredTargets.get(key) || {
        resource: parsed.resource,
        action: parsed.action,
        label: app.name,
        risk: permissionRisk(parsed.resource, parsed.action),
        apps: [],
      };
      current.apps.push({ id: app.id, name: app.name });
      requiredTargets.set(key, current);
    }
  }

  for (const tool of registeredAppTools()) {
    const key = `${tool.resource}\u0000${tool.action}`;
    const current = requiredTargets.get(key) || {
      resource: tool.resource,
      action: tool.action,
      label: `${tool.appId} automation`,
      risk: permissionRisk(tool.resource, tool.action),
      apps: [],
    };
    if (!current.apps.some((app: any) => app.id === tool.appId)) {
      current.apps.push({ id: tool.appId, name: tool.appId });
    }
    requiredTargets.set(key, current);
  }

  const orphaned = grants
    .filter((grant: any) => !requiredTargets.has(`${grant.resource}\u0000${grant.action}`) && !grant.resource.startsWith("field:"))
    .map((grant: any) => ({
      id: grant.id,
      role: grant.role,
      resource: grant.resource,
      action: grant.action,
      risk: permissionRisk(grant.resource, grant.action),
      reason: "No registered native app or app tool currently declares this target.",
    }));

  const roleCoverage = roles.map((role) => {
    const missing = Array.from(requiredTargets.values())
      .filter((target) => !evaluateGrant(role, grants.filter((grant: any) => grant.role === role), target.resource, target.action).allowed)
      .map((target) => ({ role, resource: target.resource, action: target.action, risk: target.risk, apps: target.apps }));
    return {
      role,
      required: requiredTargets.size,
      granted: requiredTargets.size - missing.length,
      missing,
      score: requiredTargets.size ? Math.round(((requiredTargets.size - missing.length) / requiredTargets.size) * 100) : 100,
    };
  });

  const missingCritical = roleCoverage.flatMap((coverage) =>
    coverage.missing.filter((item: any) => item.risk === "critical" || item.risk === "high")
  );
  const duplicateCount = grants.length - new Set(grants.map((grant: any) => `${grant.role}:${grant.resource}:${grant.action}`)).size;

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      roles: roles.length,
      registeredTargets: requiredTargets.size,
      grants: grants.length,
      orphaned: orphaned.length,
      missingHighRisk: missingCritical.length,
      duplicates: duplicateCount,
      posture: orphaned.length || missingCritical.length ? "attention" : "healthy",
    },
    roleCoverage,
    orphaned,
    registeredTargets: Array.from(requiredTargets.values()).sort((a, b) => `${a.resource}:${a.action}`.localeCompare(`${b.resource}:${b.action}`)),
  };
}

async function explainToolAccess(
  fastify: FastifyInstance,
  body: { userId?: string; email?: string; role?: string; appId?: string; toolName?: string }
) {
  const appId = body.appId?.trim();
  const toolName = body.toolName?.trim();
  if (!appId || !toolName) return { error: "appId and toolName required" };

  const { user, role } = await resolveAccessSubject(fastify, body);
  if (!role) return { error: "user or role required" };

  const tool = registeredAppTools().find((candidate: RegisteredAppTool) => candidate.appId === appId && candidate.toolName === toolName);
  if (!tool) return { error: "tool not found" };

  const grantsResult = await fastify.pg.query(
    "SELECT id, role, resource, action FROM app_permissions WHERE role = $1 ORDER BY resource, action",
    [role]
  );
  const grants = grantsResult.rows;
  const inherited = await userGroupGrants(fastify.pg, user?.id);
  const evaluation = evaluateGrantWithGroups(role, grants, inherited.grants, tool.resource, tool.action);
  const target = permissionTarget(tool.resource, tool.action, {
    label: `${tool.appId} / ${tool.toolName}`,
    source: "App tool policy",
    category: "Automation",
  });

  const trace: Array<{ status: "allow" | "deny" | "info"; label: string; detail: string }> = [
    { status: "info", label: "Registered app tool", detail: `${tool.fullName} resolves to ${tool.resource}:${tool.action}.` },
    { status: "info", label: "Policy source", detail: tool.action === "write" ? "Tool name starts with a write/action verb and requires write access." : "Tool name is read-oriented and requires read access." },
  ];
  if (evaluation.allowed) {
    trace.push({ status: "allow", label: "Execution allowed", detail: `${role} can execute ${tool.fullName}.` });
  } else {
    trace.push({ status: "deny", label: "Missing grant", detail: `${role} needs ${tool.resource}:${tool.action} to execute ${tool.fullName}.` });
  }

  return {
    result: {
      allowed: evaluation.allowed,
      user,
      role,
      tool: {
        appId: tool.appId,
        toolName: tool.toolName,
        fullName: tool.fullName,
        description: tool.description,
        resource: tool.resource,
        action: tool.action,
        risk: target.risk,
      },
      requirement: {
        resource: tool.resource,
        action: tool.action,
        allowed: evaluation.allowed,
        reason: evaluation.reason,
        directGrant: evaluation.directGrant,
        inheritedGrant: evaluation.inheritedGrant,
        risk: target.risk,
        description: target.description,
      },
      missing: evaluation.allowed ? [] : [{ resource: tool.resource, action: tool.action, risk: target.risk }],
      inheritedGroups: inherited.groups,
      inheritedGrants: inherited.grants,
      trace,
      remediation: evaluation.allowed ? [] : [{
        role,
        resource: tool.resource,
        action: tool.action,
        risk: target.risk,
        reason: `Grant ${tool.resource}:${tool.action} to ${role} to allow ${tool.fullName}.`,
      }],
    },
  };
}

async function explainTableAccess(
  fastify: FastifyInstance,
  body: { userId?: string; email?: string; role?: string; tableId?: string; fieldName?: string; accessMode?: string }
) {
  const tableId = body.tableId?.trim();
  const fieldName = body.fieldName?.trim();
  const accessMode = body.accessMode === "write" ? "write" : "read";
  if (!tableId) return { error: "tableId required" };

  const { user, role } = await resolveAccessSubject(fastify, body);
  if (!role) return { error: "user or role required" };

  const tables = await getTables(fastify);
  const table = tables.find((candidate) => candidate.id === tableId || candidate.name === tableId);
  if (!table) return { error: "table not found" };

  const fieldOptions = tableFieldsForExplanation(table);
  const selectedFields = fieldName ? fieldOptions.filter((field) => field.name === fieldName) : fieldOptions;
  if (fieldName && selectedFields.length === 0) return { error: "field not found" };

  const grantsResult = await fastify.pg.query(
    "SELECT id, role, resource, action FROM app_permissions WHERE role = $1 ORDER BY resource, action",
    [role]
  );
  const grants = grantsResult.rows;
  const inherited = await userGroupGrants(fastify.pg, user?.id);
  const tableRead = evaluateGrantWithGroups(role, grants, inherited.grants, "tables", "read");
  const tableWrite = evaluateGrantWithGroups(role, grants, inherited.grants, "tables", "write");
  const fieldAccessMap = await resolveFieldAccess({
    pg: fastify.pg,
    role,
    userId: user?.id,
    tableId: table.id,
    fieldNames: fieldOptions.map((field) => field.name),
    writableFieldNames: fieldOptions.filter((field) => field.writable).map((field) => field.name),
  });

  const fields = selectedFields.map((field) => {
    const access = fieldAccessMap.get(field.name);
    const read = Boolean(access?.read);
    const write = field.writable && Boolean(access?.write);
    const restricted = Boolean(access?.restricted);
    const resource = access?.resource || `field:${table.id}.${field.name}`;
    return {
      field: field.name,
      label: field.label,
      resource,
      writable: field.writable,
      restricted,
      read,
      write,
      readReason: restricted ? (read ? "field_grant_or_override" : "missing_field_read") : "unrestricted_field",
      writeReason: !field.writable ? "not_writable" : restricted ? (write ? "field_grant_or_override" : "missing_field_write") : "unrestricted_field",
      readRisk: permissionRisk(resource, "read"),
      writeRisk: permissionRisk(resource, "write"),
    };
  });

  const missing: Array<{ resource: string; action: string; risk: string; field?: string }> = [];
  if (!tableRead.allowed) missing.push({ resource: "tables", action: "read", risk: permissionRisk("tables", "read") });
  if (accessMode === "write" && !tableWrite.allowed) missing.push({ resource: "tables", action: "write", risk: permissionRisk("tables", "write") });
  for (const field of fields) {
    if (field.restricted && !field.read) missing.push({ resource: field.resource, action: "read", risk: field.readRisk, field: field.field });
    if (accessMode === "write" && field.writable && field.restricted && !field.write) {
      missing.push({ resource: field.resource, action: "write", risk: field.writeRisk, field: field.field });
    }
  }

  const allowed = accessMode === "write"
    ? tableRead.allowed && tableWrite.allowed && fields.every((field) => field.read && (!field.writable || field.write))
    : tableRead.allowed && fields.every((field) => field.read);
  const trace: Array<{ status: "allow" | "deny" | "info"; label: string; detail: string }> = [
    { status: "info", label: "Registered table", detail: `${table.label} resolves to ${table.id} with ${fieldOptions.length} explainable field${fieldOptions.length === 1 ? "" : "s"}.` },
    { status: tableRead.allowed ? "allow" : "deny", label: "Table read", detail: `${role} ${tableRead.allowed ? "has" : "is missing"} tables:read (${tableRead.reason.replaceAll("_", " ")}).` },
  ];
  if (accessMode === "write") {
    trace.push({ status: tableWrite.allowed ? "allow" : "deny", label: "Table write", detail: `${role} ${tableWrite.allowed ? "has" : "is missing"} tables:write (${tableWrite.reason.replaceAll("_", " ")}).` });
  }
  const restrictedCount = fields.filter((field) => field.restricted).length;
  trace.push({
    status: restrictedCount ? "info" : "allow",
    label: "Field policy",
    detail: restrictedCount
      ? `${restrictedCount} selected field${restrictedCount === 1 ? "" : "s"} require explicit field grants.`
      : "No selected fields are restricted by field policy or sensitive-name detection.",
  });
  trace.push({
    status: allowed ? "allow" : "deny",
    label: allowed ? "Access allowed" : "Access blocked",
    detail: allowed
      ? `${role} can ${accessMode} the selected ${table.label} surface.`
      : `${role} needs ${missing.map((item) => `${item.resource}:${item.action}`).join(", ")}.`,
  });

  return {
    result: {
      allowed,
      user,
      role,
      accessMode,
      table: {
        id: table.id,
        name: table.name,
        label: table.label,
        provider: table.provider,
        category: table.category,
        fieldCount: fieldOptions.length,
      },
      tableAccess: {
        read: { allowed: tableRead.allowed, reason: tableRead.reason, risk: permissionRisk("tables", "read") },
        write: { allowed: tableWrite.allowed, reason: tableWrite.reason, risk: permissionRisk("tables", "write") },
      },
      fields,
      missing,
      grants,
      inheritedGroups: inherited.groups,
      inheritedGrants: inherited.grants,
      trace,
      remediation: missing.map((item) => ({
        role,
        resource: item.resource,
        action: item.action,
        risk: item.risk,
        reason: `Grant ${item.resource}:${item.action} to ${role} to allow ${accessMode} access${item.field ? ` for ${item.field}` : ""}.`,
      })),
    },
  };
}

export async function getStateMachineConfig(pg: any): Promise<any> {
  const result = await pg.query("SELECT value FROM system_properties WHERE key = 'change_manager.state_machine'");
  if (!result.rows.length) return null;
  try {
    return JSON.parse(result.rows[0].value);
  } catch {
    return null;
  }
}

export async function adminRoutes(fastify: FastifyInstance) {
  // Admin Panels Registry
  fastify.get("/api/admin/panels", { onRequest: [fastify.authenticate] }, async (_request, reply) => {
    try {
      const user = (_request as any).user as { id?: string; role?: string } | null;
      const { hasPermission, resolveUserRole } = await import("../services/rbac");
      const role = await resolveUserRole(fastify.pg, user);

      // Filter core panels by permission
      const visibleCore = [];
      for (const panel of CORE_ADMIN_PANELS) {
        const firstPerm = panel.permissions?.[0];
        const allowed = role && firstPerm
          ? await hasPermission(fastify.pg, { role, resource: firstPerm.split(":")[0], action: "read" })
          : false;
        if (allowed) visibleCore.push(panel);
      }

      // Get app-published panels from marketplace table
      let dbPanels: any[] = [];
      try {
        const appPanelsResult = await fastify.pg.query(
          `SELECT id, admin_panels FROM marketplace_apps WHERE admin_panels IS NOT NULL`
        );
        dbPanels = appPanelsResult.rows.flatMap((app: any) => {
          try {
            const panels = JSON.parse(app.admin_panels || "[]");
            return panels.map((p: any) => ({ ...p, appId: app.id }));
          } catch {
            return [];
          }
        });
      } catch (err: any) {
        // Column may not exist yet; ignore
        if (err.message?.includes("admin_panels")) {
          fastify.log.warn("admin_panels column not found in marketplace_apps");
        } else {
          throw err;
        }
      }

      // Merge built-in app panels
      const allAppPanels = [...BUILT_IN_APP_PANELS, ...dbPanels];

      // Filter app panels by permission
      const visibleAppPanels = [];
      for (const panel of allAppPanels) {
        const firstPerm = panel.permissions?.[0];
        const allowed = role && firstPerm
          ? await hasPermission(fastify.pg, { role, resource: firstPerm.split(":")[0], action: "read" })
          : false;
        if (allowed) visibleAppPanels.push(panel);
      }

      return { panels: [...visibleCore, ...visibleAppPanels] };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to fetch admin panels" });
    }
  });

  fastify.get("/api/admin/rbac/options", { onRequest: [fastify.authenticate, requirePermission("rbac", "read")] }, async (_request, reply) => {
    try {
      const [usersResult, permissionsResult, groupsResult, apps] = await Promise.all([
        fastify.pg.query("SELECT id, name, email, role FROM users ORDER BY name, email"),
        fastify.pg.query("SELECT id, role, resource, action FROM app_permissions ORDER BY role, resource, action"),
        fastify.pg.query("SELECT id, name, slug, source, cmdb_ci_id FROM identity_groups ORDER BY name"),
        getAllRegisteredApps(fastify),
      ]);
      const tables = await getTables(fastify).catch(() => []);
      const roles = Array.from(new Set([
        ...usersResult.rows.map((user: any) => user.role).filter(Boolean),
        ...permissionsResult.rows.map((permission: any) => permission.role).filter(Boolean),
      ])).sort();
      const permissionEntries: Array<[string, any]> = [
        ...CORE_PERMISSION_TARGETS.map((target): [string, any] => [`${target.resource}:${target.action}`, target]),
        ...permissionsResult.rows.map((permission: any): [string, any] => [
          `${permission.resource}:${permission.action}`,
          permissionTarget(permission.resource, permission.action, { source: "Existing Grant" }),
        ]),
        ...apps.flatMap((app) => app.permissions.map((permission) => {
          const parsed = permissionToResourceAction(permission);
          return parsed ? [`${parsed.resource}:${parsed.action}`, permissionTarget(parsed.resource, parsed.action, {
            label: app.name,
            source: `Native app: ${app.name}`,
            category: "Application",
          })] as [string, any] : null;
        }).filter((entry): entry is [string, any] => Boolean(entry))),
        ...tables.flatMap((table) => fieldTargetsForTable(table.id, [
          { name: "name", label: "Name" },
          ...(table.hasNumber ? [{ name: "number", label: "Number" }] : []),
          ...(table.provider === "cmdb-class" ? [{ name: "environment", label: "Environment" }] : []),
          ...table.attributes.map((attr) => ({ name: attr.name, label: attr.displayName || attr.name })),
        ]).map((target): [string, any] => [`${target.resource}:${target.action}`, permissionTarget(target.resource, target.action, {
          label: `${table.label} / ${target.label}`,
          source: `Table field: ${table.label}`,
          category: "Field",
          risk: target.risk,
        })])),
      ];
      const permissionTargets = Array.from(new Map(permissionEntries).values())
        .sort((a: any, b: any) => `${a.resource}:${a.action}`.localeCompare(`${b.resource}:${b.action}`));
      return {
        users: usersResult.rows,
        groups: groupsResult.rows,
        roles,
        permissions: permissionsResult.rows,
        targets: permissionTargets,
        apps: apps.map((app) => ({ id: app.id, name: app.name, permissions: app.permissions })),
        tools: registeredAppTools(),
        tables: tables.map((table) => ({
          id: table.id,
          name: table.name,
          label: table.label,
          provider: table.provider,
          category: table.category,
          hasNumber: Boolean(table.hasNumber),
          fields: tableFieldsForExplanation(table),
        })),
      };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to fetch RBAC options" });
    }
  });

  fastify.post("/api/admin/rbac/analyze", { onRequest: [fastify.authenticate, requirePermission("rbac", "read")] }, async (request, reply) => {
    try {
      const result = await analyzeAccess(fastify, request.body as any);
      if ("error" in result) return reply.status(400).send(result);
      return result;
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to analyze access" });
    }
  });

  fastify.post("/api/admin/rbac/explain-access", { onRequest: [fastify.authenticate, requirePermission("rbac", "read")] }, async (request, reply) => {
    try {
      const result = await explainAppAccess(fastify, request.body as any);
      if ("error" in result) return reply.status(400).send(result);
      return result;
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to explain app access" });
    }
  });

  fastify.post("/api/admin/rbac/explain-tool-access", { onRequest: [fastify.authenticate, requirePermission("rbac", "read")] }, async (request, reply) => {
    try {
      const result = await explainToolAccess(fastify, request.body as any);
      if ("error" in result) return reply.status(400).send(result);
      return result;
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to explain app tool access" });
    }
  });

  fastify.post("/api/admin/rbac/explain-table-access", { onRequest: [fastify.authenticate, requirePermission("rbac", "read")] }, async (request, reply) => {
    try {
      const result = await explainTableAccess(fastify, request.body as any);
      if ("error" in result) return reply.status(400).send(result);
      return result;
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to explain table access" });
    }
  });

  fastify.get("/api/admin/rbac/field-restrictions", { onRequest: [fastify.authenticate, requirePermission("rbac", "read")] }, async (_request, reply) => {
    try {
      const [restrictions, tables] = await Promise.all([
        loadFieldRestrictions(fastify.pg),
        getTables(fastify).catch(() => []),
      ]);
      const restricted = new Set(restrictions.map((item) => item.resource));
      return {
        restrictions,
        tables: tables.map((table) => ({
          id: table.id,
          name: table.name,
          label: table.label,
          provider: table.provider,
          category: table.category,
          fields: tableFieldsForExplanation(table).map((field) => ({
            ...field,
            resource: `field:${table.id}.${field.name}`,
            restricted: restricted.has(`field:${table.id}.${field.name}`),
          })),
        })),
      };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to fetch field restrictions" });
    }
  });

  fastify.put("/api/admin/rbac/field-restrictions", { onRequest: [fastify.authenticate, requirePermission("rbac", "write")] }, async (request, reply) => {
    const body = request.body as { tableId?: string; field?: string; restricted?: boolean };
    if (!body.tableId || !body.field || typeof body.restricted !== "boolean") {
      return reply.status(400).send({ error: "tableId, field, and restricted required" });
    }
    try {
      const tables = await getTables(fastify);
      const table = tables.find((candidate) => candidate.id === body.tableId || candidate.name === body.tableId);
      if (!table) return reply.status(404).send({ error: "Table not found" });
      const field = tableFieldsForExplanation(table).find((candidate) => candidate.name === body.field);
      if (!field) return reply.status(404).send({ error: "Field not found" });

      const next = normalizeFieldRestriction(table.id, field.name);
      const current = await loadFieldRestrictions(fastify.pg);
      const withoutCurrent = current.filter((item) => item.resource !== next.resource);
      const saved = await saveFieldRestrictions(fastify.pg, body.restricted ? [...withoutCurrent, next] : withoutCurrent);
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: body.restricted ? "rbac.field_restriction.created" : "rbac.field_restriction.deleted",
        entityType: "FieldRestriction",
        entityId: next.resource,
        newValues: body.restricted ? next : undefined,
        oldValues: body.restricted ? undefined : next,
        metadata: { source: "api.admin", surface: "admin-console", tableId: table.id, field: field.name },
      });
      return { restriction: body.restricted ? next : null, restrictions: saved };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to update field restriction" });
    }
  });

  fastify.get("/api/admin/rbac/policy-drift", { onRequest: [fastify.authenticate, requirePermission("rbac", "read")] }, async (_request, reply) => {
    try {
      return await buildPolicyDrift(fastify);
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to build policy drift report" });
    }
  });

  fastify.post("/api/admin/rbac/bulk-permissions", { onRequest: [fastify.authenticate, requirePermission("rbac", "write")] }, async (request, reply) => {
    const body = request.body as { role?: string; grants?: Array<{ resource?: string; action?: string }> };
    const role = body.role?.trim();
    const grants = Array.isArray(body.grants) ? body.grants : [];
    if (!role || !grants.length) {
      return reply.status(400).send({ error: "role and grants required" });
    }
    const normalized = Array.from(new Map(grants
      .map((grant) => ({ resource: grant.resource?.trim(), action: grant.action?.trim() }))
      .filter((grant): grant is { resource: string; action: string } => Boolean(grant.resource && grant.action))
      .map((grant) => [`${grant.resource}\u0000${grant.action}`, grant])).values());
    if (!normalized.length || normalized.length > 100) {
      return reply.status(400).send({ error: "bulk grants must include 1-100 valid resource/action pairs" });
    }
    try {
      const created: any[] = [];
      const skipped: any[] = [];
      for (const grant of normalized) {
        const result = await fastify.pg.query(
          `INSERT INTO app_permissions (role, resource, action)
           VALUES ($1, $2, $3)
           ON CONFLICT (role, resource, action) DO NOTHING
           RETURNING id, role, resource, action`,
          [role, grant.resource, grant.action]
        );
        if (result.rows[0]) {
          created.push(result.rows[0]);
        } else {
          skipped.push({ role, resource: grant.resource, action: grant.action, reason: "already_granted" });
        }
      }
      if (created.length) clearPermissionCache();
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "rbac.permission.bulk_created",
        entityType: "AppPermission",
        entityId: role,
        newValues: { created },
        metadata: { source: "api.admin", surface: "admin-console", requested: normalized.length, skipped },
      });
      return { role, created, skipped, requested: normalized.length };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to bulk grant permissions" });
    }
  });

  fastify.get("/api/admin/operational-intelligence", { onRequest: [fastify.authenticate, requirePermission("system-properties", "read")] }, async (_request, reply) => {
    try {
      return await buildOperationalIntelligence(fastify);
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to build operational intelligence" });
    }
  });

  fastify.get("/api/admin/identity/sso-configs", { onRequest: [fastify.authenticate, requirePermission("identity", "read")] }, async (_request, reply) => {
    try {
      const result = await fastify.pg.query(
        `SELECT id, name, provider, status, email_domains, idp_entity_id, idp_sso_url, idp_cert, sp_entity_id,
                metadata_url, metadata_xml, jit_enabled, client_id, client_secret_ref, issuer_url, authorization_url,
                token_url, userinfo_url, scopes, enforce_sso, default_role, attribute_mapping, created_at, updated_at
         FROM sso_configs
         ORDER BY status DESC, name`
      );
      return {
        configs: result.rows.map(ssoConfigRow),
        providers: [
          { id: "saml", name: "SAML 2.0" },
          { id: "oidc", name: "OpenID Connect" },
        ],
      };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to fetch identity providers" });
    }
  });

  fastify.post("/api/admin/identity/sso-configs", { onRequest: [fastify.authenticate, requirePermission("identity", "write")] }, async (request, reply) => {
    const config = normalizeSsoConfigBody(request.body);
    if ("error" in config) return reply.status(400).send({ error: config.error });
    try {
      const result = await fastify.pg.query(
        `INSERT INTO sso_configs (
           name, provider, status, email_domains, idp_entity_id, idp_sso_url, idp_cert, sp_entity_id,
           metadata_url, metadata_xml, jit_enabled, client_id, client_secret_ref, issuer_url, authorization_url,
           token_url, userinfo_url, scopes, enforce_sso, default_role, attribute_mapping
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
         RETURNING id, name, provider, status, email_domains, idp_entity_id, idp_sso_url, idp_cert, sp_entity_id,
                   metadata_url, metadata_xml, jit_enabled, client_id, client_secret_ref, issuer_url, authorization_url,
                   token_url, userinfo_url, scopes, enforce_sso, default_role, attribute_mapping, created_at, updated_at`,
        [
          config.name,
          config.provider,
          config.status || "inactive",
          JSON.stringify(config.emailDomains),
          config.idpEntityId || null,
          config.idpSsoUrl || null,
          config.idpCert || null,
          config.spEntityId || null,
          config.metadataUrl || null,
          config.metadataXml || null,
          config.jitEnabled !== false,
          config.clientId || null,
          config.clientSecretRef || null,
          config.issuerUrl || null,
          config.authorizationUrl || null,
          config.tokenUrl || null,
          config.userinfoUrl || null,
          JSON.stringify(config.scopes || ["openid", "email", "profile"]),
          config.enforceSso === true,
          config.defaultRole || "user",
          JSON.stringify(config.attributeMapping || { email: "email", name: "name", groups: "groups" }),
        ]
      );
      const row = ssoConfigRow(result.rows[0]);
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "identity.sso_config.created",
        entityType: "SsoConfig",
        entityId: row.id,
        newValues: row,
        metadata: { source: "api.admin", surface: "admin-console", provider: row.provider },
      });
      return { config: row };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to create identity provider" });
    }
  });

  fastify.patch("/api/admin/identity/sso-configs/:id", { onRequest: [fastify.authenticate, requirePermission("identity", "write")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const config = normalizeSsoConfigBody(request.body, true);
    if ("error" in config) return reply.status(400).send({ error: config.error });
    try {
      const existing = await fastify.pg.query(
        `SELECT id, name, provider, status, email_domains, idp_entity_id, idp_sso_url, idp_cert, sp_entity_id,
                metadata_url, metadata_xml, jit_enabled, client_id, client_secret_ref, issuer_url, authorization_url,
                token_url, userinfo_url, scopes, enforce_sso, default_role, attribute_mapping, created_at, updated_at
         FROM sso_configs WHERE id = $1`,
        [id]
      );
      const result = await fastify.pg.query(
        `UPDATE sso_configs SET
           name = COALESCE($2, name),
           provider = COALESCE($3, provider),
           status = COALESCE($4, status),
           email_domains = COALESCE($5, email_domains),
           idp_entity_id = COALESCE($6, idp_entity_id),
           idp_sso_url = COALESCE($7, idp_sso_url),
           idp_cert = COALESCE($8, idp_cert),
           sp_entity_id = COALESCE($9, sp_entity_id),
           metadata_url = COALESCE($10, metadata_url),
           metadata_xml = COALESCE($11, metadata_xml),
           jit_enabled = COALESCE($12, jit_enabled),
           client_id = COALESCE($13, client_id),
           client_secret_ref = COALESCE($14, client_secret_ref),
           issuer_url = COALESCE($15, issuer_url),
           authorization_url = COALESCE($16, authorization_url),
           token_url = COALESCE($17, token_url),
           userinfo_url = COALESCE($18, userinfo_url),
           scopes = COALESCE($19, scopes),
           enforce_sso = COALESCE($20, enforce_sso),
           default_role = COALESCE($21, default_role),
           attribute_mapping = COALESCE($22, attribute_mapping),
           updated_at = NOW()
         WHERE id = $1
         RETURNING id, name, provider, status, email_domains, idp_entity_id, idp_sso_url, idp_cert, sp_entity_id,
                   metadata_url, metadata_xml, jit_enabled, client_id, client_secret_ref, issuer_url, authorization_url,
                   token_url, userinfo_url, scopes, enforce_sso, default_role, attribute_mapping, created_at, updated_at`,
        [
          id,
          config.name || null,
          config.provider || null,
          config.status || null,
          config.emailDomains ? JSON.stringify(config.emailDomains) : null,
          config.idpEntityId || null,
          config.idpSsoUrl || null,
          config.idpCert || null,
          config.spEntityId || null,
          config.metadataUrl || null,
          config.metadataXml || null,
          config.jitEnabled ?? null,
          config.clientId || null,
          config.clientSecretRef || null,
          config.issuerUrl || null,
          config.authorizationUrl || null,
          config.tokenUrl || null,
          config.userinfoUrl || null,
          config.scopes ? JSON.stringify(config.scopes) : null,
          config.enforceSso ?? null,
          config.defaultRole || null,
          config.attributeMapping ? JSON.stringify(config.attributeMapping) : null,
        ]
      );
      if (!result.rows.length) return reply.status(404).send({ error: "Identity provider not found" });
      const row = ssoConfigRow(result.rows[0]);
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "identity.sso_config.updated",
        entityType: "SsoConfig",
        entityId: row.id,
        oldValues: existing.rows[0] ? ssoConfigRow(existing.rows[0]) : undefined,
        newValues: row,
        metadata: { source: "api.admin", surface: "admin-console", provider: row.provider },
      });
      return { config: row };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to update identity provider" });
    }
  });

  fastify.delete("/api/admin/identity/sso-configs/:id", { onRequest: [fastify.authenticate, requirePermission("identity", "write")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const existing = await fastify.pg.query(
        "SELECT id, name, provider, status, email_domains FROM sso_configs WHERE id = $1",
        [id]
      );
      const result = await fastify.pg.query("DELETE FROM sso_configs WHERE id = $1 RETURNING id", [id]);
      if (!result.rows.length) return reply.status(404).send({ error: "Identity provider not found" });
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "identity.sso_config.deleted",
        entityType: "SsoConfig",
        entityId: id,
        oldValues: existing.rows[0] || { id },
        metadata: { source: "api.admin", surface: "admin-console" },
      });
      return { success: true };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to delete identity provider" });
    }
  });

  fastify.get("/api/admin/identity/groups", { onRequest: [fastify.authenticate, requirePermission("identity-groups", "read")] }, async (_request, reply) => {
    try {
      const [groups, memberships, permissions] = await Promise.all([
        fastify.pg.query(
          `SELECT id, name, slug, description, source, external_id, cmdb_ci_id, created_at, updated_at
           FROM identity_groups ORDER BY name`
        ),
        fastify.pg.query(
          `SELECT gm.id, gm.group_id, gm.user_id, gm.source, u.name AS user_name, u.email AS user_email
           FROM identity_group_memberships gm
           JOIN users u ON u.id = gm.user_id
           ORDER BY u.name, u.email`
        ),
        fastify.pg.query(
          `SELECT gp.id, gp.group_id, gp.resource, gp.action
           FROM identity_group_permissions gp
           ORDER BY gp.resource, gp.action`
        ),
      ]);
      return { groups: groups.rows, memberships: memberships.rows, permissions: permissions.rows };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to fetch identity groups" });
    }
  });

  fastify.post("/api/admin/identity/groups", { onRequest: [fastify.authenticate, requirePermission("identity-groups", "write")] }, async (request, reply) => {
    const body = request.body as { name?: string; slug?: string; description?: string; cmdbCiId?: string; source?: string; externalId?: string };
    const name = body.name?.trim();
    const slug = (body.slug || name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!name || !slug) return reply.status(400).send({ error: "name required" });
    try {
      const result = await fastify.pg.query(
        `INSERT INTO identity_groups (name, slug, description, source, external_id, cmdb_ci_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, slug, description, source, external_id, cmdb_ci_id, created_at, updated_at`,
        [name, slug, body.description || null, body.source || "local", body.externalId || null, body.cmdbCiId || null]
      );
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "identity_group.created",
        entityType: "IdentityGroup",
        entityId: result.rows[0].id,
        newValues: result.rows[0],
        metadata: { source: "api.admin", surface: "admin-console" },
      });
      return { group: result.rows[0] };
    } catch (err: any) {
      if (err.code === "23505") return reply.status(409).send({ error: "Identity group already exists" });
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to create identity group" });
    }
  });

  fastify.patch("/api/admin/identity/groups/:id", { onRequest: [fastify.authenticate, requirePermission("identity-groups", "write")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { name?: string; description?: string; cmdbCiId?: string | null };
    try {
      const existing = await fastify.pg.query("SELECT id, name, slug, description, source, external_id, cmdb_ci_id FROM identity_groups WHERE id = $1", [id]);
      const result = await fastify.pg.query(
        `UPDATE identity_groups
         SET name = COALESCE($2, name),
             description = COALESCE($3, description),
             cmdb_ci_id = $4,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, name, slug, description, source, external_id, cmdb_ci_id, created_at, updated_at`,
        [id, body.name || null, body.description || null, body.cmdbCiId ?? existing.rows[0]?.cmdb_ci_id ?? null]
      );
      if (!result.rows.length) return reply.status(404).send({ error: "Identity group not found" });
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "identity_group.updated",
        entityType: "IdentityGroup",
        entityId: id,
        oldValues: existing.rows[0] || undefined,
        newValues: result.rows[0],
        metadata: { source: "api.admin", surface: "admin-console" },
      });
      clearPermissionCache();
      return { group: result.rows[0] };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to update identity group" });
    }
  });

  fastify.post("/api/admin/identity/groups/:id/members", { onRequest: [fastify.authenticate, requirePermission("identity-groups", "write")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { userId?: string; source?: string };
    if (!body.userId) return reply.status(400).send({ error: "userId required" });
    try {
      const result = await fastify.pg.query(
        `INSERT INTO identity_group_memberships (group_id, user_id, source)
         VALUES ($1, $2, $3)
         ON CONFLICT (group_id, user_id) DO UPDATE SET source = EXCLUDED.source
         RETURNING id, group_id, user_id, source, created_at`,
        [id, body.userId, body.source || "local"]
      );
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "identity_group.member_added",
        entityType: "IdentityGroup",
        entityId: id,
        newValues: result.rows[0],
        metadata: { source: "api.admin", surface: "admin-console" },
      });
      clearPermissionCache();
      return { membership: result.rows[0] };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to add group member" });
    }
  });

  fastify.delete("/api/admin/identity/groups/:groupId/members/:userId", { onRequest: [fastify.authenticate, requirePermission("identity-groups", "write")] }, async (request) => {
    const { groupId, userId } = request.params as { groupId: string; userId: string };
    await fastify.pg.query("DELETE FROM identity_group_memberships WHERE group_id = $1 AND user_id = $2", [groupId, userId]);
    await recordAuditEvent(fastify, {
      actorId: (request.user as any)?.id,
      action: "identity_group.member_removed",
      entityType: "IdentityGroup",
      entityId: groupId,
      oldValues: { groupId, userId },
      metadata: { source: "api.admin", surface: "admin-console" },
    });
    clearPermissionCache();
    return { success: true };
  });

  fastify.post("/api/admin/identity/groups/:id/permissions", { onRequest: [fastify.authenticate, requirePermission("identity-groups", "write")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { resource?: string; action?: string };
    if (!body.resource || !body.action) return reply.status(400).send({ error: "resource and action required" });
    try {
      const result = await fastify.pg.query(
        `INSERT INTO identity_group_permissions (group_id, resource, action)
         VALUES ($1, $2, $3)
         ON CONFLICT (group_id, resource, action) DO NOTHING
         RETURNING id, group_id, resource, action`,
        [id, body.resource, body.action]
      );
      const grant = result.rows[0] || { group_id: id, resource: body.resource, action: body.action };
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "identity_group.permission_granted",
        entityType: "IdentityGroup",
        entityId: id,
        newValues: grant,
        metadata: { source: "api.admin", surface: "admin-console" },
      });
      clearPermissionCache();
      return { permission: grant };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to grant group permission" });
    }
  });

  fastify.delete("/api/admin/identity/groups/:groupId/permissions/:permissionId", { onRequest: [fastify.authenticate, requirePermission("identity-groups", "write")] }, async (request) => {
    const { groupId, permissionId } = request.params as { groupId: string; permissionId: string };
    const existing = await fastify.pg.query("SELECT id, group_id, resource, action FROM identity_group_permissions WHERE id = $1 AND group_id = $2", [permissionId, groupId]);
    await fastify.pg.query("DELETE FROM identity_group_permissions WHERE id = $1 AND group_id = $2", [permissionId, groupId]);
    await recordAuditEvent(fastify, {
      actorId: (request.user as any)?.id,
      action: "identity_group.permission_revoked",
      entityType: "IdentityGroup",
      entityId: groupId,
      oldValues: existing.rows[0] || { permissionId, groupId },
      metadata: { source: "api.admin", surface: "admin-console" },
    });
    clearPermissionCache();
    return { success: true };
  });

  fastify.get("/api/admin/number-sequences", { onRequest: [fastify.authenticate, requirePermission("number-sequences", "read")] }, async (_request, reply) => {
    try {
      const result = await fastify.pg.query(
        `SELECT id, app_id, table_name, record_type, prefix, next_value, padding, enabled, created_at, updated_at
         FROM number_sequences
         ORDER BY table_name`
      );
      return { sequences: result.rows };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to fetch number sequences" });
    }
  });

  fastify.get("/api/admin/number-sequences/options", { onRequest: [fastify.authenticate, requirePermission("number-sequences", "read")] }, async (_request) => {
    return { options: NUMBER_SEQUENCE_OPTIONS };
  });

  fastify.post("/api/admin/number-sequences", { onRequest: [fastify.authenticate, requirePermission("number-sequences", "write")] }, async (request, reply) => {
    const body = request.body as { appId?: string; tableName?: string; recordType?: string; prefix?: string; nextValue?: number; padding?: number; enabled?: boolean };
    const option = findNumberSequenceOption(body);
    if (!option) {
      return reply.status(400).send({ error: "Number sequences can only be created for registered app/table/record type combinations" });
    }
    const config = normalizeSequenceConfig({ prefix: body.prefix || option.defaultPrefix, nextValue: body.nextValue, padding: body.padding });
    if ("error" in config) {
      return reply.status(400).send({ error: config.error });
    }
    try {
      const result = await fastify.pg.query(
        `INSERT INTO number_sequences (app_id, table_name, record_type, prefix, next_value, padding, enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, app_id, table_name, record_type, prefix, next_value, padding, enabled, created_at, updated_at`,
        [option.appId, option.tableName, option.recordType, config.prefix, config.nextValue, config.padding, body.enabled !== false]
      );
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "number_sequence.created",
        entityType: "NumberSequence",
        entityId: result.rows[0].id,
        newValues: result.rows[0],
        metadata: { source: "api.admin", surface: "admin-console" },
      });
      return { sequence: result.rows[0] };
    } catch (err: any) {
      if (err.code === "23505") return reply.status(409).send({ error: "Sequence table or prefix already exists" });
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to create number sequence" });
    }
  });

  fastify.patch("/api/admin/number-sequences/:id", { onRequest: [fastify.authenticate, requirePermission("number-sequences", "write")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { appId?: string; recordType?: string; prefix?: string; nextValue?: number; padding?: number; enabled?: boolean };
    if (body.appId !== undefined || body.recordType !== undefined) {
      return reply.status(400).send({ error: "Sequence app, table, and record type are registry-owned and cannot be edited" });
    }
    const config = normalizeSequenceConfig({
      prefix: body.prefix || "ZZ",
      nextValue: body.nextValue,
      padding: body.padding,
    });
    if (body.prefix !== undefined && "error" in config) {
      return reply.status(400).send({ error: config.error });
    }
    if (body.nextValue !== undefined && (!Number.isInteger(Number(body.nextValue)) || Number(body.nextValue) < 1)) {
      return reply.status(400).send({ error: "nextValue must be a positive integer" });
    }
    if (body.padding !== undefined && (!Number.isInteger(Number(body.padding)) || Number(body.padding) < 0 || Number(body.padding) > 12)) {
      return reply.status(400).send({ error: "padding must be an integer from 0 to 12" });
    }
    try {
      const result = await fastify.pg.query(
        `UPDATE number_sequences
         SET app_id = COALESCE($2, app_id),
             record_type = COALESCE($3, record_type),
             prefix = COALESCE($4, prefix),
             next_value = COALESCE($5, next_value),
             padding = COALESCE($6, padding),
             enabled = COALESCE($7, enabled),
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, app_id, table_name, record_type, prefix, next_value, padding, enabled, created_at, updated_at`,
        [id, body.appId ?? null, body.recordType ?? null, body.prefix?.toUpperCase() ?? null, body.nextValue ?? null, body.padding ?? null, body.enabled ?? null]
      );
      if (!result.rows.length) return reply.status(404).send({ error: "Sequence not found" });
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "number_sequence.updated",
        entityType: "NumberSequence",
        entityId: id,
        newValues: result.rows[0],
        metadata: { source: "api.admin", surface: "admin-console" },
      });
      return { sequence: result.rows[0] };
    } catch (err: any) {
      if (err.code === "23505") return reply.status(409).send({ error: "Prefix already exists" });
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to update number sequence" });
    }
  });

  // State Machine Config
  fastify.get("/api/admin/state-machine/:appId", { onRequest: [fastify.authenticate, requirePermission("system-properties", "read")] }, async (request, reply) => {
    const { appId } = request.params as { appId: string };
    try {
      const config = await getStateMachineConfig(fastify.pg);
      if (!config) return reply.status(404).send({ error: "State machine config not found" });
      return { appId, config };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to fetch state machine config" });
    }
  });

  fastify.put("/api/admin/state-machine/:appId", { onRequest: [fastify.authenticate, requirePermission("system-properties", "write")] }, async (request, reply) => {
    const { appId } = request.params as { appId: string };
    const body = request.body as { config?: any };
    if (!body.config) return reply.status(400).send({ error: "config required" });
    try {
      const value = JSON.stringify(body.config);
      await fastify.pg.query(
        `INSERT INTO system_properties (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [`${appId}.state_machine`, value]
      );
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "system_property.updated",
        entityType: "SystemProperty",
        entityId: `${appId}.state_machine`,
        newValues: { key: `${appId}.state_machine`, value },
        metadata: { source: "api.admin", surface: "admin-console", appId },
      });
      return { success: true, appId, config: body.config };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to update state machine config" });
    }
  });

  // RBAC Permissions
  fastify.get("/api/admin/permissions", { onRequest: [fastify.authenticate, requirePermission("rbac", "read")] }, async (_request, reply) => {
    try {
      const result = await fastify.pg.query(
        "SELECT id, role, resource, action FROM app_permissions ORDER BY role, resource, action"
      );
      return { permissions: result.rows };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to fetch permissions" });
    }
  });

  fastify.get("/api/admin/audit-log", { onRequest: [fastify.authenticate, requirePermission("audit-log", "read")] }, async (request, reply) => {
    const query = request.query as { q?: string; action?: string; entityType?: string; actorId?: string; format?: string; limit?: string; offset?: string };
    const limit = parsePositiveInt(query.limit, query.format === "csv" ? 500 : 50, 1000);
    const offset = parsePositiveInt(query.offset, 1, 1000000) - 1;
    const where = ["1=1"];
    const params: any[] = [];
    const add = (clause: string, value: any) => {
      params.push(value);
      where.push(clause.replace("?", `$${params.length}`));
    };
    if (query.q?.trim()) {
      const q = `%${query.q.trim()}%`;
      params.push(q, q, q, q);
      where.push(`(a.action ILIKE $${params.length - 3} OR a.entity_type ILIKE $${params.length - 2} OR a.entity_id ILIKE $${params.length - 1} OR u.email ILIKE $${params.length})`);
    }
    if (query.action?.trim()) add("a.action = ?", query.action.trim());
    if (query.entityType?.trim()) add("a.entity_type = ?", query.entityType.trim());
    if (query.actorId?.trim()) add("a.actor_id = ?::uuid", query.actorId.trim());
    try {
      const result = await fastify.pg.query(
        `SELECT a.id, a.actor_id, u.email AS actor_email, u.name AS actor_name, a.action, a.entity_type, a.entity_id,
                a.old_values, a.new_values, a.metadata, a.previous_hash, a.entry_hash, a.integrity_version, a.created_at
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_id
         WHERE ${where.join(" AND ")}
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );
      const count = await fastify.pg.query(
        `SELECT COUNT(*)::int AS total
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_id
         WHERE ${where.join(" AND ")}`,
        params
      );
      const rows = result.rows.map(auditRow);
      if (query.format === "csv") {
        const csv = [
          ["id", "createdAt", "actorId", "actorEmail", "action", "entityType", "entityId", "previousHash", "entryHash", "integrityVersion", "metadata"].join(","),
          ...rows.map((row) => [row.id, row.createdAt, row.actorId, row.actorEmail, row.action, row.entityType, row.entityId, row.previousHash, row.entryHash, row.integrityVersion, row.metadata].map(csvCell).join(",")),
        ].join("\n");
        const signature = exportSignature(csv, process.env.JWT_SECRET);
        return reply
          .header("content-type", "text/csv; charset=utf-8")
          .header("content-disposition", "attachment; filename=\"specora-audit-log.csv\"")
          .header("x-specora-export-digest", signature.digest)
          .header("x-specora-export-signature", signature.signature)
          .header("x-specora-export-algorithm", signature.algorithm)
          .send(csv);
      }
      return { entries: rows, total: count.rows[0]?.total || 0, limit, offset };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to fetch audit log" });
    }
  });

  fastify.get("/api/admin/audit-log/integrity", { onRequest: [fastify.authenticate, requirePermission("audit-log", "read")] }, async (request, reply) => {
    const query = request.query as { limit?: string };
    try {
      return await verifyAuditIntegrity(fastify.pg, parsePositiveInt(query.limit, 10000, 100000));
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to verify audit integrity" });
    }
  });

  fastify.post("/api/admin/permissions", { onRequest: [fastify.authenticate, requirePermission("rbac", "write")] }, async (request, reply) => {
    const body = request.body as { role?: string; resource?: string; action?: string };
    if (!body.role || !body.resource || !body.action) {
      return reply.status(400).send({ error: "role, resource, and action required" });
    }
    try {
      const result = await fastify.pg.query(
        "INSERT INTO app_permissions (role, resource, action) VALUES ($1, $2, $3) RETURNING id, role, resource, action",
        [body.role, body.resource, body.action]
      );
      clearPermissionCache();
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "rbac.permission.created",
        entityType: "AppPermission",
        entityId: result.rows[0].id,
        newValues: result.rows[0],
        metadata: { source: "api.admin", surface: "admin-console" },
      });
      return { permission: result.rows[0] };
    } catch (err: any) {
      if (err.code === "23505") {
        return reply.status(409).send({ error: "Permission already exists" });
      }
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to create permission" });
    }
  });

  fastify.delete("/api/admin/permissions/:id", { onRequest: [fastify.authenticate, requirePermission("rbac", "write")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const existing = await fastify.pg.query("SELECT id, role, resource, action FROM app_permissions WHERE id = $1", [id]);
      await fastify.pg.query("DELETE FROM app_permissions WHERE id = $1", [id]);
      clearPermissionCache();
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "rbac.permission.deleted",
        entityType: "AppPermission",
        entityId: id,
        oldValues: existing.rows[0] || { id },
        metadata: { source: "api.admin", surface: "admin-console" },
      });
      return { success: true };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to delete permission" });
    }
  });

  // System Properties
  fastify.get("/api/admin/system-properties", { onRequest: [fastify.authenticate, requirePermission("system-properties", "read")] }, async (_request, reply) => {
    try {
      const result = await fastify.pg.query(
        "SELECT key, value, updated_at FROM system_properties ORDER BY key"
      );
      return { properties: result.rows };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to fetch system properties" });
    }
  });

  fastify.post("/api/admin/system-properties", { onRequest: [fastify.authenticate, requirePermission("system-properties", "write")] }, async (request, reply) => {
    const body = request.body as { key?: string; value?: string };
    if (!body.key || !body.value) {
      return reply.status(400).send({ error: "key and value required" });
    }
    try {
      const result = await fastify.pg.query(
        "INSERT INTO system_properties (key, value) VALUES ($1, $2) RETURNING key, value, updated_at",
        [body.key, body.value]
      );
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "system_property.created",
        entityType: "SystemProperty",
        entityId: result.rows[0].key,
        newValues: result.rows[0],
        metadata: { source: "api.admin", surface: "admin-console" },
      });
      if (body.key === "security.field_restrictions") clearFieldRestrictionCache();
      return { property: result.rows[0] };
    } catch (err: any) {
      if (err.code === "23505") {
        return reply.status(409).send({ error: "Property already exists" });
      }
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to create property" });
    }
  });

  fastify.put("/api/admin/system-properties/:key", { onRequest: [fastify.authenticate, requirePermission("system-properties", "write")] }, async (request, reply) => {
    const { key } = request.params as { key: string };
    const body = request.body as { value?: string };
    if (!body.value) {
      return reply.status(400).send({ error: "value required" });
    }
    try {
      const existing = await fastify.pg.query("SELECT key, value, updated_at FROM system_properties WHERE key = $1", [key]);
      const result = await fastify.pg.query(
        "UPDATE system_properties SET value = $1, updated_at = NOW() WHERE key = $2 RETURNING key, value, updated_at",
        [body.value, key]
      );
      if (result.rows.length === 0) {
        return reply.status(404).send({ error: "Property not found" });
      }
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "system_property.updated",
        entityType: "SystemProperty",
        entityId: key,
        oldValues: existing.rows[0] || undefined,
        newValues: result.rows[0],
        metadata: { source: "api.admin", surface: "admin-console" },
      });
      if (key === "security.field_restrictions") clearFieldRestrictionCache();
      return { property: result.rows[0] };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to update property" });
    }
  });

  fastify.delete("/api/admin/system-properties/:key", { onRequest: [fastify.authenticate, requirePermission("system-properties", "write")] }, async (request, reply) => {
    const { key } = request.params as { key: string };
    try {
      const existing = await fastify.pg.query("SELECT key, value, updated_at FROM system_properties WHERE key = $1", [key]);
      await fastify.pg.query("DELETE FROM system_properties WHERE key = $1", [key]);
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "system_property.deleted",
        entityType: "SystemProperty",
        entityId: key,
        oldValues: existing.rows[0] || { key },
        metadata: { source: "api.admin", surface: "admin-console" },
      });
      if (key === "security.field_restrictions") clearFieldRestrictionCache();
      return { success: true };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to delete property" });
    }
  });
}
