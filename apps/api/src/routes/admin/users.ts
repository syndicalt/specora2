import { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { clearPermissionCache, requirePermission } from "../../services/rbac";
import { recordAuditEvent } from "../../services/auditLog";
import { getPasswordPolicy, passwordPolicyMessage, validatePasswordAgainstPolicy } from "../../services/passwordPolicy";

type PgLike = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
};

type TimestampValue = string | Date | number | null | undefined;

type UserManagementDbRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  password_change_required?: boolean | null;
  created_at?: TimestampValue;
  updated_at?: TimestampValue;
  last_login_at?: TimestampValue;
  active_sessions?: number | string | null;
  failed_logins_24h?: number | string | null;
  group_count?: number | string | null;
  high_risk_grants?: number | string | null;
  owned_records?: number | string | null;
  oauth_accounts?: number | string | null;
};

type PermissionGrantRow = {
  id?: string;
  role?: string;
  group_id?: string;
  group_name?: string;
  group_slug?: string;
  resource: string;
  action: string;
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

type UserImpactSummary = {
  changeRequests: number;
  approvals: number;
  incidents: number;
  assets: number;
  knowledgeItems: number;
  auditEvents: number;
};

type SessionRow = {
  id: string;
  user_agent?: string | null;
  ip_address?: string | null;
  expires_at?: TimestampValue;
  last_used_at?: TimestampValue;
  revoked_at?: TimestampValue;
  revoked_reason?: string | null;
  created_at?: TimestampValue;
};

type AuditEventRow = {
  id: string;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  metadata?: unknown;
  created_at?: TimestampValue;
};

type DbError = Error & { code?: string };

function timestampString(value: TimestampValue) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

function dbError(err: unknown): DbError {
  return err instanceof Error ? err as DbError : new Error(String(err)) as DbError;
}

function countValue(rows: unknown[]) {
  return Number((rows[0] as { count?: string | number } | undefined)?.count || 0);
}

function isFutureTimestamp(value: TimestampValue) {
  return Boolean(value && new Date(value).getTime() > Date.now());
}

function permissionRisk(resource: string, action: string) {
  if (resource === "rbac" || resource === "system-properties" || resource === "identity" || resource === "identity-groups" || resource === "credentials") return "critical";
  if (resource.startsWith("field:") && action === "write") return "high";
  if (resource.startsWith("field:")) return "medium";
  if (["admin", "govern", "approve", "remediate", "delete"].includes(action)) return "high";
  if (["write", "mutate"].includes(action)) return "medium";
  return "low";
}

async function userGroupGrants(pg: PgLike, userId?: string | null): Promise<{ groups: IdentityGroupRow[]; grants: PermissionGrantRow[] }> {
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
  return { groups: groups.rows as IdentityGroupRow[], grants: grants.rows as PermissionGrantRow[] };
}

function userManagementRow(row: UserManagementDbRow) {
  const activeSessions = Number(row.active_sessions || 0);
  const lastLoginAt = timestampString(row.last_login_at);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: timestampString(row.created_at),
    updatedAt: timestampString(row.updated_at),
    lastLoginAt,
    activeSessions,
    failedLogins24h: Number(row.failed_logins_24h || 0),
    groupCount: Number(row.group_count || 0),
    highRiskGrants: Number(row.high_risk_grants || 0),
    ownedRecords: Number(row.owned_records || 0),
    status: activeSessions > 0 ? "active" : lastLoginAt ? "idle" : "never_signed_in",
    authMethod: Number(row.oauth_accounts || 0) > 0 ? "sso" : "password",
    passwordChangeRequired: Boolean(row.password_change_required),
  };
}

