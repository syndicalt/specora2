export type TableAction = "read" | "write" | "delete";

export type FilterOperator =
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

export type TableFilter = {
  field: string;
  operator: FilterOperator;
  value?: unknown;
};

export type TableSavedViewInput = {
  tableId?: string;
  name?: string;
  searchQuery?: string;
  filters?: TableFilter[];
  columns?: string[];
  density?: string;
  sortField?: string;
  sortDirection?: "asc" | "desc";
};

export type TableImportRow = {
  name?: string;
  environment?: string;
  attributes?: Record<string, unknown>;
};

export type TableImportMode = "create" | "update" | "upsert";

export type TableImportDecision = {
  row: number;
  action: "create" | "update" | "skip" | "conflict" | "error";
  recordId?: string;
  recordName?: string | null;
  reason?: string;
  payload: TableImportRow;
};

export type TableExportFormat = "csv" | "json";
export type BulkAction = "update" | "delete";

export type TableDefinition = {
  id: string;
  name: string;
  label: string;
  provider: "cmdb-class" | "postgres-table";
  className?: string;
  tableName?: string;
  displayField?: string;
  secondaryDisplayFields?: string[];
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

export type PostgresTableRegistration = {
  tableName: string;
  label: string;
  category: "itsm" | "itam" | "platform";
  nameField?: string;
  searchableFields?: string[];
};

export const FOUNDATION_CLASSES = new Set([
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

export const POSTGRES_TABLES: PostgresTableRegistration[] = [
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
  { tableName: "table_cleanup_reviews", label: "Table Cleanup Reviews", category: "platform", nameField: "record_label", searchableFields: ["table_id", "record_id", "record_label", "reason", "severity", "status"] },
];
