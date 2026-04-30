import { GraphQLError } from "graphql";
import neo4j from "neo4j-driver";
import bcrypt from "bcryptjs";
import {
  CreateCIInputSchema,
  UpdateCIInputSchema,
  CreateRelationshipInputSchema,
  DeleteRelationshipInputSchema,
  UpdateRelationshipInputSchema,
} from "@specora/core";
import { hasPermission } from "../services/rbac";
import { getPasswordPolicy, passwordPolicyMessage, validatePasswordAgainstPolicy } from "../services/passwordPolicy";
import { neo4jPropertyProps, parseNode } from "./ciNode";
import { assertRelationshipType, mapRelationshipType, relationshipPattern, RELATIONSHIP_TYPE_PATTERN } from "./relationshipTypes";

function boundedHopCount(value: number | undefined, fallback: number) {
  const hops = value ?? fallback;
  if (!Number.isInteger(hops) || hops < 1 || hops > 10) {
    throw new GraphQLError("maxHops must be an integer between 1 and 10", { extensions: { code: "BAD_USER_INPUT" } });
  }
  return hops;
}

function mapEnvironmentChoice(row: any) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    active: row.active,
    sortOrder: row.sort_order,
    isProductionLike: row.is_production_like,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapUserRow(row: any) {
  const passwordHash = String(row.password_hash || "");
  const federatedOnly = passwordHash.startsWith("oauth:") || passwordHash.startsWith("sso:");
  const oauthAccounts = Number(row.oauth_accounts || 0);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    preferences: row.preferences || {},
    role: row.role,
    authMethod: federatedOnly || oauthAccounts > 0 ? "sso" : "password",
    canChangePassword: Boolean(passwordHash) && !federatedOnly,
    passwordChangeRequired: Boolean(row.password_change_required) && Boolean(passwordHash) && !federatedOnly,
  };
}

async function getClassDefinition(pg: any, className: string) {
  const classResult = await pg.query("SELECT * FROM ci_classes WHERE name = $1", [className]);
  if (!classResult.rows.length) return null;
  const cls = classResult.rows[0];

  // Fetch own attributes + inherited attributes via recursive CTE
  const attrsResult = await pg.query(
    `WITH RECURSIVE class_tree AS (
       SELECT id, name, parent_class, 0 AS depth
       FROM ci_classes WHERE name = $1
       UNION ALL
       SELECT c.id, c.name, c.parent_class, ct.depth + 1
       FROM ci_classes c JOIN class_tree ct ON c.name = ct.parent_class
     )
     SELECT a.*, ct.depth
     FROM class_tree ct
     JOIN ci_class_attributes a ON a.class_id = ct.id
     ORDER BY ct.depth DESC, a.sort_order, a.name`,
    [className]
  );

  // Deduplicate: child attributes override parent attributes by name
  const attrMap = new Map();
  for (const row of attrsResult.rows) {
    attrMap.set(row.name, row);
  }
  const attributes = Array.from(attrMap.values());

  // Split into own vs inherited
  const ownAttrs = attributes.filter((a: any) => {
    const own = attrsResult.rows.find((r: any) => r.name === a.name && r.depth === 0);
    return !!own;
  });
  const inheritedAttrs = attributes.filter((a: any) => {
    const own = attrsResult.rows.find((r: any) => r.name === a.name && r.depth === 0);
    return !own;
  });

  return {
    ...cls,
    displayName: cls.display_name,
    parentClass: cls.parent_class,
    isSystem: cls.is_system,
    createdByAppId: cls.created_by_app_id,
    createdAt: cls.created_at,
    updatedAt: cls.updated_at,
    displayField: cls.display_field,
    secondaryDisplayFields: cls.secondary_display_fields || [],
    attributes: ownAttrs,
    inheritedAttributes: inheritedAttrs,
    allAttributes: attributes,
  };
}

