import type { FastifyInstance } from "fastify";
import neo4j from "neo4j-driver";
import { hasPermission, resolveUserRole } from "../services/rbac";
import { recordAuditEvent } from "../services/auditLog";
import {
  type BulkAction,
  type TableAction,
  type TableImportDecision,
  type TableImportRow,
  type TableSavedViewInput,
} from "./tableDefinitions";
import {
  assertReadableFilters,
  assertWritablePayload,
  attachValidationState,
  cleanupSuggestionForIssue,
  exportColumns,
  redactRecord,
  sanitizeSortField,
  tableFieldNames,
  tableWithFieldAccess,
  validationIssuesForRecord,
  validationSummary,
} from "./tables/access";
import {
  buildFilterWhere,
  cleanupReviewRow,
  createCmdbRecord,
  createPostgresRecord,
  getCmdbRecord,
  getPostgresRecord,
  getPostgresRecordsById,
  getRecordsByIdForCleanup,
  listPostgresRecords,
  normalizeImportMode,
  planImportDecisions,
  sanitizeMatchKeys,
  tableViewRow,
  updateCmdbRecord,
  updatePostgresRecord,
} from "./tables/dataAccess";
import {
  TABLE_RELATIONSHIP_PATTERN,
  actorKey,
  actorUuid,
  buildRelationshipFilterWhere,
  hasRelationshipFilters,
  neo4jPropertyProps,
  normalizeCleanupStatus,
  normalizeDensity,
  normalizeExportFormat,
  normalizeSeverity,
  normalizeSortDirection,
  parseFilters,
  parseNode,
  propertyExpression,
  quoteIdentifier,
  recordsToCsv,
  recordsToJson,
  sanitizeColumns,
  splitAttrs,
  timestampString,
} from "./tables/helpers";
import { getTables, resolveTable } from "./tables/registry";
export { getTables } from "./tables/registry";

async function getRole(fastify: FastifyInstance, user: { id?: string; role?: string } | null): Promise<string | null> {
  return resolveUserRole(fastify.pg, user);
}

function authUser(user: unknown): { id?: string; role?: string } | null {
  return typeof user === "object" && user !== null ? user as { id?: string; role?: string } : null;
}

