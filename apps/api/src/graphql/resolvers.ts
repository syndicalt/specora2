import { GraphQLError } from "graphql";
import neo4j from "neo4j-driver";
import {
  CreateCIInputSchema,
  UpdateCIInputSchema,
  CreateRelationshipInputSchema,
  DeleteRelationshipInputSchema,
  UpdateRelationshipInputSchema,
} from "@specora/core";

function parseNode(node: any) {
  const attrs = typeof node.attributes === "string" ? JSON.parse(node.attributes) : (node.attributes || {});
  return { ...node, attributes: attrs };
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
    async ciClasses(_parent: any, _args: any, context: any) {
      const session = context.neo4j.session();
      try {
        const result = await session.run(
          `MATCH (n:ConfigurationItem) RETURN DISTINCT n.class as class ORDER BY class`
        );
        return result.records.map((r: any) => r.get("class")).filter(Boolean);
      } finally {
        await session.close();
      }
    },
    async ciEnvironments(_parent: any, _args: any, context: any) {
      const session = context.neo4j.session();
      try {
        const result = await session.run(
          `MATCH (n:ConfigurationItem) WHERE n.environment IS NOT NULL RETURN DISTINCT n.environment as env ORDER BY env`
        );
        return result.records.map((r: any) => r.get("env")).filter(Boolean);
      } finally {
        await session.close();
      }
    },
    async serviceMap(_parent: any, args: { rootId: string }, context: any) {
      const session = context.neo4j.session();
      try {
        // Always fetch the root node first (even if it has no relationships)
        const rootResult = await session.run(
          `MATCH (root:ConfigurationItem {id: $rootId}) RETURN root`,
          { rootId: args.rootId }
        );
        const rootRecord = rootResult.records[0];
        const rootNode = rootRecord ? parseNode(rootRecord.get("root").properties) : null;

        // Fetch related nodes and edges (0..3 hops to include isolated nodes)
        const result = await session.run(
          `MATCH path = (root:ConfigurationItem {id: $rootId})-[:PART_OF|DEPENDS_ON|HOSTED_ON|MANAGED_BY|OWNED_BY|LOCATED_AT*0..3]-(related:ConfigurationItem)
           UNWIND relationships(path) as rel
           WITH DISTINCT rel, startNode(rel) as src, endNode(rel) as tgt
           RETURN rel, src, tgt
           LIMIT 50`,
          { rootId: args.rootId }
        );
        const nodesMap = new Map();
        const edgeSet = new Set<string>();
        const edges: any[] = [];

        // Ensure root node is always in the map
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
    async discoverySources(_parent: any, _args: any, context: any) {
      const result = await context.pg.query("SELECT id, name, type, config, created_at as createdAt FROM discovery_sources ORDER BY created_at DESC");
      return result.rows;
    },
    async discoveryJobs(_parent: any, _args: any, context: any) {
      const result = await context.pg.query("SELECT id, source_id as sourceId, file_path as filePath, status, stats, created_at as createdAt, updated_at as updatedAt FROM discovery_jobs ORDER BY created_at DESC");
      return result.rows;
    },
    async discoveryJob(_parent: any, args: { id: string }, context: any) {
      const result = await context.pg.query(
        "SELECT id, source_id as sourceId, file_path as filePath, status, stats, created_at as createdAt, updated_at as updatedAt FROM discovery_jobs WHERE id = $1",
        [args.id]
      );
      return result.rows[0] || null;
    },
    async me(_parent: any, _args: any, context: any) {
      if (!context.user?.id) return null;
      let result = await context.pg.query(
        "SELECT id, name, email, preferences, role FROM users WHERE id = $1",
        [context.user.id]
      );
      if (!result.rows.length && context.user?.email) {
        result = await context.pg.query(
          "SELECT id, name, email, preferences, role FROM users WHERE email = $1",
          [context.user.email]
        );
      }
      return result.rows[0] || null;
    },
    async marketplaceApps(_parent: any, args: { status?: string }, context: any) {
      const status = args.status || "approved";
      const result = await context.pg.query(
        "SELECT id, name, description, url, icon, version, permissions, react_version as reactVersion, author, author_url as authorUrl, status, created_at as createdAt FROM marketplace_apps WHERE status = $1 ORDER BY name",
        [status]
      );
      return result.rows;
    },
    async marketplaceApp(_parent: any, args: { id: string }, context: any) {
      const result = await context.pg.query(
        "SELECT id, name, description, url, icon, version, permissions, react_version as reactVersion, author, author_url as authorUrl, status, created_at as createdAt FROM marketplace_apps WHERE id = $1",
        [args.id]
      );
      return result.rows[0] || null;
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
        const required = ["name", "class"];
        const populated = required.filter((f) => parent[f]).length;
        const completeness = populated / required.length;

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
  Mutation: {
    async createCI(_parent: any, args: { input: any }, context: any) {
      const validated = CreateCIInputSchema.safeParse(args.input);
      if (!validated.success) {
        throw new GraphQLError(validated.error.message, { extensions: { code: "BAD_USER_INPUT" } });
      }
      const session = context.neo4j.session();
      try {
        const id = validated.data.id || crypto.randomUUID();
        const result = await session.run(
          `CREATE (n:ConfigurationItem {id: $id, name: $name, class: $class, environment: $environment, attributes: $attributes})
           RETURN n`,
          { ...validated.data, id, attributes: JSON.stringify(validated.data.attributes || {}) }
        );
        return parseNode(result.records[0].get("n").properties);
      } finally {
        await session.close();
      }
    },
    async updateCI(_parent: any, args: { id: string; input: any }, context: any) {
      const validated = UpdateCIInputSchema.safeParse(args.input);
      if (!validated.success) {
        throw new GraphQLError(validated.error.message, { extensions: { code: "BAD_USER_INPUT" } });
      }
      const session = context.neo4j.session();
      try {
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
        if (validated.data.attributes !== undefined) {
          sets.push("n.attributes = $attributes");
          params.attributes = JSON.stringify(validated.data.attributes);
        }
        if (!sets.length) throw new GraphQLError("No fields to update");
        const result = await session.run(
          `MATCH (n:ConfigurationItem {id: $id}) SET ${sets.join(", ")} RETURN n`,
          params
        );
        if (!result.records.length) throw new GraphQLError("CI not found");
        return parseNode(result.records[0].get("n").properties);
      } finally {
        await session.close();
      }
    },
    async deleteCI(_parent: any, args: { id: string }, context: any) {
      const session = context.neo4j.session();
      try {
        await session.run(
          `MATCH (n:ConfigurationItem {id: $id}) DETACH DELETE n`,
          { id: args.id }
        );
        return true;
      } finally {
        await session.close();
      }
    },
    async createRelationship(_parent: any, args: { input: any }, context: any) {
      const validated = CreateRelationshipInputSchema.safeParse(args.input);
      if (!validated.success) {
        throw new GraphQLError(validated.error.message, { extensions: { code: "BAD_USER_INPUT" } });
      }
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
      const validated = DeleteRelationshipInputSchema.safeParse(args);
      if (!validated.success) {
        throw new GraphQLError(validated.error.message, { extensions: { code: "BAD_USER_INPUT" } });
      }
      const session = context.neo4j.session();
      try {
        const result = await session.run(
          `MATCH (a:ConfigurationItem {id: $sourceId})-[r:${validated.data.type}]->(b:ConfigurationItem {id: $targetId})
           DELETE r
           RETURN count(r) as deleted`,
          { sourceId: validated.data.sourceId, targetId: validated.data.targetId }
        );
        const deleted = result.records[0]?.get("deleted")?.toNumber() || 0;
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
      const validated = UpdateRelationshipInputSchema.safeParse(args);
      if (!validated.success) {
        throw new GraphQLError(validated.error.message, { extensions: { code: "BAD_USER_INPUT" } });
      }
      const session = context.neo4j.session();
      try {
        const { sourceId, targetId, type, newType, attributes } = validated.data;
        const needsTypeChange = newType && newType !== type;
        let result;

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
      const result = await context.pg.query(
        "INSERT INTO discovery_sources (name, type, config) VALUES ($1, $2, $3) RETURNING id, name, type, config, created_at as createdAt",
        [args.name, args.type, JSON.stringify(args.config || {})]
      );
      return result.rows[0];
    },
    async deleteDiscoverySource(_parent: any, args: { id: string }, context: any) {
      await context.pg.query("DELETE FROM discovery_sources WHERE id = $1", [args.id]);
      return true;
    },
    async updatePreferences(_parent: any, args: { preferences: any }, context: any) {
      if (!context.user?.id) {
        throw new GraphQLError("Unauthorized", { extensions: { code: "UNAUTHORIZED" } });
      }
      let result = await context.pg.query(
        "UPDATE users SET preferences = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, email, preferences",
        [JSON.stringify(args.preferences), context.user.id]
      );
      if (!result.rows.length && context.user?.email) {
        result = await context.pg.query(
          "UPDATE users SET preferences = $1, updated_at = NOW() WHERE email = $2 RETURNING id, name, email, preferences",
          [JSON.stringify(args.preferences), context.user.email]
        );
      }
      if (!result.rows.length) {
        throw new GraphQLError("User not found", { extensions: { code: "NOT_FOUND" } });
      }
      return result.rows[0];
    },
    async submitMarketplaceApp(_parent: any, args: { id: string; name: string; description?: string; url: string; icon?: string; version?: string; permissions?: string[]; reactVersion?: string; author: string; authorUrl?: string }, context: any) {
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
      if (!context.user?.id) {
        throw new GraphQLError("Unauthorized", { extensions: { code: "UNAUTHORIZED" } });
      }
      const userResult = await context.pg.query("SELECT role FROM users WHERE id = $1", [context.user.id]);
      if (userResult.rows[0]?.role !== 'admin') {
        throw new GraphQLError("Admin required", { extensions: { code: "FORBIDDEN" } });
      }
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
      if (!context.user?.id) {
        throw new GraphQLError("Unauthorized", { extensions: { code: "UNAUTHORIZED" } });
      }
      const userResult = await context.pg.query("SELECT role FROM users WHERE id = $1", [context.user.id]);
      if (userResult.rows[0]?.role !== 'admin') {
        throw new GraphQLError("Admin required", { extensions: { code: "FORBIDDEN" } });
      }
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
  },
};
