import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import neo4j from "neo4j-driver";
import { hasPermission, resolveUserRole } from "../services/rbac";
import { type FieldAccess, resolveFieldAccess } from "../services/fieldRbac";
import { assignRecordNumberToRow } from "../services/numberSequences";
import { recordAuditEvent } from "../services/auditLog";

type TableAction = "read" | "write" | "delete";
type FilterOperator =
  | "contains"
  | "equals"
  | "notEquals"
  | "startsWith"
  | "endsWith"
  | "empty"
  | "notEmpty"
  | "gt"
  | "gte"
  | "lt"
  | "lte";

type TableFilter = {
  field: string;
  operator: FilterOperator;
  value?: unknown;
};

type TableSavedViewInput = {
  tableId?: string;
  name?: string;
  searchQuery?: string;
  filters?: TableFilter[];
  columns?: string[];
  density?: string;
  sortField?: string;
  sortDirection?: "asc" | "desc";
};

type TableDefinition = {
  id: string;
  name: string;
  label: string;
  provider: "cmdb-class" | "postgres-table";
  className?: string;
  tableName?: string;
  nameField?: string;
  searchableFields?: string[];
  auditFields?: string[];
  hasNumber?: boolean;
  resource: string;
  actions: TableAction[];
  category: "cmdb" | "foundation" | "itsm" | "itam" | "platform";
  attributes: Array<{
    name: string;
    displayName: string;
    attrType: string;
    isMandatory: boolean;
    isHealthRequired: boolean;
    isKeyAttribute: boolean;
    enumValues?: string[];
    referenceClass?: string;
    canRead?: boolean;
    canWrite?: boolean;
    isRestricted?: boolean;
  }>;
};

type PostgresTableRegistration = {
  tableName: string;
  label: string;
  category: "itsm" | "itam" | "platform";
  nameField?: string;
  searchableFields?: string[];
};

const FOUNDATION_CLASSES = new Set([
  "User",
  "Group",
  "Location",
  "Company",
  "BusinessUnit",
  "Department",
  "Contract",
  "CostCenter",
  "BusinessProcess",
  "CMDBGroup",
  "ProductModel",
]);

const POSTGRES_TABLES: PostgresTableRegistration[] = [
  { tableName: "discovery_sources", label: "Discovery Sources", category: "platform", nameField: "name", searchableFields: ["name", "type"] },
  { tableName: "discovery_jobs", label: "Discovery Jobs", category: "platform", searchableFields: ["status", "file_path"] },
  { tableName: "discovery_pipelines", label: "Discovery Pipelines", category: "platform", nameField: "name", searchableFields: ["name", "description"] },
  { tableName: "reconciliation_rules", label: "Reconciliation Rules", category: "platform", nameField: "ci_class", searchableFields: ["ci_class"] },
  { tableName: "reconciliation_logs", label: "Reconciliation Logs", category: "platform", nameField: "ci_id", searchableFields: ["ci_id", "action"] },
  { tableName: "change_requests", label: "Change Requests", category: "itsm", nameField: "title", searchableFields: ["title", "description", "status", "ci_id"] },
  { tableName: "change_request_comments", label: "Change Comments", category: "itsm", nameField: "content", searchableFields: ["content"] },
  { tableName: "change_request_risk_history", label: "Change Risk History", category: "itsm", nameField: "priority", searchableFields: ["priority", "computed_by"] },
  { tableName: "incidents", label: "Incidents", category: "itsm", nameField: "title", searchableFields: ["title", "description", "service", "status", "severity", "ci_id"] },
  { tableName: "incident_events", label: "Incident Events", category: "itsm", nameField: "message", searchableFields: ["type", "message"] },
  { tableName: "incident_actions", label: "Incident Actions", category: "itsm", nameField: "name", searchableFields: ["name", "kind", "status", "risk_level"] },
  { tableName: "incident_postmortems", label: "Incident Postmortems", category: "itsm", nameField: "summary", searchableFields: ["summary", "root_cause", "status"] },
  { tableName: "knowledge_items", label: "Knowledge Items", category: "itsm", nameField: "title", searchableFields: ["title", "summary", "content", "status", "type", "service"] },
  { tableName: "knowledge_links", label: "Knowledge Links", category: "itsm", nameField: "relationship", searchableFields: ["target_type", "target_id", "relationship"] },
  { tableName: "knowledge_feedback", label: "Knowledge Feedback", category: "itsm", nameField: "comment", searchableFields: ["outcome", "comment"] },
  { tableName: "knowledge_gaps", label: "Knowledge Gaps", category: "itsm", nameField: "query", searchableFields: ["query", "status"] },
  { tableName: "knowledge_events", label: "Knowledge Events", category: "itsm", nameField: "message", searchableFields: ["type", "message"] },
  { tableName: "prevention_records", label: "Prevention Records", category: "itsm", nameField: "title", searchableFields: ["title", "description", "status", "category", "service", "ci_id"] },
  { tableName: "prevention_evidence", label: "Prevention Evidence", category: "itsm", nameField: "summary", searchableFields: ["source_type", "source_id", "summary"] },
  { tableName: "prevention_actions", label: "Prevention Actions", category: "itsm", nameField: "title", searchableFields: ["title", "type", "status", "target_app"] },
  { tableName: "prevention_events", label: "Prevention Events", category: "itsm", nameField: "message", searchableFields: ["type", "message"] },
  { tableName: "asset_records", label: "Asset Records", category: "itam", nameField: "name", searchableFields: ["name", "asset_tag", "serial_number", "status", "location", "ci_id"] },
  { tableName: "asset_contracts", label: "Asset Contracts", category: "itam", nameField: "name", searchableFields: ["name", "vendor", "contract_type", "status", "source_ref"] },
  { tableName: "software_entitlements", label: "Software Entitlements", category: "itam", nameField: "product", searchableFields: ["publisher", "product", "sku", "metric", "status"] },
  { tableName: "software_usage", label: "Software Usage", category: "itam", nameField: "product", searchableFields: ["publisher", "product", "normalized_product", "version", "source_ref", "ci_id"] },
  { tableName: "asset_evidence", label: "Asset Evidence", category: "itam", nameField: "evidence_type", searchableFields: ["evidence_type", "source", "source_ref"] },
  { tableName: "asset_scan_events", label: "Asset Scan Events", category: "itam", nameField: "value", searchableFields: ["scan_type", "value", "action", "location", "condition"] },
  { tableName: "asset_reconciliation_runs", label: "Asset Reconciliation Runs", category: "itam", nameField: "summary", searchableFields: ["type", "status", "summary"] },
  { tableName: "asset_exceptions", label: "Asset Exceptions", category: "itam", nameField: "title", searchableFields: ["title", "detail", "type", "severity", "status"] },
  { tableName: "catalog_items", label: "Catalog Items", category: "platform", nameField: "title", searchableFields: ["title", "description", "category", "item_type", "status"] },
  { tableName: "catalog_requests", label: "Catalog Requests", category: "platform", nameField: "title", searchableFields: ["number", "title", "description", "request_type", "status", "source"] },
  { tableName: "catalog_request_events", label: "Catalog Request Events", category: "platform", nameField: "message", searchableFields: ["type", "message"] },
  { tableName: "support_channels", label: "Support Channels", category: "platform", nameField: "name", searchableFields: ["name", "channel_type", "description", "target"] },
  { tableName: "support_handoffs", label: "Support Handoffs", category: "platform", nameField: "reason", searchableFields: ["status", "reason"] },
];

