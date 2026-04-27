import type { FastifyInstance } from "fastify";
import { createHash, createHmac } from "crypto";
import { hasPermission, resolveUserRole } from "../services/rbac";
import { recordAuditEvent } from "../services/auditLog";

type ReportColumnType = "string" | "number" | "boolean" | "datetime" | "json";
type ReportFilterOperator = "equals" | "notEquals" | "contains" | "startsWith" | "endsWith" | "empty" | "notEmpty" | "gt" | "gte" | "lt" | "lte";

type ReportColumn = {
  key: string;
  label: string;
  type: ReportColumnType;
  expr: string;
  filterable?: boolean;
  groupable?: boolean;
};

type ReportDataset = {
  id: string;
  label: string;
  description: string;
  table: string;
  timeColumn: string;
  resource: string;
  defaultGroupBy: string[];
  columns: ReportColumn[];
};

type ReportFilter = {
  field: string;
  operator: ReportFilterOperator;
  value?: unknown;
};

type ReportContractTarget = "grafana" | "powerbi" | "tableau" | "warehouse";

type ReportQueryInput = {
  from?: unknown;
  to?: unknown;
  groupBy?: unknown;
  filters?: unknown;
  limit?: unknown;
  offset?: unknown;
  format?: unknown;
};

type ReportWindow = {
  from: Date;
  to: Date;
};

type ReportKpiStatus = "good" | "watch" | "risk" | "unknown";
type ReportKpiDirection = "higher_is_better" | "lower_is_better" | "neutral";

type ReportKpiResult = {
  id: string;
  label: string;
  description: string;
  domain: string;
  value: number | null;
  unit: "count" | "percent" | "ratio" | "days";
  status: ReportKpiStatus;
  direction: ReportKpiDirection;
  window: { from: string; to: string };
  details: Record<string, unknown>;
};

type ReportKpiDefinition = {
  id: string;
  label: string;
  description: string;
  domain: string;
  resources: string[];
  unit: ReportKpiResult["unit"];
  direction: ReportKpiDirection;
  run: (fastify: FastifyInstance, window: ReportWindow) => Promise<Omit<ReportKpiResult, "id" | "label" | "description" | "domain" | "unit" | "direction" | "window">>;
};

