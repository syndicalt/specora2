import { FastifyInstance } from "fastify";
import { requirePermission, clearPermissionCache } from "../../services/rbac";
import { getAllRegisteredApps, permissionToResourceAction } from "../../services/appRegistry";
import { clearFieldRestrictionCache, fieldTargetsForTable, resolveFieldAccess } from "../../services/fieldRbac";
import { getTables } from "../tables";
import { recordAuditEvent } from "../../services/auditLog";
import { getAllAppToolDefinitions } from "../../services/appTools";
import { resolveAppToolPolicy } from "../appToolPolicy";

type QueryablePg = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
};

type PermissionRisk = "critical" | "high" | "medium" | "low";

type PermissionTarget = {
  resource: string;
  action: string;
  label: string;
  description: string;
  category: string;
  source: string;
  risk: PermissionRisk;
};

type PermissionTargetOverrides = Partial<Omit<PermissionTarget, "resource" | "action">>;

type PermissionGrant = {
  id?: string;
  role: string;
  resource: string;
  action: string;
  group_id?: string;
  group_name?: string;
  group_slug?: string;
};

type AccessUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
};

type IdentityGroupRow = {
  id: string;
  name: string;
  slug?: string | null;
  description?: string | null;
  source?: string | null;
  external_id?: string | null;
  cmdb_ci_id?: string | null;
};

type FieldRestriction = { resource: string; tableId?: string; field?: string };

type AccessSubjectBody = { userId?: string; email?: string; role?: string };

type TraceEntry = { status: "allow" | "deny" | "info"; label: string; detail: string };

type RequiredPermissionTarget = {
  resource: string;
  action: string;
  label: string;
  risk: PermissionRisk;
  apps: Array<{ id: string; name: string }>;
};

type RbacRequestBody = AccessSubjectBody & {
  resource?: string;
  action?: string;
  appId?: string;
  toolName?: string;
  tableId?: string;
  fieldName?: string;
  accessMode?: string;
};

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function actorId(user: unknown) {
  return typeof user === "object" && user !== null && "id" in user ? String(user.id) : undefined;
}

const CORE_PERMISSION_TARGETS = [
  permissionTarget("users", "read", {
    label: "User Management",
    category: "Admin",
    source: "Core admin panel",
    description: "Allows a role to view users, sessions, identity groups, access posture, and user impact.",
    risk: "high",
  }),
  permissionTarget("users", "write", {
    label: "User Management",
    category: "Admin",
    source: "Core admin panel",
    description: "Allows a role to create users, change roles, update profile metadata, and revoke user sessions.",
    risk: "critical",
  }),
  permissionTarget("edge-enrollment", "read", {
    label: "Edge Enrollment",
    category: "Admin",
    source: "Core admin panel",
    description: "Allows a role to view edge collector enrollment tokens and collector registration posture.",
    risk: "high",
  }),
  permissionTarget("edge-enrollment", "write", {
    label: "Edge Enrollment",
    category: "Admin",
    source: "Core admin panel",
    description: "Allows a role to issue and revoke one-time enrollment tokens for specora-edge collectors.",
    risk: "critical",
  }),
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
  permissionTarget("credentials", "read", {
    label: "Credential References",
    category: "Admin",
    source: "Core admin panel",
    description: "Allows a role to view credential references and their health posture.",
    risk: "high",
  }),
  permissionTarget("credentials", "write", {
    label: "Credential References",
    category: "Admin",
    source: "Core admin panel",
    description: "Allows a role to register, update, or delete credential references.",
    risk: "critical",
  }),
  permissionTarget("credentials", "test", {
    label: "Credential References",
    category: "Admin",
    source: "Core admin panel",
    description: "Allows a role to test credential reference availability without reading secret values.",
    risk: "high",
  }),
];

function permissionRisk(resource: string, action: string): PermissionRisk {
  if (resource === "rbac" || resource === "system-properties" || resource === "identity" || resource === "identity-groups" || resource === "credentials") return "critical";
  if (resource.startsWith("field:") && action === "write") return "high";
  if (resource.startsWith("field:")) return "medium";
  if (["admin", "govern", "approve", "remediate", "delete"].includes(action)) return "high";
  if (["write", "mutate"].includes(action)) return "medium";
  return "low";
}

