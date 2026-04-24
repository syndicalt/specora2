interface PermissionCheck {
  role: string;
  resource: string;
  action: string;
}

const MAX_CACHE_SIZE = 1000;
const permissionCache = new Map<string, boolean>();

function setCache(key: string, value: boolean): void {
  if (permissionCache.size >= MAX_CACHE_SIZE && !permissionCache.has(key)) {
    const firstKey = permissionCache.keys().next().value;
    if (firstKey !== undefined) {
      permissionCache.delete(firstKey);
    }
  }
  permissionCache.set(key, value);
}

export function clearPermissionCache(): void {
  permissionCache.clear();
}

interface PgClient {
  query: (sql: string, params?: any[]) => Promise<{ rows: any[] }>;
}

export async function hasPermission(
  pg: PgClient,
  { role, resource, action }: PermissionCheck
): Promise<boolean> {
  const key = `${role}:${resource}:${action}`;
  if (permissionCache.has(key)) {
    return permissionCache.get(key)!;
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
  const allowed = result.rows.length > 0;
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
  return result.rows[0]?.role || null;
}

export function requirePermission(resource: string, action: string) {
  return async (request: any, reply: any) => {
    const user = request.user as { id?: string; role?: string } | null;
    const role = await resolveUserRole(request.server.pg, user);
    if (!role) {
      return reply.status(403).send({ error: "Forbidden: no role assigned" });
    }
    const allowed = await hasPermission(request.server.pg, { role, resource, action });
    if (!allowed) {
      return reply.status(403).send({ error: `Forbidden: ${role} cannot ${action} ${resource}` });
    }
  };
}

export function requireAdmin(request: any, reply: any) {
  const user = request.user as { role?: string } | null;
  if (user?.role !== "admin" && user?.role !== "security_admin") {
    return reply.status(403).send({ error: "Forbidden: admin required" });
  }
}