const DATASETS: ReportDataset[] = [
  {
    id: "incidents",
    label: "Incidents",
    description: "Incident volume, severity, assignment, AI state, and resolution trends.",
    table: "incidents",
    timeColumn: "created_at",
    resource: "incident-manager",
    defaultGroupBy: ["status"],
    columns: [
      { key: "id", label: "ID", type: "string", expr: "id" },
      { key: "number", label: "Number", type: "string", expr: "number", filterable: true, groupable: true },
      { key: "title", label: "Title", type: "string", expr: "title", filterable: true },
      { key: "status", label: "Status", type: "string", expr: "status", filterable: true, groupable: true },
      { key: "severity", label: "Severity", type: "string", expr: "severity", filterable: true, groupable: true },
      { key: "priority", label: "Priority", type: "number", expr: "priority", filterable: true, groupable: true },
      { key: "service", label: "Service", type: "string", expr: "service", filterable: true, groupable: true },
      { key: "assignment_group", label: "Assignment Group", type: "string", expr: "assignment_group", filterable: true, groupable: true },
      { key: "ai_state", label: "AI State", type: "string", expr: "ai_state", filterable: true, groupable: true },
      { key: "created_at", label: "Created", type: "datetime", expr: "created_at", filterable: true },
      { key: "resolved_at", label: "Resolved", type: "datetime", expr: "resolved_at", filterable: true },
    ],
  },
  {
    id: "changes",
    label: "Changes",
    description: "Change throughput, status, requester, CI, and schedule reporting.",
    table: "change_requests",
    timeColumn: "created_at",
    resource: "change-manager",
    defaultGroupBy: ["status"],
    columns: [
      { key: "id", label: "ID", type: "string", expr: "id" },
      { key: "number", label: "Number", type: "string", expr: "number", filterable: true, groupable: true },
      { key: "title", label: "Title", type: "string", expr: "title", filterable: true },
      { key: "status", label: "Status", type: "string", expr: "status", filterable: true, groupable: true },
      { key: "ci_id", label: "CI", type: "string", expr: "ci_id", filterable: true, groupable: true },
      { key: "requester_id", label: "Requester", type: "string", expr: "requester_id", filterable: true, groupable: true },
      { key: "scheduled_at", label: "Scheduled", type: "datetime", expr: "scheduled_at", filterable: true },
      { key: "created_at", label: "Created", type: "datetime", expr: "created_at", filterable: true },
    ],
  },
  {
    id: "requests",
    label: "Catalog Requests",
    description: "Portal request volume, type, source, priority, requester, and fulfillment status.",
    table: "catalog_requests",
    timeColumn: "created_at",
    resource: "customer-portal",
    defaultGroupBy: ["status"],
    columns: [
      { key: "id", label: "ID", type: "string", expr: "id" },
      { key: "number", label: "Number", type: "string", expr: "number", filterable: true, groupable: true },
      { key: "title", label: "Title", type: "string", expr: "title", filterable: true },
      { key: "request_type", label: "Request Type", type: "string", expr: "request_type", filterable: true, groupable: true },
      { key: "status", label: "Status", type: "string", expr: "status", filterable: true, groupable: true },
      { key: "priority", label: "Priority", type: "number", expr: "priority", filterable: true, groupable: true },
      { key: "source", label: "Source", type: "string", expr: "source", filterable: true, groupable: true },
      { key: "requester_id", label: "Requester", type: "string", expr: "requester_id", filterable: true, groupable: true },
      { key: "created_at", label: "Created", type: "datetime", expr: "created_at", filterable: true },
      { key: "updated_at", label: "Updated", type: "datetime", expr: "updated_at", filterable: true },
    ],
  },
  {
    id: "knowledge",
    label: "Knowledge",
    description: "Knowledge lifecycle, type, service, owner, confidence, and freshness reporting.",
    table: "knowledge_items",
    timeColumn: "updated_at",
    resource: "knowledge-core",
    defaultGroupBy: ["status"],
    columns: [
      { key: "id", label: "ID", type: "string", expr: "id" },
      { key: "number", label: "Number", type: "string", expr: "number", filterable: true, groupable: true },
      { key: "title", label: "Title", type: "string", expr: "title", filterable: true },
      { key: "status", label: "Status", type: "string", expr: "status", filterable: true, groupable: true },
      { key: "type", label: "Type", type: "string", expr: "type", filterable: true, groupable: true },
      { key: "service", label: "Service", type: "string", expr: "service", filterable: true, groupable: true },
      { key: "trust_score", label: "Trust Score", type: "number", expr: "trust_score", filterable: true },
      { key: "owner_id", label: "Owner", type: "string", expr: "owner_id", filterable: true, groupable: true },
      { key: "updated_at", label: "Updated", type: "datetime", expr: "updated_at", filterable: true },
    ],
  },
  {
    id: "assets",
    label: "Assets",
    description: "Hardware/software asset state, lifecycle, location, ownership, and cost reporting.",
    table: "asset_records",
    timeColumn: "updated_at",
    resource: "asset-command",
    defaultGroupBy: ["status"],
    columns: [
      { key: "id", label: "ID", type: "string", expr: "id" },
      { key: "asset_tag", label: "Asset Tag", type: "string", expr: "asset_tag", filterable: true, groupable: true },
      { key: "name", label: "Name", type: "string", expr: "name", filterable: true },
      { key: "category", label: "Category", type: "string", expr: "category", filterable: true, groupable: true },
      { key: "asset_type", label: "Asset Type", type: "string", expr: "asset_type", filterable: true, groupable: true },
      { key: "status", label: "Status", type: "string", expr: "status", filterable: true, groupable: true },
      { key: "lifecycle_state", label: "Lifecycle State", type: "string", expr: "lifecycle_state", filterable: true, groupable: true },
      { key: "location", label: "Location", type: "string", expr: "location", filterable: true, groupable: true },
      { key: "cost", label: "Cost", type: "number", expr: "cost", filterable: true },
      { key: "updated_at", label: "Updated", type: "datetime", expr: "updated_at", filterable: true },
    ],
  },
  {
    id: "discovery",
    label: "Discovery Jobs",
    description: "Discovery job volume, source files, status, and execution trend reporting.",
    table: "discovery_jobs",
    timeColumn: "created_at",
    resource: "discovery",
    defaultGroupBy: ["status"],
    columns: [
      { key: "id", label: "ID", type: "string", expr: "id" },
      { key: "status", label: "Status", type: "string", expr: "status", filterable: true, groupable: true },
      { key: "file_path", label: "Source File", type: "string", expr: "file_path", filterable: true },
      { key: "created_at", label: "Created", type: "datetime", expr: "created_at", filterable: true },
      { key: "completed_at", label: "Completed", type: "datetime", expr: "completed_at", filterable: true },
    ],
  },
  {
    id: "audit",
    label: "Audit Events",
    description: "Security and administrative evidence over audited platform mutations and exports.",
    table: "audit_log",
    timeColumn: "created_at",
    resource: "audit-log",
    defaultGroupBy: ["action"],
    columns: [
      { key: "id", label: "ID", type: "string", expr: "id" },
      { key: "actor_id", label: "Actor", type: "string", expr: "actor_id", filterable: true, groupable: true },
      { key: "action", label: "Action", type: "string", expr: "action", filterable: true, groupable: true },
      { key: "entity_type", label: "Entity Type", type: "string", expr: "entity_type", filterable: true, groupable: true },
      { key: "entity_id", label: "Entity ID", type: "string", expr: "entity_id", filterable: true },
      { key: "entry_hash", label: "Entry Hash", type: "string", expr: "entry_hash", filterable: true },
      { key: "created_at", label: "Created", type: "datetime", expr: "created_at", filterable: true },
    ],
  },
];

