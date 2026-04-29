import { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { clearPermissionCache, requirePermission } from "../../services/rbac";
import { recordAuditEvent } from "../../services/auditLog";
import { getPasswordPolicy, passwordPolicyMessage, validatePasswordAgainstPolicy } from "../../services/passwordPolicy";

function timestampString(value: any) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function permissionRisk(resource: string, action: string) {
  if (resource === "rbac" || resource === "system-properties" || resource === "identity" || resource === "identity-groups" || resource === "credentials") return "critical";
  if (resource.startsWith("field:") && action === "write") return "high";
  if (resource.startsWith("field:")) return "medium";
  if (["admin", "govern", "approve", "remediate", "delete"].includes(action)) return "high";
  if (["write", "mutate"].includes(action)) return "medium";
  return "low";
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

function userManagementRow(row: any) {
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

async function userImpactSummary(pg: any, userId: string) {
  const [changes, approvals, incidents, assets, knowledge, auditEvents] = await Promise.all([
    pg.query("SELECT COUNT(*)::int AS count FROM change_requests WHERE requester_id = $1 OR approver_id = $1", [userId]),
    pg.query("SELECT COUNT(*)::int AS count FROM change_request_approvers WHERE user_id = $1", [userId]),
    pg.query("SELECT COUNT(*)::int AS count FROM incidents WHERE owner_id = $1 OR commander_id = $1 OR requester_id = $1", [userId]).catch(() => ({ rows: [{ count: 0 }] })),
    pg.query("SELECT COUNT(*)::int AS count FROM asset_records WHERE assigned_to = $1", [userId]).catch(() => ({ rows: [{ count: 0 }] })),
    pg.query("SELECT COUNT(*)::int AS count FROM knowledge_items WHERE owner_id = $1", [userId]).catch(() => ({ rows: [{ count: 0 }] })),
    pg.query("SELECT COUNT(*)::int AS count FROM audit_log WHERE actor_id = $1", [userId]),
  ]);
  return {
    changeRequests: Number(changes.rows[0]?.count || 0),
    approvals: Number(approvals.rows[0]?.count || 0),
    incidents: Number(incidents.rows[0]?.count || 0),
    assets: Number(assets.rows[0]?.count || 0),
    knowledgeItems: Number(knowledge.rows[0]?.count || 0),
    auditEvents: Number(auditEvents.rows[0]?.count || 0),
  };
}

function userAccessRecommendations(user: any, directGrants: any[], inheritedGrants: any[], impact: any, sessions: any[], auditEvents: any[]) {
  const recommendations: Array<{ severity: string; title: string; rationale: string; action: string }> = [];
  const risky = [...directGrants, ...inheritedGrants].filter((grant: any) => permissionRisk(grant.resource, grant.action) === "critical");
  if ((user.role === "security_admin" || user.role === "admin") && sessions.filter((session: any) => !session.revoked_at).length === 0) {
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
  if (auditEvents.some((event: any) => String(event.action || "").includes("login.failed"))) {
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
      return { users: result.rows.map(userManagementRow) };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to fetch users" });
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
      const user = userResult.rows[0];
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
      const ownedRecords = Object.values(impact).reduce((sum: number, value: any) => sum + Number(value || 0), 0);
      return {
        user: userManagementRow({ ...user, owned_records: ownedRecords }),
        directGrants: directGrants.rows.map((grant: any) => ({ ...grant, risk: permissionRisk(grant.resource, grant.action), source: "role" })),
        inheritedGroups: inherited.groups,
        inheritedGrants: inherited.grants.map((grant: any) => ({ ...grant, risk: permissionRisk(grant.resource, grant.action), source: "group" })),
        sessions: sessions.rows.map((row: any) => ({
          id: row.id,
          userAgent: row.user_agent,
          ipAddress: row.ip_address,
          expiresAt: timestampString(row.expires_at),
          lastUsedAt: timestampString(row.last_used_at),
          revokedAt: timestampString(row.revoked_at),
          revokedReason: row.revoked_reason,
          createdAt: timestampString(row.created_at),
          active: !row.revoked_at && new Date(row.expires_at).getTime() > Date.now(),
        })),
        auditEvents: audit.rows.map((row: any) => ({
          id: row.id,
          action: row.action,
          entityType: row.entity_type,
          entityId: row.entity_id,
          metadata: row.metadata,
          createdAt: timestampString(row.created_at),
        })),
        impact,
        recommendations: userAccessRecommendations(user, directGrants.rows, inherited.grants, impact, sessions.rows, audit.rows),
      };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to fetch user" });
    }
  });

  fastify.post("/api/admin/users", { onRequest: [fastify.authenticate, requirePermission("users", "write")] }, async (request, reply) => {
    try {
      const actor = (request as any).user as { id?: string } | null;
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
    } catch (err: any) {
      if (err.code === "23505") return reply.status(409).send({ error: "User email already exists" });
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to create user" });
    }
  });

  fastify.patch("/api/admin/users/:id", { onRequest: [fastify.authenticate, requirePermission("users", "write")] }, async (request, reply) => {
    try {
      const actor = (request as any).user as { id?: string } | null;
      const { id } = request.params as { id: string };
      const body = request.body as { name?: string; role?: string };
      const existing = await fastify.pg.query("SELECT id, name, email, role FROM users WHERE id = $1", [id]);
      if (!existing.rows.length) return reply.status(404).send({ error: "User not found" });
      const nextName = body.name?.trim() || existing.rows[0].name;
      const nextRole = body.role?.trim() || existing.rows[0].role;
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
        oldValues: existing.rows[0],
        newValues: { name: nextName, role: nextRole },
      });
      return { user: result.rows[0] };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to update user" });
    }
  });

  fastify.post("/api/admin/users/:id/revoke-sessions", { onRequest: [fastify.authenticate, requirePermission("users", "write")] }, async (request, reply) => {
    try {
      const actor = (request as any).user as { id?: string } | null;
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
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to revoke user sessions" });
    }
  });
}
