import neo4j from "neo4j-driver";
import type { Driver, Node, Relationship } from "neo4j-driver";
import { parseNode } from "./ciNode";
import { relationshipPattern } from "./relationshipTypes";
import { boundedHopCount } from "./resolverSupport";

type QueryablePg = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
};

type GraphResolverContext = {
  neo4j: Driver;
  pg: QueryablePg;
};

type ServiceMapArgs = {
  rootId: string;
  classFilter?: string[];
  environmentFilter?: string[];
  relationshipFilter?: string[];
};

type NeighborsArgs = {
  nodeId: string;
  types?: string[];
  limit?: number;
};

type DependencyPathArgs = {
  fromId: string;
  toId: string;
  maxHops?: number;
};

type ConfigurationItem = ReturnType<typeof parseNode>;

type GraphEdge = {
  id: string;
  type: string;
  sourceId: string;
  targetId: string;
};

type GraphResult = {
  root?: ConfigurationItem | null;
  nodes: ConfigurationItem[];
  edges: GraphEdge[];
};

type PathRelationshipProjection = {
  reltype: string;
  sourceid: string;
  targetid: string;
};

function nodeFromRecord(value: unknown): ConfigurationItem {
  return parseNode((value as Node).properties);
}

function relationshipFromRecord(value: unknown): Relationship {
  return value as Relationship;
}

function addEdge(edges: GraphEdge[], edgeSet: Set<string>, sourceId: string, targetId: string, type: string) {
  const edgeKey = `${sourceId}-${targetId}-${type}`;
  if (edgeSet.has(edgeKey)) return;
  edgeSet.add(edgeKey);
  edges.push({
    id: edgeKey,
    type,
    sourceId,
    targetId,
  });
}

export const graphQueries = {
  async serviceMap(_parent: unknown, args: ServiceMapArgs, context: GraphResolverContext): Promise<GraphResult> {
    const session = context.neo4j.session();
    try {
      const rootResult = await session.run(
        `MATCH (root:ConfigurationItem {id: $rootId}) RETURN root`,
        { rootId: args.rootId }
      );
      const rootRecord = rootResult.records[0];
      const rootNode = rootRecord ? nodeFromRecord(rootRecord.get("root")) : null;

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

      const params: Record<string, unknown> = { rootId: args.rootId };
      if (args.classFilter?.length) params.classFilter = args.classFilter;
      if (args.environmentFilter?.length) params.environmentFilter = args.environmentFilter;
      if (args.relationshipFilter?.length) params.relationshipFilter = args.relationshipFilter;

      const result = await session.run(query, params);

      const nodesMap = new Map<string, ConfigurationItem>();
      const edgeSet = new Set<string>();
      const edges: GraphEdge[] = [];

      if (rootNode) {
        nodesMap.set(rootNode.id, rootNode);
      }

      for (const record of result.records) {
        const rel = relationshipFromRecord(record.get("rel"));
        const src = nodeFromRecord(record.get("src"));
        const tgt = nodeFromRecord(record.get("tgt"));
        nodesMap.set(src.id, src);
        nodesMap.set(tgt.id, tgt);
        addEdge(edges, edgeSet, src.id, tgt.id, rel.type);
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

  async neighbors(_parent: unknown, args: NeighborsArgs, context: GraphResolverContext): Promise<GraphResult> {
    const session = context.neo4j.session();
    try {
      const rootResult = await session.run(
        `MATCH (root:ConfigurationItem {id: $nodeId}) RETURN root`,
        { nodeId: args.nodeId }
      );
      const rootNode = rootResult.records[0] ? nodeFromRecord(rootResult.records[0].get("root")) : null;

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

      const nodesMap = new Map<string, ConfigurationItem>();
      const edgeSet = new Set<string>();
      const edges: GraphEdge[] = [];

      if (rootNode) {
        nodesMap.set(rootNode.id, rootNode);
      }

      for (const record of result.records) {
        const rel = relationshipFromRecord(record.get("rel"));
        const src = nodeFromRecord(record.get("src"));
        const tgt = nodeFromRecord(record.get("tgt"));
        nodesMap.set(src.id, src);
        nodesMap.set(tgt.id, tgt);
        addEdge(edges, edgeSet, src.id, tgt.id, rel.type);
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

  async dependencyPath(_parent: unknown, args: DependencyPathArgs, context: GraphResolverContext): Promise<Omit<GraphResult, "root"> | null> {
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
      const pathNodes = (record.get("pathNodes") as Node[]).map((node) => parseNode(node.properties));
      const pathRels = record.get("pathRels") as PathRelationshipProjection[];
      const nodesMap = new Map<string, ConfigurationItem>(pathNodes.map((node) => [node.id, node]));
      const edges = pathRels.map((rel) => ({
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