const DATASET_BY_ID = new Map(DATASETS.map((dataset) => [dataset.id, dataset]));
const OPERATORS = new Set<ReportFilterOperator>(["equals", "notEquals", "contains", "startsWith", "endsWith", "empty", "notEmpty", "gt", "gte", "lt", "lte"]);
const CONTRACT_TARGETS = new Set<ReportContractTarget>(["grafana", "powerbi", "tableau", "warehouse"]);

function actorKey(user: any) {
  return user?.id || user?.email || user?.role || "anonymous";
}

function quoteIdentifier(value: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new Error("Invalid SQL identifier");
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parsePositiveInt(value: unknown, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function parseNonNegativeInt(value: unknown, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

function parseReportWindow(input: { from?: unknown; to?: unknown }): ReportWindow {
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const from = parseDate(input.from) || defaultFrom;
  const to = parseDate(input.to) || now;
  return from <= to ? { from, to } : { from: to, to: from };
}

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function parseFilters(value: unknown): ReportFilter[] {
  let raw = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item) => item as ReportFilter)
    .filter((item) => typeof item.field === "string" && OPERATORS.has(item.operator))
    .slice(0, 25);
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function exportSignature(body: string, secret?: string) {
  const digest = createHash("sha256").update(body).digest("hex");
  const signature = createHmac("sha256", secret || "specora-dev-secret").update(digest).digest("hex");
  return { digest, signature, algorithm: "sha256+hmac-sha256" };
}

function datasetDescriptor(dataset: ReportDataset) {
  return {
    id: dataset.id,
    label: dataset.label,
    description: dataset.description,
    defaultGroupBy: dataset.defaultGroupBy,
    timeColumn: dataset.timeColumn,
    columns: dataset.columns.map(({ key, label, type, filterable, groupable }) => ({ key, label, type, filterable: !!filterable, groupable: !!groupable })),
  };
}

function contractColumn(dataset: ReportDataset, column: ReportColumn) {
  return {
    key: column.key,
    label: column.label,
    type: column.type,
    filterable: !!column.filterable,
    groupable: !!column.groupable,
    source: {
      datasetId: dataset.id,
      table: dataset.table,
      column: column.expr,
    },
  };
}

function datasetContract(dataset: ReportDataset) {
  const filterable = dataset.columns.filter((column) => column.filterable);
  const groupable = dataset.columns.filter((column) => column.groupable);
  return {
    id: dataset.id,
    label: dataset.label,
    description: dataset.description,
    timeColumn: dataset.timeColumn,
    defaultGroupBy: dataset.defaultGroupBy,
    columns: dataset.columns.map((column) => contractColumn(dataset, column)),
    filters: filterable.map((column) => ({
      field: column.key,
      type: column.type,
      operators: operatorsForType(column.type),
    })),
    groupBy: groupable.map((column) => column.key),
    endpoints: {
      metadata: `/api/reports/datasets/${dataset.id}`,
      query: `/api/reports/datasets/${dataset.id}/query`,
      csv: `/api/reports/datasets/${dataset.id}/query?format=csv`,
    },
  };
}

function operatorsForType(type: ReportColumnType): ReportFilterOperator[] {
  if (type === "number" || type === "datetime") return ["equals", "notEquals", "empty", "notEmpty", "gt", "gte", "lt", "lte"];
  if (type === "boolean") return ["equals", "notEquals", "empty", "notEmpty"];
  if (type === "json") return ["empty", "notEmpty", "contains"];
  return ["equals", "notEquals", "contains", "startsWith", "endsWith", "empty", "notEmpty"];
}

function contractTarget(value: unknown): ReportContractTarget | null {
  return typeof value === "string" && CONTRACT_TARGETS.has(value as ReportContractTarget) ? value as ReportContractTarget : null;
}

function integrationContract(target: ReportContractTarget, datasets: ReportDataset[]) {
  const base = {
    target,
    version: "2026-04-27",
    authentication: {
      type: "bearer",
      header: "Authorization",
      scheme: "Bearer <token>",
    },
    datasets: datasets.map(datasetContract),
  };

  if (target === "grafana") {
    return {
      ...base,
      client: {
        mode: "json-api",
        preferredFormat: "json",
        timeRange: { fromParam: "from", toParam: "to", format: "ISO-8601" },
        grouping: { param: "groupBy", separator: "," },
      },
    };
  }
  if (target === "powerbi") {
    return {
      ...base,
      client: {
        mode: "web-connector",
        preferredFormat: "csv",
        exportHeader: "x-specora-export-digest",
        incrementalRefresh: { fromParam: "from", toParam: "to", format: "ISO-8601" },
      },
    };
  }
  if (target === "tableau") {
    return {
      ...base,
      client: {
        mode: "web-data-connector",
        preferredFormat: "csv",
        pagination: { limitParam: "limit", offsetParam: "offset", maxLimit: 1000 },
      },
    };
  }
  return {
    ...base,
    client: {
      mode: "warehouse-extract",
      preferredFormat: "json",
      pagination: { limitParam: "limit", offsetParam: "offset", maxLimit: 1000 },
      watermark: { defaultColumn: "timeColumn", fromParam: "from", toParam: "to" },
    },
  };
}

async function getRole(fastify: FastifyInstance, user: any): Promise<string | null> {
  return resolveUserRole(fastify.pg, user);
}

async function canUseReporting(fastify: FastifyInstance, role: string | null, action: "read" | "write") {
  if (!role) return false;
  return hasPermission(fastify.pg, { role, resource: "reporting", action });
}

async function canReadDataset(fastify: FastifyInstance, role: string | null, dataset: ReportDataset) {
  if (!role) return false;
  const canReport = await canUseReporting(fastify, role, "read");
  if (!canReport) return false;
  return hasPermission(fastify.pg, { role, resource: dataset.resource, action: "read" });
}

async function canReadResources(fastify: FastifyInstance, role: string | null, resources: string[]) {
  if (!role) return false;
  const canReport = await canUseReporting(fastify, role, "read");
  if (!canReport) return false;
  for (const resource of resources) {
    if (!(await hasPermission(fastify.pg, { role, resource, action: "read" }))) return false;
  }
  return true;
}

function numeric(value: unknown): number {
  if (value && typeof value === "object" && "toNumber" in value && typeof (value as { toNumber: () => number }).toNumber === "function") {
    return (value as { toNumber: () => number }).toNumber();
  }
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : null;
}

function percent(numerator: number, denominator: number) {
  const value = ratio(numerator, denominator);
  return value === null ? null : Math.round(value * 1000) / 10;
}

function kpiStatus(value: number | null, direction: ReportKpiDirection, good: number, watch: number): ReportKpiStatus {
  if (value === null) return "unknown";
  if (direction === "lower_is_better") {
    if (value <= good) return "good";
    if (value <= watch) return "watch";
    return "risk";
  }
  if (value >= good) return "good";
  if (value >= watch) return "watch";
  return "risk";
}

function normalizeReportQuery(dataset: ReportDataset, input: ReportQueryInput) {
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const from = parseDate(input.from) || defaultFrom;
  const to = parseDate(input.to) || now;
  const limit = parsePositiveInt(input.limit, 100, 1000);
  const offset = parseNonNegativeInt(input.offset, 0, 10_000);
  const filters = parseFilters(input.filters);
  const groupBy = parseList(input.groupBy)
    .filter((field) => dataset.columns.some((column) => column.key === field && column.groupable))
    .slice(0, 3);
  return {
    from,
    to,
    limit,
    offset,
    filters,
    groupBy,
    format: input.format === "csv" ? "csv" as const : "json" as const,
  };
}

function coerceFilterValue(value: unknown, type: ReportColumnType) {
  if (value === undefined || value === null) return null;
  if (type === "number") {
    const next = Number(value);
    return Number.isFinite(next) ? next : value;
  }
  if (type === "boolean") {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
  }
  return value;
}

function buildWhere(dataset: ReportDataset, query: ReturnType<typeof normalizeReportQuery>, params: unknown[]) {
  const columns = new Map(dataset.columns.map((column) => [column.key, column]));
  const parts = [`${quoteIdentifier(dataset.timeColumn)} >= $1`, `${quoteIdentifier(dataset.timeColumn)} <= $2`];
  params.push(query.from.toISOString(), query.to.toISOString());

  for (const filter of query.filters) {
    const column = columns.get(filter.field);
    if (!column?.filterable) continue;
    const expr = quoteIdentifier(column.expr);
    const addParam = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const value = coerceFilterValue(filter.value, column.type);
    switch (filter.operator) {
      case "contains":
        parts.push(`LOWER(${expr}::text) LIKE LOWER(${addParam(`%${String(value ?? "")}%`)})`);
        break;
      case "startsWith":
        parts.push(`LOWER(${expr}::text) LIKE LOWER(${addParam(`${String(value ?? "")}%`)})`);
        break;
      case "endsWith":
        parts.push(`LOWER(${expr}::text) LIKE LOWER(${addParam(`%${String(value ?? "")}`)})`);
        break;
      case "equals":
        parts.push(`${expr} = ${addParam(value)}`);
        break;
      case "notEquals":
        parts.push(`(${expr} IS NULL OR ${expr} <> ${addParam(value)})`);
        break;
      case "empty":
        parts.push(`(${expr} IS NULL OR ${expr}::text = '')`);
        break;
      case "notEmpty":
        parts.push(`(${expr} IS NOT NULL AND ${expr}::text <> '')`);
        break;
      case "gt":
        parts.push(`${expr} > ${addParam(value)}`);
        break;
      case "gte":
        parts.push(`${expr} >= ${addParam(value)}`);
        break;
      case "lt":
        parts.push(`${expr} < ${addParam(value)}`);
        break;
      case "lte":
        parts.push(`${expr} <= ${addParam(value)}`);
        break;
      default:
        break;
    }
  }
  return parts.join(" AND ");
}

async function runReportQuery(fastify: FastifyInstance, dataset: ReportDataset, query: ReturnType<typeof normalizeReportQuery>) {
  const params: unknown[] = [];
  const where = buildWhere(dataset, query, params);
  const table = quoteIdentifier(dataset.table);
  const columnByKey = new Map(dataset.columns.map((column) => [column.key, column]));

  if (query.groupBy.length) {
    const groups = query.groupBy.map((key) => columnByKey.get(key)!).filter(Boolean);
    const groupSelect = groups.map((column) => `${quoteIdentifier(column.expr)} AS ${quoteIdentifier(column.key)}`).join(", ");
    const groupExprs = groups.map((column) => quoteIdentifier(column.expr)).join(", ");
    params.push(query.limit, query.offset);
    const result = await fastify.pg.query(
      `SELECT ${groupSelect}, COUNT(*)::int AS record_count
       FROM ${table}
       WHERE ${where}
       GROUP BY ${groupExprs}
       ORDER BY record_count DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { rows: result.rows, grouped: true };
  }

  const select = dataset.columns.map((column) => `${quoteIdentifier(column.expr)} AS ${quoteIdentifier(column.key)}`).join(", ");
  params.push(query.limit, query.offset);
  const result = await fastify.pg.query(
    `SELECT ${select}
     FROM ${table}
     WHERE ${where}
     ORDER BY ${quoteIdentifier(dataset.timeColumn)} DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return { rows: result.rows, grouped: false };
}

function rowsToCsv(rows: any[]) {
  const columns = rows.length ? Object.keys(rows[0]) : [];
  return `${[columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n")}\n`;
}

function savedReportRow(row: any) {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    name: row.name,
    description: row.description || "",
    query: typeof row.query === "string" ? JSON.parse(row.query || "{}") : row.query || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const KPI_DEFINITIONS: ReportKpiDefinition[] = [
  {
    id: "sla_risk",
    label: "SLA Risk",
    description: "Open high-priority or aging incidents that are most likely to breach service commitments.",
    domain: "Incident",
    resources: ["incident-manager"],
    unit: "count",
    direction: "lower_is_better",
    run: async (fastify, window) => {
      const result = await fastify.pg.query(
        `SELECT
           COUNT(*)::int AS total_open,
           COUNT(*) FILTER (
             WHERE status NOT IN ('resolved', 'closed', 'cancelled')
               AND (priority <= 2 OR severity IN ('high', 'critical') OR created_at <= NOW() - INTERVAL '4 hours')
           )::int AS at_risk
         FROM incidents
         WHERE created_at >= $1 AND created_at <= $2
           AND status NOT IN ('resolved', 'closed', 'cancelled')`,
        [window.from.toISOString(), window.to.toISOString()]
      );
      const row = result.rows[0] || {};
      const value = numeric(row.at_risk);
      return {
        value,
        status: kpiStatus(value, "lower_is_better", 0, 5),
        details: { totalOpen: numeric(row.total_open), threshold: "priority <= 2, high/critical severity, or older than 4 hours" },
      };
    },
  },
  {
    id: "incident_deflection",
    label: "Incident Deflection",
    description: "Share of help demand absorbed by knowledge deflections instead of new incidents.",
    domain: "Incident",
    resources: ["incident-manager", "knowledge-core"],
    unit: "percent",
    direction: "higher_is_better",
    run: async (fastify, window) => {
      const result = await fastify.pg.query(
        `SELECT
           (SELECT COALESCE(SUM(deflection_count), 0)::int FROM knowledge_items WHERE updated_at >= $1 AND updated_at <= $2) AS deflections,
           (SELECT COUNT(*)::int FROM incidents WHERE created_at >= $1 AND created_at <= $2) AS incidents`,
        [window.from.toISOString(), window.to.toISOString()]
      );
      const row = result.rows[0] || {};
      const deflections = numeric(row.deflections);
      const incidents = numeric(row.incidents);
      const value = percent(deflections, deflections + incidents);
      return {
        value,
        status: kpiStatus(value, "higher_is_better", 40, 20),
        details: { deflections, incidents },
      };
    },
  },
  {
    id: "change_collision_risk",
    label: "Change Collision Risk",
    description: "Scheduled change concentration on the same CI inside the reporting window.",
    domain: "Change",
    resources: ["change-manager"],
    unit: "count",
    direction: "lower_is_better",
    run: async (fastify, window) => {
      const result = await fastify.pg.query(
        `WITH scheduled AS (
           SELECT ci_id, COUNT(*)::int AS change_count
           FROM change_requests
           WHERE COALESCE(scheduled_at, created_at) >= $1
             AND COALESCE(scheduled_at, created_at) <= $2
             AND status NOT IN ('closed', 'cancelled', 'rejected')
           GROUP BY ci_id
         )
         SELECT
           COALESCE(SUM(GREATEST(change_count - 1, 0)), 0)::int AS collisions,
           COUNT(*) FILTER (WHERE change_count > 1)::int AS affected_cis,
           COALESCE(MAX(change_count), 0)::int AS max_ci_change_count
         FROM scheduled`,
        [window.from.toISOString(), window.to.toISOString()]
      );
      const row = result.rows[0] || {};
      const value = numeric(row.collisions);
      return {
        value,
        status: kpiStatus(value, "lower_is_better", 0, 3),
        details: { affectedCis: numeric(row.affected_cis), maxCiChangeCount: numeric(row.max_ci_change_count) },
      };
    },
  },
  {
    id: "knowledge_freshness",
    label: "Knowledge Freshness",
    description: "Published knowledge validated in the last 180 days.",
    domain: "Knowledge",
    resources: ["knowledge-core"],
    unit: "percent",
    direction: "higher_is_better",
    run: async (fastify, window) => {
      const result = await fastify.pg.query(
        `SELECT
           COUNT(*)::int AS published,
           COUNT(*) FILTER (WHERE last_validated_at >= NOW() - INTERVAL '180 days')::int AS fresh,
           COALESCE(AVG(trust_score), 0)::float AS average_trust
         FROM knowledge_items
         WHERE status = 'published'
           AND updated_at >= $1 AND updated_at <= $2`,
        [window.from.toISOString(), window.to.toISOString()]
      );
      const row = result.rows[0] || {};
      const fresh = numeric(row.fresh);
      const published = numeric(row.published);
      const value = percent(fresh, published);
      return {
        value,
        status: kpiStatus(value, "higher_is_better", 90, 70),
        details: { fresh, published, averageTrust: numeric(row.average_trust) },
      };
    },
  },
  {
    id: "request_backlog",
    label: "Request Backlog",
    description: "Open catalog requests and their average age.",
    domain: "Request",
    resources: ["customer-portal"],
    unit: "count",
    direction: "lower_is_better",
    run: async (fastify, window) => {
      const result = await fastify.pg.query(
        `SELECT
           COUNT(*)::int AS backlog,
           COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400), 0)::float AS average_age_days,
           COUNT(*) FILTER (WHERE priority <= 2)::int AS high_priority
         FROM catalog_requests
         WHERE created_at >= $1 AND created_at <= $2
           AND status NOT IN ('fulfilled', 'closed', 'cancelled', 'rejected')`,
        [window.from.toISOString(), window.to.toISOString()]
      );
      const row = result.rows[0] || {};
      const value = numeric(row.backlog);
      return {
        value,
        status: kpiStatus(value, "lower_is_better", 10, 50),
        details: { averageAgeDays: Math.round(numeric(row.average_age_days) * 10) / 10, highPriority: numeric(row.high_priority) },
      };
    },
  },
  {
    id: "cmdb_completeness",
    label: "CMDB Completeness",
    description: "Configuration items with required identity fields and at least one relationship.",
    domain: "CMDB",
    resources: ["cmdb", "relationships"],
    unit: "percent",
    direction: "higher_is_better",
    run: async (fastify) => {
      const session = fastify.neo4j.session();
      try {
        const result = await session.run(
          `MATCH (ci:ConfigurationItem)
           OPTIONAL MATCH (ci)-[r]-(:ConfigurationItem)
           WITH ci, COUNT(r) AS relCount
           RETURN
             COUNT(ci) AS total,
             SUM(CASE
               WHEN ci.name IS NOT NULL
                AND ci.class IS NOT NULL
                AND ci.environment IS NOT NULL
                AND relCount > 0
               THEN 1 ELSE 0 END) AS complete`
        );
        const row = result.records[0];
        const total = numeric(row?.get("total"));
        const complete = numeric(row?.get("complete"));
        const value = percent(complete, total);
        return {
          value,
          status: kpiStatus(value, "higher_is_better", 95, 80),
          details: { complete, total, incomplete: Math.max(total - complete, 0) },
        };
      } finally {
        await session.close();
      }
    },
  },
  {
    id: "audit_security_posture",
    label: "Audit Security Posture",
    description: "Audit integrity coverage and privileged action volume.",
    domain: "Audit",
    resources: ["audit-log"],
    unit: "percent",
    direction: "higher_is_better",
    run: async (fastify, window) => {
      const result = await fastify.pg.query(
        `SELECT
           COUNT(*)::int AS total_events,
           COUNT(*) FILTER (WHERE entry_hash IS NOT NULL AND entry_hash <> '')::int AS hashed_events,
           COUNT(*) FILTER (
             WHERE action ILIKE '%admin%'
                OR action ILIKE '%permission%'
                OR action ILIKE '%rbac%'
                OR action ILIKE '%auth%'
                OR action ILIKE '%report%'
           )::int AS privileged_events,
           COUNT(DISTINCT actor_id)::int AS distinct_actors
         FROM audit_log
         WHERE created_at >= $1 AND created_at <= $2`,
        [window.from.toISOString(), window.to.toISOString()]
      );
      const row = result.rows[0] || {};
      const hashedEvents = numeric(row.hashed_events);
      const totalEvents = numeric(row.total_events);
      const value = percent(hashedEvents, totalEvents);
      return {
        value,
        status: kpiStatus(value, "higher_is_better", 100, 95),
        details: {
          totalEvents,
          hashedEvents,
          privilegedEvents: numeric(row.privileged_events),
          distinctActors: numeric(row.distinct_actors),
        },
      };
    },
  },
];

const KPI_BY_ID = new Map(KPI_DEFINITIONS.map((definition) => [definition.id, definition]));

async function runKpi(fastify: FastifyInstance, definition: ReportKpiDefinition, window: ReportWindow): Promise<ReportKpiResult> {
  const result = await definition.run(fastify, window);
  return {
    id: definition.id,
    label: definition.label,
    description: definition.description,
    domain: definition.domain,
    unit: definition.unit,
    direction: definition.direction,
    window: { from: window.from.toISOString(), to: window.to.toISOString() },
    ...result,
  };
}

export async function reportingRoutes(fastify: FastifyInstance) {
  fastify.get("/api/reports/datasets", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, request.user);
    if (!(await canUseReporting(fastify, role, "read"))) {
      return reply.status(403).send({ error: "Forbidden: cannot read reports" });
    }
    const visible = [];
    for (const dataset of DATASETS) {
      if (await canReadDataset(fastify, role, dataset)) visible.push(datasetDescriptor(dataset));
    }
    return { datasets: visible };
  });

  fastify.get("/api/reports/datasets/:id", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, request.user);
    const { id } = request.params as { id: string };
    const dataset = DATASET_BY_ID.get(id);
    if (!dataset) return reply.status(404).send({ error: "Dataset not found" });
    if (!(await canReadDataset(fastify, role, dataset))) {
      return reply.status(403).send({ error: "Forbidden: cannot read report dataset" });
    }
    return { dataset: datasetDescriptor(dataset) };
  });

  fastify.get("/api/reports/contracts/:target", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, request.user);
    if (!(await canUseReporting(fastify, role, "read"))) {
      return reply.status(403).send({ error: "Forbidden: cannot read report contracts" });
    }
    const { target: rawTarget } = request.params as { target: string };
    const target = contractTarget(rawTarget);
    if (!target) return reply.status(404).send({ error: "Report contract target not found" });

    const visible = [];
    for (const dataset of DATASETS) {
      if (await canReadDataset(fastify, role, dataset)) visible.push(dataset);
    }
    const contract = integrationContract(target, visible);
    await recordAuditEvent(fastify, {
      actorId: (request.user as any)?.id,
      action: "report.contract.read",
      entityType: "ReportContract",
      entityId: target,
      metadata: { source: "api.reports", target, datasetCount: visible.length },
    });
    return { contract };
  });

  fastify.get("/api/reports/kpis", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, request.user);
    if (!(await canUseReporting(fastify, role, "read"))) {
      return reply.status(403).send({ error: "Forbidden: cannot read report KPIs" });
    }
    const window = parseReportWindow(request.query as { from?: unknown; to?: unknown });
    const kpis: ReportKpiResult[] = [];
    for (const definition of KPI_DEFINITIONS) {
      if (await canReadResources(fastify, role, definition.resources)) {
        kpis.push(await runKpi(fastify, definition, window));
      }
    }
    await recordAuditEvent(fastify, {
      actorId: (request.user as any)?.id,
      action: "report.kpis.read",
      entityType: "ReportKpi",
      entityId: "summary",
      metadata: { source: "api.reports", kpiCount: kpis.length, from: window.from.toISOString(), to: window.to.toISOString() },
    });
    return { kpis, window: { from: window.from.toISOString(), to: window.to.toISOString() } };
  });

  fastify.get("/api/reports/kpis/:id", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, request.user);
    if (!(await canUseReporting(fastify, role, "read"))) {
      return reply.status(403).send({ error: "Forbidden: cannot read report KPIs" });
    }
    const { id } = request.params as { id: string };
    const definition = KPI_BY_ID.get(id);
    if (!definition) return reply.status(404).send({ error: "Report KPI not found" });
    if (!(await canReadResources(fastify, role, definition.resources))) {
      return reply.status(403).send({ error: "Forbidden: cannot read report KPI" });
    }
    const window = parseReportWindow(request.query as { from?: unknown; to?: unknown });
    const kpi = await runKpi(fastify, definition, window);
    await recordAuditEvent(fastify, {
      actorId: (request.user as any)?.id,
      action: "report.kpi.read",
      entityType: "ReportKpi",
      entityId: id,
      metadata: { source: "api.reports", kpiId: id, from: window.from.toISOString(), to: window.to.toISOString() },
    });
    return { kpi };
  });

  fastify.get("/api/reports/datasets/:id/query", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, request.user);
    const { id } = request.params as { id: string };
    const dataset = DATASET_BY_ID.get(id);
    if (!dataset) return reply.status(404).send({ error: "Dataset not found" });
    if (!(await canReadDataset(fastify, role, dataset))) {
      return reply.status(403).send({ error: "Forbidden: cannot read report dataset" });
    }
    const query = normalizeReportQuery(dataset, request.query as ReportQueryInput);
    const result = await runReportQuery(fastify, dataset, query);

    if (query.format === "csv") {
      const csv = rowsToCsv(result.rows);
      const signature = exportSignature(csv, process.env.JWT_SECRET);
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "report.exported",
        entityType: "ReportDataset",
        entityId: dataset.id,
        metadata: { source: "api.reports", datasetId: dataset.id, rowCount: result.rows.length, groupBy: query.groupBy },
      });
      return reply
        .type("text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${dataset.id}-report.csv"`)
        .header("x-specora-export-digest", signature.digest)
        .header("x-specora-export-signature", signature.signature)
        .header("x-specora-export-algorithm", signature.algorithm)
        .send(csv);
    }

    await recordAuditEvent(fastify, {
      actorId: (request.user as any)?.id,
      action: "report.queried",
      entityType: "ReportDataset",
      entityId: dataset.id,
      metadata: { source: "api.reports", datasetId: dataset.id, rowCount: result.rows.length, groupBy: query.groupBy },
    });
    return {
      dataset: datasetDescriptor(dataset),
      query: { from: query.from.toISOString(), to: query.to.toISOString(), filters: query.filters, groupBy: query.groupBy, limit: query.limit, offset: query.offset },
      grouped: result.grouped,
      rows: result.rows,
    };
  });

  fastify.get("/api/reports/saved", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, request.user);
    if (!(await canUseReporting(fastify, role, "read"))) {
      return reply.status(403).send({ error: "Forbidden: cannot read saved reports" });
    }
    const query = request.query as { datasetId?: string };
    const params: unknown[] = [actorKey(request.user)];
    let where = "user_id = $1";
    if (query.datasetId) {
      params.push(query.datasetId);
      where += ` AND dataset_id = $${params.length}`;
    }
    const result = await fastify.pg.query(
      `SELECT id, dataset_id, name, description, query, created_at, updated_at
       FROM report_saved_definitions
       WHERE ${where}
       ORDER BY updated_at DESC, name`,
      params
    );
    return { reports: result.rows.map(savedReportRow) };
  });

  fastify.post("/api/reports/saved", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, request.user);
    if (!(await canUseReporting(fastify, role, "write"))) {
      return reply.status(403).send({ error: "Forbidden: cannot save reports" });
    }
    const body = request.body as { datasetId?: string; name?: string; description?: string; query?: ReportQueryInput };
    const dataset = body.datasetId ? DATASET_BY_ID.get(body.datasetId) : null;
    if (!dataset || !body.name?.trim()) return reply.status(400).send({ error: "datasetId and name required" });
    if (!(await canReadDataset(fastify, role, dataset))) {
      return reply.status(403).send({ error: "Forbidden: cannot save this report dataset" });
    }
    const normalized = normalizeReportQuery(dataset, body.query || {});
    const query = {
      from: normalized.from.toISOString(),
      to: normalized.to.toISOString(),
      filters: normalized.filters,
      groupBy: normalized.groupBy,
      limit: normalized.limit,
      offset: normalized.offset,
    };
    const result = await fastify.pg.query(
      `INSERT INTO report_saved_definitions (user_id, dataset_id, name, description, query)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, dataset_id, name)
       DO UPDATE SET description = EXCLUDED.description,
                     query = EXCLUDED.query,
                     updated_at = NOW()
       RETURNING id, dataset_id, name, description, query, created_at, updated_at`,
      [actorKey(request.user), dataset.id, body.name.trim().slice(0, 160), body.description?.trim() || "", JSON.stringify(query)]
    );
    const report = savedReportRow(result.rows[0]);
    await recordAuditEvent(fastify, {
      actorId: (request.user as any)?.id,
      action: "report.saved",
      entityType: "SavedReport",
      entityId: report.id,
      newValues: report,
      metadata: { source: "api.reports", datasetId: dataset.id },
    });
    return { report };
  });

  fastify.delete("/api/reports/saved/:id", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, request.user);
    if (!(await canUseReporting(fastify, role, "write"))) {
      return reply.status(403).send({ error: "Forbidden: cannot delete saved reports" });
    }
    const { id } = request.params as { id: string };
    const result = await fastify.pg.query(
      `DELETE FROM report_saved_definitions
       WHERE id = $1 AND user_id = $2
       RETURNING id, dataset_id, name, description, query, created_at, updated_at`,
      [id, actorKey(request.user)]
    );
    if (!result.rows.length) return reply.status(404).send({ error: "Saved report not found" });
    const report = savedReportRow(result.rows[0]);
    await recordAuditEvent(fastify, {
      actorId: (request.user as any)?.id,
      action: "report.deleted",
      entityType: "SavedReport",
      entityId: id,
      oldValues: report,
      metadata: { source: "api.reports", datasetId: report.datasetId },
    });
    return { ok: true };
  });
}
