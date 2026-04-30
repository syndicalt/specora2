import type { FastifyInstance } from "fastify";
import { registerTool } from "@specora/sdk";

function toolArgs(args: unknown): { jobId?: string; environment?: string } {
  return args && typeof args === "object" ? args as { jobId?: string; environment?: string } : {};
}

export function registerDiscoveryInsightsTools() {
registerTool<FastifyInstance>("discovery-insights", {
  name: "analyze_coverage",
  description: "Analyze a discovery job's coverage against expected CSDMv5 classes",
  parameters: {
    type: "object",
    properties: {
      jobId: { type: "string", description: "UUID of the discovery job" },
    },
    required: ["jobId"],
  },
}, async (args, fastify) => {
  const { jobId } = toolArgs(args);
  const logsResult = await fastify.pg.query(
    `SELECT ci_id, action, new_values->>'class' as class FROM reconciliation_logs WHERE discovery_job_id = $1`,
    [jobId]
  );
  const classCounts: Record<string, number> = {};
  for (const row of logsResult.rows) {
    const cls = (row as { class?: string }).class || "Unknown";
    classCounts[cls] = (classCounts[cls] || 0) + 1;
  }
  return { jobId, classCounts, total: logsResult.rows.length };
});

registerTool<FastifyInstance>("discovery-insights", {
  name: "suggest_next_scan",
  description: "Suggest the next discovery scan based on coverage gaps",
  parameters: {
    type: "object",
    properties: {
      environment: { type: "string", description: "Optional environment filter" },
    },
  },
}, async (args, fastify) => {
  const { environment } = toolArgs(args);
  const session = fastify.neo4j.session();
  try {
    let query = "MATCH (n:ConfigurationItem) RETURN n.class as class, count(n) as count";
    const params: Record<string, string> = {};
    if (environment) {
      query = "MATCH (n:ConfigurationItem {environment: $env}) RETURN n.class as class, count(n) as count";
      params.env = environment;
    }
    const result = await session.run(query, params);
    const existing: Record<string, number> = {};
    for (const record of result.records) {
      existing[record.get("class")] = record.get("count").toNumber();
    }
    const expected = ["Server", "Database", "Application", "NetworkGear", "BusinessService", "ApplicationService", "TechnicalService"];
    const gaps = expected.filter((cls) => !existing[cls] || existing[cls] === 0);
    return { gaps, existing, suggestion: gaps.length > 0 ? `Missing: ${gaps.join(", ")}` : "Coverage looks good" };
  } finally {
    await session.close();
  }
});
}
