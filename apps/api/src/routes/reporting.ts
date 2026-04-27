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

type ReportQueryInput = {
  from?: unknown;
  to?: unknown;
  groupBy?: unknown;
  filters?: unknown;
  limit?: unknown;
  offset?: unknown;
  format?: unknown;
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
