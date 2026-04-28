"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { ShellAPI } from "@/sdk/types";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Columns3,
  Database,
  Download,
  Edit3,
  Filter,
  History,
  Plus,
  RefreshCw,
  Save,
  Search,
  TableProperties,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";

type AttributeDef = {
  name: string;
  displayName: string;
  attrType: string;
  isMandatory: boolean;
  isHealthRequired?: boolean;
  isKeyAttribute: boolean;
  enumValues?: string[];
  referenceClass?: string;
  canRead?: boolean;
  canWrite?: boolean;
  isRestricted?: boolean;
};

type TableDef = {
  id: string;
  label: string;
  provider?: "cmdb-class" | "postgres-table";
  className: string;
  displayField?: string;
  secondaryDisplayFields?: string[];
  category: string;
  hasNumber?: boolean;
  attributes: AttributeDef[];
};

type TableRecord = {
  id: string;
  name: string;
  class: string;
  environment?: string | null;
  attributes?: Record<string, unknown>;
  _validation?: {
    state: "valid" | "warning" | "invalid";
    issueCount: number;
    errors: number;
    warnings: number;
  };
  [key: string]: unknown;
};

type ColumnDef = {
  key: string;
  label: string;
  core: boolean;
  attrType: string;
};

type FilterOperator = "contains" | "equals" | "notEquals" | "startsWith" | "endsWith" | "empty" | "notEmpty" | "gt" | "gte" | "lt" | "lte";

type TableFilter = {
  id: string;
  field: string;
  operator: FilterOperator;
  value: string;
};

type EditorMode = "create" | "edit";
type PendingTableAction = {
  tableId: string;
  recordId?: string;
  mode?: "create" | "edit";
};

type SavedTableView = {
  id: string;
  tableId: string;
  name: string;
  searchQuery: string;
  filters: Array<{ field: string; operator: FilterOperator; value?: unknown }>;
  columns: string[];
  density: "compact" | "comfortable" | "spacious";
  sortField?: string;
  sortDirection?: "asc" | "desc";
};

type AuditEntry = {
  id: string;
  action: string;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  entryHash?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
};