async function userImpactSummary(pg: PgLike, userId: string): Promise<UserImpactSummary> {
  const [changes, approvals, incidents, assets, knowledge, auditEvents] = await Promise.all([
    pg.query("SELECT COUNT(*)::int AS count FROM change_requests WHERE requester_id = $1 OR approver_id = $1", [userId]),
    pg.query("SELECT COUNT(*)::int AS count FROM change_request_approvers WHERE user_id = $1", [userId]),
    pg.query("SELECT COUNT(*)::int AS count FROM incidents WHERE owner_id = $1 OR commander_id = $1 OR requester_id = $1", [userId]).catch(() => ({ rows: [{ count: 0 }] })),
    pg.query("SELECT COUNT(*)::int AS count FROM asset_records WHERE assigned_to = $1", [userId]).catch(() => ({ rows: [{ count: 0 }] })),
    pg.query("SELECT COUNT(*)::int AS count FROM knowledge_items WHERE owner_id = $1", [userId]).catch(() => ({ rows: [{ count: 0 }] })),
    pg.query("SELECT COUNT(*)::int AS count FROM audit_log WHERE actor_id = $1", [userId]),
  ]);
  return {
    changeRequests: countValue(changes.rows),
    approvals: countValue(approvals.rows),
    incidents: countValue(incidents.rows),
    assets: countValue(assets.rows),
    knowledgeItems: countValue(knowledge.rows),
    auditEvents: countValue(auditEvents.rows),
  };
}

function userAccessRecommendations(
  user: UserManagementDbRow,
  directGrants: PermissionGrantRow[],
  inheritedGrants: PermissionGrantRow[],
  impact: UserImpactSummary,
  sessions: SessionRow[],
  auditEvents: AuditEventRow[]
) {
  const recommendations: Array<{ severity: string; title: string; rationale: string; action: string }> = [];
  const risky = [...directGrants, ...inheritedGrants].filter((grant) => permissionRisk(grant.resource, grant.action) === "critical");
  if ((user.role === "security_admin" || user.role === "admin") && sessions.filter((session) => !session.revoked_at).length === 0) {
    recommendations.push({
      severity: "warning",
      title: "Privileged account has no active session",
      rationale: "The user has broad administrative reach but is not currently active.",
      action: "Confirm this account should retain privileged access.",
    });
  }
  if (risky.length) {
    recommendations.push({
      severity: "critical",
      title: "Critical effective grants detected",
      rationale: `${risky.length} effective grants can change platform security, identity, credentials, or configuration.`,
      action: "Verify whether each critical grant is direct, implicit, or inherited.",
    });
  }
  const openWork = Number(impact.changeRequests || 0) + Number(impact.approvals || 0) + Number(impact.incidents || 0) + Number(impact.assets || 0);
  if (openWork > 0) {
    recommendations.push({
      severity: "warning",
      title: "Deactivation requires reassignment",
      rationale: `This user is tied to ${openWork} operational records across changes, approvals, incidents, or assets.`,
      action: "Reassign ownership before disabling access or revoking sessions.",
    });
  }
  if (auditEvents.some((event) => String(event.action || "").includes("login.failed"))) {
    recommendations.push({
      severity: "warning",
      title: "Recent failed login activity",
      rationale: "Recent authentication failures exist in this user trail.",
      action: "Check source IPs and revoke sessions if the failures are unexpected.",
    });
  }
  return recommendations.length ? recommendations : [{
    severity: "info",
    title: "No immediate access concerns",
    rationale: "No obvious critical grants, ownership blockers, or recent failure signals were found.",
    action: "Continue standard access review cadence.",
  }];
}

