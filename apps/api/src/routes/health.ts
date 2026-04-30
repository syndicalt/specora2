import { FastifyInstance } from "fastify";
import { runHardcodedRules, HARDCODED_RULES } from "../services/healthRules";
import { generateRules, executeGeneratedRule } from "../services/aiRuleGenerator";
import { buildConfigAudit, buildReadiness, buildWorkerHealth } from "../services/operability";

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : "Unexpected error";
}

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get("/api/health/ready", async (_request, reply) => {
    const readiness = await buildReadiness(fastify);
    if (readiness.status === "fail") return reply.status(503).send(readiness);
    return readiness;
  });

  fastify.get("/api/health/config", { onRequest: [fastify.authenticate] }, async () => {
    return buildConfigAudit();
  });

  fastify.get("/api/health/worker", { onRequest: [fastify.authenticate] }, async () => {
    return buildWorkerHealth(fastify);
  });

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
      const violations = result.records.map((record) => ({
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        message: rule.description,
        ciId: record.get("ciId"),
        ciName: record.get("ciName"),
        ciClass: record.get("ciClass"),
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
    } catch (err: unknown) {
      fastify.log.error({ err }, "AI rule generation failed");
      return reply.status(500).send({ error: errorMessage(err) });
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
    } catch (err: unknown) {
      fastify.log.error({ err, cypher }, "Generated rule execution failed");
      return reply.status(400).send({ error: errorMessage(err) });
    }
  });
}
