import { hasPermission } from "./rbac";

type PgClient = {
  query: (sql: string, params?: any[]) => Promise<{ rows: any[] }>;
};

type FieldAccessInput = {
  pg: PgClient;
  role: string;
  tableId: string;
  fieldNames: string[];
  writableFieldNames?: string[];
};

export type FieldAccess = {
  field: string;
  resource: string;
  read: boolean;
  write: boolean;
  restricted: boolean;
};

const SENSITIVE_FIELD_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /private[_-]?key/i,
  /credential/i,
  /salary/i,
  /ssn/i,
];

let restrictionCache: { loadedAt: number; resources: Set<string>; fields: Set<string> } | null = null;
const RESTRICTION_CACHE_MS = 30_000;

export function fieldResource(tableId: string, fieldName: string): string {
  return `field:${tableId}.${fieldName}`;
}

function isSensitiveFieldName(fieldName: string): boolean {
  return SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(fieldName));
}

async function getConfiguredRestrictions(pg: PgClient): Promise<{ resources: Set<string>; fields: Set<string> }> {
  if (restrictionCache && Date.now() - restrictionCache.loadedAt < RESTRICTION_CACHE_MS) {
    return restrictionCache;
  }
  const resources = new Set<string>();
  const fields = new Set<string>();
  try {
    const result = await pg.query("SELECT value FROM system_properties WHERE key = 'security.field_restrictions'");
    const raw = result.rows[0]?.value;
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (typeof item === "string") {
          if (item.startsWith("field:")) resources.add(item);
          else fields.add(item);
        } else if (item && typeof item === "object") {
          const resource = typeof item.resource === "string" ? item.resource : null;
          const tableId = typeof item.tableId === "string" ? item.tableId : null;
          const field = typeof item.field === "string" ? item.field : null;
          if (resource) resources.add(resource);
          if (tableId && field) resources.add(fieldResource(tableId, field));
          else if (field) fields.add(field);
        }
      }
    }
  } catch {
    // Field restrictions are optional until an administrator configures them.
  }
  restrictionCache = { loadedAt: Date.now(), resources, fields };
  return restrictionCache;
}

export function clearFieldRestrictionCache(): void {
  restrictionCache = null;
}

export async function resolveFieldAccess({
  pg,
  role,
  tableId,
  fieldNames,
  writableFieldNames = fieldNames,
}: FieldAccessInput): Promise<Map<string, FieldAccess>> {
  const configured = await getConfiguredRestrictions(pg);
  const writable = new Set(writableFieldNames);
  const access = new Map<string, FieldAccess>();

  for (const field of fieldNames) {
    const resource = fieldResource(tableId, field);
    const restricted = configured.resources.has(resource) || configured.fields.has(field) || isSensitiveFieldName(field);
    const read = restricted ? await hasPermission(pg, { role, resource, action: "read" }) : true;
    const write = writable.has(field) && (restricted ? await hasPermission(pg, { role, resource, action: "write" }) : true);
    access.set(field, { field, resource, read, write, restricted });
  }

  return access;
}

export function fieldTargetsForTable(tableId: string, fields: Array<{ name: string; label?: string }>) {
  return fields.flatMap((field) => {
    const resource = fieldResource(tableId, field.name);
    return [
      { resource, action: "read", risk: "medium", label: `${field.label || field.name} read` },
      { resource, action: "write", risk: "high", label: `${field.label || field.name} write` },
    ];
  });
}
