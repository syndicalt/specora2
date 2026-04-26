import type { FastifyInstance } from "fastify";
import { hasPermission, resolveUserRole } from "../services/rbac";
import { recordRouteAudit } from "./auditHelpers";

const FOUNDATION_CLASSES = [
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
];

type FoundationIssue = {
  id: string;
  severity: "high" | "medium" | "low";
  className: string;
  displayName: string;
  recordId?: string;
  recordName?: string;
  field?: string;
  fieldDisplayName?: string;
  title: string;
  description: string;
  action: "register_class" | "add_records" | "edit_record" | "define_key";
};

function parseAttrs(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return typeof value === "object" ? value as Record<string, unknown> : {};
}

function hasValue(record: Record<string, unknown>, attrName: string): boolean {
  const attrs = parseAttrs(record.attributes);
  const value = record[attrName] ?? attrs[attrName];
  return value !== undefined && value !== null && value !== "";
}

function issueSort(a: FoundationIssue, b: FoundationIssue) {
  const weight = { high: 0, medium: 1, low: 2 };
  return weight[a.severity] - weight[b.severity] || a.displayName.localeCompare(b.displayName);
}

async function authorize(fastify: FastifyInstance, request: any, reply: any, action: "read" | "write") {
  const user = request.user as { id?: string; role?: string } | null;
  const role = await resolveUserRole(fastify.pg, user);
  if (!role || !(await hasPermission(fastify.pg, { role, resource: "data-foundations", action }))) {
    reply.status(403).send({ error: `Forbidden: cannot ${action} data foundations` });
    return false;
  }
  return true;
}

async function loadFoundationClasses(fastify: FastifyInstance) {
  const classes = await fastify.pg.query(
    `SELECT c.id, c.name, c.display_name,
            COALESCE(
              json_agg(
                json_build_object(
                  'name', a.name,
                  'displayName', a.display_name,
                  'isMandatory', a.is_mandatory,
                  'isHealthRequired', a.is_health_required,
                  'isKeyAttribute', a.is_key_attribute
                )
                ORDER BY a.sort_order, a.name
              ) FILTER (WHERE a.id IS NOT NULL),
              '[]'
            ) AS attributes
     FROM ci_classes c
     LEFT JOIN ci_class_attributes a ON a.class_id = c.id
     WHERE c.name = ANY($1)
     GROUP BY c.id, c.name, c.display_name`,
    [FOUNDATION_CLASSES]
  );
  return new Map(classes.rows.map((row: any) => [row.name, row]));
}

async function analyzeFoundations(fastify: FastifyInstance) {
  const classMap = await loadFoundationClasses(fastify);
  const session = fastify.neo4j.session();
  try {
    const tables = [];
    const issues: FoundationIssue[] = [];
    const checks = [];

    for (const className of FOUNDATION_CLASSES) {
      const cls = classMap.get(className) as any;
      if (!cls) {
        tables.push({
          table: `cmdb.${className}`,
          className,
          displayName: className,
          registered: false,
          recordCount: 0,
          requiredAttributes: [],
          completeness: null,
          missingRequiredCount: 0,
        });
        issues.push({
          id: `missing-class:${className}`,
          severity: "high",
          className,
          displayName: className,
          title: `${className} is not registered`,
          description: "This CSDMv5 foundation class is missing from CI Class Manager.",
          action: "register_class",
        });
        continue;
      }

      const result = await session.run(
        `MATCH (n:ConfigurationItem)
         WHERE n.class = $className
         RETURN n`,
        { className }
      );
      const records = result.records.map((record) => record.get("n").properties as Record<string, unknown>);
      const attrs = Array.isArray(cls.attributes) ? cls.attributes : JSON.parse(cls.attributes || "[]");
      const required = attrs.filter((attr: any) => attr.isMandatory);
      const keyAttrs = attrs.filter((attr: any) => attr.isKeyAttribute);
      let missing = 0;

      for (const record of records) {
        for (const attr of required) {
          if (hasValue(record, attr.name)) continue;
          missing += 1;
          if (issues.length < 100) {
            issues.push({
              id: `missing-required:${className}:${record.id}:${attr.name}`,
              severity: "high",
              className,
              displayName: cls.display_name || className,
              recordId: String(record.id),
              recordName: String(record.name || record.id),
              field: attr.name,
              fieldDisplayName: attr.displayName || attr.name,
              title: `${record.name || record.id} is missing ${attr.displayName || attr.name}`,
              description: "Required foundation data is incomplete, which weakens service ownership, location, cost, and support routing.",
              action: "edit_record",
            });
          }
        }
      }

      if (records.length === 0) {
        issues.push({
          id: `empty-class:${className}`,
          severity: "medium",
          className,
          displayName: cls.display_name || className,
          title: `${cls.display_name || className} has no records`,
          description: "The class is registered, but no foundation records exist yet.",
          action: "add_records",
        });
      }
      if (keyAttrs.length === 0) {
        issues.push({
          id: `no-key:${className}`,
          severity: "low",
          className,
          displayName: cls.display_name || className,
          title: `${cls.display_name || className} has no key attribute`,
          description: "Define at least one key attribute to make reconciliation and duplicate detection more reliable.",
          action: "define_key",
        });
      }

      const completeness = records.length === 0 || required.length === 0
        ? 1
        : 1 - missing / records.length;

      tables.push({
        table: `cmdb.${className}`,
        className,
        displayName: cls.display_name || className,
        registered: true,
        recordCount: records.length,
        requiredAttributes: required.map((attr: any) => ({
          name: attr.name,
          displayName: attr.displayName || attr.name,
        })),
        completeness,
        missingRequiredCount: missing,
      });

      checks.push({
        id: `completeness:${className}`,
        title: `${cls.display_name || className} completeness`,
        status: completeness === 1 ? "pass" : "fail",
        affectedCount: missing,
        detail: missing ? `${missing} required values are missing.` : "All required values are populated.",
      });
    }

    const registered = tables.filter((table) => table.registered);
    const totalRecords = tables.reduce((sum, table) => sum + table.recordCount, 0);
    const averageCompleteness = registered.length
      ? registered.reduce((sum, table) => sum + (table.completeness ?? 1), 0) / registered.length
      : 1;

    return {
      summary: {
        totalTables: tables.length,
        registeredTables: registered.length,
        totalRecords,
        averageCompleteness,
        tablesNeedingAttention: tables.filter((table) => table.registered && (table.completeness ?? 1) < 1).length,
        openIssues: issues.length,
      },
      tables,
      issues: issues.sort(issueSort),
      checks,
    };
  } finally {
    await session.close();
  }
}

