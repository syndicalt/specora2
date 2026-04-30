import type {
  FilterOperator,
  TableExportFormat,
  TableFilter,
} from "../tableDefinitions";

export const TABLE_RELATIONSHIP_TYPES = ["PART_OF", "DEPENDS_ON", "HOSTED_ON", "MANAGED_BY", "OWNED_BY", "LOCATED_AT"] as const;
export const TABLE_RELATIONSHIP_PATTERN = TABLE_RELATIONSHIP_TYPES.join("|");
export const RELATIONSHIP_FILTER_FIELDS = new Set(["__relationshipState", "__relationshipType", "__relatedCiId"]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

type NodeLike = {
  properties?: unknown;
};

export type TableRecordLike = Record<string, unknown> & {
  id?: string;
  name?: string | null;
  number?: string | null;
  environment?: string | null;
  attributes?: Record<string, unknown>;
};

type ActorLike = {
  id?: unknown;
  email?: unknown;
  role?: unknown;
} | null | undefined;

export function parseAttributes(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return typeof value === "object" ? value as Record<string, unknown> : {};
}

export function parseNode(node: NodeLike | Record<string, unknown>) {
  const props = typeof node.properties === "object" && node.properties !== null
    ? node.properties as Record<string, unknown>
    : node as Record<string, unknown>;
  return {
    ...props,
    attributes: parseAttributes(props.attributes),
  } as TableRecordLike;
}

export function normalizeEnumValues(value: unknown): string[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function displayName(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function quoteIdentifier(value: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error("Invalid SQL identifier");
  }
  return `"${value.replace(/"/g, "\"\"")}"`;
}

export function postgresAttrType(dataType: string): string {
  if (["integer", "bigint", "numeric", "double precision", "real"].includes(dataType)) return "number";
  if (dataType === "boolean") return "boolean";
  if (dataType.includes("timestamp") || dataType === "date") return "datetime";
  if (dataType === "json" || dataType === "jsonb" || dataType === "ARRAY") return "json";
  return "string";
}

export function serializePostgresValue(value: unknown, attrType?: string): unknown {
  if (value === "" || value === undefined) return null;
  if (attrType === "json") {
    if (typeof value === "string") {
      try {
        return JSON.stringify(JSON.parse(value));
      } catch {
        return value;
      }
    }
    return JSON.stringify(value ?? {});
  }
  if (attrType === "number") {
    const next = Number(value);
    return Number.isFinite(next) ? next : value;
  }
  if (attrType === "boolean") {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
  }
  return value;
}

function isNeo4jPropertyValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (["string", "number", "boolean"].includes(typeof value)) return true;
  return Array.isArray(value) && value.every((item) => item !== null && ["string", "number", "boolean"].includes(typeof item));
}

export function neo4jPropertyProps(attrs: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(attrs).filter(([, value]) => isNeo4jPropertyValue(value)));
}

export function splitAttrs(input: Record<string, unknown> | undefined): Record<string, unknown> {
  return input && typeof input === "object" ? input : {};
}

function escapeProperty(name: string): string {
  return name.replace(/`/g, "``");
}

export function propertyExpression(field: string): string {
  return `n.\`${escapeProperty(field)}\``;
}

export function parseFilters(value: unknown): TableFilter[] {
  if (!value) return [];
  if (Array.isArray(value)) return sanitizeFilters(value);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return sanitizeFilters(parsed);
  } catch {
    return [];
  }
}

function sanitizeFilters(value: unknown[]): TableFilter[] {
  const operators = new Set<FilterOperator>(["contains", "equals", "notEquals", "startsWith", "endsWith", "empty", "notEmpty", "gt", "gte", "lt", "lte"]);
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => item as TableFilter)
    .filter((item) => typeof item.field === "string" && operators.has(item.operator))
    .slice(0, 25);
}

