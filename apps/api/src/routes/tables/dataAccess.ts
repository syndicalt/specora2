import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import type { FieldAccess } from "../../services/fieldRbac";
import { assignRecordNumberToRow } from "../../services/numberSequences";
import type { TableDefinition, TableFilter, TableImportDecision, TableImportMode, TableImportRow } from "../tableDefinitions";
import { attachValidationState, isMissing, redactRecord, sanitizeSortField, writableTableFieldNames } from "./access";
import {
  coerceFilterValue,
  neo4jPropertyProps,
  normalizeSortDirection,
  parseFilters,
  parseNode,
  propertyExpression,
  quoteIdentifier,
  serializePostgresValue,
  splitAttrs,
  timestampString,
} from "./helpers";

export function tableViewRow(row: any) {
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

export function cleanupReviewRow(row: any) {
  return {
    id: row.id,
    tableId: row.table_id,
    tableLabel: row.table_label || row.table_id,
    recordId: row.record_id,
    recordLabel: row.record_label || row.record_id,
    reason: row.reason,
    severity: row.severity,
    status: row.status,
    requestedBy: row.requested_by,
    requesterName: row.requester_name || null,
    requesterEmail: row.requester_email || null,
    createdAt: timestampString(row.created_at),
    updatedAt: timestampString(row.updated_at),
  };
}

export function buildFilterWhere(table: TableDefinition, filters: TableFilter[], params: Record<string, unknown>): string[] {
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

export async function listPostgresRecords(
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
    records: rows.rows.map((row: any) => attachValidationState(table, redactRecord(postgresRecord(table, row), access), access)),
    total: count.rows[0]?.total || 0,
  };
}

export async function getPostgresRecord(fastify: FastifyInstance, table: TableDefinition, id: string, access?: Map<string, FieldAccess>) {
  if (!table.tableName) throw new Error("Missing table name");
  const result = await fastify.pg.query(`SELECT * FROM ${quoteIdentifier(table.tableName)} WHERE id = $1`, [id]);
  const row = result.rows[0];
  if (!row) return null;
  const record = postgresRecord(table, row);
  return access ? redactRecord(record, access) : record;
}

export async function getPostgresRecordsById(fastify: FastifyInstance, table: TableDefinition, ids: string[], access: Map<string, FieldAccess>) {
  if (!table.tableName || !ids.length) return [];
  const result = await fastify.pg.query(
    `SELECT * FROM ${quoteIdentifier(table.tableName)} WHERE id::text = ANY($1) ORDER BY ${quoteIdentifier(table.nameField || "id")} NULLS LAST LIMIT 1000`,
    [ids]
  );
  return result.rows.map((row: any) => redactRecord(postgresRecord(table, row), access));
}

export async function getRecordsByIdForCleanup(fastify: FastifyInstance, table: TableDefinition, ids: string[], access: Map<string, FieldAccess>) {
  if (!ids.length) return [];
  if (table.provider === "postgres-table") {
    return getPostgresRecordsById(fastify, table, ids, access);
  }
  const session = fastify.neo4j.session();
  try {
    const result = await session.run(
      `MATCH (n:ConfigurationItem)
       WHERE n.class = $className AND n.id IN $ids
       RETURN n
       ORDER BY n.name
       LIMIT 250`,
      { className: table.className, ids }
    );
    return result.records.map((record) => redactRecord(parseNode(record.get("n")), access));
  } finally {
    await session.close();
  }
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

export async function createPostgresRecord(
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

export async function createCmdbRecord(
  fastify: FastifyInstance,
  table: TableDefinition,
  body: { name?: string; environment?: string; attributes?: Record<string, unknown> }
) {
  const attrs = splitAttrs(body.attributes);
  const record = {
    id: randomUUID(),
    name: body.name!.trim(),
    className: table.className,
    environment: body.environment || null,
    attributes: JSON.stringify(attrs),
    props: neo4jPropertyProps(attrs),
  };
  const session = fastify.neo4j.session();
  try {
    const result = await session.run(
      `CREATE (n:ConfigurationItem {id: $id, name: $name, class: $className, environment: $environment, attributes: $attributes})
       SET n += $props
       RETURN n`,
      record
    );
    return parseNode(result.records[0].get("n"));
  } finally {
    await session.close();
  }
}

export async function updateCmdbRecord(
  fastify: FastifyInstance,
  table: TableDefinition,
  id: string,
  body: { name?: string; environment?: string; attributes?: Record<string, unknown> }
) {
  const before = await getCmdbRecord(fastify, table, id);
  if (!before) return null;
  const hasAttributes = body.attributes !== undefined;
  const attrs = hasAttributes ? { ...(before.attributes || {}), ...splitAttrs(body.attributes) } : before.attributes || {};
  const session = fastify.neo4j.session();
  try {
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
        props: hasAttributes ? neo4jPropertyProps(attrs) : {},
      }
    );
    const node = result.records[0]?.get("n");
    return node ? parseNode(node) : null;
  } finally {
    await session.close();
  }
}

export async function getCmdbRecord(fastify: FastifyInstance, table: TableDefinition, id: string, access?: Map<string, FieldAccess>) {
  const session = fastify.neo4j.session();
  try {
    const result = await session.run(
      `MATCH (n:ConfigurationItem {id: $id})
       WHERE n.class = $className
       RETURN n`,
      { id, className: table.className }
    );
    const node = result.records[0]?.get("n");
    if (!node) return null;
    const record = parseNode(node);
    return access ? redactRecord(record, access) : record;
  } finally {
    await session.close();
  }
}

function importValueForField(row: TableImportRow, field: string) {
  if (field === "name") return row.name?.trim() || "";
  if (field === "environment") return row.environment?.trim() || "";
  return splitAttrs(row.attributes)[field];
}

export function normalizeImportMode(value: unknown): TableImportMode {
  return value === "update" || value === "upsert" ? value : "create";
}

export function sanitizeMatchKeys(table: TableDefinition, keys: unknown, access: Map<string, FieldAccess>) {
  if (!Array.isArray(keys)) return [];
  const allowed = new Set(writableTableFieldNames(table));
  return Array.from(new Set(keys.filter((key): key is string =>
    typeof key === "string" &&
    key !== "id" &&
    key !== "number" &&
    allowed.has(key) &&
    access.get(key)?.read !== false
  ))).slice(0, 5);
}

async function findImportMatches(
  fastify: FastifyInstance,
  table: TableDefinition,
  row: TableImportRow,
  matchKeys: string[]
) {
  if (!matchKeys.length || matchKeys.some((key) => isMissing(importValueForField(row, key)))) return [];
  if (table.provider === "postgres-table") {
    if (!table.tableName) return [];
    const params = matchKeys.map((key) => serializePostgresValue(importValueForField(row, key), table.attributes.find((attr) => attr.name === key)?.attrType));
    const clauses = matchKeys.map((key, index) => {
      const column = postgresColumnForField(table, key);
      if (!column) throw new Error(`Cannot match on ${key}`);
      return `${quoteIdentifier(column)} = $${index + 1}`;
    });
    const result = await fastify.pg.query(
      `SELECT * FROM ${quoteIdentifier(table.tableName)} WHERE ${clauses.join(" AND ")} LIMIT 3`,
      params
    );
    return result.rows.map((item: any) => postgresRecord(table, item));
  }

  const params: Record<string, unknown> = { className: table.className };
  const clauses = matchKeys.map((key, index) => {
    const param = `match_${index}`;
    params[param] = importValueForField(row, key);
    return `${propertyExpression(key)} = $${param}`;
  });
  const session = fastify.neo4j.session();
  try {
    const result = await session.run(
      `MATCH (n:ConfigurationItem)
       WHERE n.class = $className AND ${clauses.join(" AND ")}
       RETURN n
       LIMIT 3`,
      params
    );
    return result.records.map((record) => parseNode(record.get("n")));
  } finally {
    await session.close();
  }
}

export async function planImportDecisions(
  fastify: FastifyInstance,
  table: TableDefinition,
  rows: TableImportRow[],
  mode: TableImportMode,
  matchKeys: string[]
): Promise<TableImportDecision[]> {
  const decisions: TableImportDecision[] = [];
  for (const [index, payload] of rows.entries()) {
    if (mode === "create") {
      decisions.push({ row: index + 1, action: "create", payload });
      continue;
    }
    const matches = await findImportMatches(fastify, table, payload, matchKeys);
    if (matches.length > 1) {
      decisions.push({ row: index + 1, action: "conflict", reason: `Matched ${matches.length} records`, payload });
    } else if (matches.length === 1) {
      decisions.push({ row: index + 1, action: "update", recordId: matches[0].id, recordName: matches[0].name, payload });
    } else if (mode === "upsert") {
      decisions.push({ row: index + 1, action: "create", reason: "No match found", payload });
    } else {
      decisions.push({ row: index + 1, action: "skip", reason: "No match found", payload });
    }
  }
  return decisions;
}

export async function updatePostgresRecord(
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