const AUDIT_COLUMNS = new Set(["created_at", "updated_at"]);

function parseAttributes(value: unknown): Record<string, unknown> {
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

function parseNode(node: any) {
  const props = node.properties || node;
  return {
    ...props,
    attributes: parseAttributes(props.attributes),
  };
}

function normalizeEnumValues(value: unknown): string[] | undefined {
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

function displayName(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function quoteIdentifier(value: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error("Invalid SQL identifier");
  }
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function postgresAttrType(dataType: string): string {
  if (["integer", "bigint", "numeric", "double precision", "real"].includes(dataType)) return "number";
  if (dataType === "boolean") return "boolean";
  if (dataType.includes("timestamp") || dataType === "date") return "datetime";
  if (dataType === "json" || dataType === "jsonb" || dataType === "ARRAY") return "json";
  return "string";
}

function serializePostgresValue(value: unknown, attrType?: string): unknown {
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

async function getRole(fastify: FastifyInstance, user: { id?: string; role?: string } | null): Promise<string | null> {
  return resolveUserRole(fastify.pg, user);
}

async function canUseTable(fastify: FastifyInstance, role: string | null, action: TableAction): Promise<boolean> {
  if (!role) return false;
  if (action === "delete") {
    return hasPermission(fastify.pg, { role, resource: "tables", action: "write" });
  }
  return hasPermission(fastify.pg, { role, resource: "tables", action });
}

export async function getTables(fastify: FastifyInstance): Promise<TableDefinition[]> {
  const [classes, columns] = await Promise.all([
    fastify.pg.query(
    `SELECT c.id, c.name, c.display_name, c.description, c.icon, c.color,
            COALESCE(
              json_agg(
                json_build_object(
                  'name', a.name,
                  'displayName', a.display_name,
                  'attrType', a.attr_type,
                  'isMandatory', a.is_mandatory,
                  'isHealthRequired', a.is_health_required,
                  'isKeyAttribute', a.is_key_attribute,
                  'enumValues', a.enum_values,
                  'referenceClass', a.reference_class
                )
                ORDER BY a.sort_order, a.name
              ) FILTER (WHERE a.id IS NOT NULL),
              '[]'
            ) AS attributes
     FROM ci_classes c
     LEFT JOIN ci_class_attributes a ON a.class_id = c.id
     GROUP BY c.id, c.name, c.display_name, c.description, c.icon, c.color
     ORDER BY c.display_name, c.name`
    ),
    fastify.pg.query(
      `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = ANY($1)
       ORDER BY table_name, ordinal_position`,
      [POSTGRES_TABLES.map((table) => table.tableName)]
    ),
  ]);

  const cmdbTables: TableDefinition[] = classes.rows.map((row: any) => {
    const attrs = Array.isArray(row.attributes) ? row.attributes : JSON.parse(row.attributes || "[]");
    return {
      id: `cmdb.${row.name}`,
      name: `cmdb.${row.name}`,
      label: row.display_name || row.name,
      provider: "cmdb-class" as const,
      className: row.name,
      resource: "tables",
      actions: ["read", "write", "delete"] as TableAction[],
      category: FOUNDATION_CLASSES.has(row.name) ? "foundation" as const : "cmdb" as const,
      attributes: attrs.map((attr: any) => ({
        ...attr,
        enumValues: normalizeEnumValues(attr.enumValues),
      })),
    };
  });

  const columnsByTable = new Map<string, any[]>();
  for (const column of columns.rows) {
    if (!columnsByTable.has(column.table_name)) columnsByTable.set(column.table_name, []);
    columnsByTable.get(column.table_name)?.push(column);
  }

  const postgresTables: TableDefinition[] = [];
  for (const registration of POSTGRES_TABLES) {
      const tableColumns = columnsByTable.get(registration.tableName) || [];
      if (!tableColumns.length) continue;
      const hasId = tableColumns.some((column) => column.column_name === "id");
      const hasNumber = tableColumns.some((column) => column.column_name === "number");
      if (!hasId) continue;
      const nameField = registration.nameField && tableColumns.some((column) => column.column_name === registration.nameField)
        ? registration.nameField
        : "id";
      const attrs = tableColumns
        .filter((column) => column.column_name !== "id" && column.column_name !== "number" && column.column_name !== nameField && !AUDIT_COLUMNS.has(column.column_name))
        .map((column) => ({
          name: column.column_name,
          displayName: displayName(column.column_name),
          attrType: postgresAttrType(column.data_type === "USER-DEFINED" ? column.udt_name : column.data_type),
          isMandatory: column.is_nullable === "NO" && column.column_default == null,
          isHealthRequired: false,
          isKeyAttribute: registration.searchableFields?.includes(column.column_name) || false,
        }));
      postgresTables.push({
        id: `pg.${registration.tableName}`,
        name: `pg.${registration.tableName}`,
        label: registration.label,
        provider: "postgres-table" as const,
        tableName: registration.tableName,
        className: registration.tableName,
        nameField,
        hasNumber,
        searchableFields: (registration.searchableFields || [nameField]).filter((field) => tableColumns.some((column) => column.column_name === field)),
        auditFields: tableColumns.filter((column) => AUDIT_COLUMNS.has(column.column_name)).map((column) => column.column_name),
        resource: "tables",
        actions: ["read", "write", "delete"] as TableAction[],
        category: registration.category,
        attributes: attrs,
      });
  }

  return [...cmdbTables, ...postgresTables];
}

async function resolveTable(fastify: FastifyInstance, tableId: string): Promise<TableDefinition | null> {
  const tables = await getTables(fastify);
  return tables.find((table) => table.id === tableId || table.name === tableId) || null;
}

function splitAttrs(input: Record<string, unknown> | undefined): Record<string, unknown> {
  return input && typeof input === "object" ? input : {};
}

function escapeProperty(name: string): string {
  return name.replace(/`/g, "``");
}

function propertyExpression(field: string): string {
  return `n.\`${escapeProperty(field)}\``;
}

function parseFilters(value: unknown): TableFilter[] {
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

function sanitizeColumns(table: TableDefinition, columns: unknown): string[] {
  if (!Array.isArray(columns)) return [];
  const allowed = new Set(tableFieldNames(table));
  return Array.from(new Set(columns.filter((column): column is string => typeof column === "string" && allowed.has(column)))).slice(0, 50);
}

function exportColumns(table: TableDefinition, columns: unknown, access: Map<string, FieldAccess>): string[] {
  const sanitized = sanitizeColumns(table, columns);
  const fallback = tableFieldNames(table).slice(0, 12);
  return (sanitized.length ? sanitized : fallback).filter((column) => access.get(column)?.read !== false);
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function recordValueForColumn(record: any, column: string): unknown {
  if (column === "id") return record.id;
  if (column === "name") return record.name;
  if (column === "number") return record.number;
  if (column === "environment") return record.environment;
  return (record.attributes || {})[column] ?? record[column];
}

function recordsToCsv(records: any[], columns: string[]): string {
  const rows = [columns.map(csvCell).join(",")];
  for (const record of records) {
    rows.push(columns.map((column) => csvCell(recordValueForColumn(record, column))).join(","));
  }
  return `${rows.join("\n")}\n`;
}

function normalizeDensity(value: unknown) {
  return value === "compact" || value === "spacious" ? value : "comfortable";
}

function normalizeSortDirection(value: unknown): "asc" | "desc" {
  return value === "desc" ? "desc" : "asc";
}

function sanitizeSortField(table: TableDefinition, field: unknown, access?: Map<string, FieldAccess>): string {
  const fallback = table.provider === "postgres-table" ? "name" : "name";
  if (typeof field !== "string") return fallback;
  const allowed = new Set(tableFieldNames(table));
  if (!allowed.has(field)) return fallback;
  if (access?.get(field)?.read === false) return fallback;
  return field;
}

function tableViewRow(row: any) {
  return {
    id: row.id,
    tableId: row.table_id,
    name: row.name,
    searchQuery: row.search_query || "",
    filters: Array.isArray(row.filters) ? row.filters : JSON.parse(row.filters || "[]"),
    columns: Array.isArray(row.columns) ? row.columns : JSON.parse(row.columns || "[]"),
    density: row.density || "comfortable",
    sortField: row.sort_field || "name",
    sortDirection: normalizeSortDirection(row.sort_direction),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function actorKey(user: any) {
  return user?.id || user?.email || user?.role || "anonymous";
}

function coerceFilterValue(value: unknown, attrType?: string): unknown {
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

function buildFilterWhere(table: TableDefinition, filters: TableFilter[], params: Record<string, unknown>): string[] {
  const allowed = new Map<string, { attrType?: string }>();
  allowed.set("id", { attrType: "string" });
  allowed.set("name", { attrType: "string" });
  allowed.set("environment", { attrType: "string" });
  for (const attr of table.attributes) {
    allowed.set(attr.name, { attrType: attr.attrType });
  }

  const clauses: string[] = [];
  filters.forEach((filter, index) => {
    const field = allowed.get(filter.field);
    if (!field) return;
    const prop = propertyExpression(filter.field);
    const paramName = `filter_${index}`;
    const value = coerceFilterValue(filter.value, field.attrType);

    switch (filter.operator) {
      case "contains":
        clauses.push(`toLower(toString(${prop})) CONTAINS toLower($${paramName})`);
        params[paramName] = String(value ?? "");
        break;
      case "equals":
        clauses.push(`${prop} = $${paramName}`);
        params[paramName] = value;
        break;
      case "notEquals":
        clauses.push(`(${prop} IS NULL OR ${prop} <> $${paramName})`);
        params[paramName] = value;
        break;
      case "startsWith":
        clauses.push(`toLower(toString(${prop})) STARTS WITH toLower($${paramName})`);
        params[paramName] = String(value ?? "");
        break;
      case "endsWith":
        clauses.push(`toLower(toString(${prop})) ENDS WITH toLower($${paramName})`);
        params[paramName] = String(value ?? "");
        break;
      case "empty":
        clauses.push(`(${prop} IS NULL OR toString(${prop}) = "")`);
        break;
      case "notEmpty":
        clauses.push(`(${prop} IS NOT NULL AND toString(${prop}) <> "")`);
        break;
      case "gt":
        clauses.push(`${prop} > $${paramName}`);
        params[paramName] = value;
        break;
      case "gte":
        clauses.push(`${prop} >= $${paramName}`);
        params[paramName] = value;
        break;
      case "lt":
        clauses.push(`${prop} < $${paramName}`);
        params[paramName] = value;
        break;
      case "lte":
        clauses.push(`${prop} <= $${paramName}`);
        params[paramName] = value;
        break;
      default:
        break;
    }
  });
  return clauses;
}

function postgresColumnForField(table: TableDefinition, field: string): string | null {
  if (field === "id") return "id";
  if (field === "name") return table.nameField || "id";
  if (field === "number" && table.hasNumber) return "number";
  if (table.attributes.some((attr) => attr.name === field)) return field;
  return null;
}

function buildPostgresFilterWhere(table: TableDefinition, filters: TableFilter[], params: unknown[]): string[] {
  const allowed = new Map<string, { column: string; attrType?: string }>();
  allowed.set("id", { column: "id", attrType: "string" });
  if (table.nameField) allowed.set("name", { column: table.nameField, attrType: "string" });
  for (const attr of table.attributes) {
    allowed.set(attr.name, { column: attr.name, attrType: attr.attrType });
  }

  const clauses: string[] = [];
  for (const filter of filters) {
    const field = allowed.get(filter.field);
    if (!field) continue;
    const column = quoteIdentifier(field.column);
    const value = coerceFilterValue(filter.value, field.attrType);
    const addParam = (nextValue: unknown) => {
      params.push(nextValue);
      return `$${params.length}`;
    };

    switch (filter.operator) {
      case "contains":
        clauses.push(`LOWER(${column}::text) LIKE LOWER(${addParam(`%${String(value ?? "")}%`)})`);
        break;
      case "equals":
        clauses.push(`${column} = ${addParam(serializePostgresValue(value, field.attrType))}`);
        break;
      case "notEquals":
        clauses.push(`(${column} IS NULL OR ${column} <> ${addParam(serializePostgresValue(value, field.attrType))})`);
        break;
      case "startsWith":
        clauses.push(`LOWER(${column}::text) LIKE LOWER(${addParam(`${String(value ?? "")}%`)})`);
        break;
      case "endsWith":
        clauses.push(`LOWER(${column}::text) LIKE LOWER(${addParam(`%${String(value ?? "")}`)})`);
        break;
      case "empty":
        clauses.push(`(${column} IS NULL OR ${column}::text = '')`);
        break;
      case "notEmpty":
        clauses.push(`(${column} IS NOT NULL AND ${column}::text <> '')`);
        break;
      case "gt":
        clauses.push(`${column} > ${addParam(serializePostgresValue(value, field.attrType))}`);
        break;
      case "gte":
        clauses.push(`${column} >= ${addParam(serializePostgresValue(value, field.attrType))}`);
        break;
      case "lt":
        clauses.push(`${column} < ${addParam(serializePostgresValue(value, field.attrType))}`);
        break;
      case "lte":
        clauses.push(`${column} <= ${addParam(serializePostgresValue(value, field.attrType))}`);
        break;
      default:
        break;
    }
  }
  return clauses;
}

function postgresRecord(table: TableDefinition, row: Record<string, unknown>) {
  const attributes: Record<string, unknown> = {};
  for (const attr of table.attributes) {
    attributes[attr.name] = row[attr.name];
  }
  const nameField = table.nameField || "id";
  return {
    ...row,
    id: String(row.id),
    name: String(row[nameField] ?? row.id),
    number: row.number ? String(row.number) : null,
    class: table.tableName,
    environment: null,
    attributes,
  };
}

function tableFieldNames(table: TableDefinition): string[] {
  const names = ["id", "name"];
  if (table.hasNumber) names.push("number");
  if (table.provider === "cmdb-class") names.push("environment");
  names.push(...table.attributes.map((attr) => attr.name));
  return Array.from(new Set(names));
}

function writableTableFieldNames(table: TableDefinition): string[] {
  const names = ["name"];
  if (table.provider === "cmdb-class") names.push("environment");
  names.push(...table.attributes.map((attr) => attr.name));
  return Array.from(new Set(names));
}

async function tableWithFieldAccess(
  fastify: FastifyInstance,
  role: string,
  table: TableDefinition
): Promise<{ table: TableDefinition; access: Map<string, FieldAccess> }> {
  const access = await resolveFieldAccess({
    pg: fastify.pg,
    role,
    tableId: table.id,
    fieldNames: tableFieldNames(table),
    writableFieldNames: writableTableFieldNames(table),
  });
  return {
    table: {
      ...table,
      attributes: table.attributes.map((attr) => {
        const field = access.get(attr.name);
        return {
          ...attr,
          canRead: field?.read ?? true,
          canWrite: field?.write ?? true,
          isRestricted: field?.restricted ?? false,
        };
      }),
    },
    access,
  };
}

function assertReadableFilters(filters: TableFilter[], access: Map<string, FieldAccess>) {
  for (const filter of filters) {
    const field = access.get(filter.field);
    if (field && !field.read) {
      return filter.field;
    }
  }
  return null;
}

function redactRecord(record: any, access: Map<string, FieldAccess>) {
  const redactedFields: string[] = [];
  const next = { ...record, attributes: { ...(record.attributes || {}) } };
  for (const [field, fieldAccess] of access) {
    if (fieldAccess.read) continue;
    redactedFields.push(field);
    if (field === "name") next.name = null;
    else if (field === "number") next.number = null;
    else if (field === "environment") next.environment = null;
    else if (field in next.attributes) next.attributes[field] = null;
    else if (field in next) next[field] = null;
  }
  if (redactedFields.length) next._redactedFields = redactedFields;
  return next;
}

function assertWritablePayload(
  body: { name?: string; environment?: string; attributes?: Record<string, unknown> },
  access: Map<string, FieldAccess>
) {
  if (body.name !== undefined && access.get("name")?.write === false) return "name";
  if (body.environment !== undefined && access.get("environment")?.write === false) return "environment";
  const attrs = splitAttrs(body.attributes);
  for (const key of Object.keys(attrs)) {
    if (access.get(key)?.write === false) return key;
  }
  return null;
}

async function listPostgresRecords(
  fastify: FastifyInstance,
  table: TableDefinition,
  query: { limit?: string; offset?: string; q?: string; filters?: string; sortField?: string; sortDirection?: string },
  access: Map<string, FieldAccess>
) {
  if (!table.tableName) throw new Error("Missing table name");
  const tableName = quoteIdentifier(table.tableName);
  const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
  const offset = Math.max(Number(query.offset || 0), 0);
  const params: unknown[] = [];
  const whereParts: string[] = [];
  if (query.q?.trim()) {
    const searchable = table.searchableFields?.length ? table.searchableFields : [table.nameField || "id"];
    const readableSearchable = searchable.filter((field) => access.get(field)?.read !== false);
    if (!readableSearchable.length) return { table, records: [], total: 0 };
    params.push(`%${query.q.trim()}%`);
    whereParts.push(`(${readableSearchable.map((field) => `LOWER(${quoteIdentifier(field)}::text) LIKE LOWER($${params.length})`).join(" OR ")})`);
  }
  whereParts.push(...buildPostgresFilterWhere(table, parseFilters(query.filters), params));
  const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
  const sortField = sanitizeSortField(table, query.sortField, access);
  const orderColumn = quoteIdentifier(postgresColumnForField(table, sortField) || table.nameField || "id");
  const direction = normalizeSortDirection(query.sortDirection).toUpperCase();
  params.push(limit);
  const limitParam = `$${params.length}`;
  params.push(offset);
  const offsetParam = `$${params.length}`;
  const [rows, count] = await Promise.all([
    fastify.pg.query(`SELECT * FROM ${tableName} ${where} ORDER BY ${orderColumn} ${direction} NULLS LAST LIMIT ${limitParam} OFFSET ${offsetParam}`, params),
    fastify.pg.query(`SELECT COUNT(*)::int AS total FROM ${tableName} ${where}`, params.slice(0, params.length - 2)),
  ]);
  return {
    table,
    records: rows.rows.map((row: any) => redactRecord(postgresRecord(table, row), access)),
    total: count.rows[0]?.total || 0,
  };
}

async function getPostgresRecord(fastify: FastifyInstance, table: TableDefinition, id: string, access?: Map<string, FieldAccess>) {
  if (!table.tableName) throw new Error("Missing table name");
  const result = await fastify.pg.query(`SELECT * FROM ${quoteIdentifier(table.tableName)} WHERE id = $1`, [id]);
  const row = result.rows[0];
  if (!row) return null;
  const record = postgresRecord(table, row);
  return access ? redactRecord(record, access) : record;
}

async function getPostgresRecordsById(fastify: FastifyInstance, table: TableDefinition, ids: string[], access: Map<string, FieldAccess>) {
  if (!table.tableName || !ids.length) return [];
  const result = await fastify.pg.query(
    `SELECT * FROM ${quoteIdentifier(table.tableName)} WHERE id::text = ANY($1) ORDER BY ${quoteIdentifier(table.nameField || "id")} NULLS LAST LIMIT 1000`,
    [ids]
  );
  return result.rows.map((row: any) => redactRecord(postgresRecord(table, row), access));
}

function postgresWriteFields(table: TableDefinition, body: { name?: string; attributes?: Record<string, unknown> }) {
  const attrs = splitAttrs(body.attributes);
  const fields: Record<string, unknown> = {};
  const attrTypes = new Map(table.attributes.map((attr) => [attr.name, attr.attrType]));
  if (table.nameField && table.nameField !== "id" && body.name !== undefined) {
    fields[table.nameField] = body.name?.trim() || null;
  }
  for (const attr of table.attributes) {
    if (Object.prototype.hasOwnProperty.call(attrs, attr.name)) {
      fields[attr.name] = serializePostgresValue(attrs[attr.name], attrTypes.get(attr.name));
    }
  }
  return fields;
}

async function createPostgresRecord(
  fastify: FastifyInstance,
  table: TableDefinition,
  body: { id?: string; name?: string; attributes?: Record<string, unknown> }
) {
  if (!table.tableName) throw new Error("Missing table name");
  const fields = postgresWriteFields(table, body);
  const entries = Object.entries(fields);
  if (!entries.length) throw new Error("No fields to insert");
  const columns = entries.map(([field]) => quoteIdentifier(field)).join(", ");
  const placeholders = entries.map((_, index) => `$${index + 1}`).join(", ");
  const values = entries.map(([, value]) => value);
  const result = await fastify.pg.query(
    `INSERT INTO ${quoteIdentifier(table.tableName)} (${columns}) VALUES (${placeholders}) RETURNING *`,
    values
  );
  const row = await assignRecordNumberToRow(fastify, table.tableName, result.rows[0]);
  return postgresRecord(table, row);
}

async function updatePostgresRecord(
  fastify: FastifyInstance,
  table: TableDefinition,
  id: string,
  body: { name?: string; attributes?: Record<string, unknown> }
) {
  if (!table.tableName) throw new Error("Missing table name");
  const fields = postgresWriteFields(table, body);
  if (table.auditFields?.includes("updated_at")) {
    fields.updated_at = new Date().toISOString();
  }
  const entries = Object.entries(fields);
  if (!entries.length) throw new Error("No fields to update");
  const sets = entries.map(([field], index) => `${quoteIdentifier(field)} = $${index + 1}`).join(", ");
  const values = entries.map(([, value]) => value);
  values.push(id);
  const result = await fastify.pg.query(
    `UPDATE ${quoteIdentifier(table.tableName)} SET ${sets} WHERE id = $${values.length} RETURNING *`,
    values
  );
  const row = result.rows[0];
  return row ? postgresRecord(table, row) : null;
}

export async function tableRoutes(fastify: FastifyInstance) {
  fastify.get("/api/tables/views", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, request.user as any);
    if (!(await canUseTable(fastify, role, "read"))) {
      return reply.status(403).send({ error: "Forbidden: cannot read tables" });
    }
    const query = request.query as { tableId?: string };
    const userId = actorKey(request.user);
    const params: unknown[] = [userId];
    let where = "user_id = $1";
    if (query.tableId) {
      params.push(query.tableId);
      where += ` AND table_id = $${params.length}`;
    }
    const result = await fastify.pg.query(
      `SELECT id, user_id, table_id, name, search_query, filters, columns, density, sort_field, sort_direction, created_at, updated_at
       FROM table_saved_views
       WHERE ${where}
       ORDER BY updated_at DESC, name`,
      params
    );
    return { views: result.rows.map(tableViewRow) };
  });

  fastify.post("/api/tables/views", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, request.user as any);
    if (!(await canUseTable(fastify, role, "write"))) {
      return reply.status(403).send({ error: "Forbidden: cannot write table views" });
    }
    const body = request.body as TableSavedViewInput;
    if (!body.tableId || !body.name?.trim()) {
      return reply.status(400).send({ error: "tableId and name required" });
    }
    const table = await resolveTable(fastify, body.tableId);
    if (!table) return reply.status(404).send({ error: "Table not found" });
    const { access } = await tableWithFieldAccess(fastify, role!, table);
    const filters = parseFilters(body.filters);
    const unreadableFilter = assertReadableFilters(filters, access);
    if (unreadableFilter) return reply.status(403).send({ error: `Forbidden: cannot save filter on ${unreadableFilter}` });
    const columns = sanitizeColumns(table, body.columns);
    const sortField = sanitizeSortField(table, body.sortField, access);
    const sortDirection = normalizeSortDirection(body.sortDirection);
    try {
      const result = await fastify.pg.query(
        `INSERT INTO table_saved_views (user_id, table_id, name, search_query, filters, columns, density, sort_field, sort_direction)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (user_id, table_id, name)
         DO UPDATE SET search_query = EXCLUDED.search_query,
                       filters = EXCLUDED.filters,
                       columns = EXCLUDED.columns,
                       density = EXCLUDED.density,
                       sort_field = EXCLUDED.sort_field,
                       sort_direction = EXCLUDED.sort_direction,
                       updated_at = NOW()
         RETURNING id, user_id, table_id, name, search_query, filters, columns, density, sort_field, sort_direction, created_at, updated_at`,
        [
          actorKey(request.user),
          table.id,
          body.name.trim().slice(0, 120),
          body.searchQuery?.trim() || "",
          JSON.stringify(filters),
          JSON.stringify(columns),
          normalizeDensity(body.density),
          sortField,
          sortDirection,
        ]
      );
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "table.view.saved",
        entityType: "TableSavedView",
        entityId: result.rows[0].id,
        newValues: tableViewRow(result.rows[0]),
        metadata: { source: "api.tables", tableId: table.id },
      });
      return { view: tableViewRow(result.rows[0]) };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to save table view" });
    }
  });

  fastify.delete("/api/tables/views/:id", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, request.user as any);
    if (!(await canUseTable(fastify, role, "write"))) {
      return reply.status(403).send({ error: "Forbidden: cannot delete table views" });
    }
    const { id } = request.params as { id: string };
    const result = await fastify.pg.query(
      `DELETE FROM table_saved_views WHERE id = $1 AND user_id = $2
       RETURNING id, table_id, name, search_query, filters, columns, density, sort_field, sort_direction, created_at, updated_at`,
      [id, actorKey(request.user)]
    );
    if (!result.rows.length) return reply.status(404).send({ error: "View not found" });
    await recordAuditEvent(fastify, {
      actorId: (request.user as any)?.id,
      action: "table.view.deleted",
      entityType: "TableSavedView",
      entityId: id,
      oldValues: tableViewRow(result.rows[0]),
      metadata: { source: "api.tables", tableId: result.rows[0].table_id },
    });
    return { ok: true };
  });

  fastify.get("/api/tables", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, request.user as any);
    if (!(await canUseTable(fastify, role, "read"))) {
      return reply.status(403).send({ error: "Forbidden: cannot read tables" });
    }
    const tables = await getTables(fastify);
    const withAccess = await Promise.all(tables.map((table) => tableWithFieldAccess(fastify, role!, table)));
    return { tables: withAccess.map((item) => item.table) };
  });

  fastify.get("/api/tables/:table", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, request.user as any);
    if (!(await canUseTable(fastify, role, "read"))) {
      return reply.status(403).send({ error: "Forbidden: cannot read tables" });
    }
    const { table: tableId } = request.params as { table: string };
    const table = await resolveTable(fastify, tableId);
    if (!table) return reply.status(404).send({ error: "Table not found" });
    const withAccess = await tableWithFieldAccess(fastify, role!, table);
    return { table: withAccess.table };
  });

  fastify.get("/api/tables/:table/records", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, request.user as any);
    if (!(await canUseTable(fastify, role, "read"))) {
      return reply.status(403).send({ error: "Forbidden: cannot read tables" });
    }
    const { table: rawTableId } = request.params as { table: string };
    const tableId = decodeURIComponent(rawTableId);
    const query = request.query as { limit?: string; offset?: string; q?: string; filters?: string; sortField?: string; sortDirection?: string };
    const table = await resolveTable(fastify, tableId);
    if (!table) return reply.status(404).send({ error: "Table not found" });
    const { table: tableForUser, access } = await tableWithFieldAccess(fastify, role!, table);
    const filters = parseFilters(query.filters);
    const unreadableFilter = assertReadableFilters(filters, access);
    if (unreadableFilter) {
      return reply.status(403).send({ error: `Forbidden: cannot filter on ${unreadableFilter}` });
    }
    const safeQuery = { ...query, filters: filters.length ? JSON.stringify(filters) : undefined };
    if (table.provider === "postgres-table") {
      return listPostgresRecords(fastify, tableForUser, safeQuery, access);
    }

    const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
    const offset = Math.max(Number(query.offset || 0), 0);
    const params: Record<string, unknown> = { className: table.className, limit: neo4j.int(limit), offset: neo4j.int(offset) };
    const whereParts = ["n.class = $className"];
    if (query.q?.trim()) {
      const searchFields = [
        access.get("name")?.read !== false ? "toLower(n.name) CONTAINS toLower($q)" : null,
        access.get("id")?.read !== false ? "toLower(n.id) CONTAINS toLower($q)" : null,
        access.get("environment")?.read !== false ? "toLower(coalesce(n.environment, '')) CONTAINS toLower($q)" : null,
      ].filter(Boolean);
      if (searchFields.length) whereParts.push(`(${searchFields.join(" OR ")})`);
      params.q = query.q.trim();
    }
    whereParts.push(...buildFilterWhere(tableForUser, filters, params));
    const where = whereParts.join(" AND ");
    const sortField = sanitizeSortField(tableForUser, query.sortField, access);
    const sortExpression = propertyExpression(sortField);
    const sortDirection = normalizeSortDirection(query.sortDirection) === "desc" ? "DESC" : "ASC";

    const session = fastify.neo4j.session();
    try {
      const result = await session.run(
        `MATCH (n:ConfigurationItem)
         WHERE ${where}
         RETURN n
         ORDER BY ${sortExpression} ${sortDirection}
         SKIP $offset
         LIMIT $limit`,
        params
      );
      const countResult = await session.run(
        `MATCH (n:ConfigurationItem)
         WHERE ${where}
         RETURN count(n) AS total`,
        params
      );
      return {
        table: tableForUser,
        records: result.records.map((record) => redactRecord(parseNode(record.get("n")), access)),
        total: countResult.records[0]?.get("total")?.toNumber?.() ?? Number(countResult.records[0]?.get("total") ?? 0),
      };
    } finally {
      await session.close();
    }
  });

  fastify.get("/api/tables/:table/records/:id", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, request.user as any);
    if (!(await canUseTable(fastify, role, "read"))) {
      return reply.status(403).send({ error: "Forbidden: cannot read tables" });
    }
    const { table: tableId, id } = request.params as { table: string; id: string };
    const table = await resolveTable(fastify, tableId);
    if (!table) return reply.status(404).send({ error: "Table not found" });
    const { table: tableForUser, access } = await tableWithFieldAccess(fastify, role!, table);
    if (table.provider === "postgres-table") {
      const record = await getPostgresRecord(fastify, tableForUser, id, access);
      if (!record) return reply.status(404).send({ error: "Record not found" });
      return { table: tableForUser, record };
    }

    const session = fastify.neo4j.session();
    try {
      const result = await session.run(
        `MATCH (n:ConfigurationItem {id: $id})
         WHERE n.class = $className
         RETURN n`,
        { id, className: table.className }
      );
      const record = result.records[0]?.get("n");
      if (!record) return reply.status(404).send({ error: "Record not found" });
      return { table: tableForUser, record: redactRecord(parseNode(record), access) };
    } finally {
      await session.close();
    }
  });

  fastify.get("/api/tables/:table/records/:id/audit", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, request.user as any);
    if (!(await canUseTable(fastify, role, "read"))) {
      return reply.status(403).send({ error: "Forbidden: cannot read tables" });
    }
    const { table: tableId, id } = request.params as { table: string; id: string };
    const table = await resolveTable(fastify, tableId);
    if (!table) return reply.status(404).send({ error: "Table not found" });
    const result = await fastify.pg.query(
      `SELECT id, actor_id, action, entity_type, entity_id, old_values, new_values, metadata, previous_hash, entry_hash, integrity_version, created_at
       FROM audit_log
       WHERE entity_type = $1 AND entity_id = $2
       ORDER BY created_at DESC
       LIMIT 50`,
      [table.id, id]
    );
    return {
      entries: result.rows.map((row: any) => ({
        id: row.id,
        actorId: row.actor_id,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        oldValues: row.old_values,
        newValues: row.new_values,
        metadata: row.metadata,
        previousHash: row.previous_hash,
        entryHash: row.entry_hash,
        integrityVersion: row.integrity_version,
        createdAt: row.created_at,
      })),
    };
  });

  fastify.post("/api/tables/:table/export", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, request.user as any);
    if (!(await canUseTable(fastify, role, "read"))) {
      return reply.status(403).send({ error: "Forbidden: cannot read tables" });
    }
    const { table: tableId } = request.params as { table: string };
    const body = request.body as { recordIds?: unknown; columns?: unknown };
    const table = await resolveTable(fastify, tableId);
    if (!table) return reply.status(404).send({ error: "Table not found" });
    const { table: tableForUser, access } = await tableWithFieldAccess(fastify, role!, table);
    const recordIds = Array.isArray(body.recordIds)
      ? Array.from(new Set(body.recordIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0).map((id) => id.trim()))).slice(0, 1000)
      : [];
    if (!recordIds.length) return reply.status(400).send({ error: "recordIds required" });
    const columns = exportColumns(tableForUser, body.columns, access);
    if (!columns.length) return reply.status(403).send({ error: "Forbidden: no readable export columns" });

    let records: any[] = [];
    if (table.provider === "postgres-table") {
      records = await getPostgresRecordsById(fastify, tableForUser, recordIds, access);
    } else {
      const session = fastify.neo4j.session();
      try {
        const result = await session.run(
          `MATCH (n:ConfigurationItem)
           WHERE n.class = $className AND n.id IN $ids
           RETURN n
           ORDER BY n.name
           LIMIT 1000`,
          { className: table.className, ids: recordIds }
        );
        records = result.records.map((record) => redactRecord(parseNode(record.get("n")), access));
      } finally {
        await session.close();
      }
    }

    await recordAuditEvent(fastify, {
      actorId: (request.user as any)?.id,
      action: "table.records.exported",
      entityType: table.id,
      entityId: table.id,
      metadata: {
        source: "api.tables",
        provider: table.provider,
        recordCount: records.length,
        requestedRecordCount: recordIds.length,
        columns,
      },
    });

    return reply
      .type("text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${table.id.replace(/[^a-zA-Z0-9_.-]/g, "_")}-records.csv"`)
      .send(recordsToCsv(records, columns));
  });

  fastify.post("/api/tables/:table/records", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, request.user as any);
    if (!(await canUseTable(fastify, role, "write"))) {
      return reply.status(403).send({ error: "Forbidden: cannot write tables" });
    }
    const { table: tableId } = request.params as { table: string };
    const body = request.body as { id?: string; name?: string; environment?: string; attributes?: Record<string, unknown> };
    const table = await resolveTable(fastify, tableId);
    if (!table) return reply.status(404).send({ error: "Table not found" });
    if (!body.name?.trim()) return reply.status(400).send({ error: "name is required" });
    const { table: tableForUser, access } = await tableWithFieldAccess(fastify, role!, table);
    const blockedField = assertWritablePayload(body, access);
    if (blockedField) return reply.status(403).send({ error: `Forbidden: cannot write ${blockedField}` });
    if (table.provider === "postgres-table") {
      const record = await createPostgresRecord(fastify, tableForUser, body);
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "table.record.created",
        entityType: table.id,
        entityId: record.id,
        newValues: record,
        metadata: { source: "api.tables", provider: table.provider, tableName: table.tableName },
      });
      return reply.status(201).send({ table: tableForUser, record: redactRecord(record, access) });
    }

    const attrs = splitAttrs(body.attributes);
    const record = {
      id: body.id || randomUUID(),
      name: body.name.trim(),
      className: table.className,
      environment: body.environment || null,
      attributes: JSON.stringify(attrs),
      props: attrs,
    };
    const session = fastify.neo4j.session();
    try {
      const result = await session.run(
        `CREATE (n:ConfigurationItem {id: $id, name: $name, class: $className, environment: $environment, attributes: $attributes})
         SET n += $props
         RETURN n`,
        record
      );
      const created = parseNode(result.records[0].get("n"));
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "table.record.created",
        entityType: table.id,
        entityId: created.id,
        newValues: created,
        metadata: { source: "api.tables", provider: table.provider, className: table.className },
      });
      return reply.status(201).send({ table: tableForUser, record: redactRecord(created, access) });
    } finally {
      await session.close();
    }
  });

  fastify.patch("/api/tables/:table/records/:id", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, request.user as any);
    if (!(await canUseTable(fastify, role, "write"))) {
      return reply.status(403).send({ error: "Forbidden: cannot write tables" });
    }
    const { table: tableId, id } = request.params as { table: string; id: string };
    const body = request.body as { name?: string; environment?: string; attributes?: Record<string, unknown> };
    const table = await resolveTable(fastify, tableId);
    if (!table) return reply.status(404).send({ error: "Table not found" });
    const { table: tableForUser, access } = await tableWithFieldAccess(fastify, role!, table);
    const blockedField = assertWritablePayload(body, access);
    if (blockedField) return reply.status(403).send({ error: `Forbidden: cannot write ${blockedField}` });
    if (table.provider === "postgres-table") {
      const before = await getPostgresRecord(fastify, table, id);
      const record = await updatePostgresRecord(fastify, tableForUser, id, body);
      if (!record) return reply.status(404).send({ error: "Record not found" });
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "table.record.updated",
        entityType: table.id,
        entityId: id,
        oldValues: before || undefined,
        newValues: record,
        metadata: { source: "api.tables", provider: table.provider, tableName: table.tableName },
      });
      return { table: tableForUser, record: redactRecord(record, access) };
    }

    const session = fastify.neo4j.session();
    try {
      const beforeResult = await session.run(
        `MATCH (n:ConfigurationItem {id: $id})
         WHERE n.class = $className
         RETURN n`,
        { id, className: table.className }
      );
      const beforeNode = beforeResult.records[0]?.get("n");
      if (!beforeNode) return reply.status(404).send({ error: "Record not found" });
      const before = parseNode(beforeNode);
      const hasAttributes = body.attributes !== undefined;
      const attrs = hasAttributes ? { ...(before.attributes || {}), ...splitAttrs(body.attributes) } : before.attributes || {};
      const result = await session.run(
        `MATCH (n:ConfigurationItem {id: $id})
         WHERE n.class = $className
         SET n.name = coalesce($name, n.name),
             n.environment = coalesce($environment, n.environment),
             n.attributes = coalesce($attributes, n.attributes)
         SET n += $props
         RETURN n`,
        {
          id,
          className: table.className,
          name: body.name?.trim() || null,
          environment: body.environment ?? null,
          attributes: hasAttributes ? JSON.stringify(attrs) : null,
          props: hasAttributes ? attrs : {},
        }
      );
      const record = result.records[0]?.get("n");
      const updated = parseNode(record);
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "table.record.updated",
        entityType: table.id,
        entityId: id,
        oldValues: before,
        newValues: updated,
        metadata: { source: "api.tables", provider: table.provider, className: table.className },
      });
      return { table: tableForUser, record: redactRecord(updated, access) };
    } finally {
      await session.close();
    }
  });

  fastify.delete("/api/tables/:table/records/:id", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, request.user as any);
    if (!(await canUseTable(fastify, role, "write"))) {
      return reply.status(403).send({ error: "Forbidden: cannot write tables" });
    }
    const { table: tableId, id } = request.params as { table: string; id: string };
    const table = await resolveTable(fastify, tableId);
    if (!table) return reply.status(404).send({ error: "Table not found" });
    if (table.provider === "postgres-table") {
      const before = await getPostgresRecord(fastify, table, id);
      await fastify.pg.query(`DELETE FROM ${quoteIdentifier(table.tableName!)} WHERE id = $1`, [id]);
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "table.record.deleted",
        entityType: table.id,
        entityId: id,
        oldValues: before || { id },
        metadata: { source: "api.tables", provider: table.provider, tableName: table.tableName },
      });
      return { ok: true };
    }

    const session = fastify.neo4j.session();
    try {
      await session.run(
        `MATCH (n:ConfigurationItem {id: $id})
         WHERE n.class = $className
         DETACH DELETE n`,
        { id, className: table.className }
      );
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "table.record.deleted",
        entityType: table.id,
        entityId: id,
        oldValues: { id, className: table.className },
        metadata: { source: "api.tables", provider: table.provider, className: table.className },
      });
      return { ok: true };
    } finally {
      await session.close();
    }
  });
}