function auditActorId(user: unknown): string | undefined {
  return typeof user === "object" && user !== null && "id" in user ? String(user.id) : undefined;
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

type GenericTableRecord = Record<string, unknown> & { id?: string; name?: string; number?: string | null };

type CleanupReviewRow = Record<string, unknown> & {
  id: string;
  table_id: string;
  record_id: string;
  record_label: string;
  reason: string;
  severity: string;
  status: string;
  created_at?: string | Date;
  updated_at?: string | Date;
};

type AuditLogRow = {
  id: string;
  actor_id?: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  old_values?: unknown;
  new_values?: unknown;
  metadata?: unknown;
  previous_hash?: string | null;
  entry_hash?: string | null;
  integrity_version?: number | null;
  created_at?: string | Date;
};

async function canUseTable(fastify: FastifyInstance, role: string | null, action: TableAction): Promise<boolean> {
  if (!role) return false;
  if (action === "delete") {
    return hasPermission(fastify.pg, { role, resource: "tables", action: "write" });
  }
  return hasPermission(fastify.pg, { role, resource: "tables", action });
}

export async function tableRoutes(fastify: FastifyInstance) {
  fastify.get("/api/tables/views", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, authUser(request.user));
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
    const role = await getRole(fastify, authUser(request.user));
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
    if (hasRelationshipFilters(filters) && table.provider !== "cmdb-class") {
      return reply.status(400).send({ error: "Relationship filters only apply to CMDB tables" });
    }
    const unreadableFilter = assertReadableFilters(filters, access);
    if (unreadableFilter) return reply.status(403).send({ error: `Forbidden: cannot save filter on ${unreadableFilter}` });
    const columns = sanitizeColumns(body.columns, tableFieldNames(table));
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
        actorId: auditActorId(request.user),
        action: "table.view.saved",
        entityType: "TableSavedView",
        entityId: result.rows[0].id,
        newValues: tableViewRow(result.rows[0]),
        metadata: { source: "api.tables", tableId: table.id },
      });
      return { view: tableViewRow(result.rows[0]) };
    } catch (err: unknown) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to save table view") });
    }
  });

  fastify.delete("/api/tables/views/:id", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, authUser(request.user));
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
      actorId: auditActorId(request.user),
      action: "table.view.deleted",
      entityType: "TableSavedView",
      entityId: id,
      oldValues: tableViewRow(result.rows[0]),
      metadata: { source: "api.tables", tableId: result.rows[0].table_id },
    });
    return { ok: true };
  });

  fastify.get("/api/tables", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, authUser(request.user));
    if (!(await canUseTable(fastify, role, "read"))) {
      return reply.status(403).send({ error: "Forbidden: cannot read tables" });
    }
    const tables = await getTables(fastify);
    const withAccess = await Promise.all(tables.map((table) => tableWithFieldAccess(fastify, role!, table)));
    return { tables: withAccess.map((item) => item.table) };
  });

  fastify.get("/api/tables/:table", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, authUser(request.user));
    if (!(await canUseTable(fastify, role, "read"))) {
      return reply.status(403).send({ error: "Forbidden: cannot read tables" });
    }
    const { table: tableId } = request.params as { table: string };
    const table = await resolveTable(fastify, tableId);
    if (!table) return reply.status(404).send({ error: "Table not found" });
    const withAccess = await tableWithFieldAccess(fastify, role!, table);
    return { table: withAccess.table };
  });

  fastify.get("/api/tables/cleanup-reviews", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, authUser(request.user));
    if (!(await canUseTable(fastify, role, "read"))) {
      return reply.status(403).send({ error: "Forbidden: cannot read tables" });
    }
    const query = request.query as { status?: string; tableId?: string; limit?: string; offset?: string };
    const limit = Math.min(Math.max(Number(query.limit || 100), 1), 250);
    const offset = Math.max(Number(query.offset || 0), 0);
    const params: unknown[] = [];
    const where: string[] = [];
    if (query.status && query.status !== "all") {
      params.push(normalizeCleanupStatus(query.status));
      where.push(`r.status = $${params.length}`);
    }
    if (query.tableId?.trim()) {
      params.push(query.tableId.trim());
      where.push(`r.table_id = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    params.push(limit);
    const limitParam = `$${params.length}`;
    params.push(offset);
    const offsetParam = `$${params.length}`;
    const result = await fastify.pg.query(
      `SELECT r.id, r.table_id, r.record_id, r.record_label, r.reason, r.severity, r.status, r.requested_by,
              r.created_at, r.updated_at, u.name AS requester_name, u.email AS requester_email
       FROM table_cleanup_reviews r
       LEFT JOIN users u ON u.id = r.requested_by
       ${whereSql}
       ORDER BY
         CASE r.severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
         r.updated_at DESC
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params
    );
    const count = await fastify.pg.query(`SELECT COUNT(*)::int AS total FROM table_cleanup_reviews r ${whereSql}`, params.slice(0, -2));
    const tables = await getTables(fastify);
    const labels = new Map(tables.map((table) => [table.id, table.label]));
    return {
      reviews: (result.rows as CleanupReviewRow[]).map((row) => cleanupReviewRow({ ...row, table_label: labels.get(String(row.table_id || "")) })),
      total: count.rows[0]?.total || 0,
      limit,
      offset,
    };
  });

  fastify.patch("/api/tables/cleanup-reviews/:id", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, authUser(request.user));
    if (!(await canUseTable(fastify, role, "write"))) {
      return reply.status(403).send({ error: "Forbidden: cannot write tables" });
    }
    const { id } = request.params as { id: string };
    const body = request.body as { status?: string };
    const status = normalizeCleanupStatus(body.status);
    const before = await fastify.pg.query(
      `SELECT id, table_id, record_id, record_label, reason, severity, status, requested_by, created_at, updated_at
       FROM table_cleanup_reviews
       WHERE id = $1`,
      [id]
    );
    const oldRow = before.rows[0];
    if (!oldRow) return reply.status(404).send({ error: "Cleanup review not found" });
    const result = await fastify.pg.query(
      `UPDATE table_cleanup_reviews
       SET status = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING id, table_id, record_id, record_label, reason, severity, status, requested_by, created_at, updated_at`,
      [id, status]
    );
    const row = result.rows[0];
    await recordAuditEvent(fastify, {
      actorId: auditActorId(request.user),
      action: "table.cleanup_review.status_updated",
      entityType: "TableCleanupReview",
      entityId: id,
      oldValues: cleanupReviewRow(oldRow),
      newValues: cleanupReviewRow(row),
      metadata: { source: "api.tables", tableId: row.table_id, recordId: row.record_id },
    });
    return { review: cleanupReviewRow(row) };
  });

  fastify.get("/api/tables/:table/records", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, authUser(request.user));
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
    if (hasRelationshipFilters(filters) && table.provider !== "cmdb-class") {
      return reply.status(400).send({ error: "Relationship filters only apply to CMDB tables" });
    }
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
    whereParts.push(...buildRelationshipFilterWhere(filters, params));
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
        records: result.records.map((record) => attachValidationState(tableForUser, redactRecord(parseNode(record.get("n")), access), access)),
        total: countResult.records[0]?.get("total")?.toNumber?.() ?? Number(countResult.records[0]?.get("total") ?? 0),
      };
    } finally {
      await session.close();
    }
  });

  fastify.get("/api/tables/:table/records/:id", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, authUser(request.user));
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

  fastify.get("/api/tables/:table/records/:id/validation", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, authUser(request.user));
    if (!(await canUseTable(fastify, role, "read"))) {
      return reply.status(403).send({ error: "Forbidden: cannot read tables" });
    }
    const { table: tableId, id } = request.params as { table: string; id: string };
    const table = await resolveTable(fastify, tableId);
    if (!table) return reply.status(404).send({ error: "Table not found" });
    const { table: tableForUser, access } = await tableWithFieldAccess(fastify, role!, table);
    let record: GenericTableRecord | null = null;
    let relationshipCount: number | undefined;

    if (table.provider === "postgres-table") {
      record = await getPostgresRecord(fastify, tableForUser, id, access);
      if (!record) return reply.status(404).send({ error: "Record not found" });
    } else {
      const session = fastify.neo4j.session();
      try {
        const result = await session.run(
          `MATCH (n:ConfigurationItem {id: $id})
           WHERE n.class = $className
           OPTIONAL MATCH (n)-[r:${TABLE_RELATIONSHIP_PATTERN}]-()
           RETURN n, count(r) AS relationshipCount`,
          { id, className: table.className }
        );
        const row = result.records[0];
        const node = row?.get("n");
        if (!node) return reply.status(404).send({ error: "Record not found" });
        record = redactRecord(parseNode(node), access);
        relationshipCount = row.get("relationshipCount")?.toNumber?.() ?? Number(row.get("relationshipCount") ?? 0);
      } finally {
        await session.close();
      }
    }

    const issues = validationIssuesForRecord(tableForUser, record, access, relationshipCount);
    return {
      table: tableForUser,
      recordId: id,
      issues,
      summary: {
        issueCount: issues.length,
        errors: issues.filter((issue) => issue.severity === "error").length,
        warnings: issues.filter((issue) => issue.severity === "warn").length,
        relationshipCount,
      },
    };
  });

  fastify.get("/api/tables/:table/records/:id/audit", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, authUser(request.user));
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
      entries: (result.rows as AuditLogRow[]).map((row) => ({
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
        createdAt: timestampString(row.created_at),
      })),
    };
  });

  fastify.post("/api/tables/:table/export", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, authUser(request.user));
    if (!(await canUseTable(fastify, role, "read"))) {
      return reply.status(403).send({ error: "Forbidden: cannot read tables" });
    }
    const { table: tableId } = request.params as { table: string };
    const body = request.body as { recordIds?: unknown; columns?: unknown; format?: unknown };
    const table = await resolveTable(fastify, tableId);
    if (!table) return reply.status(404).send({ error: "Table not found" });
    const { table: tableForUser, access } = await tableWithFieldAccess(fastify, role!, table);
    const recordIds = Array.isArray(body.recordIds)
      ? Array.from(new Set(body.recordIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0).map((id) => id.trim()))).slice(0, 1000)
      : [];
    if (!recordIds.length) return reply.status(400).send({ error: "recordIds required" });
    const columns = exportColumns(tableForUser, body.columns, access);
    const format = normalizeExportFormat(body.format);
    if (!columns.length) return reply.status(403).send({ error: "Forbidden: no readable export columns" });

    let records: GenericTableRecord[] = [];
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
      actorId: auditActorId(request.user),
      action: "table.records.exported",
      entityType: table.id,
      entityId: table.id,
      metadata: {
        source: "api.tables",
        provider: table.provider,
        recordCount: records.length,
        requestedRecordCount: recordIds.length,
        columns,
        format,
      },
    });

    if (format === "json") {
      return reply
        .type("application/json; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${table.id.replace(/[^a-zA-Z0-9_.-]/g, "_")}-records.json"`)
        .send(recordsToJson(records, columns));
    }

    return reply
      .type("text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${table.id.replace(/[^a-zA-Z0-9_.-]/g, "_")}-records.csv"`)
      .send(recordsToCsv(records, columns));
  });

  fastify.post("/api/tables/:table/bulk", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, authUser(request.user));
    if (!(await canUseTable(fastify, role, "write"))) {
      return reply.status(403).send({ error: "Forbidden: cannot write tables" });
    }
    const { table: tableId } = request.params as { table: string };
    const body = request.body as {
      action?: BulkAction;
      recordIds?: unknown;
      patch?: { name?: string; environment?: string; attributes?: Record<string, unknown> };
    };
    const table = await resolveTable(fastify, tableId);
    if (!table) return reply.status(404).send({ error: "Table not found" });
    const { table: tableForUser, access } = await tableWithFieldAccess(fastify, role!, table);
    const recordIds = Array.isArray(body.recordIds)
      ? Array.from(new Set(body.recordIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0).map((id) => id.trim()))).slice(0, 1000)
      : [];
    if (!recordIds.length) return reply.status(400).send({ error: "recordIds required" });
    const action = body.action === "delete" ? "delete" : body.action === "update" ? "update" : null;
    if (!action) return reply.status(400).send({ error: "Unsupported bulk action" });

    const updated: GenericTableRecord[] = [];
    const deleted: string[] = [];
    const errors: Array<{ recordId: string; error: string }> = [];

    if (action === "update") {
      const patch = body.patch || {};
      const blockedField = assertWritablePayload(patch, access);
      if (blockedField) return reply.status(403).send({ error: `Forbidden: cannot write ${blockedField}` });
      for (const id of recordIds) {
        try {
          const before = table.provider === "postgres-table"
            ? await getPostgresRecord(fastify, tableForUser, id)
            : await getCmdbRecord(fastify, tableForUser, id);
          const record = table.provider === "postgres-table"
            ? await updatePostgresRecord(fastify, tableForUser, id, patch)
            : await updateCmdbRecord(fastify, tableForUser, id, patch);
          if (!record) {
            errors.push({ recordId: id, error: "Record not found" });
            continue;
          }
          updated.push(record);
          await recordAuditEvent(fastify, {
            actorId: auditActorId(request.user),
            action: "table.record.updated",
            entityType: table.id,
            entityId: id,
            oldValues: before || undefined,
            newValues: record,
            metadata: { source: "api.tables.bulk", provider: table.provider },
          });
        } catch (err: unknown) {
          errors.push({ recordId: id, error: errorMessage(err, "Bulk update failed") });
        }
      }
    } else {
      for (const id of recordIds) {
        try {
          const before = table.provider === "postgres-table"
            ? await getPostgresRecord(fastify, tableForUser, id)
            : await getCmdbRecord(fastify, tableForUser, id);
          if (table.provider === "postgres-table") {
            await fastify.pg.query(`DELETE FROM ${quoteIdentifier(table.tableName!)} WHERE id = $1`, [id]);
          } else {
            const session = fastify.neo4j.session();
            try {
              await session.run(
                `MATCH (n:ConfigurationItem {id: $id})
                 WHERE n.class = $className
                 DETACH DELETE n`,
                { id, className: table.className }
              );
            } finally {
              await session.close();
            }
          }
          deleted.push(id);
          await recordAuditEvent(fastify, {
            actorId: auditActorId(request.user),
            action: "table.record.deleted",
            entityType: table.id,
            entityId: id,
            oldValues: before || { id },
            metadata: { source: "api.tables.bulk", provider: table.provider },
          });
        } catch (err: unknown) {
          errors.push({ recordId: id, error: errorMessage(err, "Bulk delete failed") });
        }
      }
    }

    await recordAuditEvent(fastify, {
      actorId: auditActorId(request.user),
      action: action === "update" ? "table.records.bulk_updated" : "table.records.bulk_deleted",
      entityType: table.id,
      entityId: table.id,
      metadata: {
        source: "api.tables.bulk",
        provider: table.provider,
        requestedRecordCount: recordIds.length,
        updatedRecordCount: updated.length,
        deletedRecordCount: deleted.length,
        errorCount: errors.length,
      },
    });

    return {
      table: tableForUser,
      updated: updated.map((record) => redactRecord(record, access)),
      deleted,
      errors,
      summary: {
        requested: recordIds.length,
        updated: updated.length,
        deleted: deleted.length,
        failed: errors.length,
      },
    };
  });

  fastify.post("/api/tables/:table/cleanup-assist", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, authUser(request.user));
    if (!(await canUseTable(fastify, role, "read"))) {
      return reply.status(403).send({ error: "Forbidden: cannot read tables" });
    }
    const { table: tableId } = request.params as { table: string };
    const body = request.body as { recordIds?: unknown };
    const table = await resolveTable(fastify, tableId);
    if (!table) return reply.status(404).send({ error: "Table not found" });
    const { table: tableForUser, access } = await tableWithFieldAccess(fastify, role!, table);
    const recordIds = Array.isArray(body.recordIds)
      ? Array.from(new Set(body.recordIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0).map((id) => id.trim()))).slice(0, 100)
      : [];
    if (!recordIds.length) return reply.status(400).send({ error: "recordIds required" });

    const records = await getRecordsByIdForCleanup(fastify, tableForUser, recordIds, access);
    const suggestions = records.map((record) => {
      const issues = validationIssuesForRecord(tableForUser, record, access);
      const recommendations = issues.map(cleanupSuggestionForIssue);
      const severity = recommendations.some((item) => item.severity === "high") ? "high" : recommendations.some((item) => item.severity === "medium") ? "medium" : "low";
      return {
        recordId: record.id,
        recordLabel: record.name || record.number || record.id,
        validation: validationSummary(issues),
        severity,
        reviewReason: recommendations.length
          ? recommendations.map((item) => item.recommendation).join(" ")
          : "No cleanup issues detected by the stewardship assistant.",
        recommendations,
      };
    });

    await recordAuditEvent(fastify, {
      actorId: auditActorId(request.user),
      action: "table.cleanup_assist.generated",
      entityType: table.id,
      entityId: table.id,
      metadata: { source: "api.tables.cleanup-assist", provider: table.provider, recordCount: suggestions.length },
    });

    return { table: tableForUser, suggestions };
  });

  fastify.post("/api/tables/:table/cleanup-reviews", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, authUser(request.user));
    if (!(await canUseTable(fastify, role, "write"))) {
      return reply.status(403).send({ error: "Forbidden: cannot write tables" });
    }
    const { table: tableId } = request.params as { table: string };
    const body = request.body as { recordIds?: unknown; reason?: string; severity?: string };
    const table = await resolveTable(fastify, tableId);
    if (!table) return reply.status(404).send({ error: "Table not found" });
    const { table: tableForUser, access } = await tableWithFieldAccess(fastify, role!, table);
    const recordIds = Array.isArray(body.recordIds)
      ? Array.from(new Set(body.recordIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0).map((id) => id.trim()))).slice(0, 250)
      : [];
    const reason = body.reason?.trim().slice(0, 1000);
    if (!recordIds.length) return reply.status(400).send({ error: "recordIds required" });
    if (!reason) return reply.status(400).send({ error: "reason required" });

    const records = await getRecordsByIdForCleanup(fastify, tableForUser, recordIds, access);
    if (!records.length) return reply.status(404).send({ error: "No matching records found" });
    const severity = normalizeSeverity(body.severity);
    const rows = await Promise.all(records.map(async (record) => {
      const result = await fastify.pg.query(
        `INSERT INTO table_cleanup_reviews (table_id, record_id, record_label, reason, severity, status, requested_by)
         VALUES ($1, $2, $3, $4, $5, 'open', $6)
         ON CONFLICT (table_id, record_id)
         DO UPDATE SET record_label = EXCLUDED.record_label,
                       reason = EXCLUDED.reason,
                       severity = EXCLUDED.severity,
                       status = 'open',
                       requested_by = EXCLUDED.requested_by,
                       updated_at = NOW()
         RETURNING id, table_id, record_id, record_label, reason, severity, status, requested_by, created_at, updated_at`,
        [table.id, record.id, record.name || record.number || record.id, reason, severity, actorUuid(request.user)]
      );
      return result.rows[0];
    }));

    await recordAuditEvent(fastify, {
      actorId: auditActorId(request.user),
      action: "table.cleanup_review.queued",
      entityType: "TableCleanupReview",
      entityId: table.id,
      newValues: { tableId: table.id, recordIds: rows.map((row) => row.record_id), reason, severity },
      metadata: {
        source: "api.tables",
        provider: table.provider,
        requestedRecordCount: recordIds.length,
        queuedRecordCount: rows.length,
      },
    });

    return {
      table: tableForUser,
      reviews: rows.map((row) => ({
        id: row.id,
        tableId: row.table_id,
        recordId: row.record_id,
        recordLabel: row.record_label,
        reason: row.reason,
        severity: row.severity,
        status: row.status,
        requestedBy: row.requested_by,
        createdAt: timestampString(row.created_at),
        updatedAt: timestampString(row.updated_at),
      })),
    };
  });

  fastify.post("/api/tables/:table/import", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, authUser(request.user));
    if (!(await canUseTable(fastify, role, "write"))) {
      return reply.status(403).send({ error: "Forbidden: cannot write tables" });
    }
    const { table: tableId } = request.params as { table: string };
    const body = request.body as {
      dryRun?: boolean;
      mode?: string;
      matchKeys?: unknown;
      rows?: unknown;
      source?: { filename?: string; fileType?: string; rowCount?: number };
    };
    const table = await resolveTable(fastify, tableId);
    if (!table) return reply.status(404).send({ error: "Table not found" });
    const { table: tableForUser, access } = await tableWithFieldAccess(fastify, role!, table);
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 250) as TableImportRow[] : [];
    if (!rows.length) return reply.status(400).send({ error: "rows required" });
    if (Array.isArray(body.rows) && body.rows.length > 250) {
      return reply.status(400).send({ error: "Imports are limited to 250 rows per commit" });
    }
    const mode = normalizeImportMode(body.mode);
    const matchKeys = sanitizeMatchKeys(tableForUser, body.matchKeys, access);
    if (mode !== "create" && !matchKeys.length) {
      return reply.status(400).send({ error: "matchKeys required for update and upsert imports" });
    }

    const errors: Array<{ row: number; error: string }> = [];
    const candidates = rows.map((row, index) => {
      const payload: TableImportRow = {
        name: typeof row?.name === "string" ? row.name.trim() : row?.name == null ? "" : String(row.name).trim(),
        environment: typeof row?.environment === "string" ? row.environment.trim() || undefined : row?.environment == null ? undefined : String(row.environment).trim() || undefined,
        attributes: splitAttrs(row?.attributes),
      };
      if (!payload.name) errors.push({ row: index + 1, error: "name is required" });
      const blockedField = assertWritablePayload(payload, access);
      if (blockedField) errors.push({ row: index + 1, error: `cannot write ${blockedField}` });
      return payload;
    });
    if (errors.length) return reply.status(400).send({ table: tableForUser, created: [], errors });

    const decisions = await planImportDecisions(fastify, tableForUser, candidates, mode, matchKeys);
    const counts = decisions.reduce((acc, decision) => {
      acc[decision.action] = (acc[decision.action] || 0) + 1;
      return acc;
    }, {} as Record<TableImportDecision["action"], number>);
    if (body.dryRun) {
      await recordAuditEvent(fastify, {
        actorId: auditActorId(request.user),
        action: "table.records.import_previewed",
        entityType: table.id,
        entityId: table.id,
        metadata: {
          source: "api.tables.import",
          provider: table.provider,
          mode,
          matchKeys,
          fileName: body.source?.filename,
          requestedRecordCount: rows.length,
          counts,
        },
      });
      return { table: tableForUser, decisions, errors: [], summary: { requested: rows.length, ...counts } };
    }

    const created: GenericTableRecord[] = [];
    const updated: GenericTableRecord[] = [];
    const skipped: TableImportDecision[] = [];
    for (const decision of decisions) {
      const index = decision.row - 1;
      const payload = decision.payload;
      if (decision.action === "skip" || decision.action === "conflict") {
        skipped.push(decision);
        continue;
      }
      try {
        const before = decision.action === "update"
          ? table.provider === "postgres-table"
            ? await getPostgresRecord(fastify, tableForUser, decision.recordId!)
            : await getCmdbRecord(fastify, tableForUser, decision.recordId!)
          : null;
        const record = decision.action === "update"
          ? table.provider === "postgres-table"
            ? await updatePostgresRecord(fastify, tableForUser, decision.recordId!, payload)
            : await updateCmdbRecord(fastify, tableForUser, decision.recordId!, payload)
          : table.provider === "postgres-table"
            ? await createPostgresRecord(fastify, tableForUser, payload)
            : await createCmdbRecord(fastify, tableForUser, payload);
        if (!record) throw new Error("Matched record was not found");
        if (decision.action === "update") updated.push(record);
        else created.push(record);
        await recordAuditEvent(fastify, {
          actorId: auditActorId(request.user),
          action: decision.action === "update" ? "table.record.updated" : "table.record.created",
          entityType: table.id,
          entityId: record.id,
          oldValues: before || undefined,
          newValues: record,
          metadata: { source: "api.tables.import", provider: table.provider, row: index + 1, mode, matchKeys, fileName: body.source?.filename },
        });
      } catch (err: unknown) {
        errors.push({ row: index + 1, error: errorMessage(err, "Failed to create record") });
      }
    }

    await recordAuditEvent(fastify, {
      actorId: auditActorId(request.user),
      action: "table.records.imported",
      entityType: table.id,
      entityId: table.id,
      newValues: { createdRecordIds: created.map((record) => record.id), updatedRecordIds: updated.map((record) => record.id) },
      metadata: {
        source: "api.tables.import",
        provider: table.provider,
        mode,
        matchKeys,
        tableName: table.tableName,
        className: table.className,
        fileName: body.source?.filename,
        fileType: body.source?.fileType,
        requestedRecordCount: rows.length,
        createdRecordCount: created.length,
        updatedRecordCount: updated.length,
        skippedRecordCount: skipped.length,
        errorCount: errors.length,
      },
    });

    return {
      table: tableForUser,
      created: created.map((record) => redactRecord(record, access)),
      updated: updated.map((record) => redactRecord(record, access)),
      skipped,
      decisions,
      errors,
      summary: {
        requested: rows.length,
        created: created.length,
        updated: updated.length,
        skipped: skipped.length,
        failed: errors.length,
      },
    };
  });

  fastify.post("/api/tables/:table/records", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, authUser(request.user));
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
        actorId: auditActorId(request.user),
        action: "table.record.created",
        entityType: table.id,
        entityId: record.id,
        newValues: record,
        metadata: { source: "api.tables", provider: table.provider, tableName: table.tableName },
      });
      return reply.status(201).send({ table: tableForUser, record: redactRecord(record, access) });
    }

    const created = await createCmdbRecord(fastify, tableForUser, body);
    await recordAuditEvent(fastify, {
      actorId: auditActorId(request.user),
      action: "table.record.created",
      entityType: table.id,
      entityId: created.id,
      newValues: created,
      metadata: { source: "api.tables", provider: table.provider, className: table.className },
    });
    return reply.status(201).send({ table: tableForUser, record: redactRecord(created, access) });
  });

  fastify.patch("/api/tables/:table/records/:id", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const role = await getRole(fastify, authUser(request.user));
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
        actorId: auditActorId(request.user),
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
          props: hasAttributes ? neo4jPropertyProps(attrs) : {},
        }
      );
      const record = result.records[0]?.get("n");
      const updated = parseNode(record);
      await recordAuditEvent(fastify, {
        actorId: auditActorId(request.user),
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
    const role = await getRole(fastify, authUser(request.user));
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
        actorId: auditActorId(request.user),
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
        actorId: auditActorId(request.user),
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
