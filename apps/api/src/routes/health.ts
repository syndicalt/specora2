import { FastifyInstance } from "fastify";
import { runHardcodedRules, HARDCODED_RULES } from "../services/healthRules";
import { generateRules, executeGeneratedRule } from "../services/aiRuleGenerator";

export async function healthRoutes(fastify: FastifyInstance) {
  // Run all hardcoded synthetic completeness rules
  fastify.get("/api/health/rules", { onRequest: [fastify.authenticate] }, async (_request, _reply) => {
    const violations = await runHardcodedRules(fastify);
    return {
      totalRules: HARDCODED_RULES.length,
      violationCount: violations.length,
      violations: violations.slice(0, 100), // cap response size
    };
  });

  // Get rule definitions (without running them)
  fastify.get("/api/health/rules/definitions", { onRequest: [fastify.authenticate] }, async () => {
    return HARDCODED_RULES.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      severity: r.severity,
    }));
  });

  // Run a specific hardcoded rule by ID
  fastify.post("/api/health/rules/:ruleId/run", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { ruleId } = request.params as { ruleId: string };
    const rule = HARDCODED_RULES.find((r) => r.id === ruleId);
    if (!rule) {
      return reply.status(404).send({ error: "Rule not found" });
    }

    const session = fastify.neo4j.session();
    try {
      const result = await session.run(rule.cypher);
      const violations = result.records.map((r: any) => ({
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        message: rule.description,
        ciId: r.get("ciId"),
        ciName: r.get("ciName"),
        ciClass: r.get("ciClass"),
      }));
      return { violations };
    } finally {
      await session.close();
    }
  });

  // Generate AI rules based on current graph topology
  fastify.post("/api/health/rules/generate", { onRequest: [fastify.authenticate] }, async (_request, reply) => {
    try {
      const rules = await generateRules(fastify);
      return { rules };
    } catch (err: any) {
      fastify.log.error({ err }, "AI rule generation failed");
      return reply.status(500).send({ error: err.message });
    }
  });

  // Execute a generated (AI) rule
  fastify.post("/api/health/rules/execute", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { cypher } = request.body as { cypher: string };
    if (!cypher || typeof cypher !== "string") {
      return reply.status(400).send({ error: "cypher query is required" });
    }

    try {
      const violations = await executeGeneratedRule(fastify, cypher);
      return { violations };
    } catch (err: any) {
      fastify.log.error({ err, cypher }, "Generated rule execution failed");
      return reply.status(400).send({ error: err.message });
    }
  });
}
