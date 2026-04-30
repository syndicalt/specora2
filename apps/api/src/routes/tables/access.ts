import type { FastifyInstance } from "fastify";
import { type FieldAccess, resolveFieldAccess } from "../../services/fieldRbac";
import type { TableDefinition, TableFilter } from "../tableDefinitions";
import { RELATIONSHIP_FILTER_FIELDS, sanitizeColumns, splitAttrs } from "./helpers";

export type TableValidationIssue = {
  field: string;
  label: string;
  severity: "error" | "warn";
  reason: "missing_required" | "missing_health_required" | "missing_relationship";
  message: string;
};

export function tableFieldNames(table: TableDefinition): string[] {
  const names = ["id", "name"];
  if (table.hasNumber) names.push("number");
  if (table.provider === "cmdb-class") names.push("environment");
  names.push(...table.attributes.map((attr) => attr.name));
  return Array.from(new Set(names));
}

export function writableTableFieldNames(table: TableDefinition): string[] {
  const names = ["name"];
  if (table.provider === "cmdb-class") names.push("environment");
  names.push(...table.attributes.map((attr) => attr.name));
  return Array.from(new Set(names));
}

export async function tableWithFieldAccess(
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

export function validationSummary(issues: TableValidationIssue[]) {
  return {
    state: issues.some((issue) => issue.severity === "error") ? "invalid" : issues.length ? "warning" : "valid",
    issueCount: issues.length,
    errors: issues.filter((issue) => issue.severity === "error").length,
    warnings: issues.filter((issue) => issue.severity === "warn").length,
  };
}

export function attachValidationState(table: TableDefinition, record: any, access: Map<string, FieldAccess>) {
  const issues = validationIssuesForRecord(table, record, access);
  return {
    ...record,
    _validation: validationSummary(issues),
  };
}

export function exportColumns(table: TableDefinition, columns: unknown, access: Map<string, FieldAccess>): string[] {
  const sanitized = sanitizeColumns(columns, tableFieldNames(table));
  const fallback = tableFieldNames(table).slice(0, 12);
  return (sanitized.length ? sanitized : fallback).filter((column) => access.get(column)?.read !== false);
}

export function cleanupSuggestionForIssue(issue: TableValidationIssue) {
  if (issue.reason === "missing_relationship") {
    return {
      field: issue.field,
      severity: "medium",
      title: "Link relationship evidence",
      recommendation: "Review the CI topology and add the expected upstream, downstream, ownership, or location relationship.",
    };
  }
  if (issue.reason === "missing_health_required") {
    return {
      field: issue.field,
      severity: "medium",
      title: `Populate ${issue.label}`,
      recommendation: `${issue.label} is a health field. Confirm the authoritative value with the service or data owner and update the record.`,
    };
  }
  return {
    field: issue.field,
    severity: "high",
    title: `Fix required ${issue.label}`,
    recommendation: `${issue.label} is required before this record can be treated as stewarded.`,
  };
}

export function sanitizeSortField(table: TableDefinition, field: unknown, access?: Map<string, FieldAccess>): string {
  const fallback = table.provider === "postgres-table" ? "name" : "name";
  if (typeof field !== "string") return fallback;
  const allowed = new Set(tableFieldNames(table));
  if (!allowed.has(field)) return fallback;
  if (access?.get(field)?.read === false) return fallback;
  return field;
}

export function assertReadableFilters(filters: TableFilter[], access: Map<string, FieldAccess>) {
  for (const filter of filters) {
    if (RELATIONSHIP_FILTER_FIELDS.has(filter.field)) continue;
    const field = access.get(filter.field);
    if (field && !field.read) {
      return filter.field;
    }
  }
  return null;
}

export function isMissing(value: unknown) {
  return value === undefined || value === null || value === "";
}

export function validationIssuesForRecord(table: TableDefinition, record: any, access: Map<string, FieldAccess>, relationshipCount?: number): TableValidationIssue[] {
  const issues: TableValidationIssue[] = [];
  if (access.get("name")?.read !== false && isMissing(record.name)) {
    issues.push({
      field: "name",
      label: "Name",
      severity: "error",
      reason: "missing_required",
      message: "Name is required.",
    });
  }
  for (const attr of table.attributes) {
    if (access.get(attr.name)?.read === false) continue;
    const value = (record.attributes || {})[attr.name] ?? record[attr.name];
    if (attr.isMandatory && isMissing(value)) {
      issues.push({
        field: attr.name,
        label: attr.displayName || attr.name,
        severity: "error",
        reason: "missing_required",
        message: `${attr.displayName || attr.name} is required.`,
      });
    } else if (attr.isHealthRequired && isMissing(value)) {
      issues.push({
        field: attr.name,
        label: attr.displayName || attr.name,
        severity: "warn",
        reason: "missing_health_required",
        message: `${attr.displayName || attr.name} is missing.`,
      });
    }
  }
  if (table.provider === "cmdb-class" && relationshipCount === 0) {
    issues.push({
      field: "relationships",
      label: "Relationships",
      severity: "warn",
      reason: "missing_relationship",
      message: "No CMDB relationships are linked to this record.",
    });
  }
  return issues;
}

export function redactRecord(record: any, access: Map<string, FieldAccess>) {
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

export function assertWritablePayload(
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