export async function dataFoundationRoutes(fastify: FastifyInstance) {
  fastify.get("/api/data-foundations/summary", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await authorize(fastify, request, reply, "read"))) return;
    const analysis = await analyzeFoundations(fastify);
    return { summary: analysis.summary, tables: analysis.tables };
  });

  fastify.get("/api/data-foundations/stewardship", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await authorize(fastify, request, reply, "read"))) return;
    const analysis = await analyzeFoundations(fastify);
    return { summary: analysis.summary, issues: analysis.issues };
  });

  fastify.get("/api/data-foundations/validation", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await authorize(fastify, request, reply, "read"))) return;
    const analysis = await analyzeFoundations(fastify);
    return { summary: analysis.summary, checks: analysis.checks };
  });

  fastify.patch("/api/data-foundations/foundation-records/:className/:id", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!(await authorize(fastify, request, reply, "write"))) return;
    const { className, id } = request.params as { className: string; id: string };
    const body = request.body as { fields?: Record<string, unknown> };
    if (!FOUNDATION_CLASSES.includes(className) || !body?.fields || Object.keys(body.fields).length === 0) {
      return reply.status(400).send({ error: "A foundation class and at least one field are required" });
    }

    const classMap = await loadFoundationClasses(fastify);
    const cls = classMap.get(className) as any;
    if (!cls) return reply.status(404).send({ error: "Foundation class is not registered" });
    const attrs = Array.isArray(cls.attributes) ? cls.attributes : JSON.parse(cls.attributes || "[]");
    const classAttrNames = new Set(attrs.map((attr: any) => attr.name));

    const session = fastify.neo4j.session();
    try {
      const current = await session.run(
        `MATCH (n:ConfigurationItem {id: $id})
         WHERE n.class = $className
         RETURN n`,
        { id, className }
      );
      if (!current.records.length) return reply.status(404).send({ error: "Foundation record not found" });
      const record = current.records[0].get("n").properties as Record<string, unknown>;
      const topLevelProps: Record<string, unknown> = {};
      const attributes = { ...parseAttrs(record.attributes) };
      for (const [key, value] of Object.entries(body.fields)) {
        if (classAttrNames.has(key)) topLevelProps[key] = value;
        else attributes[key] = value;
      }
      const updated = await session.run(
        `MATCH (n:ConfigurationItem {id: $id})
         WHERE n.class = $className
         SET n += $topLevelProps, n.attributes = $attributes
         RETURN n`,
        { id, className, topLevelProps, attributes: JSON.stringify(attributes) }
      );
      const updatedRecord = updated.records[0].get("n").properties;
      await recordRouteAudit(fastify, request, {
        action: "data_foundations.foundation_record_updated",
        entityType: className,
        entityId: id,
        oldValues: record,
        newValues: updatedRecord,
        metadata: { source: "api.data-foundations", surface: "data-foundations", className },
      });
      return { record: updatedRecord };
    } finally {
      await session.close();
    }
  });
}
