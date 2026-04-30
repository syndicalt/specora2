import { getRedis, isRedisAvailable } from "./redis";
import type { FastifyReply, FastifyRequest } from "fastify";

interface PermissionCheck {
  role: string;
  resource: string;
  action: string;
  userId?: string;
}

const MAX_CACHE_SIZE = 1000;
const CACHE_TTL_SECONDS = 30;
const permissionCache = new Map<string, boolean>();

function localSetCache(key: string, value: boolean): void {
  if (permissionCache.size >= MAX_CACHE_SIZE && !permissionCache.has(key)) {
    const firstKey = permissionCache.keys().next().value;
    if (firstKey !== undefined) {
      permissionCache.delete(firstKey);
    }
  }
  permissionCache.set(key, value);
}

async function redisSetCache(key: string, value: boolean): Promise<void> {
  const redis = getRedis();
  if (!redis || !isRedisAvailable()) return;
  try {
    await redis.setex(`specora:perm:${key}`, CACHE_TTL_SECONDS, value ? "1" : "0");
  } catch {
    // fallback to local cache on Redis error
  }
}

async function redisGetCache(key: string): Promise<boolean | null> {
  const redis = getRedis();
  if (!redis || !isRedisAvailable()) return null;
  try {
    const value = await redis.get(`specora:perm:${key}`);
    if (value === "1") return true;
    if (value === "0") return false;
    return null;
  } catch {
    return null;
  }
}

function setCache(key: string, value: boolean): void {
  localSetCache(key, value);
  // Fire-and-forget Redis cache update
  redisSetCache(key, value).catch(() => {});
}

export function clearPermissionCache(): void {
  permissionCache.clear();
  const redis = getRedis();
  if (redis && isRedisAvailable()) {
    // Best-effort: clear matching keys. In production with many keys,
    // use a Redis Lua script or SCAN + DEL.
    redis.del("specora:perm:*").catch(() => {});
  }
}

interface PgClient {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}

export async function hasPermission(
  pg: PgClient,
  { role, resource, action, userId }: PermissionCheck
): Promise<boolean> {
  const key = `${role}:${userId || "role-only"}:${resource}:${action}`;

  // Check local cache first (fastest)
  if (permissionCache.has(key)) {
    return permissionCache.get(key)!;
  }

  // Check Redis cache second (cross-instance)
  const redisValue = await redisGetCache(key);
  if (redisValue !== null) {
    localSetCache(key, redisValue); // warm local cache
    return redisValue;
  }

  // security_admin = universal access (highest privilege)
  if (role === "security_admin") {
    setCache(key, true);
    return true;
  }

  // admin = universal access except RBAC management
  if (role === "admin" && resource !== "rbac") {
    setCache(key, true);
    return true;
  }

  const result = await pg.query(
    "SELECT 1 FROM app_permissions WHERE role = $1 AND resource = $2 AND action = $3",
    [role, resource, action]
  );
  let allowed = result.rows.length > 0;
  if (!allowed && userId) {
    const groupResult = await pg.query(
      `SELECT 1
       FROM identity_group_memberships gm
       JOIN identity_group_permissions gp ON gp.group_id = gm.group_id
       WHERE gm.user_id = $1 AND gp.resource = $2 AND gp.action = $3
       LIMIT 1`,
      [userId, resource, action]
    );
    allowed = groupResult.rows.length > 0;
  }
  setCache(key, allowed);
  return allowed;
}

export async function resolveUserRole(
  pg: PgClient,
  user: { id?: string; role?: string } | null
): Promise<string | null> {
  if (user?.role) return user.role;
  if (!user?.id) return null;
  const result = await pg.query("SELECT role FROM users WHERE id = $1", [user.id]);
  return (result.rows[0] as { role?: string } | undefined)?.role || null;
}

export function requirePermission(resource: string, action: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user;
    const role = await resolveUserRole(request.server.pg, user);
    if (!role) {
      return reply.status(403).send({ error: "Forbidden: no role assigned" });
    }
    const allowed = await hasPermission(request.server.pg, { role, resource, action, userId: user?.id });
    if (!allowed) {
      return reply.status(403).send({ error: `Forbidden: ${role} cannot ${action} ${resource}` });
    }
  };
}

export function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user;
  if (user?.role !== "admin" && user?.role !== "security_admin") {
    return reply.status(403).send({ error: "Forbidden: admin required" });
  }
}
