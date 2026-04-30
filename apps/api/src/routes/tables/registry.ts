import type { FastifyInstance } from "fastify";
import {
  FOUNDATION_CLASSES,
  POSTGRES_TABLES,
  type TableAction,
  type TableDefinition,
} from "../tableDefinitions";
import { displayName, normalizeEnumValues, postgresAttrType } from "./helpers";

const AUDIT_COLUMNS = new Set(["created_at", "updated_at"]);

type CiClassAttributeRow = {
  name: string;
  displayName: string;
  attrType: string;
  isMandatory: boolean;
  isHealthRequired: boolean;
  isKeyAttribute: boolean;
  enumValues?: unknown;
  referenceClass?: string;
};

type CiClassRow = {
  id: string;
  name: string;
  display_name?: string | null;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  display_field?: string | null;
  secondary_display_fields?: string[] | null;
  attributes?: unknown;
};

type PostgresColumnRow = {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: "YES" | "NO";
  column_default?: string | null;
};

function parseClassAttributes(value: unknown): CiClassAttributeRow[] {
  if (Array.isArray(value)) return value as CiClassAttributeRow[];
  if (typeof value !== "string") return [];
  const parsed = JSON.parse(value || "[]") as unknown;
  return Array.isArray(parsed) ? parsed as CiClassAttributeRow[] : [];
}

export async function getTables(fastify: FastifyInstance): Promise<TableDefinition[]> {
  const [classes, columns] = await Promise.all([
    fastify.pg.query(
    `SELECT c.id, c.name, c.display_name, c.description, c.icon, c.color, c.display_field, c.secondary_display_fields,
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
     GROUP BY c.id, c.name, c.display_name, c.description, c.icon, c.color, c.display_field, c.secondary_display_fields
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

  const cmdbTables: TableDefinition[] = (classes.rows as CiClassRow[]).map((row) => {
    const attrs = parseClassAttributes(row.attributes);
    return {
      id: `cmdb.${row.name}`,
      name: `cmdb.${row.name}`,
      label: row.display_name || row.name,
      provider: "cmdb-class" as const,
      className: row.name,
      displayField: row.display_field || "name",
      secondaryDisplayFields: row.secondary_display_fields || [],
      resource: "tables",
      actions: ["read", "write", "delete"] as TableAction[],
      category: FOUNDATION_CLASSES.has(row.name) ? "foundation" as const : "cmdb" as const,
      attributes: attrs.map((attr) => ({
        ...attr,
        enumValues: normalizeEnumValues(attr.enumValues),
      })),
    };
  });

  const columnsByTable = new Map<string, PostgresColumnRow[]>();
  for (const column of columns.rows as PostgresColumnRow[]) {
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

export async function resolveTable(fastify: FastifyInstance, tableId: string): Promise<TableDefinition | null> {
  const tables = await getTables(fastify);
  return tables.find((table) => table.id === tableId || table.name === tableId) || null;
}
