import neo4j from "neo4j-driver";
import { parseNode } from "./ciNode";
import { relationshipPattern } from "./relationshipTypes";
import { boundedHopCount } from "./resolverSupport";

export const graphQueries = {
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
      const pathNodes = record.get("pathNodes").map((node: any) => parseNode(node.properties));
      const pathRels = record.get("pathRels");
      const nodesMap = new Map(pathNodes.map((node: any) => [node.id, node]));
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
};
