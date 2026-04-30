import { GraphQLError } from "graphql";
import neo4j from "neo4j-driver";
import type { Driver, Record as Neo4jRecord } from "neo4j-driver";
import {
  CreateCIInputSchema,
  UpdateCIInputSchema,
  CreateRelationshipInputSchema,
  DeleteRelationshipInputSchema,
  UpdateRelationshipInputSchema,
} from "@specora/core";
import { neo4jPropertyProps, parseNode } from "./ciNode";
import { discoveryMutations, discoveryQueries } from "./discoveryResolvers";
import { graphQueries } from "./graphResolvers";
import { marketplaceMutations, marketplaceQueries } from "./marketplaceResolvers";
import { assertRelationshipType, mapRelationshipType, RELATIONSHIP_TYPE_PATTERN } from "./relationshipTypes";
import { checkPermission, getClassDefinition, mapEnvironmentChoice, validateCIAgainstClass } from "./resolverSupport";
import { savedViewMutations, savedViewQueries } from "./savedViewResolvers";
import { userMutations, userQueries } from "./userResolvers";

type QueryablePg = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
};

type ResolverContext = {
  neo4j: Driver;
  pg: QueryablePg;
  user?: unknown;
};

type CiFilter = {
  class?: string;
  environment?: string;
  name?: string;
};

type CiListArgs = {
  filter?: CiFilter;
  limit?: number;
  offset?: number;
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
  created_at?: string | Date;
};

type CiClassRow = {
  id: string;
  name: string;
  display_name?: string | null;
  description?: string | null;
  parent_class?: string | null;
  icon?: string | null;
  color?: string | null;
  display_field?: string | null;
  secondary_display_fields?: string[] | null;
  is_system?: boolean;
  created_by_app_id?: string | null;
  created_at?: string | Date;
  updated_at?: string | Date;
};

function applyCiFilter(query: string, params: Record<string, unknown>, filter?: CiFilter) {
  const conditions: string[] = [];
  if (filter?.class) {
    conditions.push("n.class = $class");
    params.class = filter.class;
  }
  if (filter?.environment) {
    conditions.push("n.environment = $environment");
    params.environment = filter.environment;
  }
  if (filter?.name) {
    conditions.push("n.name CONTAINS $name");
    params.name = filter.name;
  }
  return conditions.length ? `${query} WHERE ${conditions.join(" AND ")}` : query;
}

