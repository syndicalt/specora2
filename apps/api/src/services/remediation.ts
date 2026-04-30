import type { FastifyInstance } from "fastify";
import { runHardcodedRules, RuleViolation, SuggestedFix } from "./healthRules";

export { RuleViolation, SuggestedFix };

function errorMessage(err: unknown) {
  return err instanceof Error && err.message ? err.message : "Remediation failed";
}

export async function getRemediationSuggestions(fastify: FastifyInstance): Promise<RuleViolation[]> {
  const violations = await runHardcodedRules(fastify);
  return violations.filter((v) => v.suggestedFix);
}

export async function applyRemediation(
  fastify: FastifyInstance,
  fix: SuggestedFix,
  actorId?: string
): Promise<{ success: boolean; message: string }> {
  if (fix.type !== "create_relationship") {
    return { success: false, message: `Unsupported fix type: ${fix.type}` };
  }
  if (!fix.targetId) {
    return { success: false, message: "Fix is missing targetId" };
  }

  const session = fastify.neo4j.session();
  try {
    // Verify both nodes exist
    const checkResult = await session.run(
      `MATCH (a:ConfigurationItem {id: $sourceId}), (b:ConfigurationItem {id: $targetId})
       RETURN a, b`,
      { sourceId: fix.sourceId, targetId: fix.targetId }
    );
    if (!checkResult.records.length) {
      return { success: false, message: "Source or target CI not found" };
    }

    // Check for duplicate
    const dupResult = await session.run(
      `MATCH (a:ConfigurationItem {id: $sourceId})-[r:${fix.relType}]->(b:ConfigurationItem {id: $targetId})
       RETURN count(r) as c`,
      { sourceId: fix.sourceId, targetId: fix.targetId }
    );
    if (dupResult.records[0].get("c").toNumber() > 0) {
      return { success: false, message: "Relationship already exists" };
    }

    await session.run(
      `MATCH (a:ConfigurationItem {id: $sourceId}), (b:ConfigurationItem {id: $targetId})
       CREATE (a)-[r:${fix.relType}]->(b)
       RETURN r`,
      { sourceId: fix.sourceId, targetId: fix.targetId }
    );

    // Emit event if available
    try {
      const { emit } = await import("./eventBus");
      emit("relationship.created", {
        sourceId: fix.sourceId,
        targetId: fix.targetId,
        type: fix.relType,
        actorId,
      });
    } catch {
      // Event bus may not be initialized in tests
    }

    return { success: true, message: `Created ${fix.relType} relationship` };
  } catch (err) {
    const message = errorMessage(err);
    fastify.log.warn({ error: message }, "applyRemediation failed");
    return { success: false, message };
  } finally {
    await session.close();
  }
}
