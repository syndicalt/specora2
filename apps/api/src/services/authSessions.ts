import { FastifyInstance, FastifyRequest } from "fastify";
import { createHash, randomBytes, randomUUID } from "crypto";
import { recordAuditEvent } from "./auditLog";

export const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || "15m";
const ACCESS_TOKEN_EXPIRES_IN_SECONDS = Number(process.env.ACCESS_TOKEN_EXPIRES_IN_SECONDS || 15 * 60);
const REFRESH_TOKEN_DAYS = Number(process.env.REFRESH_TOKEN_DAYS || 30);

export type AuthUser = {
  id: string;
  email: string;
  name?: string;
  role: string;
};

type SessionRow = {
  id: string;
  user_id: string;
  refresh_token_family: string;
  revoked_at: string | null;
  expires_at: string;
  email: string;
  name: string;
  role: string;
};

export function hashRefreshToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function newRefreshToken() {
  return randomBytes(48).toString("base64url");
}

function requestMetadata(request?: FastifyRequest) {
  return {
    userAgent: request?.headers["user-agent"] || null,
    ipAddress: request?.ip || null,
  };
}

async function auditAuth(fastify: FastifyInstance, input: {
  actorId?: string | null;
  action: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await recordAuditEvent(fastify, {
      actorId: input.actorId,
      action: input.action,
      entityType: "AuthSession",
      entityId: input.entityId,
      metadata: input.metadata,
    });
  } catch (error) {
    fastify.log.warn({ err: error }, "auth audit event could not be recorded");
  }
}

export async function issueAuthTokens(
  fastify: FastifyInstance,
  user: AuthUser,
  request?: FastifyRequest,
  familyId: string = randomUUID()
) {
  const sessionId = randomUUID();
  const accessJti = randomUUID();
  const refreshToken = newRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);
  const metadata = requestMetadata(request);

  await fastify.pg.query(
    `INSERT INTO auth_sessions (id, user_id, refresh_token_hash, refresh_token_family, access_jti, user_agent, ip_address, expires_at, last_used_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
    [sessionId, user.id, refreshTokenHash, familyId, accessJti, metadata.userAgent, metadata.ipAddress, refreshExpiresAt.toISOString()]
  );

  const token = await fastify.jwt.sign(
    { id: user.id, email: user.email, role: user.role, jti: accessJti, sid: sessionId, typ: "access" },
    { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
  );

  return {
    token,
    refreshToken,
    expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
    refreshExpiresAt: refreshExpiresAt.toISOString(),
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  };
}

export async function rotateRefreshToken(fastify: FastifyInstance, refreshToken: string, request?: FastifyRequest) {
  const tokenHash = hashRefreshToken(refreshToken);
  const result = await fastify.pg.query(
    `SELECT s.id, s.user_id, s.refresh_token_family, s.revoked_at, s.expires_at, u.email, u.name, u.role
     FROM auth_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.refresh_token_hash = $1`,
    [tokenHash]
  );
  const session = result.rows[0] as SessionRow | undefined;
  if (!session) {
    await auditAuth(fastify, {
      action: "auth.refresh.invalid",
      entityId: tokenHash.slice(0, 12),
      metadata: { reason: "not_found" },
    });
    return null;
  }

  if (session.revoked_at) {
    await fastify.pg.query(
      "UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, NOW()), revoked_reason = COALESCE(revoked_reason, 'refresh_reuse'), updated_at = NOW() WHERE refresh_token_family = $1",
      [session.refresh_token_family]
    );
    await auditAuth(fastify, {
      actorId: session.user_id,
      action: "auth.refresh.reuse_detected",
      entityId: session.id,
      metadata: { familyId: session.refresh_token_family },
    });
    return null;
  }

  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await fastify.pg.query(
      "UPDATE auth_sessions SET revoked_at = NOW(), revoked_reason = 'expired', updated_at = NOW() WHERE id = $1",
      [session.id]
    );
    await auditAuth(fastify, {
      actorId: session.user_id,
      action: "auth.refresh.invalid",
      entityId: session.id,
      metadata: { reason: "expired" },
    });
    return null;
  }

  await fastify.pg.query(
    "UPDATE auth_sessions SET revoked_at = NOW(), revoked_reason = 'rotated', last_used_at = NOW(), updated_at = NOW() WHERE id = $1",
    [session.id]
  );

  const issued = await issueAuthTokens(
    fastify,
    { id: session.user_id, email: session.email, name: session.name, role: session.role },
    request,
    session.refresh_token_family
  );
  await auditAuth(fastify, {
    actorId: session.user_id,
    action: "auth.refresh.rotated",
    entityId: session.id,
    metadata: { replacementSessionId: (await fastify.pg.query("SELECT id FROM auth_sessions WHERE refresh_token_hash = $1", [hashRefreshToken(issued.refreshToken)])).rows[0]?.id },
  });
  return issued;
}

export async function revokeRefreshToken(fastify: FastifyInstance, refreshToken: string, reason = "logout") {
  const tokenHash = hashRefreshToken(refreshToken);
  const result = await fastify.pg.query(
    "UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, NOW()), revoked_reason = COALESCE(revoked_reason, $2), updated_at = NOW() WHERE refresh_token_hash = $1 RETURNING id, user_id",
    [tokenHash, reason]
  );
  const row = result.rows[0];
  if (row) {
    await auditAuth(fastify, { actorId: row.user_id, action: "auth.logout", entityId: row.id, metadata: { reason } });
  }
  return Boolean(row);
}

export async function revokeUserSession(fastify: FastifyInstance, userId: string, sessionId: string, reason = "revoked") {
  const result = await fastify.pg.query(
    "UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, NOW()), revoked_reason = COALESCE(revoked_reason, $3), updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING id",
    [sessionId, userId, reason]
  );
  if (result.rows[0]) {
    await auditAuth(fastify, { actorId: userId, action: "auth.session.revoked", entityId: sessionId, metadata: { reason } });
  }
  return Boolean(result.rows[0]);
}

export async function listUserSessions(fastify: FastifyInstance, userId: string) {
  const result = await fastify.pg.query(
    `SELECT id, user_agent, ip_address, expires_at, last_used_at, revoked_at, revoked_reason, created_at
     FROM auth_sessions
     WHERE user_id = $1
     ORDER BY COALESCE(last_used_at, created_at) DESC`,
    [userId]
  );
  return result.rows;
}

export async function isAccessSessionActive(fastify: FastifyInstance, sessionId?: string, userId?: string) {
  if (!sessionId || !userId) return false;
  const result = await fastify.pg.query(
    `SELECT 1
     FROM auth_sessions
     WHERE id = $1
       AND user_id = $2
       AND revoked_at IS NULL
       AND expires_at > NOW()
     LIMIT 1`,
    [sessionId, userId]
  );
  return result.rows.length > 0;
}
