import { FastifyInstance } from "fastify";
import { registerTool } from "@specora/sdk";

export function registerHealthMonitorTools() {
registerTool<FastifyInstance>("health-monitor", {
  name: "find_cycles",
  description: "Find circular dependencies in the CMDB graph",
  parameters: {
    type: "object",
    properties: {
      maxDepth: { type: "integer", description: "Maximum path depth to search" },
    },
  },
}, async (args, fastify) => {
  const maxDepth = (args.maxDepth as number) || 5;
  if (!Number.isInteger(maxDepth) || maxDepth < 2 || maxDepth > 50) {
    throw new Error("maxDepth must be an integer between 2 and 50");
  }
  const session = fastify.neo4j.session();
  try {
    const result = await session.run(
      `MATCH path = (a)-[:DEPENDS_ON|PART_OF*2..${maxDepth}]->(a)
       UNWIND nodes(path) as node
       WITH path, collect(DISTINCT node) as cycleNodes
       RETURN cycleNodes, relationships(path) as rels
       LIMIT 20`
    );
    return result.records.map((r: any) => {
      const nodes = r.get("cycleNodes").map((n: any) => ({
        id: n.properties.id,
        name: n.properties.name,
        class: n.properties.class,
      }));
      const rels = r.get("rels").map((rel: any) => ({
        type: rel.type,
        sourceId: rel.start.properties.id,
        targetId: rel.end.properties.id,
      }));
      return { nodes, relationships: rels };
    });
  } finally {
    await session.close();
  }
});

registerTool<FastifyInstance>("health-monitor", {
  name: "find_orphaned",
  description: "Find CIs with zero relationships",
  parameters: {
    type: "object",
    properties: {
      class: { type: "string", description: "Optional CI class filter" },
    },
  },
}, async (args, fastify) => {
  const cls = args.class as string | undefined;
  const session = fastify.neo4j.session();
  try {
    let query = "MATCH (n:ConfigurationItem) WHERE NOT (n)-[:PART_OF|DEPENDS_ON|HOSTED_ON|MANAGED_BY|OWNED_BY|LOCATED_AT]-()";
    const params: any = {};
    if (cls) {
      query += " AND n.class = $class";
      params.class = cls;
    }
    query += " RETURN n LIMIT 50";
    const result = await session.run(query, params);
    return result.records.map((r: any) => {
      const props = r.get("n").properties;
      return { id: props.id, name: props.name, class: props.class, environment: props.environment };
    });
  } finally {
    await session.close();
  }
});

registerTool<FastifyInstance>("health-monitor", {
  name: "find_stale",
  description: "Find CIs not discovered in the last N days",
  parameters: {
    type: "object",
    properties: {
      days: { type: "integer", description: "Days since last discovery (default 30)" },
    },
  },
}, async (args, fastify) => {
  const days = (args.days as number) || 30;
  const cutoff = Date.now() - days * 86400000;
  const session = fastify.neo4j.session();
  try {
    const result = await session.run(
      `MATCH (n:ConfigurationItem)
       WHERE n.lastDiscoveredAt IS NULL OR n.lastDiscoveredAt < $cutoff
       RETURN n LIMIT 50`,
      { cutoff }
    );
    return result.records.map((r: any) => {
      const props = r.get("n").properties;
      return { id: props.id, name: props.name, class: props.class, environment: props.environment };
    });
  } finally {
    await session.close();
  }
});

registerTool<FastifyInstance>("health-monitor", {
  name: "score_ci",
  description: "Compute health score for a specific CI",
  parameters: {
    type: "object",
    properties: {
      ciId: { type: "string", description: "ID of the CI" },
    },
    required: ["ciId"],
  },
}, async (args, fastify) => {
  const { ciId } = args as any;
  const session = fastify.neo4j.session();
  try {
    const result = await session.run(
      `MATCH (n:ConfigurationItem {id: $id})
       OPTIONAL MATCH (n)-[r]-()
       RETURN n, count(r) as relCount`,
      { id: ciId }
    );
    if (!result.records.length) return { error: "CI not found" };
    const props = result.records[0].get("n").properties;
    const relCount = result.records[0].get("relCount").toNumber();
    const completeness = props.name && props.class && props.environment ? 100 : 60;
    const relationshipValidity = relCount > 0 ? 100 : 0;
    const freshness = props.lastDiscoveredAt ? 100 : 0;
    const overall = Math.round((completeness + relationshipValidity + freshness) / 3);
    return {
      ciId,
      name: props.name,
      class: props.class,
      scores: { completeness, relationshipValidity, freshness, overall },
      relationshipCount: relCount,
    };
  } finally {
    await session.close();
  }
});

registerTool<FastifyInstance>("health-monitor", {
  name: "check_completeness",
  description: "Run hardcoded synthetic completeness rules against the CMDB graph. Returns structural violations like missing relationships.",
  parameters: {
    type: "object",
    properties: {
      ruleId: { type: "string", description: "Optional: run only a specific rule by ID. Leave empty to run all." },
    },
  },
}, async (args, fastify) => {
  const { runHardcodedRules, HARDCODED_RULES } = await import("../healthRules");
  if (args.ruleId) {
    const rule = HARDCODED_RULES.find((r) => r.id === args.ruleId);
    if (!rule) return { error: "Rule not found" };
    const session = fastify.neo4j.session();
    try {
      const result = await session.run(rule.cypher);
      return result.records.map((r: any) => ({
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        message: rule.description,
        ciId: r.get("ciId"),
        ciName: r.get("ciName"),
        ciClass: r.get("ciClass"),
      }));
    } finally {
      await session.close();
    }
  }
  return runHardcodedRules(fastify);
});

registerTool<FastifyInstance>("health-monitor", {
  name: "generate_rules",
  description: "Use AI to analyze the current CMDB graph and suggest new structural validation rules. Returns suggested Cypher queries.",
  parameters: {
    type: "object",
    properties: {},
  },
}, async (_args, fastify) => {
  const { generateRules } = await import("../aiRuleGenerator");
  return generateRules(fastify);
});

registerTool<FastifyInstance>("health-monitor", {
  name: "execute_generated_rule",
  description: "Execute a Cypher query generated by the AI rule generator against the CMDB. Safety-guarded: only MATCH queries allowed.",
  parameters: {
    type: "object",
    properties: {
      cypher: { type: "string", description: "The Cypher query to execute. Must start with MATCH." },
    },
    required: ["cypher"],
  },
}, async (args, fastify) => {
  const { executeGeneratedRule } = await import("../aiRuleGenerator");
  return executeGeneratedRule(fastify, args.cypher as string);
});

// ─────────────────────────────────────────────────────────────
// Auto-remediation tools
// ─────────────────────────────────────────────────────────────

registerTool<FastifyInstance>("health-monitor", {
  name: "get_remediation_suggestions",
  description: "Get a list of health rule violations that have suggested auto-remediation fixes. Each suggestion includes the violation details and a proposed fix action.",
  parameters: {
    type: "object",
    properties: {},
  },
}, async (_args, fastify) => {
  const { getRemediationSuggestions } = await import("../remediation");
  return getRemediationSuggestions(fastify);
});

registerTool<FastifyInstance>("health-monitor", {
  name: "apply_remediation",
  description: "Apply a suggested remediation fix to the CMDB. Currently supports creating relationships. Returns success or error.",
  parameters: {
    type: "object",
    properties: {
      sourceId: { type: "string", description: "ID of the source CI" },
      targetId: { type: "string", description: "ID of the target CI" },
      relType: { type: "string", description: "Relationship type to create (PART_OF, DEPENDS_ON, HOSTED_ON, MANAGED_BY, OWNED_BY, LOCATED_AT)" },
    },
    required: ["sourceId", "targetId", "relType"],
  },
}, async (args, fastify) => {
  const { applyRemediation } = await import("../remediation");
  const a = args as any;
  return applyRemediation(fastify, {
    type: "create_relationship",
    description: `Create ${a.relType} from ${a.sourceId} to ${a.targetId}`,
    sourceId: a.sourceId,
    targetId: a.targetId,
    relType: a.relType,
  });
});
}
