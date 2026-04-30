import type { ReferenceOption } from "@/components/ReferenceTypeahead";

export type AttributeDef = {
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

export type TableDef = {
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

export type TableRecord = {
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

export type ColumnDef = {
  key: string;
  label: string;
  core: boolean;
  attrType: string;
};

export type FilterOperator = "contains" | "equals" | "notEquals" | "startsWith" | "endsWith" | "empty" | "notEmpty" | "gt" | "gte" | "lt" | "lte";

export type TableFilter = {
  id: string;
  field: string;
  operator: FilterOperator;
  value: string;
};

export type EditorMode = "create" | "edit";

export type PendingTableAction = {
  tableId: string;
  recordId?: string;
  mode?: "create" | "edit";
};

export type SavedTableView = {
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

export type AuditEntry = {
  id: string;
  action: string;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  entryHash?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
};

export type CleanupReview = {
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

export type InlineEdit = {
  recordId: string;
  columnKey: string;
  value: string;
};

export type DiffRow = {
  field: string;
  before: unknown;
  after: unknown;
};

export type ValidationIssue = {
  field: string;
  label: string;
  severity: "error" | "warn";
  message?: string;
  reason?: string;
};

export type CleanupSuggestion = {
  recordId: string;
  recordLabel: string;
  severity: "low" | "medium" | "high" | "critical";
  reviewReason: string;
  recommendations: Array<{ title: string; recommendation: string; field: string; severity: string }>;
};

export type ImportRow = Record<string, string>;

export type ImportPayloadRow = {
  name?: string;
  environment?: string;
  attributes: Record<string, unknown>;
};

export type ImportField = {
  key: string;
  label: string;
  attr?: AttributeDef;
};

export type ImportMode = "create" | "update" | "upsert";

export type ImportDecision = {
  row: number;
  action: "create" | "update" | "skip" | "conflict" | "error";
  recordId?: string;
  recordName?: string | null;
  reason?: string;
};

export type { ReferenceOption };