async function validateCIAgainstClass(pg: any, className: string, ciData: any, mode: "create" | "update") {
  const def = await getClassDefinition(pg, className);
  if (!def) {
    throw new GraphQLError(`Unknown CI class: ${className}`, { extensions: { code: "BAD_USER_INPUT" } });
  }

  const attrs = ciData.attributes || {};
  const allData = { ...ciData, ...attrs };

  for (const attr of def.allAttributes) {
    const val = allData[attr.name];

    if (mode === "create" && attr.is_mandatory && (val === undefined || val === null || val === "")) {
      throw new GraphQLError(
        `Missing mandatory attribute '${attr.display_name || attr.name}' for class ${className}`,
        { extensions: { code: "BAD_USER_INPUT" } }
      );
    }

    if (val !== undefined && val !== null && val !== "") {
      // Type validation
      if (attr.attr_type === "number" && typeof val !== "number") {
        throw new GraphQLError(`Attribute '${attr.name}' must be a number`, { extensions: { code: "BAD_USER_INPUT" } });
      }
      if (attr.attr_type === "boolean" && typeof val !== "boolean") {
        throw new GraphQLError(`Attribute '${attr.name}' must be a boolean`, { extensions: { code: "BAD_USER_INPUT" } });
      }
      if (attr.attr_type === "enum" && attr.enum_values && !attr.enum_values.includes(String(val))) {
        throw new GraphQLError(
          `Attribute '${attr.name}' must be one of: ${attr.enum_values.join(", ")}`,
          { extensions: { code: "BAD_USER_INPUT" } }
        );
      }
      if (attr.attr_type === "date" && isNaN(Date.parse(String(val)))) {
        throw new GraphQLError(`Attribute '${attr.name}' must be a valid date`, { extensions: { code: "BAD_USER_INPUT" } });
      }
      if (attr.validation_regex && !new RegExp(attr.validation_regex).test(String(val))) {
        throw new GraphQLError(
          `Attribute '${attr.name}' failed validation: ${attr.validation_regex}`,
          { extensions: { code: "BAD_USER_INPUT" } }
        );
      }
    }
  }

  // Apply default values for missing optional attributes
  const defaults: Record<string, any> = {};
  for (const attr of def.allAttributes) {
    if (allData[attr.name] === undefined && attr.default_value !== null && attr.default_value !== undefined) {
      defaults[attr.name] = attr.default_value;
    }
  }

  return { def, defaults };
}

async function checkPermission(context: any, resource: string, action: string) {
  const user = context.user as { role?: string } | null;
  if (!user?.role) {
    throw new GraphQLError("Forbidden: not authenticated", { extensions: { code: "FORBIDDEN" } });
  }
  const allowed = await hasPermission(context.pg, { role: user.role, resource, action });
  if (!allowed) {
    throw new GraphQLError(`Forbidden: ${user.role} cannot ${action} ${resource}`, { extensions: { code: "FORBIDDEN" } });
  }
}

