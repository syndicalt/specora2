import { GraphQLError } from "graphql";
import { CreateCIInputSchema, UpdateCIInputSchema, CreateRelationshipInputSchema } from "@specora/core";

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
    async cis(_parent: any, args: { filter?: any }, context: any) {
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
        query += " RETURN n LIMIT 100";
        const result = await session.run(query, params);
        return result.records.map((r: any) => parseNode(r.get("n").properties));
      } finally {
        await session.close();
      }
    },
    async serviceMap(_parent: any, args: { rootId: string }, context: any) {
      const session = context.neo4j.session();
      try {
        const result = await session.run(
          `MATCH path = (root:ConfigurationItem {id: $rootId})-[:PART_OF|DEPENDS_ON|HOSTED_ON|MANAGED_BY|OWNED_BY|LOCATED_AT*1..3]-(related:ConfigurationItem)
           UNWIND relationships(path) as rel
           WITH DISTINCT rel, startNode(rel) as src, endNode(rel) as tgt
           RETURN rel, src, tgt
           LIMIT 50`,
          { rootId: args.rootId }
        );
        const nodesMap = new Map();
        const edgeSet = new Set<string>();
        const edges: any[] = [];
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
          root: nodesMap.get(args.rootId),
          nodes: Array.from(nodesMap.values()),
          edges,
        };
      } finally {
        await session.close();
      }
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
  },
};