function permissionCategory(resource: string, action: string) {
  if (resource.startsWith("field:")) return "Field";
  if (resource === "tables" || resource.startsWith("pg.") || resource.startsWith("cmdb.")) return "Table";
  if (resource === "rbac" || resource === "system-properties" || resource === "number-sequences" || resource === "identity" || resource === "identity-groups" || resource === "credentials") return "Admin";
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
  if (resource === "credentials") {
    return "Controls reusable credential references for discovery and other integrations without exposing secret values.";
  }
  return `Allows a role to ${actionPhrase(action)} ${label || resource}.`;
}

function permissionTarget(resource: string, action: string, overrides: PermissionTargetOverrides = {}): PermissionTarget {
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

type AdminTableField = { name: string; label: string; writable: boolean };

type AdminTableLike = {
  id: string;
  name: string;
  label: string;
  provider?: string;
  category?: string;
  nameField?: string;
  hasNumber?: boolean;
  attributes?: Array<{ name: string; displayName?: string | null }>;
};

function tableFieldsForExplanation(table: AdminTableLike): AdminTableField[] {
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

async function loadFieldRestrictions(pg: QueryablePg): Promise<FieldRestriction[]> {
  const result = await pg.query("SELECT value FROM system_properties WHERE key = 'security.field_restrictions'");
  const raw = (result.rows[0] as { value?: string } | undefined)?.value;
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
      .filter((item): item is FieldRestriction => Boolean(item?.resource));
  } catch {
    return [];
  }
}

function normalizeFieldRestriction(tableId: string, field: string) {
  return { tableId, field, resource: `field:${tableId}.${field}` };
}

async function saveFieldRestrictions(pg: QueryablePg, restrictions: FieldRestriction[]) {
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

async function roleHasGrant(pg: QueryablePg, role: string, resource: string, action: string): Promise<PermissionGrant | null> {
  const result = await pg.query(
    "SELECT id, role, resource, action FROM app_permissions WHERE role = $1 AND resource = $2 AND action = $3",
    [role, resource, action]
  );
  return (result.rows[0] as PermissionGrant | undefined) || null;
}

async function userGroupGrants(pg: QueryablePg, userId?: string | null): Promise<{ groups: IdentityGroupRow[]; grants: PermissionGrant[] }> {
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
  return { groups: groups.rows as IdentityGroupRow[], grants: grants.rows as PermissionGrant[] };
}

function evaluateGrantWithGroups(role: string, grants: PermissionGrant[], groupGrants: PermissionGrant[], resource: string, action: string) {
  const base = evaluateGrant(role, grants, resource, action);
  if (base.allowed) return { ...base, inheritedGrant: null };
  const inheritedGrant = groupGrants.find((grant) => grant.resource === resource && grant.action === action) || null;
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

  let user: AccessUser | null = null;
  if (body.userId) {
    const result = await fastify.pg.query("SELECT id, name, email, role FROM users WHERE id = $1", [body.userId]);
    user = (result.rows[0] as AccessUser | undefined) || null;
  } else if (body.email) {
    const result = await fastify.pg.query("SELECT id, name, email, role FROM users WHERE email = $1", [body.email]);
    user = (result.rows[0] as AccessUser | undefined) || null;
  }

  const role = body.role || user?.role;
  if (!role) {
    return { error: "user or role required" };
  }

  const trace: TraceEntry[] = [];
  const grantsResult = await fastify.pg.query(
    "SELECT id, role, resource, action FROM app_permissions WHERE role = $1 ORDER BY resource, action",
    [role]
  );
  const grants = grantsResult.rows as PermissionGrant[];
  const inherited = await userGroupGrants(fastify.pg, user?.id);
  const directGrant = grants.find((grant) => grant.resource === resource && grant.action === action) ||
    await roleHasGrant(fastify.pg, role, resource, action);
  const inheritedGrant = inherited.grants.find((grant) => grant.resource === resource && grant.action === action) || null;

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

async function resolveAccessSubject(fastify: FastifyInstance, body: AccessSubjectBody) {
  let user: AccessUser | null = null;
  if (body.userId) {
    const result = await fastify.pg.query("SELECT id, name, email, role FROM users WHERE id = $1", [body.userId]);
    user = (result.rows[0] as AccessUser | undefined) || null;
  } else if (body.email) {
    const result = await fastify.pg.query("SELECT id, name, email, role FROM users WHERE email = $1", [body.email]);
    user = (result.rows[0] as AccessUser | undefined) || null;
  }
  const role = body.role || user?.role;
  return { user, role };
}

function evaluateGrant(role: string, grants: PermissionGrant[], resource: string, action: string) {
  const directGrant = grants.find((grant) => grant.resource === resource && grant.action === action) || null;
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
  parameters: unknown;
  resource: string;
  action: string;
};

function registeredAppTools(): RegisteredAppTool[] {
  return getAllAppToolDefinitions()
    .map((tool: { name: string; description: string; parameters: unknown }) => {
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
  const grants = permissionsResult.rows as PermissionGrant[];
  const roles = Array.from(new Set(grants.map((grant) => grant.role).filter(Boolean))).sort();
  const requiredTargets = new Map<string, RequiredPermissionTarget>();

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
    if (!current.apps.some((app) => app.id === tool.appId)) {
      current.apps.push({ id: tool.appId, name: tool.appId });
    }
    requiredTargets.set(key, current);
  }

  const orphaned = grants
    .filter((grant) => !requiredTargets.has(`${grant.resource}\u0000${grant.action}`) && !grant.resource.startsWith("field:"))
    .map((grant) => ({
      id: grant.id,
      role: grant.role,
      resource: grant.resource,
      action: grant.action,
      risk: permissionRisk(grant.resource, grant.action),
      reason: "No registered native app or app tool currently declares this target.",
    }));

  const roleCoverage = roles.map((role) => {
    const missing = Array.from(requiredTargets.values())
      .filter((target) => !evaluateGrant(role, grants.filter((grant) => grant.role === role), target.resource, target.action).allowed)
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
    coverage.missing.filter((item) => item.risk === "critical" || item.risk === "high")
  );
  const duplicateCount = grants.length - new Set(grants.map((grant) => `${grant.role}:${grant.resource}:${grant.action}`)).size;

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

export function registerAdminRbacRoutes(fastify: FastifyInstance) {
  fastify.get("/api/admin/rbac/options", { onRequest: [fastify.authenticate, requirePermission("rbac", "read")] }, async (_request, reply) => {
    try {
      const [usersResult, permissionsResult, groupsResult, apps] = await Promise.all([
        fastify.pg.query("SELECT id, name, email, role FROM users ORDER BY name, email"),
        fastify.pg.query("SELECT id, role, resource, action FROM app_permissions ORDER BY role, resource, action"),
        fastify.pg.query("SELECT id, name, slug, source, cmdb_ci_id FROM identity_groups ORDER BY name"),
        getAllRegisteredApps(fastify),
      ]);
      const tables = await getTables(fastify).catch(() => []);
      const users = usersResult.rows as AccessUser[];
      const permissions = permissionsResult.rows as PermissionGrant[];
      const roles = Array.from(new Set([
        ...users.map((user) => user.role).filter(Boolean),
        ...permissions.map((permission) => permission.role).filter(Boolean),
      ])).sort();
      const permissionEntries: Array<[string, PermissionTarget]> = [
        ...CORE_PERMISSION_TARGETS.map((target): [string, PermissionTarget] => [`${target.resource}:${target.action}`, target]),
        ...permissions.map((permission): [string, PermissionTarget] => [
          `${permission.resource}:${permission.action}`,
          permissionTarget(permission.resource, permission.action, { source: "Existing Grant" }),
        ]),
        ...apps.flatMap((app) => app.permissions.map((permission) => {
          const parsed = permissionToResourceAction(permission);
          return parsed ? [`${parsed.resource}:${parsed.action}`, permissionTarget(parsed.resource, parsed.action, {
            label: app.name,
            source: `Native app: ${app.name}`,
            category: "Application",
          })] as [string, PermissionTarget] : null;
        }).filter((entry): entry is [string, PermissionTarget] => Boolean(entry))),
        ...tables.flatMap((table) => fieldTargetsForTable(table.id, [
          { name: "name", label: "Name" },
          ...(table.hasNumber ? [{ name: "number", label: "Number" }] : []),
          ...(table.provider === "cmdb-class" ? [{ name: "environment", label: "Environment" }] : []),
          ...table.attributes.map((attr) => ({ name: attr.name, label: attr.displayName || attr.name })),
        ]).map((target): [string, PermissionTarget] => [`${target.resource}:${target.action}`, permissionTarget(target.resource, target.action, {
          label: `${table.label} / ${target.label}`,
          source: `Table field: ${table.label}`,
          category: "Field",
          risk: target.risk as PermissionRisk,
        })])),
      ];
      const permissionTargets = Array.from(new Map(permissionEntries).values())
        .sort((a, b) => `${a.resource}:${a.action}`.localeCompare(`${b.resource}:${b.action}`));
      return {
        users,
        groups: groupsResult.rows,
        roles,
        permissions,
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
    } catch (err: unknown) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to fetch RBAC options") });
    }
  });

  fastify.post("/api/admin/rbac/analyze", { onRequest: [fastify.authenticate, requirePermission("rbac", "read")] }, async (request, reply) => {
    try {
      const result = await analyzeAccess(fastify, request.body as RbacRequestBody);
      if ("error" in result) return reply.status(400).send(result);
      return result;
    } catch (err: unknown) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to analyze access") });
    }
  });

  fastify.post("/api/admin/rbac/explain-access", { onRequest: [fastify.authenticate, requirePermission("rbac", "read")] }, async (request, reply) => {
    try {
      const result = await explainAppAccess(fastify, request.body as RbacRequestBody);
      if ("error" in result) return reply.status(400).send(result);
      return result;
    } catch (err: unknown) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to explain app access") });
    }
  });

  fastify.post("/api/admin/rbac/explain-tool-access", { onRequest: [fastify.authenticate, requirePermission("rbac", "read")] }, async (request, reply) => {
    try {
      const result = await explainToolAccess(fastify, request.body as RbacRequestBody);
      if ("error" in result) return reply.status(400).send(result);
      return result;
    } catch (err: unknown) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to explain app tool access") });
    }
  });

  fastify.post("/api/admin/rbac/explain-table-access", { onRequest: [fastify.authenticate, requirePermission("rbac", "read")] }, async (request, reply) => {
    try {
      const result = await explainTableAccess(fastify, request.body as RbacRequestBody);
      if ("error" in result) return reply.status(400).send(result);
      return result;
    } catch (err: unknown) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to explain table access") });
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
    } catch (err: unknown) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to fetch field restrictions") });
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
        actorId: actorId(request.user),
        action: body.restricted ? "rbac.field_restriction.created" : "rbac.field_restriction.deleted",
        entityType: "FieldRestriction",
        entityId: next.resource,
        newValues: body.restricted ? next : undefined,
        oldValues: body.restricted ? undefined : next,
        metadata: { source: "api.admin", surface: "admin-console", tableId: table.id, field: field.name },
      });
      return { restriction: body.restricted ? next : null, restrictions: saved };
    } catch (err: unknown) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to update field restriction") });
    }
  });

  fastify.get("/api/admin/rbac/policy-drift", { onRequest: [fastify.authenticate, requirePermission("rbac", "read")] }, async (_request, reply) => {
    try {
      return await buildPolicyDrift(fastify);
    } catch (err: unknown) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to build policy drift report") });
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
      const created: PermissionGrant[] = [];
      const skipped: Array<{ role: string; resource: string; action: string; reason: string }> = [];
      for (const grant of normalized) {
        const result = await fastify.pg.query(
          `INSERT INTO app_permissions (role, resource, action)
           VALUES ($1, $2, $3)
           ON CONFLICT (role, resource, action) DO NOTHING
           RETURNING id, role, resource, action`,
          [role, grant.resource, grant.action]
        );
        if (result.rows[0]) {
          created.push(result.rows[0] as PermissionGrant);
        } else {
          skipped.push({ role, resource: grant.resource, action: grant.action, reason: "already_granted" });
        }
      }
      if (created.length) clearPermissionCache();
      await recordAuditEvent(fastify, {
        actorId: actorId(request.user),
        action: "rbac.permission.bulk_created",
        entityType: "AppPermission",
        entityId: role,
        newValues: { created },
        metadata: { source: "api.admin", surface: "admin-console", requested: normalized.length, skipped },
      });
      return { role, created, skipped, requested: normalized.length };
    } catch (err: unknown) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to bulk grant permissions") });
    }
  });

}