export function sanitizeColumns(columns: unknown, fieldNames: string[]): string[] {
  if (!Array.isArray(columns)) return [];
  const allowed = new Set(fieldNames);
  return Array.from(new Set(columns.filter((column): column is string => typeof column === "string" && allowed.has(column)))).slice(0, 50);
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

export function recordValueForColumn(record: TableRecordLike, column: string): unknown {
  if (column === "id") return record.id;
  if (column === "name") return record.name;
  if (column === "number") return record.number;
  if (column === "environment") return record.environment;
  return (record.attributes || {})[column] ?? record[column];
}

export function recordsToCsv(records: TableRecordLike[], columns: string[]): string {
  const rows = [columns.map(csvCell).join(",")];
  for (const record of records) {
    rows.push(columns.map((column) => csvCell(recordValueForColumn(record, column))).join(","));
  }
  return `${rows.join("\n")}\n`;
}

export function recordsToJson(records: TableRecordLike[], columns: string[]) {
  return JSON.stringify({
    records: records.map((record) => Object.fromEntries(columns.map((column) => [column, recordValueForColumn(record, column)]))),
  }, null, 2);
}

export function normalizeExportFormat(value: unknown): TableExportFormat {
  return value === "json" ? "json" : "csv";
}

export function normalizeDensity(value: unknown) {
  return value === "compact" || value === "spacious" ? value : "comfortable";
}

export function normalizeSortDirection(value: unknown): "asc" | "desc" {
  return value === "desc" ? "desc" : "asc";
}

export function normalizeSeverity(value: unknown): "low" | "medium" | "high" | "critical" {
  return value === "low" || value === "high" || value === "critical" ? value : "medium";
}

export function normalizeCleanupStatus(value: unknown): "open" | "in_progress" | "resolved" | "dismissed" {
  if (value === "in_progress" || value === "resolved" || value === "dismissed") return value;
  return "open";
}

export function timestampString(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function actorKey(user: ActorLike) {
  return user?.id || user?.email || user?.role || "anonymous";
}

export function actorUuid(user: ActorLike) {
  return typeof user?.id === "string" && UUID_PATTERN.test(user.id) ? user.id : null;
}

export function coerceFilterValue(value: unknown, attrType?: string): unknown {
  if (value === undefined || value === null) return null;
  if (attrType === "number") {
    const next = Number(value);
    return Number.isFinite(next) ? next : value;
  }
  if (attrType === "boolean") {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
  }
  return value;
}

export function hasRelationshipFilters(filters: TableFilter[]) {
  return filters.some((filter) => RELATIONSHIP_FILTER_FIELDS.has(filter.field));
}

export function buildRelationshipFilterWhere(filters: TableFilter[], params: Record<string, unknown>): string[] {
  const clauses: string[] = [];
  filters.forEach((filter, index) => {
    if (!RELATIONSHIP_FILTER_FIELDS.has(filter.field) || filter.operator !== "equals") return;
    const value = String(filter.value ?? "").trim();
    if (!value) return;

    if (filter.field === "__relationshipState") {
      if (value === "connected") {
        clauses.push(`EXISTS { MATCH (n)-[:${TABLE_RELATIONSHIP_PATTERN}]-() }`);
      } else if (value === "orphaned") {
        clauses.push(`NOT EXISTS { MATCH (n)-[:${TABLE_RELATIONSHIP_PATTERN}]-() }`);
      }
      return;
    }

    if (filter.field === "__relationshipType") {
      const relationshipType = value.toUpperCase();
      if (!TABLE_RELATIONSHIP_TYPES.includes(relationshipType as typeof TABLE_RELATIONSHIP_TYPES[number])) return;
      const paramName = `relationship_filter_${index}`;
      params[paramName] = relationshipType;
      clauses.push(`EXISTS { MATCH (n)-[r]-() WHERE type(r) = $${paramName} }`);
      return;
    }

    if (filter.field === "__relatedCiId") {
      const paramName = `relationship_filter_${index}`;
      params[paramName] = value;
      clauses.push(`EXISTS { MATCH (n)--(related:ConfigurationItem {id: $${paramName}}) }`);
    }
  });
  return clauses;
}
