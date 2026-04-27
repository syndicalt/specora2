import { FastifyInstance } from "fastify";
import { requirePermission, clearPermissionCache } from "../services/rbac";
import { getAllRegisteredApps, permissionToResourceAction } from "../services/appRegistry";
import { clearFieldRestrictionCache, fieldTargetsForTable } from "../services/fieldRbac";
import { getTables } from "./tables";
import { recordAuditEvent } from "../services/auditLog";

const CORE_ADMIN_PANELS = [
  { id: "rbac", name: "RBAC", icon: "Shield", permissions: ["rbac:read"] },
  { id: "number-sequences", name: "Number Sequences", icon: "Hash", permissions: ["number-sequences:read"] },
  { id: "system-properties", name: "System Properties", icon: "Settings", permissions: ["system-properties:read"] },
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
  if (resource === "rbac" || resource === "system-properties") return "critical";
  if (resource.startsWith("field:") && action === "write") return "high";
  if (resource.startsWith("field:")) return "medium";
  if (["admin", "govern", "approve", "remediate", "delete"].includes(action)) return "high";
  if (["write", "mutate"].includes(action)) return "medium";
  return "low";
}

function permissionCategory(resource: string, action: string) {
  if (resource.startsWith("field:")) return "Field";
  if (resource === "tables" || resource.startsWith("pg.") || resource.startsWith("cmdb.")) return "Table";
  if (resource === "rbac" || resource === "system-properties" || resource === "number-sequences") return "Admin";
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

async function roleHasGrant(pg: any, role: string, resource: string, action: string) {
  const result = await pg.query(
    "SELECT id, role, resource, action FROM app_permissions WHERE role = $1 AND resource = $2 AND action = $3",
    [role, resource, action]
  );
  return result.rows[0] || null;
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
  const directGrant = grants.find((grant: any) => grant.resource === resource && grant.action === action) ||
    await roleHasGrant(fastify.pg, role, resource, action);

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
      grants,
      relatedApps,
      missing: allowed ? [] : [{ resource, action }],
      trace,
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
      const [usersResult, permissionsResult, apps] = await Promise.all([
        fastify.pg.query("SELECT id, name, email, role FROM users ORDER BY name, email"),
        fastify.pg.query("SELECT id, role, resource, action FROM app_permissions ORDER BY role, resource, action"),
        getAllRegisteredApps(fastify),
      ]);
      const tables = await getTables(fastify).catch(() => []);
      const roles = Array.from(new Set([
        ...usersResult.rows.map((user: any) => user.role).filter(Boolean),
        ...permissionsResult.rows.map((permission: any) => permission.role).filter(Boolean),
      ])).sort();
      const permissionEntries: Array<[string, any]> = [
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
        roles,
        permissions: permissionsResult.rows,
        targets: permissionTargets,
        apps: apps.map((app) => ({ id: app.id, name: app.name, permissions: app.permissions })),
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