type CleanupReview = {
  id: string;
  tableId: string;
  tableLabel: string;
  recordId: string;
  recordLabel: string;
  reason: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "in_progress" | "resolved" | "dismissed";
  requesterName?: string | null;
  requesterEmail?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type InlineEdit = {
  recordId: string;
  columnKey: string;
  value: string;
};

type DiffRow = {
  field: string;
  before: unknown;
  after: unknown;
};

type ValidationIssue = {
  field: string;
  label: string;
  severity: "error" | "warn";
  message?: string;
  reason?: string;
};
type CleanupSuggestion = {
  recordId: string;
  recordLabel: string;
  severity: "low" | "medium" | "high" | "critical";
  reviewReason: string;
  recommendations: Array<{ title: string; recommendation: string; field: string; severity: string }>;
};

type ImportRow = Record<string, string>;
type ImportPayloadRow = {
  name?: string;
  environment?: string;
  attributes: Record<string, unknown>;
};
type ImportField = {
  key: string;
  label: string;
  attr?: AttributeDef;
};
type ImportMode = "create" | "update" | "upsert";
type ImportDecision = {
  row: number;
  action: "create" | "update" | "skip" | "conflict" | "error";
  recordId?: string;
  recordName?: string | null;
  reason?: string;
};
type ReferenceOption = {
  id: string;
  label: string;
  sublabel?: string;
};

const PAGE_SIZE = 100;
const IMPORT_LIMIT = 250;
const REFERENCE_OPTIONS_LIMIT = 500;
const TABLES_LAUNCH_KEY = "specora_tables_launch";
const SELECT_CLASS = "appearance-none rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 pr-8 text-sm text-gray-100 outline-none [color-scheme:dark] focus:border-indigo-500 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-500";
const INLINE_SELECT_CLASS = "w-full min-w-32 appearance-none rounded border border-indigo-500 bg-gray-950 px-2 py-1 pr-8 text-sm text-gray-100 outline-none [color-scheme:dark] focus:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-50";
const RELATIONSHIP_TYPES = ["PART_OF", "DEPENDS_ON", "HOSTED_ON", "MANAGED_BY", "OWNED_BY", "LOCATED_AT"];
const RELATIONSHIP_FILTERS: ColumnDef[] = [
  { key: "__relationshipState", label: "Relationship State", core: false, attrType: "relationship-state" },
  { key: "__relationshipType", label: "Relationship Type", core: false, attrType: "relationship-type" },
  { key: "__relatedCiId", label: "Related CI ID", core: false, attrType: "string" },
];
const RELATIONSHIP_FILTER_KEYS = new Set(RELATIONSHIP_FILTERS.map((filter) => filter.key));

const OPERATORS: Array<{ value: FilterOperator; label: string; needsValue: boolean }> = [
  { value: "contains", label: "contains", needsValue: true },
  { value: "equals", label: "equals", needsValue: true },
  { value: "notEquals", label: "not equals", needsValue: true },
  { value: "startsWith", label: "starts with", needsValue: true },
  { value: "endsWith", label: "ends with", needsValue: true },
  { value: "empty", label: "is empty", needsValue: false },
  { value: "notEmpty", label: "is not empty", needsValue: false },
  { value: "gt", label: "greater than", needsValue: true },
  { value: "gte", label: "greater/equal", needsValue: true },
  { value: "lt", label: "less than", needsValue: true },
  { value: "lte", label: "less/equal", needsValue: true },
];

function isValueOperator(operator: FilterOperator) {
  return OPERATORS.find((item) => item.value === operator)?.needsValue ?? true;
}

function operatorLabel(operator: FilterOperator) {
  return OPERATORS.find((item) => item.value === operator)?.label || operator;
}

function formatValue(value: unknown): string {
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

function formatDateTime(value?: string | null) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
}

function canReadAttr(attr?: AttributeDef) {
  return attr?.canRead !== false;
}

function canWriteAttr(attr?: AttributeDef) {
  return attr?.canWrite !== false;
}

function coerceValue(raw: string, attr?: AttributeDef): unknown {
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

function auditDiffRows(before?: Record<string, unknown> | null, after?: Record<string, unknown> | null): DiffRow[] {
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

function validationIssues(table: TableDef | null, record: TableRecord): ValidationIssue[] {
  if (!table) return [];
  const issues: ValidationIssue[] = [];
  if (isMissing(record.name)) issues.push({ field: "name", label: "Name", severity: "error" });
  for (const attr of table.attributes) {
    if (!canReadAttr(attr)) continue;
    const value = (record.attributes || {})[attr.name] ?? record[attr.name];
    if (attr.isMandatory && isMissing(value)) {
      issues.push({ field: attr.name, label: attr.displayName || attr.name, severity: "error" });
    } else if ((attr as any).isHealthRequired && isMissing(value)) {
      issues.push({ field: attr.name, label: attr.displayName || attr.name, severity: "warn" });
    }
  }
  return issues;
}

function validationIssuesForForm(table: TableDef, form: Record<string, string>): ValidationIssue[] {
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

function isRelationshipFilter(key: string) {
  return RELATIONSHIP_FILTER_KEYS.has(key);
}

function displayRelationshipValue(filter: Pick<TableFilter, "field" | "value">) {
  if (filter.field === "__relationshipState") return filter.value === "connected" ? "Connected" : "Orphaned";
  if (filter.field === "__relationshipType") return String(filter.value || "").replaceAll("_", " ");
  return String(filter.value || "");
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function initialForm(table: TableDef, record?: TableRecord): Record<string, string> {
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

function referenceOptionForRecord(table: TableDef | undefined, record: TableRecord): ReferenceOption {
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

function referenceClassesForTables(tables: TableDef[]) {
  return Array.from(new Set(tables.flatMap((table) => (
    table.attributes
      .filter((attr) => attr.attrType === "reference" && attr.referenceClass)
      .map((attr) => attr.referenceClass!)
  )))).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function normalizeImportKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function primitiveCellValue(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function parseCsv(text: string): ImportRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === "\"" && next === "\"") {
        cell += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  row.push(cell);
  rows.push(row);
  const headers = (rows.shift() || []).map((header) => header.trim()).filter(Boolean);
  return rows
    .filter((items) => items.some((item) => item.trim() !== ""))
    .map((items) => Object.fromEntries(headers.map((header, index) => [header, items[index]?.trim() || ""])));
}

function parseJsonImport(text: string): ImportRow[] {
  const parsed = JSON.parse(text);
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.records) ? parsed.records : Array.isArray(parsed?.rows) ? parsed.rows : [];
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => row && typeof row === "object")
    .map((row) => Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) => [key, primitiveCellValue(value)])));
}

function columnIndexFromRef(ref: string) {
  const letters = ref.replace(/[^A-Z]/gi, "").toUpperCase();
  let index = 0;
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
  return Math.max(index - 1, 0);
}

async function inflateRaw(data: Uint8Array) {
  const Decompression = (globalThis as any).DecompressionStream;
  if (!Decompression) throw new Error("XLSX parsing requires a browser with decompression support.");
  const input = new Uint8Array(data.byteLength);
  input.set(data);
  const stream = new Blob([input.buffer]).stream().pipeThrough(new Decompression("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzipEntries(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("Invalid XLSX file.");
  let offset = view.getUint32(eocd + 16, true);
  const entries = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  while (offset + 46 <= bytes.length && view.getUint32(offset, true) === 0x02014b50) {
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.slice(dataStart, dataStart + compressedSize);
    entries.set(name, method === 0 ? data : method === 8 ? await inflateRaw(data) : new Uint8Array());
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function parseXlsxImport(file: File): Promise<ImportRow[]> {
  const entries = await unzipEntries(await file.arrayBuffer());
  const decoder = new TextDecoder();
  const xml = (path: string) => entries.has(path) ? new DOMParser().parseFromString(decoder.decode(entries.get(path)), "application/xml") : null;
  const sharedDoc = xml("xl/sharedStrings.xml");
  const sharedStrings = sharedDoc ? Array.from(sharedDoc.getElementsByTagName("si")).map((item) => Array.from(item.getElementsByTagName("t")).map((part) => part.textContent || "").join("")) : [];
  const sheetPath = entries.has("xl/worksheets/sheet1.xml") ? "xl/worksheets/sheet1.xml" : Array.from(entries.keys()).find((key) => key.startsWith("xl/worksheets/") && key.endsWith(".xml"));
  if (!sheetPath) throw new Error("No worksheet found in XLSX file.");
  const sheet = xml(sheetPath);
  if (!sheet) return [];
  const matrix: string[][] = [];
  for (const row of Array.from(sheet.getElementsByTagName("row"))) {
    const values: string[] = [];
    for (const cell of Array.from(row.getElementsByTagName("c"))) {
      const ref = cell.getAttribute("r") || "";
      const type = cell.getAttribute("t");
      const valueNode = cell.getElementsByTagName("v")[0];
      const inlineNode = cell.getElementsByTagName("t")[0];
      const raw = valueNode?.textContent || inlineNode?.textContent || "";
      values[columnIndexFromRef(ref)] = type === "s" ? sharedStrings[Number(raw)] || "" : raw;
    }
    if (values.some((value) => value)) matrix.push(values);
  }
  const headers = (matrix.shift() || []).map((header) => String(header || "").trim()).filter(Boolean);
  return matrix.map((items) => Object.fromEntries(headers.map((header, index) => [header, primitiveCellValue(items[index])])));
}

async function parseImportFile(file: File) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".json")) return parseJsonImport(await file.text());
  if (name.endsWith(".xlsx")) return parseXlsxImport(file);
  return parseCsv(await file.text());
}

export default function TablesApp({ shell }: { shell: ShellAPI }) {
  const [mode, setMode] = useState<"records" | "stewardship">("records");
  const [tables, setTables] = useState<TableDef[]>([]);
  const [selected, setSelected] = useState<TableDef | null>(null);
  const [tableSearch, setTableSearch] = useState("");
  const [records, setRecords] = useState<TableRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<TableFilter[]>([]);
  const [loading, setLoading] = useState(true);
  const [recordLoading, setRecordLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [exportMenuOpen, setExportMenuOpen] = useState<"loaded" | "selected" | null>(null);
  const [selectedColumns, setSelectedColumns] = useState<Record<string, string[]>>({});
  const [savedViews, setSavedViews] = useState<SavedTableView[]>([]);
  const [density, setDensity] = useState<"compact" | "comfortable" | "spacious">("comfortable");
  const [sortField, setSortField] = useState("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [pendingTableAction, setPendingTableAction] = useState<PendingTableAction | null>(null);
  const [editor, setEditor] = useState<{ mode: EditorMode; record?: TableRecord; form: Record<string, string> } | null>(null);
  const [saving, setSaving] = useState(false);
  const [inlineEdit, setInlineEdit] = useState<InlineEdit | null>(null);
  const [inlineSaving, setInlineSaving] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkEditorOpen, setBulkEditorOpen] = useState(false);
  const [bulkField, setBulkField] = useState("environment");
  const [bulkValue, setBulkValue] = useState("");
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupReason, setCleanupReason] = useState("Missing required stewardship data");
  const [cleanupSeverity, setCleanupSeverity] = useState<"low" | "medium" | "high" | "critical">("medium");
  const [cleanupSuggestions, setCleanupSuggestions] = useState<CleanupSuggestion[]>([]);
  const [cleanupReviews, setCleanupReviews] = useState<CleanupReview[]>([]);
  const [cleanupStatus, setCleanupStatus] = useState<"open" | "in_progress" | "resolved" | "dismissed" | "all">("open");
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [issuePopover, setIssuePopover] = useState<string | null>(null);
  const [serverValidationIssues, setServerValidationIssues] = useState<ValidationIssue[] | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [importMapping, setImportMapping] = useState<Record<string, string>>({});
  const [importFileName, setImportFileName] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>("create");
  const [importMatchKeys, setImportMatchKeys] = useState<string[]>(["name"]);
  const [importDecisions, setImportDecisions] = useState<ImportDecision[]>([]);
  const [environments, setEnvironments] = useState<string[]>([]);
  const [referenceOptions, setReferenceOptions] = useState<Record<string, ReferenceOption[]>>({});
  const handledLaunchRef = useRef<string | null>(null);

  const availableColumns = useMemo<ColumnDef[]>(() => {
    const attrs = selected?.attributes || [];
    return [
      { key: "name", label: "Name", core: true, attrType: "string" },
      ...(selected?.hasNumber ? [{ key: "number", label: "Number", core: true, attrType: "string" }] : []),
      { key: "id", label: "ID", core: true, attrType: "string" },
      { key: "environment", label: "Environment", core: true, attrType: "string" },
      ...attrs.map((attr) => ({ key: attr.name, label: attr.displayName || attr.name, core: false, attrType: attr.attrType })),
    ];
  }, [selected]);

  const visibleColumns = useMemo(() => {
    if (!selected) return [];
    const explicit = selectedColumns[selected.id];
    if (explicit) return availableColumns.filter((column) => explicit.includes(column.key));
    const attrs = selected.attributes || [];
    const keyAttrs = attrs.filter((attr) => attr.isMandatory || attr.isKeyAttribute);
    const defaultAttrKeys = (keyAttrs.length > 0 ? keyAttrs.slice(0, 5) : attrs.slice(0, 5)).map((attr) => attr.name);
    return availableColumns.filter((column) => column.core || defaultAttrKeys.includes(column.key));
  }, [availableColumns, selected, selectedColumns]);

  const filterColumns = useMemo(() => {
    const readable = availableColumns.filter((column) => canReadColumn(column.key));
    return selected?.provider === "cmdb-class" ? [...readable, ...RELATIONSHIP_FILTERS] : readable;
  }, [availableColumns, selected]);

  const filterPayload = useMemo(() => {
    return filters
      .filter((item) => item.field && item.operator && (!isValueOperator(item.operator) || item.value.trim() !== ""))
      .map((item) => ({ field: item.field, operator: item.operator, value: item.value }));
  }, [filters]);

  const selectedRecordIds = useMemo(() => records.filter((record) => selectedRows[record.id]).map((record) => record.id), [records, selectedRows]);
  const allLoadedSelected = records.length > 0 && selectedRecordIds.length === records.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const stewardshipStats = useMemo(() => {
    const issueCounts = records.map((record) => record._validation?.issueCount ?? validationIssues(selected, record).length);
    const needsReview = issueCounts.filter((count) => count > 0).length;
    const requiredAttrs = selected?.attributes.filter((attr) => attr.isMandatory || attr.isHealthRequired).length || 0;
    return { needsReview, clean: records.length - needsReview, requiredAttrs };
  }, [records, selected]);
  const writableBulkColumns = useMemo(() => availableColumns.filter((column) => column.key !== "name" && (!column.core || column.key === "environment")).filter((column) => canWriteColumn(column.key)), [availableColumns, selected]);
  const importFields = useMemo<ImportField[]>(() => {
    if (!selected) return [];
    return [
      { key: "name", label: "Name" },
      ...(selected.provider === "cmdb-class" ? [{ key: "environment", label: "Environment" }] : []),
      ...selected.attributes.filter((attr) => canWriteAttr(attr)).map((attr) => ({ key: attr.name, label: attr.displayName || attr.name, attr })),
    ];
  }, [selected]);
  const importPreview = useMemo(() => importRows.map((row) => importPayloadForRow(row)).slice(0, 10), [importRows, importMapping, selected]);
  const importReadyCount = useMemo(() => importRows.map((row) => importPayloadForRow(row)).filter((row) => row.name?.trim()).length, [importRows, importMapping, selected]);
  const importDecisionCounts = useMemo(() => importDecisions.reduce((acc, decision) => {
    acc[decision.action] = (acc[decision.action] || 0) + 1;
    return acc;
  }, {} as Record<ImportDecision["action"], number>), [importDecisions]);
  const filteredTables = useMemo(() => {
    const needle = tableSearch.trim().toLowerCase();
    return [...tables]
      .sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id, undefined, { sensitivity: "base" }))
      .filter((table) => {
        if (!needle) return true;
        return [table.label, table.id, table.className, table.category].some((value) => String(value || "").toLowerCase().includes(needle));
      });
  }, [tableSearch, tables]);

  function tableAttr(key: string) {
    return selected?.attributes.find((attr) => attr.name === key);
  }

  function canReadColumn(key: string) {
    const attr = tableAttr(key);
    return attr ? canReadAttr(attr) : true;
  }

  function canWriteColumn(key: string) {
    if (key === "id" || key === "number") return false;
    if (key === "name" || key === "environment") return true;
    return canWriteAttr(tableAttr(key));
  }

  function selectTable(table: TableDef) {
    setSelected(table);
    setQuery("");
    setFilters([]);
    setSortField("name");
    setSortDirection("asc");
    setPage(0);
    setAuditEntries([]);
    setPickerOpen(false);
    setExportMenuOpen(null);
    setEditor(null);
    setInlineEdit(null);
    setSelectedRows({});
    setBulkEditorOpen(false);
    setCleanupOpen(false);
    setCleanupSuggestions([]);
    setImportOpen(false);
    resetImport();
    setServerValidationIssues(null);
  }

  function toggleColumn(key: string) {
    if (!selected) return;
    setSelectedColumns((prev) => {
      const current = prev[selected.id] || visibleColumns.map((column) => column.key);
      const next = current.includes(key) ? current.filter((column) => column !== key) : [...current, key];
      return { ...prev, [selected.id]: next.length > 0 ? next : current };
    });
  }

  async function loadTables() {
    setLoading(true);
    try {
      const res = await shell.fetch("/api/tables");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to fetch tables");
      }
      const data = await res.json();
      const nextTables = data.tables || [];
      setTables(nextTables);
      await loadReferenceOptions(nextTables);
    } catch (err: any) {
      shell.notify(err.message || "Failed to fetch tables", "error");
    } finally {
      setLoading(false);
    }
  }

  async function loadRecords(table = selected, pageOverride = page) {
    if (!table) return;
    setRecordLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(pageOverride * PAGE_SIZE), sortField, sortDirection });
      if (query.trim()) params.set("q", query.trim());
      if (filterPayload.length > 0) params.set("filters", JSON.stringify(filterPayload));
      const res = await shell.fetch(`/api/tables/${encodeURIComponent(table.id)}/records?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to fetch records");
      }
      const data = await res.json();
      setRecords(data.records || []);
      setTotal(data.total || 0);
      setSelectedRows({});
    } catch (err: any) {
      shell.notify(err.message || "Failed to fetch table records", "error");
    } finally {
      setRecordLoading(false);
    }
  }

  async function loadSavedViews(table = selected) {
    if (!table) return;
    try {
      const res = await shell.fetch(`/api/tables/views?tableId=${encodeURIComponent(table.id)}`);
      if (!res.ok) return;
      const data = await res.json();
      setSavedViews(data.views || []);
    } catch {
      setSavedViews([]);
    }
  }

  async function loadCleanupReviews(status = cleanupStatus) {
    setCleanupLoading(true);
    try {
      const params = new URLSearchParams({ status, limit: "100" });
      const res = await shell.fetch(`/api/tables/cleanup-reviews?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to fetch cleanup reviews");
      }
      const data = await res.json();
      setCleanupReviews(data.reviews || []);
    } catch (err: any) {
      shell.notify(err.message || "Failed to fetch cleanup reviews", "error");
    } finally {
      setCleanupLoading(false);
    }
  }

  async function loadEditorOptions() {
    try {
      const envData = await shell.query(`query { ciEnvironments }`);
      setEnvironments((envData.ciEnvironments || []) as string[]);
    } catch {
      setEnvironments([]);
    }
  }

  async function loadReferenceOptions(nextTables = tables) {
    const classes = referenceClassesForTables(nextTables);
    if (classes.length === 0) {
      setReferenceOptions({});
      return;
    }
    const entries = await Promise.all(classes.map(async (className) => {
      try {
        const refTable = nextTables.find((table) => table.provider === "cmdb-class" && table.className === className);
        const params = new URLSearchParams({
          limit: String(REFERENCE_OPTIONS_LIMIT),
          offset: "0",
          sortField: "name",
          sortDirection: "asc",
        });
        const res = await shell.fetch(`/api/tables/${encodeURIComponent(`cmdb.${className}`)}/records?${params.toString()}`);
        if (!res.ok) return [className, []] as const;
        const data = await res.json();
        const records = Array.isArray(data.records) ? data.records as TableRecord[] : [];
        return [className, records.map((record) => referenceOptionForRecord(refTable, record))] as const;
      } catch {
        return [className, []] as const;
      }
    }));
    setReferenceOptions(Object.fromEntries(entries));
  }

  async function saveCurrentView() {
    if (!selected) return;
    const name = window.prompt("View name", `${selected.label} view`);
    if (!name?.trim()) return;
    try {
      const columns = (selectedColumns[selected.id] || visibleColumns.map((column) => column.key)).filter(Boolean);
      const res = await shell.fetch("/api/tables/views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableId: selected.id,
          name: name.trim(),
          searchQuery: query,
          filters: filterPayload,
          columns,
          density,
          sortField,
          sortDirection,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to save view");
      }
      shell.notify("View saved", "success");
      await loadSavedViews(selected);
    } catch (err: any) {
      shell.notify(err.message || "Failed to save view", "error");
    }
  }

  function applySavedView(view: SavedTableView) {
    if (!selected) return;
    setQuery(view.searchQuery || "");
    setFilters((view.filters || []).map((filter) => ({
      id: crypto.randomUUID(),
      field: filter.field,
      operator: filter.operator,
      value: filter.value === undefined || filter.value === null ? "" : String(filter.value),
    })));
    setSelectedColumns((current) => ({ ...current, [selected.id]: view.columns || [] }));
    setDensity(view.density || "comfortable");
    setSortField(view.sortField || "name");
    setSortDirection(view.sortDirection || "asc");
    setPage(0);
  }

  async function deleteSavedView(view: SavedTableView) {
    try {
      const res = await shell.fetch(`/api/tables/views/${encodeURIComponent(view.id)}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to delete view");
      }
      setSavedViews((current) => current.filter((item) => item.id !== view.id));
      shell.notify("View deleted", "success");
    } catch (err: any) {
      shell.notify(err.message || "Failed to delete view", "error");
    }
  }

  async function loadAudit(table: TableDef, recordId: string) {
    try {
      const res = await shell.fetch(`/api/tables/${encodeURIComponent(table.id)}/records/${encodeURIComponent(recordId)}/audit`);
      if (!res.ok) {
        setAuditEntries([]);
        return;
      }
      const data = await res.json();
      setAuditEntries(data.entries || []);
    } catch {
      setAuditEntries([]);
    }
  }

  async function loadValidation(table: TableDef, recordId: string) {
    try {
      const res = await shell.fetch(`/api/tables/${encodeURIComponent(table.id)}/records/${encodeURIComponent(recordId)}/validation`);
      if (!res.ok) {
        setServerValidationIssues(null);
        return;
      }
      const data = await res.json();
      setServerValidationIssues(data.issues || []);
    } catch {
      setServerValidationIssues(null);
    }
  }

  function cellValue(record: TableRecord, key: string) {
    if (key === "name") return record.name;
    if (key === "number") return record.number || "-";
    if (key === "id") return record.id;
    if (key === "environment") return record.environment || "-";
    const attr = tableAttr(key);
    if (attr && !canReadAttr(attr)) return "Restricted";
    return formatValue((record.attributes || {})[key] ?? record[key]);
  }

  function rawCellValue(record: TableRecord, key: string) {
    if (key === "name") return record.name || "";
    if (key === "environment") return record.environment || "";
    const attr = tableAttr(key);
    if (attr && !canReadAttr(attr)) return "";
    const value = (record.attributes || {})[key] ?? record[key] ?? "";
    if (value === null || value === undefined) return "";
    return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
  }

  function addFilter() {
    setFilters((prev) => [...prev, { id: crypto.randomUUID(), field: filterColumns[0]?.key || "name", operator: "contains", value: "" }]);
    setFiltersOpen(true);
  }

  function updateFilter(id: string, patch: Partial<TableFilter>) {
    setFilters((prev) => prev.map((item) => {
      if (item.id !== id) return item;
      const next = { ...item, ...patch };
      if (patch.field && isRelationshipFilter(patch.field)) {
        next.operator = "equals";
        next.value = patch.field === "__relationshipState" ? "orphaned" : "";
      }
      return next;
    }));
  }

  function filterChipLabel(filter: Pick<TableFilter, "field" | "operator" | "value">) {
    const fieldLabel = filterColumns.find((column) => column.key === filter.field)?.label || tableAttr(filter.field)?.displayName || filter.field;
    if (!isValueOperator(filter.operator)) return `${fieldLabel} ${operatorLabel(filter.operator)}`;
    const value = isRelationshipFilter(filter.field) ? displayRelationshipValue(filter) : String(filter.value || "");
    return `${fieldLabel} ${operatorLabel(filter.operator)} ${value || "..."}`;
  }

  function removeFilter(id: string) {
    setFilters((prev) => prev.filter((item) => item.id !== id));
  }

  function applySearchAndFilters() {
    setPage(0);
    setSelectedRows({});
    loadRecords(selected, 0);
  }

  function toggleSort(key: string) {
    if (!canReadColumn(key)) return;
    setPage(0);
    setSelectedRows({});
    if (sortField === key) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortField(key);
    setSortDirection("asc");
  }

  function openCreate() {
    if (!selected) return;
    setServerValidationIssues(null);
    setEditor({ mode: "create", form: initialForm(selected) });
  }

  function openEdit(record: TableRecord) {
    if (!selected) return;
    setServerValidationIssues(null);
    setEditor({ mode: "edit", record, form: initialForm(selected, record) });
    loadAudit(selected, record.id);
    loadValidation(selected, record.id);
  }

  async function openRecordEditor(table: TableDef, recordId: string) {
    setRecordLoading(true);
    try {
      const res = await shell.fetch(`/api/tables/${encodeURIComponent(table.id)}/records/${encodeURIComponent(recordId)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to fetch record");
      }
      const data = await res.json();
      const record = data.record as TableRecord;
      setSelected(table);
      setServerValidationIssues(null);
      setEditor({ mode: "edit", record, form: initialForm(table, record) });
      await loadAudit(table, record.id);
      await loadValidation(table, record.id);
    } catch (err: any) {
      shell.notify(err.message || "Failed to open record editor", "error");
    } finally {
      setRecordLoading(false);
    }
  }

  function handleTableAction(action: { type?: string; tableId?: string; recordId?: string; mode?: "create" | "edit" }) {
    if (action.type !== "SELECT_TABLE" && action.type !== "OPEN_TABLE_RECORD") return;
    const tableId = action.tableId;
    const recordId = action.recordId;
    const table = tables.find((item) => item.id === tableId || item.className === tableId);
    if (!table) {
      setPendingTableAction(tableId ? { tableId, recordId, mode: action.mode } : null);
      return;
    }
    setPendingTableAction(null);
    if (action.mode === "create") {
      selectTable(table);
      setServerValidationIssues(null);
      setEditor({ mode: "create", form: initialForm(table) });
    } else if (action.type === "OPEN_TABLE_RECORD" && recordId) {
      openRecordEditor(table, recordId);
    } else {
      selectTable(table);
    }
  }

  function updateForm(key: string, value: string) {
    setEditor((current) => current ? { ...current, form: { ...current.form, [key]: value } } : current);
  }

  async function saveRecord() {
    if (!selected || !editor) return;
    if (!editor.form.name.trim()) {
      shell.notify("Name is required", "error");
      return;
    }
    setSaving(true);
    try {
      const attributes: Record<string, unknown> = {};
      for (const attr of selected.attributes) {
        if (!canWriteAttr(attr)) continue;
        attributes[attr.name] = coerceValue(editor.form[attr.name] || "", attr);
      }
      const payload = {
        name: editor.form.name.trim(),
        environment: editor.form.environment.trim() || undefined,
        attributes,
      };
      const path = editor.mode === "create"
        ? `/api/tables/${encodeURIComponent(selected.id)}/records`
        : `/api/tables/${encodeURIComponent(selected.id)}/records/${encodeURIComponent(editor.record!.id)}`;
      const res = await shell.fetch(path, {
        method: editor.mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to save record");
      }
      shell.notify(editor.mode === "create" ? "Record created" : "Record updated", "success");
      setEditor(null);
      await loadRecords();
      await loadReferenceOptions(tables);
    } catch (err: any) {
      shell.notify(err.message || "Failed to save record", "error");
    } finally {
      setSaving(false);
    }
  }

  function startInlineEdit(record: TableRecord, columnKey: string) {
    if (!canWriteColumn(columnKey)) return;
    setInlineEdit({ recordId: record.id, columnKey, value: rawCellValue(record, columnKey) });
  }

  async function commitInlineEdit() {
    if (!selected || !inlineEdit) return;
    const record = records.find((item) => item.id === inlineEdit.recordId);
    if (!record) return;
    const current = rawCellValue(record, inlineEdit.columnKey);
    if (current === inlineEdit.value) {
      setInlineEdit(null);
      return;
    }
    if (inlineEdit.columnKey === "name" && !inlineEdit.value.trim()) {
      shell.notify("Name is required", "error");
      return;
    }
    const attr = tableAttr(inlineEdit.columnKey);
    const payload = inlineEdit.columnKey === "name"
      ? { name: inlineEdit.value.trim() }
      : inlineEdit.columnKey === "environment"
        ? { environment: inlineEdit.value.trim() || undefined }
        : { attributes: { [inlineEdit.columnKey]: coerceValue(inlineEdit.value, attr) } };
    setInlineSaving(true);
    try {
      const res = await shell.fetch(`/api/tables/${encodeURIComponent(selected.id)}/records/${encodeURIComponent(record.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to update cell");
      }
      const data = await res.json();
      setRecords((current) => current.map((item) => item.id === record.id ? data.record : item));
      setEditor((current) => current?.record?.id === record.id ? { ...current, record: data.record, form: initialForm(selected, data.record) } : current);
      if (editor?.record?.id === record.id) await loadAudit(selected, record.id);
      shell.notify("Cell updated", "success");
      setInlineEdit(null);
    } catch (err: any) {
      shell.notify(err.message || "Failed to update cell", "error");
    } finally {
      setInlineSaving(false);
    }
  }

  function toggleLoadedSelection() {
    if (allLoadedSelected) {
      setSelectedRows({});
      return;
    }
    setSelectedRows(Object.fromEntries(records.map((record) => [record.id, true])));
  }

  async function exportRows(recordIds = selectedRecordIds.length ? selectedRecordIds : records.map((record) => record.id), format: "csv" | "json" = "csv") {
    if (!selected || !recordIds.length) return;
    setBulkBusy(true);
    try {
      const res = await shell.fetch(`/api/tables/${encodeURIComponent(selected.id)}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordIds, columns: visibleColumns.map((column) => column.key), format }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to export records");
      }
      const blob = await res.blob();
      downloadBlob(blob, `${selected.id.replace(/[^a-zA-Z0-9_.-]/g, "_")}-records.${format}`);
      shell.notify(`Exported ${recordIds.length} records as ${format.toUpperCase()}`, "success");
    } catch (err: any) {
      shell.notify(err.message || "Failed to export records", "error");
    } finally {
      setBulkBusy(false);
    }
  }

  function resetImport() {
    setImportRows([]);
    setImportHeaders([]);
    setImportMapping({});
    setImportFileName("");
    setImportBusy(false);
    setImportMode("create");
    setImportMatchKeys(["name"]);
    setImportDecisions([]);
  }

  function autoMapImportHeaders(headers: string[]) {
    const targets = new Map(importFields.flatMap((field) => {
      const keys = [field.key, field.label, field.attr?.name, field.attr?.displayName].filter(Boolean).map((value) => normalizeImportKey(String(value)));
      return keys.map((key) => [key, field.key] as const);
    }));
    return Object.fromEntries(headers.map((header) => [header, targets.get(normalizeImportKey(header)) || ""]));
  }

  async function handleImportFile(file: File | null) {
    if (!selected || !file) return;
    setImportBusy(true);
    try {
      const rows = (await parseImportFile(file)).slice(0, IMPORT_LIMIT);
      const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
      if (!rows.length || !headers.length) throw new Error("No importable rows found");
      setImportRows(rows);
      setImportHeaders(headers);
      setImportMapping(autoMapImportHeaders(headers));
      setImportFileName(file.name);
      setImportDecisions([]);
      shell.notify(`Loaded ${rows.length} import row${rows.length === 1 ? "" : "s"}`, "success");
    } catch (err: any) {
      resetImport();
      shell.notify(err.message || "Failed to parse import file", "error");
    } finally {
      setImportBusy(false);
    }
  }

  function importPayloadForRow(row: ImportRow): ImportPayloadRow {
    const payload: ImportPayloadRow = { attributes: {} };
    for (const [header, target] of Object.entries(importMapping)) {
      if (!target) continue;
      const raw = row[header] || "";
      if (target === "name") payload.name = raw.trim();
      else if (target === "environment") payload.environment = raw.trim();
      else {
        const attr = selected?.attributes.find((item) => item.name === target);
        payload.attributes[target] = coerceValue(raw, attr);
      }
    }
    return payload;
  }

  async function commitImport() {
    if (!selected || !importRows.length) return;
    const rows = importRows.map((row) => importPayloadForRow(row));
    const invalidIndex = rows.findIndex((row) => !row.name?.trim());
    if (invalidIndex >= 0) {
      shell.notify(`Import row ${invalidIndex + 1} is missing a name`, "error");
      return;
    }
    if (importMode !== "create" && !importMatchKeys.length) {
      shell.notify("Choose at least one match key for update or upsert", "error");
      return;
    }
    if (importMode !== "create" && !importDecisions.length) {
      shell.notify("Generate an import preview before committing updates", "error");
      return;
    }
    if (importMode !== "create" && (importDecisionCounts.conflict || 0) > 0) {
      shell.notify("Resolve import conflicts before committing", "error");
      return;
    }
    setImportBusy(true);
    try {
      const res = await shell.fetch(`/api/tables/${encodeURIComponent(selected.id)}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, mode: importMode, matchKeys: importMatchKeys, source: { filename: importFileName, fileType: importFileName.split(".").pop(), rowCount: rows.length } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.errors?.[0]?.error || "Failed to import records");
      const created = data.summary?.created || data.created?.length || 0;
      const updated = data.summary?.updated || data.updated?.length || 0;
      const failed = data.summary?.failed || data.errors?.length || 0;
      shell.notify(`Imported ${created} created, ${updated} updated${failed ? `, ${failed} failed` : ""}`, failed ? "info" : "success");
      resetImport();
      setImportOpen(false);
      await loadRecords();
    } catch (err: any) {
      shell.notify(err.message || "Failed to import records", "error");
    } finally {
      setImportBusy(false);
    }
  }

  async function previewImport() {
    if (!selected || !importRows.length) return;
    const rows = importRows.map((row) => importPayloadForRow(row));
    if (importMode !== "create" && !importMatchKeys.length) {
      shell.notify("Choose at least one match key", "error");
      return;
    }
    setImportBusy(true);
    try {
      const res = await shell.fetch(`/api/tables/${encodeURIComponent(selected.id)}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true, rows, mode: importMode, matchKeys: importMatchKeys, source: { filename: importFileName, fileType: importFileName.split(".").pop(), rowCount: rows.length } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.errors?.[0]?.error || "Failed to preview import");
      setImportDecisions(data.decisions || []);
      shell.notify("Import preview generated", "success");
    } catch (err: any) {
      shell.notify(err.message || "Failed to preview import", "error");
    } finally {
      setImportBusy(false);
    }
  }

  async function deleteSelectedRows() {
    if (!selected || !selectedRecordIds.length) return;
    if (!confirm(`Delete ${selectedRecordIds.length} selected records? This cannot be undone.`)) return;
    setBulkBusy(true);
    try {
      const res = await shell.fetch(`/api/tables/${encodeURIComponent(selected.id)}/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", recordIds: selectedRecordIds }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to delete selected records");
      if (body.summary?.failed) {
        shell.notify(`Deleted ${body.summary.deleted || 0}, ${body.summary.failed} failed`, "info");
      } else {
        shell.notify(`Deleted ${body.summary?.deleted || selectedRecordIds.length} records`, "success");
      }
      await loadRecords();
    } catch (err: any) {
      shell.notify(err.message || "Failed to delete selected records", "error");
    } finally {
      setBulkBusy(false);
    }
  }

  async function applyBulkUpdate() {
    if (!selected || !selectedRecordIds.length || !bulkField) return;
    if (bulkField === "name") {
      shell.notify("Name cannot be bulk-updated from this cockpit.", "error");
      return;
    }
    const attr = tableAttr(bulkField);
    const payload = bulkField === "environment"
      ? { environment: bulkValue.trim() || undefined }
      : { attributes: { [bulkField]: coerceValue(bulkValue, attr) } };
    setBulkBusy(true);
    try {
      const res = await shell.fetch(`/api/tables/${encodeURIComponent(selected.id)}/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", recordIds: selectedRecordIds, patch: payload }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to bulk update records");
      if (body.summary?.failed) {
        shell.notify(`Updated ${body.summary.updated || 0}, ${body.summary.failed} failed`, "info");
      } else {
        shell.notify(`Updated ${body.summary?.updated || selectedRecordIds.length} records`, "success");
      }
      setBulkEditorOpen(false);
      setBulkValue("");
      await loadRecords();
    } catch (err: any) {
      shell.notify(err.message || "Failed to bulk update records", "error");
    } finally {
      setBulkBusy(false);
    }
  }

  async function queueCleanupReview() {
    if (!selected || !selectedRecordIds.length) return;
    if (!cleanupReason.trim()) {
      shell.notify("Cleanup reason is required", "error");
      return;
    }
    setBulkBusy(true);
    try {
      const res = await shell.fetch(`/api/tables/${encodeURIComponent(selected.id)}/cleanup-reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordIds: selectedRecordIds, reason: cleanupReason.trim(), severity: cleanupSeverity }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to queue cleanup review");
      }
      const data = await res.json();
      shell.notify(`Queued ${data.reviews?.length || selectedRecordIds.length} cleanup review${(data.reviews?.length || selectedRecordIds.length) === 1 ? "" : "s"}`, "success");
      setCleanupOpen(false);
      setSelectedRows({});
      if (mode === "stewardship") await loadCleanupReviews();
    } catch (err: any) {
      shell.notify(err.message || "Failed to queue cleanup review", "error");
    } finally {
      setBulkBusy(false);
    }
  }

  async function suggestCleanupReview() {
    if (!selected || !selectedRecordIds.length) return;
    setBulkBusy(true);
    try {
      const res = await shell.fetch(`/api/tables/${encodeURIComponent(selected.id)}/cleanup-assist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordIds: selectedRecordIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to generate cleanup suggestions");
      const suggestions = data.suggestions || [];
      setCleanupSuggestions(suggestions);
      const first = suggestions.find((item: CleanupSuggestion) => item.recommendations?.length) || suggestions[0];
      if (first) {
        setCleanupReason(first.reviewReason);
        setCleanupSeverity(first.severity);
        setCleanupOpen(true);
      }
      shell.notify(`Generated ${suggestions.length} cleanup suggestion${suggestions.length === 1 ? "" : "s"}`, "success");
    } catch (err: any) {
      shell.notify(err.message || "Failed to generate cleanup suggestions", "error");
    } finally {
      setBulkBusy(false);
    }
  }

  async function updateCleanupReview(review: CleanupReview, status: CleanupReview["status"]) {
    setBulkBusy(true);
    try {
      const res = await shell.fetch(`/api/tables/cleanup-reviews/${encodeURIComponent(review.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to update cleanup review");
      }
      shell.notify(`Cleanup review ${status.replace("_", " ")}`, "success");
      await loadCleanupReviews();
    } catch (err: any) {
      shell.notify(err.message || "Failed to update cleanup review", "error");
    } finally {
      setBulkBusy(false);
    }
  }

  async function openCleanupRecord(review: CleanupReview) {
    const table = tables.find((item) => item.id === review.tableId);
    if (!table) {
      shell.notify(`Table ${review.tableId} is not available`, "error");
      return;
    }
    setMode("records");
    await openRecordEditor(table, review.recordId);
  }

  async function deleteRecord(record: TableRecord) {
    if (!selected) return;
    if (!confirm(`Delete ${record.name}? This will detach relationships and cannot be undone.`)) return;
    try {
      const res = await shell.fetch(`/api/tables/${encodeURIComponent(selected.id)}/records/${encodeURIComponent(record.id)}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to delete record");
      }
      shell.notify("Record deleted", "success");
      await loadRecords();
      await loadReferenceOptions(tables);
    } catch (err: any) {
      shell.notify(err.message || "Failed to delete record", "error");
    }
  }

  useEffect(() => {
    loadTables();
    loadEditorOptions();
  }, []);

  useEffect(() => {
    if (selected) {
      loadRecords(selected);
      loadSavedViews(selected);
    }
  }, [selected?.id]);

  useEffect(() => {
    if (selected) loadRecords(selected);
  }, [page, sortField, sortDirection]);

  useEffect(() => {
    if (mode === "stewardship") loadCleanupReviews();
  }, [mode, cleanupStatus]);

  useEffect(() => {
    return shell.onMessage((message) => {
      handleTableAction({ type: message.type, ...message.payload });
    });
  }, [shell, tables]);

  useEffect(() => {
    const payload = shell.launchPayload as { type?: string; tableId?: string; recordId?: string; mode?: "create" | "edit" } | undefined;
    if (!payload) return;
    if (payload.type !== "SELECT_TABLE" && payload.type !== "OPEN_TABLE_RECORD") return;
    const key = JSON.stringify(payload);
    if (handledLaunchRef.current === key) return;
    handledLaunchRef.current = key;
    handleTableAction(payload);
  }, [shell.launchPayload, tables]);

  useEffect(() => {
    let payload: { type?: string; tableId?: string; recordId?: string; mode?: "create" | "edit"; createdAt?: number } | null = null;
    try {
      const raw = sessionStorage.getItem(TABLES_LAUNCH_KEY);
      payload = raw ? JSON.parse(raw) : null;
      if (raw) sessionStorage.removeItem(TABLES_LAUNCH_KEY);
    } catch {
      payload = null;
    }
    if (!payload) return;
    if (payload.createdAt && Date.now() - payload.createdAt > 60_000) return;
    if (payload.type !== "SELECT_TABLE" && payload.type !== "OPEN_TABLE_RECORD") return;
    const key = JSON.stringify(payload);
    if (handledLaunchRef.current === key) return;
    handledLaunchRef.current = key;
    handleTableAction(payload);
  }, [tables]);

  useEffect(() => {
    if (!pendingTableAction || tables.length === 0) return;
    const table = tables.find((item) => item.id === pendingTableAction.tableId || item.className === pendingTableAction.tableId);
    if (!table) return;
    if (pendingTableAction.mode === "create") {
      selectTable(table);
      setServerValidationIssues(null);
      setEditor({ mode: "create", form: initialForm(table) });
    } else if (pendingTableAction.recordId) {
      openRecordEditor(table, pendingTableAction.recordId);
    } else {
      selectTable(table);
    }
    setPendingTableAction(null);
  }, [pendingTableAction, tables]);

  useEffect(() => {
    if (!writableBulkColumns.some((column) => column.key === bulkField)) {
      setBulkField(writableBulkColumns[0]?.key || "environment");
    }
  }, [bulkField, writableBulkColumns]);

  return (
    <div className="flex h-full w-full bg-gray-950 text-gray-100">
      <aside className="flex w-72 shrink-0 flex-col border-r border-gray-800 bg-gray-950">
        <div className="border-b border-gray-800 px-4 py-4">
          <div className="flex items-center gap-2">
            <TableProperties className="h-5 w-5 text-indigo-400" />
            <h1 className="text-base font-semibold">Tables</h1>
          </div>
          <p className="mt-1 text-xs text-gray-500">RBAC-aware platform data access</p>
          <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg border border-gray-800 bg-gray-900 p-1">
            <button onClick={() => setMode("records")} className={`rounded px-2 py-1.5 text-xs ${mode === "records" ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white"}`}>
              Records
            </button>
            <button onClick={() => setMode("stewardship")} className={`rounded px-2 py-1.5 text-xs ${mode === "stewardship" ? "bg-amber-500 text-gray-950" : "text-gray-400 hover:text-white"}`}>
              Stewardship
            </button>
          </div>
        </div>
        {mode === "records" && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="border-b border-gray-900 p-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
                <input
                  value={tableSearch}
                  onChange={(event) => setTableSearch(event.target.value)}
                  placeholder="Search tables"
                  className="w-full rounded-lg border border-gray-800 bg-gray-900 py-2 pl-8 pr-8 text-sm text-gray-100 outline-none focus:border-indigo-500"
                />
                {tableSearch && (
                  <button onClick={() => setTableSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-500 hover:text-gray-200" aria-label="Clear table search">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2">
              {loading ? (
                <div className="px-3 py-4 text-sm text-gray-500">Loading tables...</div>
              ) : filteredTables.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-800 px-3 py-8 text-center text-sm text-gray-600">No tables match this search.</div>
              ) : filteredTables.map((table) => (
                <button
                  key={table.id}
                  data-testid={`tables-table-${table.id}`}
                  onClick={() => selectTable(table)}
                  className={`w-full rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                    selected?.id === table.id ? "bg-indigo-600/20 text-indigo-200" : "text-gray-300 hover:bg-gray-900"
                  }`}
                >
                  <div className="truncate font-medium">{table.label}</div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-gray-500">{table.id}</div>
                </button>
              ))}
            </div>
          </div>
        )}
        {mode === "stewardship" && (
          <div className="min-h-0 flex-1 border-t border-gray-900 p-3 text-sm text-gray-500">
            <div className="font-medium text-gray-300">Cleanup Review Queue</div>
            <p className="mt-1 text-xs">Work selected records that were queued from stewardship filters and validation findings.</p>
          </div>
        )}
        {mode === "records" && selected && (
          <div className="border-t border-gray-800 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-600">Views</div>
              <button onClick={saveCurrentView} className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-900 hover:text-white">
                Save
              </button>
            </div>
            <div className="scrollbar-thin max-h-44 space-y-1 overflow-y-auto">
              {savedViews.map((view) => (
                <div key={view.id} className="group flex items-center gap-1 rounded-lg border border-gray-900 bg-gray-950 px-2 py-1.5 hover:border-gray-800">
                  <button onClick={() => applySavedView(view)} className="min-w-0 flex-1 text-left">
                    <div className="truncate text-xs font-medium text-gray-300">{view.name}</div>
                    <div className="truncate text-[10px] text-gray-600">{view.columns.length || "default"} columns / {view.filters.length} filters</div>
                    {view.filters.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {view.filters.slice(0, 2).map((filter, index) => (
                          <span key={`${filter.field}:${filter.operator}:${index}`} className="max-w-full truncate rounded border border-gray-800 bg-gray-950 px-1.5 py-0.5 text-[10px] text-gray-500">
                            {filterChipLabel({ field: filter.field, operator: filter.operator, value: filter.value === undefined || filter.value === null ? "" : String(filter.value) })}
                          </span>
                        ))}
                        {view.filters.length > 2 && <span className="rounded border border-gray-800 bg-gray-950 px-1.5 py-0.5 text-[10px] text-gray-600">+{view.filters.length - 2}</span>}
                      </div>
                    )}
                  </button>
                  <button onClick={() => deleteSavedView(view)} className="rounded p-1 text-gray-600 opacity-0 hover:text-red-300 group-hover:opacity-100" title="Delete view">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {!savedViews.length && <div className="rounded-lg border border-dashed border-gray-800 px-2 py-3 text-xs text-gray-600">No saved views.</div>}
            </div>
          </div>
        )}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {mode === "stewardship" ? (
          <CleanupReviewWorkbench
            reviews={cleanupReviews}
            status={cleanupStatus}
            loading={cleanupLoading}
            busy={bulkBusy}
            onStatusChange={(status) => setCleanupStatus(status)}
            onRefresh={() => loadCleanupReviews()}
            onOpenRecord={openCleanupRecord}
            onUpdateStatus={updateCleanupReview}
          />
        ) : (
        <>
        <header className="flex shrink-0 items-center gap-3 border-b border-gray-800 px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-300">
            <Database className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{selected?.label || "Select a table"}</h2>
            <p className="font-mono text-xs text-gray-500">{selected ? `${selected.id} / ${total} records` : "No table selected"}</p>
          </div>
          {selected && (
            <div className="ml-4 hidden items-center gap-2 xl:flex">
              <MetricPill label="Loaded" value={records.length} />
              <MetricPill label="Needs Review" value={stewardshipStats.needsReview} tone={stewardshipStats.needsReview ? "warn" : "good"} />
              <MetricPill label="Required Fields" value={stewardshipStats.requiredAttrs} />
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            <div className="relative z-50">
              <button onClick={() => setExportMenuOpen((open) => open === "loaded" ? null : "loaded")} disabled={!selected || records.length === 0 || bulkBusy} className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-300 hover:text-white disabled:opacity-40">
                <Download className="h-4 w-4" />
                Export
              </button>
              {exportMenuOpen === "loaded" && (
                <ExportMenu
                  onCsv={() => { setExportMenuOpen(null); exportRows(records.map((record) => record.id), "csv"); }}
                  onJson={() => { setExportMenuOpen(null); exportRows(records.map((record) => record.id), "json"); }}
                />
              )}
            </div>
            <button onClick={() => setImportOpen((open) => !open)} disabled={!selected || importBusy} className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-500/15 disabled:opacity-40">
              <Upload className="h-4 w-4" />
              Import
            </button>
            <button onClick={openCreate} disabled={!selected} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40">
              <Plus className="h-4 w-4" />
              New
            </button>
            <button onClick={() => setFiltersOpen((open) => !open)} className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-300 hover:text-white">
              <Filter className="h-4 w-4" />
              Filters
              {filterPayload.length > 0 && <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-xs text-indigo-200">{filterPayload.length}</span>}
            </button>
            <button onClick={() => loadRecords()} className="rounded-lg border border-gray-700 bg-gray-900 p-2 text-gray-300 hover:text-white" title="Refresh">
              <RefreshCw className={`h-4 w-4 ${recordLoading ? "animate-spin" : ""}`} />
            </button>
            <select value={density} onChange={(event) => setDensity(event.target.value as typeof density)} className={SELECT_CLASS} title="Density">
              <option value="compact">Compact</option>
              <option value="comfortable">Comfortable</option>
              <option value="spacious">Spacious</option>
            </select>
            <div className="relative z-50">
              <button onClick={() => setPickerOpen((open) => !open)} className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-300 hover:text-white">
                <Columns3 className="h-4 w-4" />
                Columns
              </button>
              {pickerOpen && (
                <div className="absolute right-0 z-50 mt-2 w-72 rounded-lg border border-gray-700 bg-gray-900 p-2 shadow-2xl">
                  <div className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Visible Columns</div>
                  <div className="scrollbar-thin max-h-72 space-y-1 overflow-y-auto">
                    {availableColumns.map((column) => (
                      <label key={column.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-300 hover:bg-gray-800">
                        <input
                          type="checkbox"
                          checked={visibleColumns.some((item) => item.key === column.key)}
                          onChange={() => toggleColumn(column.key)}
                          className="rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500"
                        />
                        <span className="truncate">{column.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <section className="border-b border-gray-800 bg-gray-950 px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="relative w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") applySearchAndFilters();
                }}
                placeholder="Search name, ID, or environment"
                className="w-full rounded-lg border border-gray-700 bg-gray-900 py-2 pl-9 pr-3 text-sm text-gray-100 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <button onClick={applySearchAndFilters} className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-300 hover:text-white">
              Apply
            </button>
            {filters.length > 0 && (
              <button onClick={() => { setFilters([]); setPage(0); }} className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:text-gray-200">
                Clear filters
              </button>
            )}
          </div>

          {filters.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-600">Filters</span>
              {filters.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => removeFilter(filter.id)}
                  title="Remove filter"
                  className="inline-flex max-w-[360px] items-center gap-1.5 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-1 text-xs text-indigo-100 hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-100"
                >
                  <span className="truncate">{filterChipLabel(filter)}</span>
                  <X className="h-3 w-3 shrink-0" />
                </button>
              ))}
              <button onClick={() => setFiltersOpen(true)} className="rounded-full border border-gray-800 px-2.5 py-1 text-xs text-gray-500 hover:border-gray-700 hover:text-gray-200">
                Edit filters
              </button>
            </div>
          )}

          {filtersOpen && (
            <div className="mt-3 space-y-2">
              {filters.map((filter) => (
                <div key={filter.id} className="grid grid-cols-[220px_160px_1fr_36px] gap-2">
                  <select value={filter.field} onChange={(event) => updateFilter(filter.id, { field: event.target.value })} className={SELECT_CLASS}>
                    {filterColumns.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}
                  </select>
                  <select value={filter.operator} onChange={(event) => updateFilter(filter.id, { operator: event.target.value as FilterOperator })} className={SELECT_CLASS} disabled={isRelationshipFilter(filter.field)}>
                    {OPERATORS.map((operator) => <option key={operator.value} value={operator.value}>{operator.label}</option>)}
                  </select>
                  {isValueOperator(filter.operator) ? (
                    <FilterValueInput filter={filter} attr={tableAttr(filter.field)} onChange={(value) => updateFilter(filter.id, { value })} />
                  ) : (
                    <div className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-600">No value required</div>
                  )}
                  <button onClick={() => removeFilter(filter.id)} className="rounded-lg border border-gray-700 bg-gray-900 p-2 text-gray-500 hover:text-red-300">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button onClick={addFilter} className="inline-flex items-center gap-2 rounded-lg border border-dashed border-gray-700 px-3 py-2 text-sm text-gray-400 hover:border-indigo-500/50 hover:text-white">
                <Plus className="h-4 w-4" />
                Add filter
              </button>
            </div>
          )}
        </section>

        {selected && importOpen && (
          <ImportWorkbench
            table={selected}
            headers={importHeaders}
            rows={importRows}
            fields={importFields}
            mapping={importMapping}
            fileName={importFileName}
            busy={importBusy}
            mode={importMode}
            matchKeys={importMatchKeys}
            decisions={importDecisions}
            decisionCounts={importDecisionCounts}
            readyCount={importReadyCount}
            preview={importPreview}
            onFile={handleImportFile}
            onMap={(header, target) => setImportMapping((current) => ({ ...current, [header]: target }))}
            onModeChange={(mode) => { setImportMode(mode); setImportDecisions([]); }}
            onToggleMatchKey={(key) => {
              setImportMatchKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
              setImportDecisions([]);
            }}
            onPreview={previewImport}
            onCommit={commitImport}
            onReset={resetImport}
            onClose={() => setImportOpen(false)}
          />
        )}

        {selectedRecordIds.length > 0 && (
          <section className="shrink-0 border-b border-cyan-500/20 bg-cyan-950/20 px-5 py-2 text-sm">
            <div className="flex items-center gap-3">
              <div className="font-medium text-cyan-100">{selectedRecordIds.length} selected</div>
              <div className="relative">
                <button onClick={() => setExportMenuOpen((open) => open === "selected" ? null : "selected")} disabled={bulkBusy} className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/30 px-3 py-1.5 text-cyan-100 hover:bg-cyan-500/10 disabled:opacity-50">
                  <Download className="h-4 w-4" />
                  Export selected
                </button>
                {exportMenuOpen === "selected" && (
                  <ExportMenu
                    align="left"
                    onCsv={() => { setExportMenuOpen(null); exportRows(selectedRecordIds, "csv"); }}
                    onJson={() => { setExportMenuOpen(null); exportRows(selectedRecordIds, "json"); }}
                  />
                )}
              </div>
              <button onClick={() => setBulkEditorOpen((open) => !open)} disabled={bulkBusy || !writableBulkColumns.length} className="inline-flex items-center gap-2 rounded-lg border border-indigo-500/30 px-3 py-1.5 text-indigo-100 hover:bg-indigo-500/10 disabled:opacity-50">
                <Edit3 className="h-4 w-4" />
                Bulk update
              </button>
              <button onClick={() => setCleanupOpen((open) => !open)} disabled={bulkBusy} className="inline-flex items-center gap-2 rounded-lg border border-amber-500/30 px-3 py-1.5 text-amber-100 hover:bg-amber-500/10 disabled:opacity-50">
                <AlertTriangle className="h-4 w-4" />
                Queue cleanup
              </button>
              <button onClick={suggestCleanupReview} disabled={bulkBusy} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 px-3 py-1.5 text-emerald-100 hover:bg-emerald-500/10 disabled:opacity-50">
                <Check className="h-4 w-4" />
                Suggest cleanup
              </button>
              <button onClick={deleteSelectedRows} disabled={bulkBusy} className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 px-3 py-1.5 text-red-200 hover:bg-red-500/10 disabled:opacity-50">
                <Trash2 className="h-4 w-4" />
                Delete selected
              </button>
              <button onClick={() => setSelectedRows({})} className="ml-auto inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-gray-400 hover:text-white">
                <Undo2 className="h-4 w-4" />
                Clear
              </button>
            </div>
            {bulkEditorOpen && (
              <div className="mt-2 grid grid-cols-[220px_1fr_auto] gap-2">
                <select value={bulkField} onChange={(event) => setBulkField(event.target.value)} className={SELECT_CLASS}>
                  {writableBulkColumns.filter((column) => column.key !== "name").map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}
                </select>
                <BulkValueInput attr={tableAttr(bulkField)} value={bulkValue} onChange={setBulkValue} />
                <button onClick={applyBulkUpdate} disabled={bulkBusy || !bulkField} className="rounded-lg bg-cyan-500 px-3 py-2 font-medium text-gray-950 hover:bg-cyan-400 disabled:opacity-50">
                  Apply to selected
                </button>
              </div>
            )}
            {cleanupOpen && (
              <div className="mt-2 grid grid-cols-[160px_1fr_auto] gap-2">
                <select value={cleanupSeverity} onChange={(event) => setCleanupSeverity(event.target.value as typeof cleanupSeverity)} className={SELECT_CLASS}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
                <input
                  value={cleanupReason}
                  onChange={(event) => setCleanupReason(event.target.value)}
                  placeholder="Reason for cleanup review"
                  className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-amber-500"
                />
                <button onClick={queueCleanupReview} disabled={bulkBusy || !cleanupReason.trim()} className="rounded-lg bg-amber-500 px-3 py-2 font-medium text-gray-950 hover:bg-amber-400 disabled:opacity-50">
                  Queue review
                </button>
                {cleanupSuggestions.length > 0 && (
                  <div className="col-span-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-100">
                    {cleanupSuggestions.slice(0, 3).map((suggestion) => (
                      <div key={suggestion.recordId} className="truncate">
                        {suggestion.recordLabel}: {suggestion.recommendations[0]?.title || "No cleanup issue detected"}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-950">
              {selected && records.length > 0 && (
                <tr className="border-b border-gray-800 bg-gray-950/95">
                  <th colSpan={Math.max(visibleColumns.length + 2, 1)} className="sticky top-0 z-20 bg-gray-950 px-4 py-2">
                    <div className="flex items-center justify-end gap-2 text-sm font-normal normal-case tracking-normal text-gray-500">
                      <span className="mr-auto">
                        Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
                      </span>
                      <button onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0 || recordLoading} className="rounded-lg border border-gray-700 px-2.5 py-1.5 hover:text-white disabled:opacity-40">
                        Previous
                      </button>
                      <span className="font-mono text-xs text-gray-600">Page {page + 1}/{totalPages}</span>
                      <button onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))} disabled={page >= totalPages - 1 || recordLoading} className="rounded-lg border border-gray-700 px-2.5 py-1.5 hover:text-white disabled:opacity-40">
                        Next
                      </button>
                    </div>
                  </th>
                </tr>
              )}
              <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wider text-gray-500">
                <th className="sticky z-20 w-10 bg-gray-950 px-4 py-3" style={{ top: selected && records.length > 0 ? 41 : 0 }}>
                  <input
                    type="checkbox"
                    checked={allLoadedSelected}
                    onChange={toggleLoadedSelection}
                    aria-label="Select loaded records"
                    className="rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500"
                  />
                </th>
                {visibleColumns.map((column) => (
                  <th key={column.key} className="sticky z-20 whitespace-nowrap bg-gray-950 px-4 py-3" style={{ top: selected && records.length > 0 ? 41 : 0 }}>
                    <button onClick={() => toggleSort(column.key)} className="inline-flex items-center gap-1 text-left hover:text-gray-200">
                      {column.label}
                      {sortField === column.key && <span className="text-[10px] text-indigo-300">{sortDirection === "asc" ? "ASC" : "DESC"}</span>}
                    </button>
                  </th>
                ))}
                <th className="sticky z-20 w-24 bg-gray-950 px-4 py-3 text-right" style={{ top: selected && records.length > 0 ? 41 : 0 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id} data-testid={`tables-record-${record.id}`} className="border-b border-gray-900 hover:bg-gray-900/60">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={!!selectedRows[record.id]}
                      onChange={(event) => setSelectedRows((current) => ({ ...current, [record.id]: event.target.checked }))}
                      aria-label={`Select record ${record.id}`}
                      className="rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500"
                    />
                  </td>
                  {visibleColumns.map((column) => (
                    <td
                      key={column.key}
                      onDoubleClick={() => startInlineEdit(record, column.key)}
                      className={`max-w-[260px] px-4 ${density === "compact" ? "py-2" : density === "spacious" ? "py-4" : "py-3"} ${column.key === "id" ? "font-mono text-xs text-gray-500" : column.key === "name" ? "font-medium text-gray-200" : "text-gray-300"} ${canWriteColumn(column.key) ? "cursor-text" : ""}`}
                      title={canWriteColumn(column.key) ? "Double-click to edit" : undefined}
                    >
                      {inlineEdit?.recordId === record.id && inlineEdit.columnKey === column.key ? (
                        <InlineCellEditor
                          attr={tableAttr(column.key)}
                          value={inlineEdit.value}
                          saving={inlineSaving}
                          onChange={(value) => setInlineEdit((current) => current ? { ...current, value } : current)}
                          onCommit={commitInlineEdit}
                          onCancel={() => setInlineEdit(null)}
                        />
                      ) : (
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="block truncate">{String(cellValue(record, column.key))}</span>
                          {column.key === "name" && (
                            <ValidationBadge
                              issues={validationIssues(selected, record)}
                              open={issuePopover === record.id}
                              onToggle={() => setIssuePopover((current) => current === record.id ? null : record.id)}
                            />
                          )}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className={`px-4 ${density === "compact" ? "py-2" : density === "spacious" ? "py-4" : "py-3"}`}>
                    <div className="flex justify-end gap-1">
                      <button onClick={() => openEdit(record)} className="rounded p-1.5 text-gray-500 hover:bg-gray-800 hover:text-white" title="Edit" aria-label={`Edit ${record.name}`}>
                        <Edit3 className="h-4 w-4" />
                      </button>
                      <button onClick={() => deleteRecord(record)} className="rounded p-1.5 text-gray-500 hover:bg-red-950/60 hover:text-red-300" title="Delete" aria-label={`Delete ${record.name}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {recordLoading && (
                <tr>
                  <td colSpan={Math.max(visibleColumns.length + 2, 1)} className="px-4 py-12 text-center text-gray-500">
                    Loading records...
                  </td>
                </tr>
              )}
              {!recordLoading && records.length === 0 && (
                <tr>
                  <td colSpan={Math.max(visibleColumns.length + 2, 1)} className="px-4 py-12 text-center text-gray-500">
                    No records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </>
        )}
      </main>

      {selected && editor && (
        <RecordEditor
          table={selected}
          editor={editor}
          saving={saving}
          auditEntries={auditEntries}
          serverValidationIssues={serverValidationIssues}
          environments={environments}
          referenceOptions={referenceOptions}
          onChange={updateForm}
          onClose={() => { setEditor(null); setServerValidationIssues(null); }}
          onSave={saveRecord}
        />
      )}
    </div>
  );
}

function ImportWorkbench({
  table,
  headers,
  rows,
  fields,
  mapping,
  fileName,
  busy,
  mode,
  matchKeys,
  decisions,
  decisionCounts,
  readyCount,
  preview,
  onFile,
  onMap,
  onModeChange,
  onToggleMatchKey,
  onPreview,
  onCommit,
  onReset,
  onClose,
}: {
  table: TableDef;
  headers: string[];
  rows: ImportRow[];
  fields: ImportField[];
  mapping: Record<string, string>;
  fileName: string;
  busy: boolean;
  mode: ImportMode;
  matchKeys: string[];
  decisions: ImportDecision[];
  decisionCounts: Record<ImportDecision["action"], number>;
  readyCount: number;
  preview: ImportPayloadRow[];
  onFile: (file: File | null) => void;
  onMap: (header: string, target: string) => void;
  onModeChange: (mode: ImportMode) => void;
  onToggleMatchKey: (key: string) => void;
  onPreview: () => void;
  onCommit: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const previewIssues = preview.map((row) => validationIssuesForForm(table, {
    id: "",
    name: row.name || "",
    environment: row.environment || "",
    ...Object.fromEntries(table.attributes.map((attr) => [attr.name, primitiveCellValue(row.attributes[attr.name])])),
  }));
  return (
    <section className="shrink-0 border-b border-cyan-500/20 bg-cyan-950/10 px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-cyan-100">
            <Upload className="h-4 w-4" />
            Import Records
          </div>
          <p className="mt-1 text-xs text-gray-500">CSV, JSON, or first-sheet XLSX. Create, update, or upsert with server-side matching and generated IDs.</p>
        </div>
        <button onClick={onClose} className="rounded-lg border border-gray-700 p-2 text-gray-400 hover:text-white" title="Close import">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[340px_1fr]">
        <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-3">
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Source file</label>
          <input
            type="file"
            accept=".csv,.json,.xlsx,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => onFile(event.target.files?.[0] || null)}
            className="mt-2 block w-full cursor-pointer rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-300 file:mr-3 file:rounded-md file:border-0 file:bg-cyan-500 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gray-950 hover:border-cyan-500/50"
          />
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <MetricPill label="Rows" value={rows.length} />
            <MetricPill label="Ready" value={readyCount} tone={readyCount === rows.length && rows.length ? "good" : "warn"} />
            <MetricPill label="Limit" value={IMPORT_LIMIT} />
          </div>
          <div className="mt-3">
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Import mode</label>
            <select data-testid="tables-import-mode" value={mode} onChange={(event) => onModeChange(event.target.value as ImportMode)} className={`mt-2 w-full ${SELECT_CLASS}`}>
              <option value="create">Create only</option>
              <option value="update">Update matched records only</option>
              <option value="upsert">Upsert matched records</option>
            </select>
          </div>
          {mode !== "create" && (
            <div className="mt-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Match keys</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {fields.map((field) => (
                  <button
                    key={field.key}
                    type="button"
                    onClick={() => onToggleMatchKey(field.key)}
                    className={`rounded-full border px-2.5 py-1 text-xs ${matchKeys.includes(field.key) ? "border-cyan-400 bg-cyan-500/15 text-cyan-100" : "border-gray-700 text-gray-400 hover:text-white"}`}
                  >
                    {field.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {fileName && <div className="mt-3 truncate font-mono text-xs text-gray-500">{fileName}</div>}
          <div className="mt-3 flex gap-2">
            <button onClick={onPreview} disabled={busy || !rows.length || readyCount !== rows.length || (mode !== "create" && !matchKeys.length)} className="rounded-lg border border-cyan-500/40 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-500/10 disabled:opacity-50">
              Preview
            </button>
            <button onClick={onCommit} disabled={busy || !rows.length || readyCount !== rows.length || (mode !== "create" && (!decisions.length || !!decisionCounts.conflict))} className="flex-1 rounded-lg bg-cyan-500 px-3 py-2 text-sm font-medium text-gray-950 hover:bg-cyan-400 disabled:opacity-50">
              {busy ? "Working..." : "Commit import"}
            </button>
            <button onClick={onReset} disabled={busy || !rows.length} className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:text-white disabled:opacity-50">
              Reset
            </button>
          </div>
        </div>
        <div className="min-w-0 rounded-lg border border-gray-800 bg-gray-900/60 p-3">
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Column mapping</div>
              <div className="scrollbar-thin max-h-64 space-y-2 overflow-y-auto pr-1">
                {headers.map((header) => (
                  <div key={header} className="grid grid-cols-[minmax(0,1fr)_220px] items-center gap-2 rounded-lg border border-gray-800 bg-gray-950 px-2 py-2">
                    <div className="truncate text-sm text-gray-300" title={header}>{header}</div>
                    <select value={mapping[header] || ""} onChange={(event) => onMap(header, event.target.value)} className={SELECT_CLASS}>
                      <option value="">Do not import</option>
                      {fields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
                    </select>
                  </div>
                ))}
                {!headers.length && <div className="rounded-lg border border-dashed border-gray-800 px-3 py-8 text-center text-sm text-gray-600">Choose a file to map columns.</div>}
              </div>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Preview</div>
                {decisions.length > 0 && (
                  <div className="flex gap-1 text-[10px]">
                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-200">{decisionCounts.create || 0} create</span>
                    <span className="rounded bg-indigo-500/10 px-1.5 py-0.5 text-indigo-200">{decisionCounts.update || 0} update</span>
                    <span className="rounded bg-gray-700/40 px-1.5 py-0.5 text-gray-300">{decisionCounts.skip || 0} skip</span>
                    {!!decisionCounts.conflict && <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-red-200">{decisionCounts.conflict} conflict</span>}
                  </div>
                )}
              </div>
              <div className="scrollbar-thin max-h-64 space-y-2 overflow-y-auto pr-1">
                {preview.map((row, index) => (
                  <div key={index} className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate text-sm font-medium text-gray-200">{row.name || `Row ${index + 1}`}</div>
                      {decisions[index] ? (
                        <span className={`rounded px-2 py-0.5 text-xs ${
                          decisions[index].action === "conflict" ? "bg-red-500/10 text-red-200" :
                          decisions[index].action === "update" ? "bg-indigo-500/10 text-indigo-200" :
                          decisions[index].action === "skip" ? "bg-gray-700/40 text-gray-300" :
                          "bg-emerald-500/10 text-emerald-200"
                        }`}>
                          {decisions[index].action}
                        </span>
                      ) : previewIssues[index]?.length ? (
                        <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-200">{previewIssues[index].length} issue(s)</span>
                      ) : (
                        <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-200">ready</span>
                      )}
                    </div>
                    <div className="mt-1 truncate text-xs text-gray-500">{row.environment || "No environment"} / {Object.keys(row.attributes).filter((key) => row.attributes[key] !== "").join(", ") || "no attributes"}</div>
                    {decisions[index]?.recordName && <div className="mt-1 truncate text-xs text-indigo-300">Match: {decisions[index].recordName}</div>}
                    {decisions[index]?.reason && <div className="mt-1 truncate text-xs text-amber-300">{decisions[index].reason}</div>}
                  </div>
                ))}
                {!preview.length && <div className="rounded-lg border border-dashed border-gray-800 px-3 py-8 text-center text-sm text-gray-600">Preview appears after mapping.</div>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ExportMenu({ onCsv, onJson, align = "right" }: { onCsv: () => void; onJson: () => void; align?: "left" | "right" }) {
  return (
    <div className={`absolute z-30 mt-2 w-44 rounded-lg border border-gray-700 bg-gray-900 p-1 shadow-2xl ${align === "right" ? "right-0" : "left-0"}`}>
      <button onClick={onCsv} className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800">
        <span>CSV</span>
        <span className="text-xs text-gray-500">Spreadsheet</span>
      </button>
      <button onClick={onJson} className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800">
        <span>JSON</span>
        <span className="text-xs text-gray-500">API</span>
      </button>
    </div>
  );
}

function CleanupReviewWorkbench({
  reviews,
  status,
  loading,
  busy,
  onStatusChange,
  onRefresh,
  onOpenRecord,
  onUpdateStatus,
}: {
  reviews: CleanupReview[];
  status: CleanupReview["status"] | "all";
  loading: boolean;
  busy: boolean;
  onStatusChange: (status: CleanupReview["status"] | "all") => void;
  onRefresh: () => void;
  onOpenRecord: (review: CleanupReview) => void;
  onUpdateStatus: (review: CleanupReview, status: CleanupReview["status"]) => void;
}) {
  const active = reviews.filter((review) => review.status === "open" || review.status === "in_progress").length;
  const critical = reviews.filter((review) => review.severity === "critical").length;
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-gray-950">
      <header className="flex shrink-0 items-center gap-3 border-b border-gray-800 px-5 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/15 text-amber-300">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Stewardship Queue</h2>
          <p className="text-xs text-gray-500">Review, route, and close cleanup work queued from Tables.</p>
        </div>
        <div className="ml-4 hidden items-center gap-2 lg:flex">
          <MetricPill label="Loaded" value={reviews.length} />
          <MetricPill label="Active" value={active} tone={active ? "warn" : "good"} />
          <MetricPill label="Critical" value={critical} tone={critical ? "warn" : "neutral"} />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select value={status} onChange={(event) => onStatusChange(event.target.value as typeof status)} className={SELECT_CLASS}>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
            <option value="all">All</option>
          </select>
          <button onClick={onRefresh} className="rounded-lg border border-gray-700 bg-gray-900 p-2 text-gray-300 hover:text-white" title="Refresh queue">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>
      <div className="scrollbar-thin flex-1 overflow-y-auto p-5 pb-32">
        {loading ? (
          <div className="rounded-lg border border-dashed border-gray-800 px-4 py-10 text-center text-sm text-gray-500">Loading cleanup reviews...</div>
        ) : reviews.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-800 px-4 py-10 text-center text-sm text-gray-500">No cleanup reviews match this view.</div>
        ) : (
          <div className="space-y-3">
            {reviews.map((review) => (
              <div key={review.id} className="rounded-lg border border-gray-800 bg-gray-900 p-4">
                <div className="flex items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${review.severity === "critical" || review.severity === "high" ? "bg-red-500/10 text-red-200" : review.severity === "medium" ? "bg-amber-500/10 text-amber-200" : "bg-gray-800 text-gray-300"}`}>
                        {review.severity}
                      </span>
                      <span className="rounded bg-gray-800 px-2 py-0.5 text-[10px] uppercase text-gray-400">{review.status.replace("_", " ")}</span>
                      <span className="font-mono text-[11px] text-gray-600">{review.tableId}</span>
                    </div>
                    <div className="mt-2 text-sm font-medium text-gray-100">{review.recordLabel}</div>
                    <div className="mt-1 text-sm text-gray-400">{review.reason}</div>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-600">
                      <span>{review.tableLabel}</span>
                      <span className="font-mono">{review.recordId}</span>
                      <span>{review.requesterName || review.requesterEmail || "system"}</span>
                      <span>{formatDateTime(review.updatedAt || review.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    <button onClick={() => onOpenRecord(review)} className="inline-flex items-center gap-1 rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:text-white">
                      <ArrowUpRight className="h-3.5 w-3.5" />
                      Open record
                    </button>
                    {review.status === "open" && (
                      <button disabled={busy} onClick={() => onUpdateStatus(review, "in_progress")} className="rounded-lg border border-indigo-500/30 px-3 py-1.5 text-xs text-indigo-100 hover:bg-indigo-500/10 disabled:opacity-50">
                        Start
                      </button>
                    )}
                    {review.status !== "resolved" && (
                      <button disabled={busy} onClick={() => onUpdateStatus(review, "resolved")} className="rounded-lg border border-emerald-500/30 px-3 py-1.5 text-xs text-emerald-100 hover:bg-emerald-500/10 disabled:opacity-50">
                        Resolve
                      </button>
                    )}
                    {review.status !== "dismissed" && (
                      <button disabled={busy} onClick={() => onUpdateStatus(review, "dismissed")} className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50">
                        Dismiss
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterValueInput({ filter, attr, onChange }: { filter: TableFilter; attr?: AttributeDef; onChange: (value: string) => void }) {
  if (filter.field === "__relationshipState") {
    return (
      <select value={filter.value || "orphaned"} onChange={(event) => onChange(event.target.value)} className={SELECT_CLASS}>
        <option value="orphaned">Orphaned</option>
        <option value="connected">Connected</option>
      </select>
    );
  }
  if (filter.field === "__relationshipType") {
    return (
      <select value={filter.value} onChange={(event) => onChange(event.target.value)} className={SELECT_CLASS}>
        <option value="">Select relationship</option>
        {RELATIONSHIP_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
    );
  }
  if (attr?.attrType === "boolean") {
    return (
      <select value={filter.value || "true"} onChange={(event) => onChange(event.target.value)} className={SELECT_CLASS}>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (attr?.attrType === "enum" && attr.enumValues?.length) {
    return (
      <select value={filter.value} onChange={(event) => onChange(event.target.value)} className={SELECT_CLASS}>
        <option value="">Select value</option>
        {attr.enumValues.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
    );
  }
  return (
    <input
      value={filter.value}
      onChange={(event) => onChange(event.target.value)}
      type={attr?.attrType === "number" ? "number" : attr?.attrType === "date" ? "date" : "text"}
      placeholder="Value"
      className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500"
    />
  );
}

function BulkValueInput({ attr, value, onChange }: { attr?: AttributeDef; value: string; onChange: (value: string) => void }) {
  if (attr?.attrType === "boolean") {
    return (
      <select value={value || "false"} onChange={(event) => onChange(event.target.value)} className={SELECT_CLASS}>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (attr?.attrType === "enum" && attr.enumValues?.length) {
    return (
      <select value={value} onChange={(event) => onChange(event.target.value)} className={SELECT_CLASS}>
        <option value="">Select value</option>
        {attr.enumValues.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    );
  }
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      type={attr?.attrType === "number" ? "number" : attr?.attrType === "date" ? "date" : "text"}
      placeholder="New value"
      className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500"
    />
  );
}

function MetricPill({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "good" | "warn" }) {
  const toneClass = tone === "good"
    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
    : tone === "warn"
      ? "border-amber-500/20 bg-amber-500/10 text-amber-100"
      : "border-gray-800 bg-gray-900 text-gray-200";
  return (
    <div className={`rounded-lg border px-3 py-1.5 ${toneClass}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-70">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

function ValidationBadge({ issues, open, onToggle }: { issues: ValidationIssue[]; open: boolean; onToggle: () => void }) {
  if (!issues.length) return <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-200">Clean</span>;
  const hard = issues.filter((issue) => issue.severity === "error").length;
  const title = issues.map((issue) => issue.label).join(", ");
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        title={`Missing: ${title}`}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        className={`cursor-pointer rounded px-1.5 py-0.5 text-[10px] font-medium hover:ring-1 hover:ring-current ${hard ? "bg-red-500/10 text-red-200" : "bg-amber-500/10 text-amber-200"}`}
      >
        {issues.length} issue{issues.length === 1 ? "" : "s"}
      </button>
      {open && (
        <span className="absolute left-0 top-6 z-30 w-56 rounded-lg border border-gray-700 bg-gray-950 p-2 text-xs shadow-2xl">
          <span className="mb-1 block font-semibold text-gray-200">Validation issues</span>
          {issues.map((issue) => (
            <span key={`${issue.field}:${issue.severity}`} className="block rounded px-2 py-1 text-gray-300">
              <span className={issue.severity === "error" ? "text-red-300" : "text-amber-300"}>{issue.severity === "error" ? "Required" : "Health"}</span>
              <span className="text-gray-600"> / </span>
              {issue.label} is missing
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

function ValidationIssuePanel({ issues, title = "Stewardship validation" }: { issues: ValidationIssue[]; title?: string }) {
  if (!issues.length) {
    return (
      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
        {title}: required stewardship checks passed.
      </div>
    );
  }
  const required = issues.filter((issue) => issue.severity === "error").length;
  return (
    <div className={`rounded-lg border px-3 py-3 ${required ? "border-red-500/20 bg-red-500/10" : "border-amber-500/20 bg-amber-500/10"}`}>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">{title}</div>
      <div className={`text-sm font-medium ${required ? "text-red-100" : "text-amber-100"}`}>
        {issues.length} stewardship issue{issues.length === 1 ? "" : "s"} to resolve
      </div>
      <div className="mt-2 space-y-1">
        {issues.map((issue) => (
          <div key={`${issue.field}:${issue.severity}`} className="flex items-center justify-between gap-3 rounded border border-gray-800/70 bg-gray-950/60 px-2 py-1.5 text-xs">
            <span className="truncate text-gray-200">{issue.message || issue.label}</span>
            <span className={issue.severity === "error" ? "text-red-300" : "text-amber-300"}>
              {issue.severity === "error" ? "Required" : issue.reason === "missing_relationship" ? "Relationship" : "Health field"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function InlineCellEditor({
  attr,
  value,
  saving,
  onChange,
  onCommit,
  onCancel,
}: {
  attr?: AttributeDef;
  value: string;
  saving: boolean;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const className = "w-full min-w-32 rounded border border-indigo-500 bg-gray-950 px-2 py-1 text-sm text-gray-100 outline-none focus:border-cyan-400";
  const closedRef = useRef(false);
  const commitOnce = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    onCommit();
  };
  const cancelOnce = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    onCancel();
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (event.key === "Enter") commitOnce();
    if (event.key === "Escape") cancelOnce();
  };
  if (attr?.attrType === "boolean") {
    return (
      <select autoFocus disabled={saving} value={value || "false"} onBlur={commitOnce} onKeyDown={onKeyDown} onChange={(event) => onChange(event.target.value)} className={INLINE_SELECT_CLASS}>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (attr?.attrType === "enum" && attr.enumValues?.length) {
    return (
      <select autoFocus disabled={saving} value={value} onBlur={commitOnce} onKeyDown={onKeyDown} onChange={(event) => onChange(event.target.value)} className={INLINE_SELECT_CLASS}>
        <option value="">Select value</option>
        {attr.enumValues.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    );
  }
  return (
    <input
      autoFocus
      disabled={saving}
      value={value}
      onBlur={commitOnce}
      onKeyDown={onKeyDown}
      onChange={(event) => onChange(event.target.value)}
      type={attr?.attrType === "number" ? "number" : attr?.attrType === "date" ? "date" : "text"}
      className={className}
    />
  );
}

function RecordEditor({
  table,
  editor,
  saving,
  auditEntries,
  serverValidationIssues,
  environments,
  referenceOptions,
  onChange,
  onClose,
  onSave,
}: {
  table: TableDef;
  editor: { mode: EditorMode; record?: TableRecord; form: Record<string, string> };
  saving: boolean;
  auditEntries: AuditEntry[];
  serverValidationIssues: ValidationIssue[] | null;
  environments: string[];
  referenceOptions: Record<string, ReferenceOption[]>;
  onChange: (key: string, value: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const editorIssues = validationIssuesForForm(table, editor.form);
  const environmentOptions = Array.from(new Set([editor.form.environment, ...environments].filter(Boolean)));
  return (
    <aside data-testid="tables-record-editor" className="flex w-[420px] shrink-0 flex-col border-l border-gray-800 bg-gray-950 shadow-[-12px_0_32px_rgba(0,0,0,0.35)]">
      <div className="flex items-center gap-3 border-b border-gray-800 px-4 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-300">
          {editor.mode === "create" ? <Plus className="h-4 w-4" /> : <Edit3 className="h-4 w-4" />}
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold">{editor.mode === "create" ? "New Record" : "Edit Record"}</h3>
          <p className="truncate text-xs text-gray-500">{table.label}</p>
        </div>
        <button onClick={onClose} className="ml-auto rounded p-1.5 text-gray-500 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 pb-28">
        <ValidationIssuePanel issues={editorIssues} title="Live form stewardship" />
        {editor.mode === "edit" && serverValidationIssues && (
          <ValidationIssuePanel issues={serverValidationIssues} title="Server validation snapshot" />
        )}
        {editor.mode === "create" && (
          <Field label="ID" hint="Generated automatically when the record is saved.">
            <input value="Auto-generated" readOnly disabled className="w-full cursor-not-allowed rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2 text-sm text-gray-500 outline-none" />
          </Field>
        )}
        <Field label="Name" required>
          <input value={editor.form.name || ""} onChange={(event) => onChange("name", event.target.value)} className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500" />
        </Field>
        <Field label="Environment">
          <select value={editor.form.environment || ""} onChange={(event) => onChange("environment", event.target.value)} className={`w-full ${SELECT_CLASS}`}>
            <option value="">Select environment</option>
            {environmentOptions.map((environment) => <option key={environment} value={environment}>{environment}</option>)}
          </select>
        </Field>

        <div className="border-t border-gray-800 pt-4">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Attributes</div>
          <div className="space-y-3">
            {table.attributes.map((attr) => (
              <AttributeInput
                key={attr.name}
                attr={attr}
                value={editor.form[attr.name] || ""}
                referenceOptions={referenceOptions[attr.referenceClass || ""] || []}
                onChange={(value) => onChange(attr.name, value)}
              />
            ))}
          </div>
        </div>

        {editor.mode === "edit" && (
          <div className="border-t border-gray-800 pt-4">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              <History className="h-3.5 w-3.5" />
              Audit History
            </div>
            <div className="space-y-2">
              {auditEntries.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-gray-800 bg-gray-900 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-mono text-xs text-gray-300">{entry.action}</div>
                    <div className="text-[10px] text-gray-600">{formatDateTime(entry.createdAt || entry.created_at)}</div>
                  </div>
                  <div className="mt-2 grid gap-2 text-xs text-gray-500">
                    <AuditDiff before={entry.oldValues} after={entry.newValues} />
                  </div>
                  {entry.entryHash && <div className="mt-2 truncate font-mono text-[10px] text-gray-700">hash {entry.entryHash}</div>}
                </div>
              ))}
              {!auditEntries.length && <div className="rounded-lg border border-dashed border-gray-800 px-3 py-4 text-sm text-gray-600">No audit history for this record.</div>}
            </div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t border-gray-800 px-4 py-3">
        <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
        <button onClick={onSave} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
          {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </button>
      </div>
    </aside>
  );
}

function AuditDiff({ before, after }: { before?: Record<string, unknown> | null; after?: Record<string, unknown> | null }) {
  const rows = auditDiffRows(before, after);
  if (!rows.length) {
    const snapshot = after || before;
    return (
      <div className="rounded border border-gray-800 bg-gray-950 px-2 py-2 text-gray-500">
        {snapshot ? "Snapshot captured; no field-level delta." : "No field values captured."}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {rows.slice(0, 8).map((row) => (
        <div key={row.field} className="rounded border border-gray-800 bg-gray-950 p-2">
          <div className="mb-1 font-medium text-gray-300">{row.field}</div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 font-mono text-[11px]">
            <div className="truncate rounded bg-red-950/30 px-2 py-1 text-red-200">{formatValue(row.before)}</div>
            <div className="text-gray-700">to</div>
            <div className="truncate rounded bg-emerald-950/30 px-2 py-1 text-emerald-200">{formatValue(row.after)}</div>
          </div>
        </div>
      ))}
      {rows.length > 8 && <div className="text-[11px] text-gray-600">{rows.length - 8} more changes hidden.</div>}
    </div>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center gap-2 text-sm text-gray-300">
        {label}
        {required && <span className="text-red-300">*</span>}
      </div>
      {children}
      {hint && <div className="mt-1 text-xs text-gray-600">{hint}</div>}
    </label>
  );
}

function AttributeInput({ attr, value, referenceOptions, onChange }: { attr: AttributeDef; value: string; referenceOptions: ReferenceOption[]; onChange: (value: string) => void }) {
  const label = attr.displayName || attr.name;
  const [referenceSearch, setReferenceSearch] = useState("");
  if (!canReadAttr(attr)) {
    return (
      <Field label={label} required={attr.isMandatory} hint="Restricted by field-level RBAC.">
        <input value="Restricted" readOnly disabled className="w-full cursor-not-allowed rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2 text-sm text-gray-500 outline-none" />
      </Field>
    );
  }
  const disabled = !canWriteAttr(attr);
  let input: React.ReactNode;
  if (attr.attrType === "boolean") {
    input = (
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && onChange(value === "true" ? "false" : "true")}
        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${value === "true" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-gray-700 bg-gray-900 text-gray-400"}`}
      >
        <Check className="h-4 w-4" />
        {value === "true" ? "True" : "False"}
      </button>
    );
  } else if (attr.attrType === "enum" && attr.enumValues?.length) {
    input = (
      <select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} className={`w-full ${SELECT_CLASS}`}>
        <option value="">Select value</option>
        {attr.enumValues.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    );
  } else if (attr.attrType === "reference") {
    const options = referenceOptions.some((option) => option.id === value) || !value
      ? referenceOptions
      : [{ id: value, label: value }, ...referenceOptions];
    input = (
      <ReferenceTypeahead
        disabled={disabled}
        referenceClass={attr.referenceClass}
        value={value}
        options={options}
        search={referenceSearch}
        onSearch={setReferenceSearch}
        onChange={onChange}
      />
    );
  } else if (attr.attrType === "json") {
    input = (
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        readOnly={disabled}
        disabled={disabled}
        rows={Math.min(10, Math.max(4, value.split("\n").length))}
        className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 font-mono text-xs text-gray-100 outline-none focus:border-indigo-500 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-500"
      />
    );
  } else {
    input = (
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        readOnly={disabled}
        disabled={disabled}
        type={attr.attrType === "number" ? "number" : attr.attrType === "date" ? "date" : "text"}
        className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-500"
      />
    );
  }
  return (
    <Field label={label} required={attr.isMandatory} hint={disabled ? "Read-only by field-level RBAC." : attr.isRestricted ? "Field-level RBAC managed." : undefined}>
      {input}
    </Field>
  );
}

function ReferenceTypeahead({
  disabled,
  referenceClass,
  value,
  options,
  search,
  onSearch,
  onChange,
}: {
  disabled: boolean;
  referenceClass?: string;
  value: string;
  options: ReferenceOption[];
  search: string;
  onSearch: (value: string) => void;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.id === value);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matches = needle
      ? options.filter((option) => [option.label, option.sublabel, option.id].some((item) => String(item || "").toLowerCase().includes(needle)))
      : options;
    return matches.slice(0, 50);
  }, [options, search]);
  const displayValue = open ? search : selected ? selected.label : "";
  const placeholder = referenceClass ? `Search ${referenceClass}` : "Search reference";

  function choose(option: ReferenceOption) {
    onChange(option.id);
    onSearch("");
    setOpen(false);
  }

  return (
    <div className="relative">
      <div className="relative">
        <input
          disabled={disabled}
          value={displayValue}
          onFocus={() => {
            setOpen(true);
            onSearch("");
          }}
          onChange={(event) => {
            setOpen(true);
            onSearch(event.target.value);
          }}
          onBlur={() => {
            window.setTimeout(() => {
              setOpen(false);
              onSearch("");
            }, 120);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              onSearch("");
            } else if (event.key === "Enter" && open && filtered[0]) {
              event.preventDefault();
              choose(filtered[0]);
            } else if (event.key === "Backspace" && !open && value) {
              onChange("");
            }
          }}
          placeholder={placeholder}
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 pr-9 text-sm text-gray-100 outline-none focus:border-indigo-500 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-500"
        />
        {value && !disabled && (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange("");
              onSearch("");
              setOpen(false);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-500 hover:text-gray-200"
            aria-label="Clear reference"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && !disabled && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-gray-700 bg-gray-950 py-1 shadow-xl shadow-black/40">
          {filtered.length > 0 ? filtered.map((option) => (
            <button
              key={option.id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-indigo-600/20 ${option.id === value ? "text-indigo-200" : "text-gray-200"}`}
            >
              <div className="truncate">{option.label}</div>
              {option.sublabel && <div className="truncate text-xs text-gray-500">{option.sublabel}</div>}
            </button>
          )) : (
            <div className="px-3 py-3 text-sm text-gray-500">No matching records.</div>
          )}
        </div>
      )}
    </div>
  );
}