function mapAuditLogRow(row: AuditLogRow) {
  return {
    id: row.id,
    actorId: row.actor_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    oldValues: row.old_values,
    newValues: row.new_values,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

function mapCiClassRow(row: CiClassRow) {
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    description: row.description,
    parentClass: row.parent_class,
    icon: row.icon,
    color: row.color,
    displayField: row.display_field,
    secondaryDisplayFields: row.secondary_display_fields || [],
    isSystem: row.is_system,
    createdByAppId: row.created_by_app_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const resolvers = {
  Query: {
    async ci(_parent: unknown, args: { id: string }, context: ResolverContext) {
      const session = context.neo4j.session();
      try {
        const result = await session.run(
          `MATCH (n:ConfigurationItem {id: $id}) RETURN n`,
          { id: args.id }
        );
        const record = result.records[0];
        if (!record) return null;
        return parseNode(record.get("n").properties);
      } finally {
        await session.close();
      }
    },
    async cis(_parent: unknown, args: CiListArgs, context: ResolverContext) {
      const session = context.neo4j.session();
      try {
        const params: Record<string, unknown> = {};
        let query = applyCiFilter("MATCH (n:ConfigurationItem)", params, args.filter);
        query += " RETURN n";
        if (args.offset !== undefined && args.offset > 0) {
          query += " SKIP $offset";
          params.offset = neo4j.int(args.offset);
        }
        query += " LIMIT $limit";
        params.limit = neo4j.int(args.limit ?? 100);
        const result = await session.run(query, params);
        return result.records.map((record: Neo4jRecord) => parseNode(record.get("n").properties));
      } finally {
        await session.close();
      }
    },
    async ciCount(_parent: unknown, args: { filter?: CiFilter }, context: ResolverContext) {
      const session = context.neo4j.session();
      try {
        const params: Record<string, unknown> = {};
        let query = applyCiFilter("MATCH (n:ConfigurationItem)", params, args.filter);
        query += " RETURN count(n) as total";
        const result = await session.run(query, params);
        return result.records[0]?.get("total")?.toNumber() ?? 0;
      } finally {
        await session.close();
      }
    },
    async ciEnvironments(_parent: unknown, _args: Record<string, never>, context: ResolverContext) {
      const session = context.neo4j.session();
      try {
        const [choiceResult, result] = await Promise.all([
          context.pg.query(
            `SELECT name
             FROM ci_environment_choices
             WHERE active = true
             ORDER BY sort_order, name`
          ).catch(() => ({ rows: [] })),
          session.run(
            `MATCH (n:ConfigurationItem) WHERE n.environment IS NOT NULL RETURN DISTINCT n.environment as env ORDER BY env`
          ),
        ]);
        const values = new Set<string>();
        for (const row of (choiceResult.rows || []) as Array<{ name?: string | null }>) {
          if (row.name) values.add(row.name);
        }
        for (const record of result.records) {
          const env = record.get("env");
          if (env) values.add(env);
        }
        return Array.from(values).sort((a, b) => a.localeCompare(b));
      } finally {
        await session.close();
      }
    },
    async ciClasses(_parent: unknown, _args: Record<string, never>, context: ResolverContext) {
      await checkPermission(context, "cmdb", "read");
      const result = await context.pg.query(
        `SELECT id, name, display_name, description, parent_class, icon, color, display_field, secondary_display_fields, is_system, created_by_app_id, created_at, updated_at
         FROM ci_classes ORDER BY name`
      );
      return (result.rows as CiClassRow[]).map(mapCiClassRow);
    },
    async ciClass(_parent: any, args: { name: string }, context: any) {
      await checkPermission(context, "cmdb", "read");
      return getClassDefinition(context.pg, args.name);
    },
    async ciEnvironmentChoices(_parent: any, args: { activeOnly?: boolean }, context: any) {
      await checkPermission(context, "cmdb", "read");
      let sql = `SELECT id, code, name, active, sort_order, is_production_like, created_at, updated_at
                 FROM ci_environment_choices`;
      if (args.activeOnly !== false) sql += " WHERE active = true";
      sql += " ORDER BY sort_order, name";
      const result = await context.pg.query(sql);
      return result.rows.map(mapEnvironmentChoice);
    },
    async relationshipTypes(_parent: any, args: { activeOnly?: boolean }, context: any) {
      await checkPermission(context, "relationships", "read");
      let sql = `SELECT id, name, display_name, description, color, active, directed, is_system, sort_order, created_at, updated_at
                 FROM relationship_types`;
      if (args.activeOnly !== false) sql += " WHERE active = true";
      sql += " ORDER BY sort_order, display_name";
      const result = await context.pg.query(sql);
      return result.rows.map(mapRelationshipType);
    },
    ...graphQueries,
    ...discoveryQueries,
    ...userQueries,
    ...marketplaceQueries,
    ...savedViewQueries,
    async auditLog(_parent: unknown, args: { entityType?: string; entityId?: string; limit?: number; offset?: number }, context: ResolverContext) {
      let query = "SELECT id, actor_id, action, entity_type, entity_id, old_values, new_values, metadata, created_at FROM audit_log WHERE 1=1";
      const params: unknown[] = [];
      let idx = 1;
      if (args.entityType) {
        query += ` AND entity_type = $${idx++}`;
        params.push(args.entityType);
      }
      if (args.entityId) {
        query += ` AND entity_id = $${idx++}`;
        params.push(args.entityId);
      }
      query += " ORDER BY created_at DESC";
      if (args.limit) {
        query += ` LIMIT $${idx++}`;
        params.push(args.limit);
      }
      if (args.offset) {
        query += ` OFFSET $${idx++}`;
        params.push(args.offset);
      }
      const result = await context.pg.query(query, params);
      return (result.rows as AuditLogRow[]).map(mapAuditLogRow);
    },
    async auditLogForCI(_parent: unknown, args: { ciId: string; limit?: number }, context: ResolverContext) {
      const result = await context.pg.query(
        `SELECT id, actor_id, action, entity_type, entity_id, old_values, new_values, metadata, created_at
         FROM audit_log
         WHERE entity_type = 'ConfigurationItem' AND entity_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [args.ciId, args.limit || 50]
      );
      return (result.rows as AuditLogRow[]).map(mapAuditLogRow);
    },
  },
  ConfigurationItem: {
    async relationships(parent: any, _args: any, context: any) {
      const session = context.neo4j.session();
      try {
        const result = await session.run(
          `MATCH (n:ConfigurationItem {id: $id})-[r]-(target:ConfigurationItem)
           RETURN r, target`,
          { id: parent.id }
        );
        return result.records.map((r: any) => {
          const rel = r.get("r");
          const target = parseNode(r.get("target").properties);
          return {
            id: `${rel.start}-${rel.end}-${rel.type}`,
            type: rel.type,
            target,
            attributes: rel.properties || {},
          };
        });
      } finally {
        await session.close();
      }
    },
    dataQualityScore(parent: any) {
      return parent.dataQualityScore ?? null;
    },
    lastDiscoveredAt(parent: any) {
      return parent.lastDiscoveredAt ?? null;
    },
    async health(parent: any, _args: any, context: any) {
      const session = context.neo4j.session();
      try {
        // Per-class health scoring
        const def = await getClassDefinition(context.pg, parent.class);
        let completeness = 1.0;

        if (def && def.allAttributes.length > 0) {
          const healthAttrs = def.allAttributes.filter((a: any) => a.is_health_required);
          if (healthAttrs.length > 0) {
            const populated = healthAttrs.filter((a: any) => {
              const val = parent[a.name] !== undefined ? parent[a.name] : parent.attributes?.[a.name];
              return val !== undefined && val !== null && val !== "";
            }).length;
            completeness = populated / healthAttrs.length;

            // Penalize completeness for regex/enum violations on health-required attrs
            let violations = 0;
            for (const attr of healthAttrs) {
              const val = parent[attr.name] !== undefined ? parent[attr.name] : parent.attributes?.[attr.name];
              if (val !== undefined && val !== null && val !== "") {
                if (attr.attr_type === "enum" && attr.enum_values && !attr.enum_values.includes(String(val))) {
                  violations++;
                }
                if (attr.validation_regex && !new RegExp(attr.validation_regex).test(String(val))) {
                  violations++;
                }
              }
            }
            if (violations > 0) {
              completeness = Math.max(0, completeness - (violations / healthAttrs.length) * 0.5);
            }
          }
        }

        const relResult = await session.run(
          `MATCH (n:ConfigurationItem {id: $id})-[r]-(target:ConfigurationItem)
           RETURN count(r) as relCount`,
          { id: parent.id }
        );
        const relCount = relResult.records[0]?.get("relCount")?.toNumber() || 0;
        const relationshipValidity = relCount > 0 ? 1.0 : 0.5;

        const freshness = parent.lastDiscoveredAt ? 1.0 : 0.0;
        const overall = (freshness + completeness + relationshipValidity) / 3;

        return {
          freshness,
          completeness,
          relationshipValidity,
          overall,
        };
      } finally {
        await session.close();
      }
    },
  },
  Relationship: {
    target(parent: any) {
      return parent.target;
    },
  },
  CIClass: {
    async attributes(parent: any, _args: any, context: any) {
      const result = await context.pg.query(
        `SELECT id, name, display_name, description, attr_type, is_mandatory, is_health_required, is_key_attribute, default_value, validation_regex, enum_values, reference_class, sort_order
         FROM ci_class_attributes WHERE class_id = $1 ORDER BY sort_order, name`,
        [parent.id]
      );
      return result.rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        displayName: row.display_name,
        description: row.description,
        attrType: row.attr_type,
        isMandatory: row.is_mandatory,
        isHealthRequired: row.is_health_required,
        isKeyAttribute: row.is_key_attribute,
        defaultValue: row.default_value,
        validationRegex: row.validation_regex,
        enumValues: row.enum_values,
        referenceClass: row.reference_class,
        sortOrder: row.sort_order,
      }));
    },
    async inheritedAttributes(parent: any, _args: any, context: any) {
      if (!parent.parentClass) return [];
      const def = await getClassDefinition(context.pg, parent.name);
      return def?.inheritedAttributes || [];
    },
  },
  Mutation: {
    async createCI(_parent: any, args: { input: any }, context: any) {
      await checkPermission(context, "cmdb", "write");
      const validated = CreateCIInputSchema.safeParse(args.input);
      if (!validated.success) {
        throw new GraphQLError(validated.error.message, { extensions: { code: "BAD_USER_INPUT" } });
      }

      // Validate against class schema and get defaults
      const { defaults } = await validateCIAgainstClass(context.pg, validated.data.class, validated.data, "create");

      const session = context.neo4j.session();
      try {
        const id = validated.data.id || crypto.randomUUID();

        // Merge defaults into attributes
        const attrs = { ...validated.data.attributes, ...defaults };

        // Build dynamic property set for top-level attributes from class definition
        const def = await getClassDefinition(context.pg, validated.data.class);
        const topLevelProps: Record<string, any> = {};
        const attrProps: Record<string, any> = {};

        for (const attr of def?.allAttributes || []) {
          const val = attrs[attr.name];
          if (val !== undefined) {
            topLevelProps[attr.name] = val;
          }
        }

        // Keep any extra attributes not in class definition
        for (const [key, val] of Object.entries(attrs)) {
          if (!topLevelProps[key]) {
            attrProps[key] = val;
          }
        }

        const result = await session.run(
          `CREATE (n:ConfigurationItem {id: $id, name: $name, class: $class, environment: $environment, attributes: $attributes})
           SET n += $topLevelProps
           RETURN n`,
          {
            id,
            name: validated.data.name,
            class: validated.data.class,
            environment: validated.data.environment || null,
            attributes: JSON.stringify(attrProps),
            topLevelProps: neo4jPropertyProps(topLevelProps),
          }
        );
        const node = parseNode(result.records[0].get("n").properties);
        if (context.emit) {
          context.emit("ci.created", { ciId: node.id, class: node.class, name: node.name });
        }
        return node;
      } finally {
        await session.close();
      }
    },
    async updateCI(_parent: any, args: { id: string; input: any }, context: any) {
      await checkPermission(context, "cmdb", "write");
      const validated = UpdateCIInputSchema.safeParse(args.input);
      if (!validated.success) {
        throw new GraphQLError(validated.error.message, { extensions: { code: "BAD_USER_INPUT" } });
      }
      const session = context.neo4j.session();
      try {
        // Fetch old values for audit
        const oldResult = await session.run(
          `MATCH (n:ConfigurationItem {id: $id}) RETURN n`,
          { id: args.id }
        );
        if (!oldResult.records.length) throw new GraphQLError("CI not found");
        const oldNode = parseNode(oldResult.records[0].get("n").properties);

        // Validate against class schema if class or attributes are changing
        const className = validated.data.class || oldNode.class;
        const mergedAttrs = { ...oldNode.attributes, ...(validated.data.attributes || {}) };
        await validateCIAgainstClass(context.pg, className, { ...oldNode, ...validated.data, attributes: mergedAttrs }, "update");

        const sets: string[] = [];
        const params: any = { id: args.id };
        if (validated.data.name !== undefined) {
          sets.push("n.name = $name");
          params.name = validated.data.name;
        }
        if (validated.data.class !== undefined) {
          sets.push("n.class = $class");
          params.class = validated.data.class;
        }
        if (validated.data.environment !== undefined) {
          sets.push("n.environment = $environment");
          params.environment = validated.data.environment;
        }

        // Handle attributes: merge class-defined top-level properties with remaining attrs JSON
        if (validated.data.attributes !== undefined) {
          const def = await getClassDefinition(context.pg, className);
          const topLevelProps: Record<string, any> = {};
          const attrProps: Record<string, any> = {};

          for (const [key, val] of Object.entries(mergedAttrs)) {
            const isClassAttr = def?.allAttributes.some((a: any) => a.name === key);
            if (isClassAttr) {
              topLevelProps[key] = val;
            } else {
              attrProps[key] = val;
            }
          }

          if (Object.keys(topLevelProps).length > 0) {
            sets.push("n += $topLevelProps");
            params.topLevelProps = neo4jPropertyProps(topLevelProps);
          }
          sets.push("n.attributes = $attributes");
          params.attributes = JSON.stringify(attrProps);
        }

        if (!sets.length) throw new GraphQLError("No fields to update");
        const result = await session.run(
          `MATCH (n:ConfigurationItem {id: $id}) SET ${sets.join(", ")} RETURN n`,
          params
        );
        const node = parseNode(result.records[0].get("n").properties);
        if (context.emit) {
          context.emit("ci.updated", {
            ciId: node.id,
            class: node.class,
            name: node.name,
            oldValues: oldNode,
            newValues: node,
            actorId: context.user?.id,
          });
        }
        return node;
      } finally {
        await session.close();
      }
    },
    async deleteCI(_parent: any, args: { id: string }, context: any) {
      await checkPermission(context, "cmdb", "write");
      const session = context.neo4j.session();
      try {
        const oldResult = await session.run(
          `MATCH (n:ConfigurationItem {id: $id}) RETURN n`,
          { id: args.id }
        );
        const oldNode = oldResult.records.length ? parseNode(oldResult.records[0].get("n").properties) : null;
        await session.run(
          `MATCH (n:ConfigurationItem {id: $id}) DETACH DELETE n`,
          { id: args.id }
        );
        if (context.emit) {
          context.emit("ci.deleted", { ciId: args.id, oldValues: oldNode, actorId: context.user?.id });
        }
        return true;
      } finally {
        await session.close();
      }
    },
    async createRelationship(_parent: any, args: { input: any }, context: any) {
      await checkPermission(context, "relationships", "write");
      const validated = CreateRelationshipInputSchema.safeParse(args.input);
      if (!validated.success) {
        throw new GraphQLError(validated.error.message, { extensions: { code: "BAD_USER_INPUT" } });
      }
      await assertRelationshipType(context.pg, validated.data.type);
      const session = context.neo4j.session();
      try {
        const result = await session.run(
          `MATCH (a:ConfigurationItem {id: $sourceId}), (b:ConfigurationItem {id: $targetId})
           CREATE (a)-[r:${validated.data.type}]->(b)
           RETURN r, b as target`,
          { sourceId: validated.data.sourceId, targetId: validated.data.targetId }
        );
        if (!result.records.length) throw new GraphQLError("Source or target not found");
        const rel = result.records[0].get("r");
        const target = parseNode(result.records[0].get("target").properties);
        if (context.emit) {
          context.emit("relationship.created", {
            sourceId: validated.data.sourceId,
            targetId: validated.data.targetId,
            type: validated.data.type,
            actorId: context.user?.id,
          });
        }
        return {
          id: `${rel.start}-${rel.end}-${rel.type}`,
          type: rel.type,
          target,
          attributes: rel.properties || {},
        };
      } finally {
        await session.close();
      }
    },
    async deleteRelationship(_parent: any, args: { sourceId: string; targetId: string; type: string }, context: any) {
      await checkPermission(context, "relationships", "write");
      const validated = DeleteRelationshipInputSchema.safeParse(args);
      if (!validated.success) {
        throw new GraphQLError(validated.error.message, { extensions: { code: "BAD_USER_INPUT" } });
      }
      await assertRelationshipType(context.pg, validated.data.type);
      const session = context.neo4j.session();
      try {
        const oldResult = await session.run(
          `MATCH (a:ConfigurationItem {id: $sourceId})-[r:${validated.data.type}]->(b:ConfigurationItem {id: $targetId})
           RETURN r, a as source, b as target`,
          { sourceId: validated.data.sourceId, targetId: validated.data.targetId }
        );
        const oldRel = oldResult.records.length ? oldResult.records[0].get("r") : null;
        const oldSource = oldResult.records.length ? parseNode(oldResult.records[0].get("source").properties) : null;
        const oldTarget = oldResult.records.length ? parseNode(oldResult.records[0].get("target").properties) : null;
        const result = await session.run(
          `MATCH (a:ConfigurationItem {id: $sourceId})-[r:${validated.data.type}]->(b:ConfigurationItem {id: $targetId})
           DELETE r
           RETURN count(r) as deleted`,
          { sourceId: validated.data.sourceId, targetId: validated.data.targetId }
        );
        const deleted = result.records[0]?.get("deleted")?.toNumber() || 0;
        if (deleted > 0 && context.emit) {
          context.emit("relationship.deleted", {
            sourceId: validated.data.sourceId,
            targetId: validated.data.targetId,
            type: validated.data.type,
            oldValues: oldRel ? { source: oldSource, target: oldTarget, attributes: oldRel.properties } : undefined,
            actorId: context.user?.id,
          });
        }
        return deleted > 0;
      } finally {
        await session.close();
      }
    },
    async updateRelationship(
      _parent: any,
      args: { sourceId: string; targetId: string; type: string; newType?: string; attributes?: any },
      context: any
    ) {
      await checkPermission(context, "relationships", "write");
      const validated = UpdateRelationshipInputSchema.safeParse(args);
      if (!validated.success) {
        throw new GraphQLError(validated.error.message, { extensions: { code: "BAD_USER_INPUT" } });
      }
      await assertRelationshipType(context.pg, validated.data.type);
      if (validated.data.newType) await assertRelationshipType(context.pg, validated.data.newType);
      const session = context.neo4j.session();
      try {
        const { sourceId, targetId, type, newType, attributes } = validated.data;
        const needsTypeChange = newType && newType !== type;
        let result;

        const oldResult = await session.run(
          `MATCH (a:ConfigurationItem {id: $sourceId})-[r:${type}]->(b:ConfigurationItem {id: $targetId})
           RETURN r, a as source, b as target`,
          { sourceId, targetId }
        );
        const oldRel = oldResult.records.length ? oldResult.records[0].get("r") : null;
        const oldSource = oldResult.records.length ? parseNode(oldResult.records[0].get("source").properties) : null;
        const oldTarget = oldResult.records.length ? parseNode(oldResult.records[0].get("target").properties) : null;

        if (needsTypeChange) {
          result = await session.run(
            `MATCH (a:ConfigurationItem {id: $sourceId})-[r:${type}]->(b:ConfigurationItem {id: $targetId})
             DELETE r
             CREATE (a)-[r2:${newType}]->(b)
             SET r2.attributes = $attributes
             RETURN r2, b as target`,
            { sourceId, targetId, attributes: JSON.stringify(attributes || {}) }
          );
        } else {
          result = await session.run(
            `MATCH (a:ConfigurationItem {id: $sourceId})-[r:${type}]->(b:ConfigurationItem {id: $targetId})
             SET r.attributes = $attributes
             RETURN r, b as target`,
            { sourceId, targetId, attributes: JSON.stringify(attributes || {}) }
          );
        }

        if (!result.records.length) throw new GraphQLError("Relationship not found");
        const rel = result.records[0].get(needsTypeChange ? "r2" : "r");
        const target = parseNode(result.records[0].get("target").properties);
        if (context.emit) {
          context.emit("relationship.updated", {
            sourceId: validated.data.sourceId,
            targetId: validated.data.targetId,
            type: rel.type,
            previousType: needsTypeChange ? type : undefined,
            oldValues: oldRel ? { source: oldSource, target: oldTarget, type: oldRel.type, attributes: oldRel.properties } : undefined,
            newValues: { source: oldSource, target, type: rel.type, attributes: rel.properties },
            actorId: context.user?.id,
          });
        }
        return {
          id: `${rel.start}-${rel.end}-${rel.type}`,
          type: rel.type,
          target,
          attributes: rel.properties || {},
        };
      } finally {
        await session.close();
      }
    },
    async ingestCMDB(_parent: any, args: { payload: any }, context: any) {
      await checkPermission(context, "discovery", "write");
      const jobId = crypto.randomUUID();
      try {
        const response = await context.worker.ingestCMDB({
          job_id: jobId,
          source: "api",
          payload: Buffer.from(JSON.stringify(args.payload || {}), "utf-8"),
        });
        return { jobId: response.job_id, status: response.status };
      } catch (err: any) {
        console.error("gRPC ingestCMDB failed:", err.message);
        throw new GraphQLError("Failed to queue ingestion job: " + err.message);
      }
    },
    ...discoveryMutations,
    ...userMutations,
    ...marketplaceMutations,
    ...savedViewMutations,
    async createCIClass(_parent: any, args: { input: any }, context: any) {
      await checkPermission(context, "cmdb", "admin");
      const { name, displayName, description, parentClass, icon, color, displayField, secondaryDisplayFields, attributes } = args.input;

      // Validate name is PascalCase
      if (!/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
        throw new GraphQLError("Class name must be PascalCase", { extensions: { code: "BAD_USER_INPUT" } });
      }

      const client = await context.pg.connect();
      try {
        await client.query("BEGIN");

        // Check for duplicate
        const existing = await client.query("SELECT id FROM ci_classes WHERE name = $1", [name]);
        if (existing.rows.length) {
          throw new GraphQLError(`Class '${name}' already exists`, { extensions: { code: "BAD_USER_INPUT" } });
        }

        // Validate parent class exists if specified
        if (parentClass) {
          const parent = await client.query("SELECT id FROM ci_classes WHERE name = $1", [parentClass]);
          if (!parent.rows.length) {
            throw new GraphQLError(`Parent class '${parentClass}' not found`, { extensions: { code: "BAD_USER_INPUT" } });
          }
        }

        // Insert class
        const classResult = await client.query(
          `INSERT INTO ci_classes (name, display_name, description, parent_class, icon, color, display_field, secondary_display_fields, created_by_app_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, name, display_name, description, parent_class, icon, color, display_field, secondary_display_fields, is_system, created_by_app_id, created_at, updated_at`,
          [name, displayName, description || null, parentClass || null, icon || null, color || null, displayField || "name", secondaryDisplayFields || [], context.appId || null]
        );
        const cls = classResult.rows[0];

        // Insert attributes
        if (attributes && attributes.length > 0) {
          const seenNames = new Set<string>();
          for (const attr of attributes) {
            if (seenNames.has(attr.name)) {
              throw new GraphQLError(`Duplicate attribute name: ${attr.name}`, { extensions: { code: "BAD_USER_INPUT" } });
            }
            seenNames.add(attr.name);
            await client.query(
              `INSERT INTO ci_class_attributes
               (class_id, name, display_name, description, attr_type, is_mandatory, is_health_required, is_key_attribute, default_value, validation_regex, enum_values, reference_class, sort_order)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
              [
                cls.id, attr.name, attr.displayName, attr.description || null,
                attr.attrType, attr.isMandatory || false, attr.isHealthRequired || false,
                attr.isKeyAttribute || false, attr.defaultValue || null,
                attr.validationRegex || null, attr.enumValues || null,
                attr.referenceClass || null, attr.sortOrder || 0,
              ]
            );
          }
        }

        await client.query("COMMIT");

        if (context.emit) {
          context.emit("ci_class.created", { className: cls.name, createdByAppId: cls.created_by_app_id });
        }

        return {
          id: cls.id,
          name: cls.name,
          displayName: cls.display_name,
          description: cls.description,
          parentClass: cls.parent_class,
          icon: cls.icon,
          color: cls.color,
          displayField: cls.display_field,
          secondaryDisplayFields: cls.secondary_display_fields || [],
          isSystem: cls.is_system,
          createdByAppId: cls.created_by_app_id,
          createdAt: cls.created_at,
          updatedAt: cls.updated_at,
        };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
    async updateCIClass(_parent: any, args: { id: string; input: any }, context: any) {
      await checkPermission(context, "cmdb", "admin");
      const { name, displayName, description, parentClass, icon, color, displayField, secondaryDisplayFields, attributes } = args.input;

      const client = await context.pg.connect();
      try {
        await client.query("BEGIN");

        // Fetch existing class
        const existing = await client.query("SELECT * FROM ci_classes WHERE id = $1", [args.id]);
        if (!existing.rows.length) {
          throw new GraphQLError("Class not found", { extensions: { code: "NOT_FOUND" } });
        }
        const oldClass = existing.rows[0];

        if (oldClass.is_system && name !== oldClass.name) {
          throw new GraphQLError("System class names cannot be changed", { extensions: { code: "FORBIDDEN" } });
        }
        if (oldClass.is_system && (parentClass || null) !== (oldClass.parent_class || null)) {
          throw new GraphQLError("System class inheritance cannot be changed", { extensions: { code: "FORBIDDEN" } });
        }

        // Check name uniqueness if changing
        if (name !== oldClass.name) {
          const dup = await client.query("SELECT id FROM ci_classes WHERE name = $1 AND id != $2", [name, args.id]);
          if (dup.rows.length) {
            throw new GraphQLError(`Class name '${name}' already exists`, { extensions: { code: "BAD_USER_INPUT" } });
          }
        }

        // Validate parent class
        if (parentClass) {
          const parent = await client.query("SELECT id FROM ci_classes WHERE name = $1", [parentClass]);
          if (!parent.rows.length) {
            throw new GraphQLError(`Parent class '${parentClass}' not found`, { extensions: { code: "BAD_USER_INPUT" } });
          }
        }

        // Update class
        const classResult = await client.query(
          `UPDATE ci_classes
           SET name = $1, display_name = $2, description = $3, parent_class = $4, icon = $5, color = $6, display_field = $7, secondary_display_fields = $8, updated_at = NOW()
           WHERE id = $9
           RETURNING id, name, display_name, description, parent_class, icon, color, display_field, secondary_display_fields, is_system, created_by_app_id, created_at, updated_at`,
          [name, displayName, description || null, parentClass || null, icon || null, color || null, displayField || "name", secondaryDisplayFields || [], args.id]
        );
        const cls = classResult.rows[0];

        // Delete old attributes and insert new ones
        await client.query("DELETE FROM ci_class_attributes WHERE class_id = $1", [args.id]);
        if (attributes && attributes.length > 0) {
          const seenNames = new Set<string>();
          for (const attr of attributes) {
            if (seenNames.has(attr.name)) {
              throw new GraphQLError(`Duplicate attribute name: ${attr.name}`, { extensions: { code: "BAD_USER_INPUT" } });
            }
            seenNames.add(attr.name);
            await client.query(
              `INSERT INTO ci_class_attributes
               (class_id, name, display_name, description, attr_type, is_mandatory, is_health_required, is_key_attribute, default_value, validation_regex, enum_values, reference_class, sort_order)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
              [
                cls.id, attr.name, attr.displayName, attr.description || null,
                attr.attrType, attr.isMandatory || false, attr.isHealthRequired || false,
                attr.isKeyAttribute || false, attr.defaultValue || null,
                attr.validationRegex || null, attr.enumValues || null,
                attr.referenceClass || null, attr.sortOrder || 0,
              ]
            );
          }
        }

        await client.query("COMMIT");

        if (context.emit) {
          context.emit("ci_class.updated", { className: cls.name, createdByAppId: cls.created_by_app_id });
        }

        return {
          id: cls.id,
          name: cls.name,
          displayName: cls.display_name,
          description: cls.description,
          parentClass: cls.parent_class,
          icon: cls.icon,
          color: cls.color,
          displayField: cls.display_field,
          secondaryDisplayFields: cls.secondary_display_fields || [],
          isSystem: cls.is_system,
          createdByAppId: cls.created_by_app_id,
          createdAt: cls.created_at,
          updatedAt: cls.updated_at,
        };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
    async deleteCIClass(_parent: any, args: { id: string }, context: any) {
      await checkPermission(context, "cmdb", "admin");

      const client = await context.pg.connect();
      try {
        await client.query("BEGIN");

        const existing = await client.query("SELECT * FROM ci_classes WHERE id = $1", [args.id]);
        if (!existing.rows.length) {
          throw new GraphQLError("Class not found", { extensions: { code: "NOT_FOUND" } });
        }
        const cls = existing.rows[0];

        if (cls.is_system) {
          throw new GraphQLError("System classes cannot be deleted", { extensions: { code: "FORBIDDEN" } });
        }

        // Check if any CIs exist in Neo4j with this class
        const session = context.neo4j.session();
        try {
          const ciResult = await session.run(
            `MATCH (n:ConfigurationItem {class: $className}) RETURN count(n) as ciCount`,
            { className: cls.name }
          );
          const ciCount = ciResult.records[0]?.get("ciCount")?.toNumber() || 0;
          if (ciCount > 0) {
            throw new GraphQLError(
              `Cannot delete class '${cls.name}': ${ciCount} CIs exist. Migrate or delete them first.`,
              { extensions: { code: "BAD_USER_INPUT" } }
            );
          }
        } finally {
          await session.close();
        }

        await client.query("DELETE FROM ci_classes WHERE id = $1", [args.id]);
        await client.query("COMMIT");

        if (context.emit) {
          context.emit("ci_class.deleted", { className: cls.name, createdByAppId: cls.created_by_app_id });
        }

        return true;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
    async upsertCIEnvironmentChoice(_parent: any, args: { input: any }, context: any) {
      await checkPermission(context, "cmdb", "admin");
      const code = String(args.input.code || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
      const name = String(args.input.name || "").trim();
      if (!code || !name) {
        throw new GraphQLError("Environment code and name are required", { extensions: { code: "BAD_USER_INPUT" } });
      }
      const result = await context.pg.query(
        `INSERT INTO ci_environment_choices (code, name, active, sort_order, is_production_like)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (code) DO UPDATE SET
           name = EXCLUDED.name,
           active = EXCLUDED.active,
           sort_order = EXCLUDED.sort_order,
           is_production_like = EXCLUDED.is_production_like,
           updated_at = NOW()
         RETURNING id, code, name, active, sort_order, is_production_like, created_at, updated_at`,
        [
          code,
          name,
          args.input.active ?? true,
          args.input.sortOrder ?? 0,
          args.input.isProductionLike ?? false,
        ]
      );
      return mapEnvironmentChoice(result.rows[0]);
    },
    async deleteCIEnvironmentChoice(_parent: any, args: { id: string }, context: any) {
      await checkPermission(context, "cmdb", "admin");
      const result = await context.pg.query("DELETE FROM ci_environment_choices WHERE id = $1 RETURNING id", [args.id]);
      return result.rows.length > 0;
    },
    async upsertRelationshipType(_parent: any, args: { input: any }, context: any) {
      await checkPermission(context, "relationships", "write");
      const name = String(args.input.name || "").trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
      const displayName = String(args.input.displayName || "").trim();
      if (!RELATIONSHIP_TYPE_PATTERN.test(name) || !displayName) {
        throw new GraphQLError("Relationship type name and display name are required", { extensions: { code: "BAD_USER_INPUT" } });
      }
      const result = await context.pg.query(
        `INSERT INTO relationship_types (name, display_name, description, color, active, directed, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (name) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           description = EXCLUDED.description,
           color = EXCLUDED.color,
           active = EXCLUDED.active,
           directed = EXCLUDED.directed,
           sort_order = EXCLUDED.sort_order,
           updated_at = NOW()
         RETURNING id, name, display_name, description, color, active, directed, is_system, sort_order, created_at, updated_at`,
        [
          name,
          displayName,
          args.input.description || null,
          args.input.color || "#6366f1",
          args.input.active ?? true,
          args.input.directed ?? true,
          args.input.sortOrder ?? 100,
        ]
      );
      return mapRelationshipType(result.rows[0]);
    },
    async deleteRelationshipType(_parent: any, args: { id: string }, context: any) {
      await checkPermission(context, "relationships", "write");
      const existing = await context.pg.query("SELECT * FROM relationship_types WHERE id = $1", [args.id]);
      if (!existing.rows.length) return false;
      const relType = existing.rows[0];
      if (relType.is_system) {
        throw new GraphQLError("System relationship types cannot be deleted", { extensions: { code: "FORBIDDEN" } });
      }
      const session = context.neo4j.session();
      try {
        const countResult = await session.run(
          `MATCH ()-[r:${relType.name}]-() RETURN count(r) as relCount`
        );
        const relCount = countResult.records[0]?.get("relCount")?.toNumber?.() || 0;
        if (relCount > 0) {
          throw new GraphQLError(`Cannot delete relationship type '${relType.name}': ${relCount} relationships exist. Disable it instead.`, { extensions: { code: "BAD_USER_INPUT" } });
        }
      } finally {
        await session.close();
      }
      const result = await context.pg.query("DELETE FROM relationship_types WHERE id = $1 RETURNING id", [args.id]);
      return result.rows.length > 0;
    },
  },
};
