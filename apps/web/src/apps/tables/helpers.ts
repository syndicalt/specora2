import type {
  AttributeDef,
  DiffRow,
  ReferenceOption,
  TableDef,
  TableFilter,
  TableRecord,
  ValidationIssue,
} from "./types";
import { OPERATORS, RELATIONSHIP_FILTER_KEYS } from "./constants";

export function isValueOperator(operator: TableFilter["operator"]) {
  return OPERATORS.find((item) => item.value === operator)?.needsValue ?? true;
}

export function operatorLabel(operator: TableFilter["operator"]) {
  return OPERATORS.find((item) => item.value === operator)?.label || operator;
}

export function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "-";
  if (Array.isArray(value)) {
    if (value.length === 0) return "-";
    if (value.every((item) => item === null || ["string", "number", "boolean"].includes(typeof item))) {
      return value.map((item) => String(item)).join(", ");
    }
    return `${value.length} item${value.length === 1 ? "" : "s"}`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const healthParts = [
      typeof record.running === "number" ? `${record.running} running` : null,
      typeof record.failed === "number" ? `${record.failed} failed` : null,
      typeof record.total === "number" ? `${record.total} total` : null,
    ].filter(Boolean);
    if (healthParts.length > 0) return healthParts.join(" / ");
    const entries = Object.entries(record);
    if (entries.length === 0) return "-";
    return entries.slice(0, 4).map(([key, item]) => `${key}: ${formatValue(item)}`).join(" / ");
  }
  return String(value);
}

export function formatDateTime(value?: string | null) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
}

export function primitiveCellValue(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function canReadAttr(attr?: AttributeDef) {
  return attr?.canRead !== false;
}

export function canWriteAttr(attr?: AttributeDef) {
  return attr?.canWrite !== false;
}

export function coerceValue(raw: string, attr?: AttributeDef): unknown {
  if (!attr) return raw;
  if (attr.attrType === "json") {
    if (!raw.trim()) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  if (attr.attrType === "number") {
    const value = Number(raw);
    return Number.isFinite(value) ? value : raw;
  }
  if (attr.attrType === "boolean") return raw === "true";
  return raw;
}

function flattenForDiff(value?: Record<string, unknown> | null): Record<string, unknown> {
  if (!value) return {};
  const attrs = value.attributes && typeof value.attributes === "object" ? value.attributes as Record<string, unknown> : {};
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "attributes") continue;
    next[key] = item;
  }
  for (const [key, item] of Object.entries(attrs)) {
    next[`attributes.${key}`] = item;
  }
  return next;
}

export function auditDiffRows(before?: Record<string, unknown> | null, after?: Record<string, unknown> | null): DiffRow[] {
  const oldValues = flattenForDiff(before);
  const newValues = flattenForDiff(after);
  const keys = Array.from(new Set([...Object.keys(oldValues), ...Object.keys(newValues)])).sort();
  return keys
    .filter((key) => JSON.stringify(oldValues[key] ?? null) !== JSON.stringify(newValues[key] ?? null))
    .map((key) => ({ field: key.replace(/^attributes\./, ""), before: oldValues[key], after: newValues[key] }));
}

function isMissing(value: unknown) {
  return value === undefined || value === null || value === "";
}

export function validationIssues(table: TableDef | null, record: TableRecord): ValidationIssue[] {
  if (!table) return [];
  const issues: ValidationIssue[] = [];
  if (isMissing(record.name)) issues.push({ field: "name", label: "Name", severity: "error" });
  for (const attr of table.attributes) {
    if (!canReadAttr(attr)) continue;
    const value = (record.attributes || {})[attr.name] ?? record[attr.name];
    if (attr.isMandatory && isMissing(value)) {
      issues.push({ field: attr.name, label: attr.displayName || attr.name, severity: "error" });
    } else if (attr.isHealthRequired && isMissing(value)) {
      issues.push({ field: attr.name, label: attr.displayName || attr.name, severity: "warn" });
    }
  }
  return issues;
}

export function validationIssuesForForm(table: TableDef, form: Record<string, string>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (isMissing(form.name)) issues.push({ field: "name", label: "Name", severity: "error" });
  for (const attr of table.attributes) {
    if (!canReadAttr(attr)) continue;
    const value = form[attr.name];
    if (attr.isMandatory && isMissing(value)) {
      issues.push({ field: attr.name, label: attr.displayName || attr.name, severity: "error" });
    } else if (attr.isHealthRequired && isMissing(value)) {
      issues.push({ field: attr.name, label: attr.displayName || attr.name, severity: "warn" });
    }
  }
  return issues;
}

export function isRelationshipFilter(key: string) {
  return RELATIONSHIP_FILTER_KEYS.has(key);
}

export function displayRelationshipValue(filter: Pick<TableFilter, "field" | "value">) {
  if (filter.field === "__relationshipState") return filter.value === "connected" ? "Connected" : "Orphaned";
  if (filter.field === "__relationshipType") return String(filter.value || "").replaceAll("_", " ");
  return String(filter.value || "");
}

export function initialForm(table: TableDef, record?: TableRecord): Record<string, string> {
  const next: Record<string, string> = {
    id: record?.id || "",
    name: record?.name || "",
    environment: record?.environment || "",
  };
  for (const attr of table.attributes) {
    const value = (record?.attributes || {})[attr.name] ?? record?.[attr.name] ?? "";
    next[attr.name] = value === undefined || value === null
      ? ""
      : attr.attrType === "json" && typeof value === "object"
        ? JSON.stringify(value, null, 2)
        : String(value);
  }
  return next;
}

function recordDisplayValue(record: TableRecord, field?: string) {
  if (!field) return undefined;
  if (field === "id") return record.id;
  if (field === "name") return record.name;
  if (field === "class") return record.class;
  if (field === "environment") return record.environment;
  return (record.attributes || {})[field] ?? record[field];
}

function firstDisplayValue(record: TableRecord, fields: Array<string | undefined>) {
  for (const field of fields) {
    const value = recordDisplayValue(record, field);
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value);
  }
  return undefined;
}

export function referenceOptionForRecord(table: TableDef | undefined, record: TableRecord): ReferenceOption {
  const attrs = record.attributes || {};
  const keyAttrs = table?.attributes.filter((attr) => attr.isKeyAttribute).map((attr) => attr.name) || [];
  const mandatoryStringAttrs = table?.attributes.filter((attr) => attr.isMandatory && attr.attrType === "string").map((attr) => attr.name) || [];
  const legacyFields = ["code", "departmentCode", "email"];
  const label = firstDisplayValue(record, [table?.displayField, "name", ...keyAttrs, ...mandatoryStringAttrs, ...legacyFields, "id"]) || String(record.id);
  const configuredSecondary = (table?.secondaryDisplayFields || [])
    .map((field) => recordDisplayValue(record, field))
    .filter((item) => item !== undefined && item !== null && String(item).trim() !== "" && String(item) !== label)
    .map((item) => String(item));
  const fallbackSecondary = [attrs.code, attrs.departmentCode, attrs.email, record.environment, record.id]
    .filter((item) => item !== undefined && item !== null && String(item) !== "" && String(item) !== label)
    .map((item) => String(item))[0];
  return {
    id: String(record.id),
    label,
    sublabel: configuredSecondary.length > 0 ? configuredSecondary.join(" | ") : fallbackSecondary,
  };
}

export function referenceClassesForTables(tables: TableDef[]) {
  return Array.from(new Set(tables.flatMap((table) => (
    table.attributes
      .filter((attr) => attr.attrType === "reference" && attr.referenceClass)
      .map((attr) => attr.referenceClass!)
  )))).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