export const resolvers = {
  Query: {
    async ci(_parent: any, args: { id: string }, context: any) {
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
    async cis(_parent: any, args: { filter?: any; limit?: number; offset?: number }, context: any) {
      const session = context.neo4j.session();
      try {
        let query = "MATCH (n:ConfigurationItem)";
        const params: any = {};
        const conditions: string[] = [];
        if (args.filter?.class) {
          conditions.push("n.class = $class");
          params.class = args.filter.class;
        }
        if (args.filter?.environment) {
          conditions.push("n.environment = $environment");
          params.environment = args.filter.environment;
        }
        if (args.filter?.name) {
          conditions.push("n.name CONTAINS $name");
          params.name = args.filter.name;
        }
        if (conditions.length) query += " WHERE " + conditions.join(" AND ");
        query += " RETURN n";
        if (args.offset !== undefined && args.offset > 0) {
          query += " SKIP $offset";
          params.offset = neo4j.int(args.offset);
        }
        query += " LIMIT $limit";
        params.limit = neo4j.int(args.limit ?? 100);
        const result = await session.run(query, params);
        return result.records.map((r: any) => parseNode(r.get("n").properties));
      } finally {
        await session.close();
      }
    },
    async ciCount(_parent: any, args: { filter?: any }, context: any) {
      const session = context.neo4j.session();
      try {
        let query = "MATCH (n:ConfigurationItem)";
        const params: any = {};
        const conditions: string[] = [];
        if (args.filter?.class) {
          conditions.push("n.class = $class");
          params.class = args.filter.class;
        }
        if (args.filter?.environment) {
          conditions.push("n.environment = $environment");
          params.environment = args.filter.environment;
        }
        if (args.filter?.name) {
          conditions.push("n.name CONTAINS $name");
          params.name = args.filter.name;
        }
        if (conditions.length) query += " WHERE " + conditions.join(" AND ");
        query += " RETURN count(n) as total";
        const result = await session.run(query, params);
        return result.records[0]?.get("total")?.toNumber() ?? 0;
      } finally {
        await session.close();
      }
    },
    async ciEnvironments(_parent: any, _args: any, context: any) {
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
        for (const row of choiceResult.rows || []) {
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
    async ciClasses(_parent: any, _args: any, context: any) {
      await checkPermission(context, "cmdb", "read");
      const result = await context.pg.query(
        `SELECT id, name, display_name, description, parent_class, icon, color, display_field, secondary_display_fields, is_system, created_by_app_id, created_at, updated_at
         FROM ci_classes ORDER BY name`
      );
      return result.rows.map((row: any) => ({
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
      }));
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
    async serviceMap(_parent: any, args: { rootId: string; classFilter?: string[]; environmentFilter?: string[]; relationshipFilter?: string[] }, context: any) {
      const session = context.neo4j.session();
      try {
        const rootResult = await session.run(
          `MATCH (root:ConfigurationItem {id: $rootId}) RETURN root`,
          { rootId: args.rootId }
        );
        const rootRecord = rootResult.records[0];
        const rootNode = rootRecord ? parseNode(rootRecord.get("root").properties) : null;

        const relTypes = await relationshipPattern(context.pg, args.relationshipFilter);

        let query = `MATCH path = (root:ConfigurationItem {id: $rootId})-[:${relTypes}*0..3]-(related:ConfigurationItem)
WHERE related <> root`;
        if (args.classFilter?.length) {
          query += ` AND related.class IN $classFilter`;
        }
        if (args.environmentFilter?.length) {
          query += ` AND related.environment IN $environmentFilter`;
        }
        query += `
UNWIND relationships(path) as rel
WITH DISTINCT rel, startNode(rel) as src, endNode(rel) as tgt`;
        if (args.relationshipFilter?.length) {
          query += `
WHERE type(rel) IN $relationshipFilter`;
        }
        query += `
RETURN rel, src, tgt
LIMIT 50`;

        const params: any = { rootId: args.rootId };
        if (args.classFilter?.length) params.classFilter = args.classFilter;
        if (args.environmentFilter?.length) params.environmentFilter = args.environmentFilter;
        if (args.relationshipFilter?.length) params.relationshipFilter = args.relationshipFilter;

        const result = await session.run(query, params);

        const nodesMap = new Map();
        const edgeSet = new Set<string>();
        const edges: any[] = [];

        if (rootNode) {
          nodesMap.set(rootNode.id, rootNode);
        }

        for (const record of result.records) {
          const rel = record.get("rel");
          const src = parseNode(record.get("src").properties);
          const tgt = parseNode(record.get("tgt").properties);
          nodesMap.set(src.id, src);
          nodesMap.set(tgt.id, tgt);
          const edgeKey = `${src.id}-${tgt.id}-${rel.type}`;
          if (!edgeSet.has(edgeKey)) {
            edgeSet.add(edgeKey);
            edges.push({
              id: edgeKey,
              type: rel.type,
              sourceId: src.id,
              targetId: tgt.id,
            });
          }
        }
        return {
          root: nodesMap.get(args.rootId) || rootNode,
          nodes: Array.from(nodesMap.values()),
          edges,
        };
      } finally {
        await session.close();
      }
    },
    async neighbors(_parent: any, args: { nodeId: string; types?: string[]; limit?: number }, context: any) {
      const session = context.neo4j.session();
      try {
        const rootResult = await session.run(
          `MATCH (root:ConfigurationItem {id: $nodeId}) RETURN root`,
          { nodeId: args.nodeId }
        );
        const rootNode = rootResult.records[0] ? parseNode(rootResult.records[0].get("root").properties) : null;

        const relTypes = await relationshipPattern(context.pg, args.types);
        const limit = args.limit ?? 50;

        const result = await session.run(
          `MATCH path = (root:ConfigurationItem {id: $nodeId})-[:${relTypes}*1]-(related:ConfigurationItem)
           UNWIND relationships(path) as rel
           WITH DISTINCT rel, startNode(rel) as src, endNode(rel) as tgt
           RETURN rel, src, tgt
           LIMIT $limit`,
          { nodeId: args.nodeId, limit: neo4j.int(limit) }
        );

        const nodesMap = new Map();
        const edgeSet = new Set<string>();
        const edges: any[] = [];

        if (rootNode) {
          nodesMap.set(rootNode.id, rootNode);
        }

        for (const record of result.records) {
          const rel = record.get("rel");
          const src = parseNode(record.get("src").properties);
          const tgt = parseNode(record.get("tgt").properties);
          nodesMap.set(src.id, src);
          nodesMap.set(tgt.id, tgt);
          const edgeKey = `${src.id}-${tgt.id}-${rel.type}`;
          if (!edgeSet.has(edgeKey)) {
            edgeSet.add(edgeKey);
            edges.push({
              id: edgeKey,
              type: rel.type,
              sourceId: src.id,
              targetId: tgt.id,
            });
          }
        }
        return {
          root: rootNode,
          nodes: Array.from(nodesMap.values()),
          edges,
        };
      } finally {
        await session.close();
      }
    },
    async dependencyPath(_parent: any, args: { fromId: string; toId: string; maxHops?: number }, context: any) {
      const session = context.neo4j.session();
      try {
        const maxHops = boundedHopCount(args.maxHops, 10);
        const result = await session.run(
          `MATCH path = shortestPath(
             (a:ConfigurationItem {id: $fromId})
             -[:PART_OF|DEPENDS_ON|HOSTED_ON|MANAGED_BY*1..${maxHops}]-
             (b:ConfigurationItem {id: $toId})
           )
           WITH path
           WHERE path IS NOT NULL
           UNWIND nodes(path) as node
           WITH collect(DISTINCT node) as pathNodes, path
           UNWIND relationships(path) as rel
           WITH pathNodes, rel, startNode(rel) as src, endNode(rel) as tgt
           RETURN pathNodes, collect({reltype: type(rel), sourceid: src.id, targetid: tgt.id}) as pathRels`,
          { fromId: args.fromId, toId: args.toId }
        );
        if (!result.records.length) return null;

        const record = result.records[0];
        const pathNodes = record.get("pathNodes").map((n: any) => parseNode(n.properties));
        const pathRels = record.get("pathRels");
        const nodesMap = new Map(pathNodes.map((n: any) => [n.id, n]));
        const edges = pathRels.map((rel: any) => ({
          id: `${rel.sourceid}-${rel.targetid}-${rel.reltype}`,
          type: rel.reltype,
          sourceId: rel.sourceid,
          targetId: rel.targetid,
        }));

        return {
          nodes: Array.from(nodesMap.values()),
          edges,
        };
      } catch (err) {
        console.error("dependencyPath error:", err);
        throw err;
      } finally {
        await session.close();
      }
    },
    async discoverySources(_parent: any, _args: any, context: any) {
      const result = await context.pg.query("SELECT id, name, type, config, credential_ref, last_tested_at, last_status, last_error, created_at, updated_at FROM discovery_sources ORDER BY created_at DESC");
      return result.rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        config: row.config,
        credentialRef: row.credential_ref,
        lastTestedAt: row.last_tested_at,
        lastStatus: row.last_status,
        lastError: row.last_error,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    },
    async discoveryJobs(_parent: any, _args: any, context: any) {
      const result = await context.pg.query("SELECT id, source_id, file_path, status, stats, created_at, updated_at FROM discovery_jobs ORDER BY created_at DESC");
      return result.rows.map((row: any) => ({ id: row.id, sourceId: row.source_id, filePath: row.file_path, status: row.status, stats: row.stats, createdAt: row.created_at, updatedAt: row.updated_at }));
    },
    async discoveryJob(_parent: any, args: { id: string }, context: any) {
      const result = await context.pg.query(
        "SELECT id, source_id, file_path, status, stats, created_at, updated_at FROM discovery_jobs WHERE id = $1",
        [args.id]
      );
      if (!result.rows.length) return null;
      const row = result.rows[0];
      return { id: row.id, sourceId: row.source_id, filePath: row.file_path, status: row.status, stats: row.stats, createdAt: row.created_at, updatedAt: row.updated_at };
    },
    async me(_parent: any, _args: any, context: any) {
      if (!context.user?.id) return null;
      let result = await context.pg.query(
        `SELECT u.id, u.name, u.email, u.preferences, u.role, u.password_hash, u.password_change_required,
                COUNT(oa.id)::int AS oauth_accounts
         FROM users u
         LEFT JOIN oauth_accounts oa ON oa.user_id = u.id
         WHERE u.id = $1
         GROUP BY u.id`,
        [context.user.id]
      );
      if (!result.rows.length && context.user?.email) {
        result = await context.pg.query(
          `SELECT u.id, u.name, u.email, u.preferences, u.role, u.password_hash, u.password_change_required,
                  COUNT(oa.id)::int AS oauth_accounts
           FROM users u
           LEFT JOIN oauth_accounts oa ON oa.user_id = u.id
           WHERE u.email = $1
           GROUP BY u.id`,
          [context.user.email]
        );
      }
      return result.rows[0] ? mapUserRow(result.rows[0]) : null;
    },
    async passwordPolicy(_parent: any, _args: any, context: any) {
      return getPasswordPolicy(context.pg);
    },
    async marketplaceApps(_parent: any, args: { status?: string }, context: any) {
      const status = args.status || "approved";
      const result = await context.pg.query(
        "SELECT id, name, description, url, icon, version, permissions, react_version, author, author_url, status, created_at FROM marketplace_apps WHERE status = $1 ORDER BY name",
        [status]
      );
      return result.rows.map((row: any) => ({
        id: row.id, name: row.name, description: row.description, url: row.url, icon: row.icon,
        version: row.version, permissions: row.permissions, reactVersion: row.react_version,
        author: row.author, authorUrl: row.author_url, status: row.status, createdAt: row.created_at,
      }));
    },
    async marketplaceApp(_parent: any, args: { id: string }, context: any) {
      const result = await context.pg.query(
        "SELECT id, name, description, url, icon, version, permissions, react_version, author, author_url, status, created_at FROM marketplace_apps WHERE id = $1",
        [args.id]
      );
      if (!result.rows.length) return null;
      const row = result.rows[0];
      return {
        id: row.id, name: row.name, description: row.description, url: row.url, icon: row.icon,
        version: row.version, permissions: row.permissions, reactVersion: row.react_version,
        author: row.author, authorUrl: row.author_url, status: row.status, createdAt: row.created_at,
      };
    },
    async savedViews(_parent: any, _args: any, context: any) {
      if (!context.user?.id) return [];
      try {
        const result = await context.pg.query(
          `SELECT id, name, root_id, class_filter, environment_filter, relationship_filter, camera_x, camera_y, camera_zoom, created_at, updated_at
           FROM saved_views WHERE user_id = $1 ORDER BY updated_at DESC`,
          [context.user.id]
        );
        return result.rows.map((row: any) => ({
          id: row.id,
          name: row.name,
          rootId: row.root_id,
          classFilter: row.class_filter || [],
          environmentFilter: row.environment_filter || [],
          relationshipFilter: row.relationship_filter || [],
          cameraX: row.camera_x,
          cameraY: row.camera_y,
          cameraZoom: row.camera_zoom,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));
      } catch (err) {
        console.error("savedViews error:", err);
        throw err;
      }
    },
    async savedView(_parent: any, args: { id: string }, context: any) {
      if (!context.user?.id) return null;
      try {
        const result = await context.pg.query(
          `SELECT id, name, root_id, class_filter, environment_filter, relationship_filter, camera_x, camera_y, camera_zoom, created_at, updated_at
           FROM saved_views WHERE id = $1 AND user_id = $2`,
          [args.id, context.user.id]
        );
        if (!result.rows.length) return null;
        const row = result.rows[0];
        return {
          id: row.id,
          name: row.name,
          rootId: row.root_id,
          classFilter: row.class_filter || [],
          environmentFilter: row.environment_filter || [],
          relationshipFilter: row.relationship_filter || [],
          cameraX: row.camera_x,
          cameraY: row.camera_y,
          cameraZoom: row.camera_zoom,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      } catch (err) {
        console.error("savedView error:", err);
        throw err;
      }
    },
    async auditLog(_parent: any, args: { entityType?: string; entityId?: string; limit?: number; offset?: number }, context: any) {
      let query = "SELECT id, actor_id, action, entity_type, entity_id, old_values, new_values, metadata, created_at FROM audit_log WHERE 1=1";
      const params: any[] = [];
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
      return result.rows.map((row: any) => ({
        id: row.id,
        actorId: row.actor_id,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        oldValues: row.old_values,
        newValues: row.new_values,
        metadata: row.metadata,
        createdAt: row.created_at,
      }));
    },
    async auditLogForCI(_parent: any, args: { ciId: string; limit?: number }, context: any) {
      const result = await context.pg.query(
        `SELECT id, actor_id, action, entity_type, entity_id, old_values, new_values, metadata, created_at
         FROM audit_log
         WHERE entity_type = 'ConfigurationItem' AND entity_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [args.ciId, args.limit || 50]
      );
      return result.rows.map((row: any) => ({
        id: row.id,
        actorId: row.actor_id,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        oldValues: row.old_values,
        newValues: row.new_values,
        metadata: row.metadata,
        createdAt: row.created_at,
      }));
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
    async createDiscoverySource(_parent: any, args: { name: string; type: string; config?: any }, context: any) {
      await checkPermission(context, "discovery", "write");
      const result = await context.pg.query(
        "INSERT INTO discovery_sources (name, type, config, credential_ref) VALUES ($1, $2, $3, $4) RETURNING id, name, type, config, credential_ref, last_tested_at, last_status, last_error, created_at, updated_at",
        [args.name, args.type, JSON.stringify(args.config || {}), args.config?.credentialRef || null]
      );
      const row = result.rows[0];
      return {
        id: row.id,
        name: row.name,
        type: row.type,
        config: row.config,
        credentialRef: row.credential_ref,
        lastTestedAt: row.last_tested_at,
        lastStatus: row.last_status,
        lastError: row.last_error,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    },
    async updateDiscoverySource(_parent: any, args: { id: string; name: string; type: string; config?: any }, context: any) {
      await checkPermission(context, "discovery", "write");
      const result = await context.pg.query(
        `UPDATE discovery_sources
         SET name = $2,
             type = $3,
             config = $4,
             credential_ref = $5,
             last_status = NULL,
             last_error = NULL,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, name, type, config, credential_ref, last_tested_at, last_status, last_error, created_at, updated_at`,
        [args.id, args.name, args.type, JSON.stringify(args.config || {}), args.config?.credentialRef || null]
      );
      if (!result.rows.length) {
        throw new GraphQLError("Discovery source not found", { extensions: { code: "NOT_FOUND" } });
      }
      const row = result.rows[0];
      return {
        id: row.id,
        name: row.name,
        type: row.type,
        config: row.config,
        credentialRef: row.credential_ref,
        lastTestedAt: row.last_tested_at,
        lastStatus: row.last_status,
        lastError: row.last_error,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    },
    async deleteDiscoverySource(_parent: any, args: { id: string }, context: any) {
      await checkPermission(context, "discovery", "write");
      await context.pg.query("DELETE FROM discovery_sources WHERE id = $1", [args.id]);
      return true;
    },
    async updatePreferences(_parent: any, args: { preferences: any }, context: any) {
      if (!context.user?.id) {
        throw new GraphQLError("Unauthorized", { extensions: { code: "UNAUTHORIZED" } });
      }
      let result = await context.pg.query(
        "UPDATE users SET preferences = COALESCE(preferences, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE id = $2 RETURNING id, name, email, preferences",
        [JSON.stringify(args.preferences), context.user.id]
      );
      if (!result.rows.length && context.user?.email) {
        result = await context.pg.query(
          "UPDATE users SET preferences = COALESCE(preferences, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE email = $2 RETURNING id, name, email, preferences",
          [JSON.stringify(args.preferences), context.user.email]
        );
      }
      if (!result.rows.length) {
        throw new GraphQLError("User not found", { extensions: { code: "NOT_FOUND" } });
      }
      return result.rows[0];
    },
    async updateProfile(_parent: any, args: { name: string }, context: any) {
      if (!context.user?.id) {
        throw new GraphQLError("Unauthorized", { extensions: { code: "UNAUTHORIZED" } });
      }
      const name = String(args.name || "").trim();
      if (name.length < 2 || name.length > 120) {
        throw new GraphQLError("Display name must be between 2 and 120 characters", { extensions: { code: "BAD_USER_INPUT" } });
      }
      let result = await context.pg.query(
        `WITH updated AS (
           UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING *
         )
         SELECT u.id, u.name, u.email, u.preferences, u.role, u.password_hash, u.password_change_required,
                COUNT(oa.id)::int AS oauth_accounts
         FROM updated u
         LEFT JOIN oauth_accounts oa ON oa.user_id = u.id
         GROUP BY u.id, u.name, u.email, u.preferences, u.role, u.password_hash, u.password_change_required`,
        [name, context.user.id]
      );
      if (!result.rows.length && context.user?.email) {
        result = await context.pg.query(
          `WITH updated AS (
             UPDATE users SET name = $1, updated_at = NOW() WHERE email = $2 RETURNING *
           )
           SELECT u.id, u.name, u.email, u.preferences, u.role, u.password_hash, u.password_change_required,
                  COUNT(oa.id)::int AS oauth_accounts
           FROM updated u
           LEFT JOIN oauth_accounts oa ON oa.user_id = u.id
           GROUP BY u.id, u.name, u.email, u.preferences, u.role, u.password_hash, u.password_change_required`,
          [name, context.user.email]
        );
      }
      if (!result.rows.length) {
        throw new GraphQLError("User not found", { extensions: { code: "NOT_FOUND" } });
      }
      return mapUserRow(result.rows[0]);
    },
    async changePassword(_parent: any, args: { currentPassword: string; newPassword: string }, context: any) {
      if (!context.user?.id) {
        throw new GraphQLError("Unauthorized", { extensions: { code: "UNAUTHORIZED" } });
      }
      const currentPassword = String(args.currentPassword || "");
      const newPassword = String(args.newPassword || "");
      const policy = await getPasswordPolicy(context.pg);
      const policyCheck = validatePasswordAgainstPolicy(newPassword, policy);
      if (!policyCheck.valid) {
        throw new GraphQLError(policyCheck.failures[0] || passwordPolicyMessage(policy), { extensions: { code: "BAD_USER_INPUT", failures: policyCheck.failures } });
      }
      if (newPassword === currentPassword) {
        throw new GraphQLError("New password must be different from the current password", { extensions: { code: "BAD_USER_INPUT" } });
      }

      let userResult = await context.pg.query(
        `SELECT u.id, u.name, u.email, u.preferences, u.role, u.password_hash, u.password_change_required,
                COUNT(oa.id)::int AS oauth_accounts
         FROM users u
         LEFT JOIN oauth_accounts oa ON oa.user_id = u.id
         WHERE u.id = $1
         GROUP BY u.id`,
        [context.user.id]
      );
      if (!userResult.rows.length && context.user?.email) {
        userResult = await context.pg.query(
          `SELECT u.id, u.name, u.email, u.preferences, u.role, u.password_hash, u.password_change_required,
                  COUNT(oa.id)::int AS oauth_accounts
           FROM users u
           LEFT JOIN oauth_accounts oa ON oa.user_id = u.id
           WHERE u.email = $1
           GROUP BY u.id`,
          [context.user.email]
        );
      }
      const user = userResult.rows[0];
      if (!user) throw new GraphQLError("User not found", { extensions: { code: "NOT_FOUND" } });
      const currentHash = String(user.password_hash || "");
      if (!currentHash || currentHash.startsWith("oauth:") || currentHash.startsWith("sso:")) {
        throw new GraphQLError("Password changes are only available for local password accounts", { extensions: { code: "FORBIDDEN" } });
      }
      const valid = await bcrypt.compare(currentPassword, currentHash);
      if (!valid) {
        throw new GraphQLError("Current password is incorrect", { extensions: { code: "BAD_USER_INPUT" } });
      }
      const nextHash = await bcrypt.hash(newPassword, 10);
      const result = await context.pg.query(
        `UPDATE users
         SET password_hash = $1,
             password_change_required = FALSE,
             password_changed_at = NOW(),
             updated_at = NOW()
         WHERE id = $2
         RETURNING id, name, email, preferences, role, password_hash, password_change_required, 0::int AS oauth_accounts`,
        [nextHash, user.id]
      );
      return mapUserRow(result.rows[0]);
    },
    async submitMarketplaceApp(_parent: any, args: { id: string; name: string; description?: string; url: string; icon?: string; version?: string; permissions?: string[]; reactVersion?: string; author: string; authorUrl?: string }, context: any) {
      await checkPermission(context, "app", "install");
      const result = await context.pg.query(
        `INSERT INTO marketplace_apps (id, name, description, url, icon, version, permissions, react_version, author, author_url, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           url = EXCLUDED.url,
           icon = EXCLUDED.icon,
           version = EXCLUDED.version,
           permissions = EXCLUDED.permissions,
           react_version = EXCLUDED.react_version,
           author = EXCLUDED.author,
           author_url = EXCLUDED.author_url,
           status = 'pending'
         RETURNING id, name, description, url, icon, version, permissions, react_version as reactVersion, author, author_url as authorUrl, status, created_at as createdAt`,
        [args.id, args.name, args.description || null, args.url, args.icon || 'Compass', args.version || '1.0.0', JSON.stringify(args.permissions || []), args.reactVersion || '^18.0.0', args.author, args.authorUrl || null]
      );
      return result.rows[0];
    },
    async approveMarketplaceApp(_parent: any, args: { id: string }, context: any) {
      await checkPermission(context, "app", "install");
      const result = await context.pg.query(
        `UPDATE marketplace_apps SET status = 'approved', reviewed_by = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, name, description, url, icon, version, permissions, react_version as reactVersion, author, author_url as authorUrl, status, created_at as createdAt`,
        [context.user.id, args.id]
      );
      if (!result.rows.length) {
        throw new GraphQLError("App not found", { extensions: { code: "NOT_FOUND" } });
      }
      return result.rows[0];
    },
    async rejectMarketplaceApp(_parent: any, args: { id: string }, context: any) {
      await checkPermission(context, "app", "install");
      const result = await context.pg.query(
        `UPDATE marketplace_apps SET status = 'rejected', reviewed_by = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, name, description, url, icon, version, permissions, react_version as reactVersion, author, author_url as authorUrl, status, created_at as createdAt`,
        [context.user.id, args.id]
      );
      if (!result.rows.length) {
        throw new GraphQLError("App not found", { extensions: { code: "NOT_FOUND" } });
      }
      return result.rows[0];
    },
    async createSavedView(_parent: any, args: any, context: any) {
      await checkPermission(context, "cmdb", "read");
      if (!context.user?.id) {
        throw new GraphQLError("Unauthorized", { extensions: { code: "UNAUTHORIZED" } });
      }
      try {
        const result = await context.pg.query(
          `INSERT INTO saved_views (user_id, name, root_id, class_filter, environment_filter, relationship_filter, camera_x, camera_y, camera_zoom)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, name, root_id, class_filter, environment_filter, relationship_filter, camera_x, camera_y, camera_zoom, created_at, updated_at`,
          [
            context.user.id, args.name, args.rootId,
            JSON.stringify(args.classFilter || []),
            JSON.stringify(args.environmentFilter || []),
            JSON.stringify(args.relationshipFilter || []),
            args.cameraX ?? null, args.cameraY ?? null, args.cameraZoom ?? null,
          ]
        );
        const row = result.rows[0];
        return {
          id: row.id,
          name: row.name,
          rootId: row.root_id,
          classFilter: row.class_filter || [],
          environmentFilter: row.environment_filter || [],
          relationshipFilter: row.relationship_filter || [],
          cameraX: row.camera_x,
          cameraY: row.camera_y,
          cameraZoom: row.camera_zoom,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      } catch (err) {
        console.error("createSavedView error:", err);
        throw err;
      }
    },
    async updateSavedView(_parent: any, args: any, context: any) {
      await checkPermission(context, "cmdb", "read");
      if (!context.user?.id) {
        throw new GraphQLError("Unauthorized", { extensions: { code: "UNAUTHORIZED" } });
      }
      try {
        const updates: string[] = [];
        const values: any[] = [];
        let idx = 1;
        if (args.name !== undefined) { updates.push(`name = $${idx++}`); values.push(args.name); }
        if (args.rootId !== undefined) { updates.push(`root_id = $${idx++}`); values.push(args.rootId); }
        if (args.classFilter !== undefined) { updates.push(`class_filter = $${idx++}`); values.push(JSON.stringify(args.classFilter)); }
        if (args.environmentFilter !== undefined) { updates.push(`environment_filter = $${idx++}`); values.push(JSON.stringify(args.environmentFilter)); }
        if (args.relationshipFilter !== undefined) { updates.push(`relationship_filter = $${idx++}`); values.push(JSON.stringify(args.relationshipFilter)); }
        if (args.cameraX !== undefined) { updates.push(`camera_x = $${idx++}`); values.push(args.cameraX); }
        if (args.cameraY !== undefined) { updates.push(`camera_y = $${idx++}`); values.push(args.cameraY); }
        if (args.cameraZoom !== undefined) { updates.push(`camera_zoom = $${idx++}`); values.push(args.cameraZoom); }
        if (updates.length === 0) {
          throw new GraphQLError("No fields to update", { extensions: { code: "BAD_USER_INPUT" } });
        }
        updates.push(`updated_at = NOW()`);
        values.push(args.id, context.user.id);
        const result = await context.pg.query(
          `UPDATE saved_views SET ${updates.join(", ")} WHERE id = $${idx++} AND user_id = $${idx++}
           RETURNING id, name, root_id, class_filter, environment_filter, relationship_filter, camera_x, camera_y, camera_zoom, created_at, updated_at`,
          values
        );
        if (!result.rows.length) {
          throw new GraphQLError("View not found", { extensions: { code: "NOT_FOUND" } });
        }
        const row = result.rows[0];
        return {
          id: row.id,
          name: row.name,
          rootId: row.root_id,
          classFilter: row.class_filter || [],
          environmentFilter: row.environment_filter || [],
          relationshipFilter: row.relationship_filter || [],
          cameraX: row.camera_x,
          cameraY: row.camera_y,
          cameraZoom: row.camera_zoom,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      } catch (err) {
        console.error("updateSavedView error:", err);
        throw err;
      }
    },
    async deleteSavedView(_parent: any, args: { id: string }, context: any) {
      await checkPermission(context, "cmdb", "read");
      if (!context.user?.id) {
        throw new GraphQLError("Unauthorized", { extensions: { code: "UNAUTHORIZED" } });
      }
      const result = await context.pg.query(
        "DELETE FROM saved_views WHERE id = $1 AND user_id = $2 RETURNING id",
        [args.id, context.user.id]
      );
      return result.rows.length > 0;
    },
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