export function registerAdminUserRoutes(fastify: FastifyInstance) {
  fastify.get("/api/admin/users", { onRequest: [fastify.authenticate, requirePermission("users", "read")] }, async (_request, reply) => {
    try {
      const result = await fastify.pg.query(
        `SELECT u.id, u.name, u.email, u.role, u.password_change_required, u.created_at, u.updated_at,
                MAX(CASE WHEN a.action = 'auth.login.success' THEN a.created_at ELSE NULL END) AS last_login_at,
                COUNT(DISTINCT CASE WHEN s.revoked_at IS NULL AND s.expires_at > NOW() THEN s.id ELSE NULL END)::int AS active_sessions,
                COUNT(DISTINCT gm.group_id)::int AS group_count,
                COUNT(DISTINCT oa.id)::int AS oauth_accounts,
                COUNT(DISTINCT CASE WHEN a.action = 'auth.login.failed' AND a.created_at > NOW() - INTERVAL '24 hours' THEN a.id ELSE NULL END)::int AS failed_logins_24h,
                COUNT(DISTINCT CASE WHEN p.resource IN ('rbac','system-properties','identity','identity-groups','credentials','users') OR p.action IN ('admin','delete') THEN p.id ELSE NULL END)::int AS high_risk_grants,
                (
                  (SELECT COUNT(*) FROM change_requests cr WHERE cr.requester_id = u.id OR cr.approver_id = u.id) +
                  (SELECT COUNT(*) FROM change_request_approvers ca WHERE ca.user_id = u.id)
                )::int AS owned_records
         FROM users u
         LEFT JOIN auth_sessions s ON s.user_id = u.id
         LEFT JOIN identity_group_memberships gm ON gm.user_id = u.id
         LEFT JOIN oauth_accounts oa ON oa.user_id = u.id
         LEFT JOIN app_permissions p ON p.role = u.role
         LEFT JOIN audit_log a ON a.actor_id = u.id
         GROUP BY u.id
         ORDER BY u.name, u.email`
      );
      return { users: (result.rows as UserManagementDbRow[]).map(userManagementRow) };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to fetch users") });
    }
  });

  fastify.get("/api/admin/users/:id", { onRequest: [fastify.authenticate, requirePermission("users", "read")] }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const userResult = await fastify.pg.query(
        `SELECT u.id, u.name, u.email, u.role, u.password_change_required, u.created_at, u.updated_at,
                MAX(CASE WHEN a.action = 'auth.login.success' THEN a.created_at ELSE NULL END) AS last_login_at,
                COUNT(DISTINCT CASE WHEN s.revoked_at IS NULL AND s.expires_at > NOW() THEN s.id ELSE NULL END)::int AS active_sessions,
                COUNT(DISTINCT gm.group_id)::int AS group_count,
                COUNT(DISTINCT oa.id)::int AS oauth_accounts,
                COUNT(DISTINCT CASE WHEN a.action = 'auth.login.failed' AND a.created_at > NOW() - INTERVAL '24 hours' THEN a.id ELSE NULL END)::int AS failed_logins_24h,
                COUNT(DISTINCT CASE WHEN p.resource IN ('rbac','system-properties','identity','identity-groups','credentials','users') OR p.action IN ('admin','delete') THEN p.id ELSE NULL END)::int AS high_risk_grants,
                0::int AS owned_records
         FROM users u
         LEFT JOIN auth_sessions s ON s.user_id = u.id
         LEFT JOIN identity_group_memberships gm ON gm.user_id = u.id
         LEFT JOIN oauth_accounts oa ON oa.user_id = u.id
         LEFT JOIN app_permissions p ON p.role = u.role
         LEFT JOIN audit_log a ON a.actor_id = u.id
         WHERE u.id = $1
         GROUP BY u.id`,
        [id]
      );
      const user = userResult.rows[0] as UserManagementDbRow | undefined;
      if (!user) return reply.status(404).send({ error: "User not found" });
      const [directGrants, inherited, sessions, audit, impact] = await Promise.all([
        fastify.pg.query("SELECT id, role, resource, action FROM app_permissions WHERE role = $1 ORDER BY resource, action", [user.role]),
        userGroupGrants(fastify.pg, id),
        fastify.pg.query(
          `SELECT id, user_agent, ip_address, expires_at, last_used_at, revoked_at, revoked_reason, created_at
           FROM auth_sessions WHERE user_id = $1 ORDER BY COALESCE(last_used_at, created_at) DESC LIMIT 10`,
          [id]
        ),
        fastify.pg.query(
          `SELECT id, action, entity_type, entity_id, metadata, created_at
           FROM audit_log WHERE actor_id = $1 OR entity_id = $1::text ORDER BY created_at DESC LIMIT 20`,
          [id]
        ),
        userImpactSummary(fastify.pg, id),
      ]);
      const directGrantRows = directGrants.rows as PermissionGrantRow[];
      const sessionRows = sessions.rows as SessionRow[];
      const auditRows = audit.rows as AuditEventRow[];
      const ownedRecords = Object.values(impact).reduce((sum, value) => sum + Number(value || 0), 0);
      return {
        user: userManagementRow({ ...user, owned_records: ownedRecords }),
        directGrants: directGrantRows.map((grant) => ({ ...grant, risk: permissionRisk(grant.resource, grant.action), source: "role" })),
        inheritedGroups: inherited.groups,
        inheritedGrants: inherited.grants.map((grant) => ({ ...grant, risk: permissionRisk(grant.resource, grant.action), source: "group" })),
        sessions: sessionRows.map((row) => ({
          id: row.id,
          userAgent: row.user_agent,
          ipAddress: row.ip_address,
          expiresAt: timestampString(row.expires_at),
          lastUsedAt: timestampString(row.last_used_at),
          revokedAt: timestampString(row.revoked_at),
          revokedReason: row.revoked_reason,
          createdAt: timestampString(row.created_at),
          active: !row.revoked_at && isFutureTimestamp(row.expires_at),
        })),
        auditEvents: auditRows.map((row) => ({
          id: row.id,
          action: row.action,
          entityType: row.entity_type,
          entityId: row.entity_id,
          metadata: row.metadata,
          createdAt: timestampString(row.created_at),
        })),
        impact,
        recommendations: userAccessRecommendations(user, directGrantRows, inherited.grants, impact, sessionRows, auditRows),
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to fetch user") });
    }
  });

  fastify.post("/api/admin/users", { onRequest: [fastify.authenticate, requirePermission("users", "write")] }, async (request, reply) => {
    try {
      const actor = request.user;
      const body = request.body as { email?: string; name?: string; role?: string; password?: string };
      const email = body.email?.trim().toLowerCase();
      const name = body.name?.trim();
      const role = body.role?.trim() || "operator";
      if (!email || !name || !body.password) {
        return reply.status(400).send({ error: "email, name, and password are required" });
      }
      const policy = await getPasswordPolicy(fastify.pg);
      const policyCheck = validatePasswordAgainstPolicy(body.password, policy);
      if (!policyCheck.valid) {
        return reply.status(400).send({ error: policyCheck.failures[0] || passwordPolicyMessage(policy), failures: policyCheck.failures });
      }
      const id = randomUUID();
      const passwordHash = await bcrypt.hash(body.password, 10);
      const result = await fastify.pg.query(
        `INSERT INTO users (id, email, name, password_hash, role, password_change_required)
         VALUES ($1, $2, $3, $4, $5, TRUE)
         RETURNING id, name, email, role, password_change_required, created_at, updated_at`,
        [id, email, name, passwordHash, role]
      );
      await recordAuditEvent(fastify, {
        actorId: actor?.id,
        action: "admin.user.created",
        entityType: "user",
        entityId: id,
        newValues: { email, name, role },
      });
      return { user: result.rows[0] };
    } catch (err) {
      const error = dbError(err);
      if (error.code === "23505") return reply.status(409).send({ error: "User email already exists" });
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to create user") });
    }
  });

  fastify.patch("/api/admin/users/:id", { onRequest: [fastify.authenticate, requirePermission("users", "write")] }, async (request, reply) => {
    try {
      const actor = request.user;
      const { id } = request.params as { id: string };
      const body = request.body as { name?: string; role?: string };
      const existing = await fastify.pg.query("SELECT id, name, email, role FROM users WHERE id = $1", [id]);
      if (!existing.rows.length) return reply.status(404).send({ error: "User not found" });
      const existingUser = existing.rows[0] as UserManagementDbRow;
      const nextName = body.name?.trim() || existingUser.name;
      const nextRole = body.role?.trim() || existingUser.role;
      const result = await fastify.pg.query(
        `UPDATE users SET name = $1, role = $2, updated_at = NOW()
         WHERE id = $3 RETURNING id, name, email, role, created_at, updated_at`,
        [nextName, nextRole, id]
      );
      clearPermissionCache();
      await recordAuditEvent(fastify, {
        actorId: actor?.id,
        action: "admin.user.updated",
        entityType: "user",
        entityId: id,
        oldValues: existingUser,
        newValues: { name: nextName, role: nextRole },
      });
      return { user: result.rows[0] };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to update user") });
    }
  });

  fastify.post("/api/admin/users/:id/revoke-sessions", { onRequest: [fastify.authenticate, requirePermission("users", "write")] }, async (request, reply) => {
    try {
      const actor = request.user;
      const { id } = request.params as { id: string };
      const result = await fastify.pg.query(
        `UPDATE auth_sessions
         SET revoked_at = NOW(), revoked_reason = 'admin_revoked', updated_at = NOW()
         WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
         RETURNING id`,
        [id]
      );
      await recordAuditEvent(fastify, {
        actorId: actor?.id,
        action: "admin.user.sessions_revoked",
        entityType: "user",
        entityId: id,
        metadata: { revoked: result.rows.length },
      });
      return { revoked: result.rows.length };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to revoke user sessions") });
    }
  });
}
