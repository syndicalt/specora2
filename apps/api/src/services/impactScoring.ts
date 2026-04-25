import { FastifyInstance } from "fastify";

// ─────────────────────────────────────────────────────────────
// Configuration: class weights and environment multipliers
// ─────────────────────────────────────────────────────────────

const CLASS_WEIGHTS: Record<string, number> = {
  BusinessService: 25,
  ApplicationService: 20,
  Database: 20,
  TechnicalService: 15,
  Application: 15,
  Server: 10,
  NetworkGear: 5,
  User: 2,
  Group: 2,
  Location: 2,
};

const ENV_MULTIPLIERS: Record<string, number> = {
  Production: 2.0,
  Staging: 1.0,
  Development: 0.5,
};

const DOWNSTREAM_MULTIPLIER = 1.5;
const UPSTREAM_MULTIPLIER = 0.8;
const HEALTH_PENALTY_MAX = 20;
const CONFLICT_PENALTY_PER_RFC = 5;
const CONFLICT_PENALTY_MAX = 15;
const MAX_RISK_SCORE = 100;

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface ScoredCi {
  ciId: string;
  name: string;
  class: string;
  environment: string;
  distance: number;
  direction: "upstream" | "downstream";
  contribution: number;
}

export interface ImpactScore {
  riskScore: number;
  blastRadius: number;
  priority: "critical" | "high" | "medium" | "low";
  breakdown: {
    primaryCriticality: number;
    downstreamCount: number;
    productionCount: number;
    businessServiceCount: number;
    averageHealth: number;
  };
  affectedCis: ScoredCi[];
}

// ─────────────────────────────────────────────────────────────
// Core scoring
// ─────────────────────────────────────────────────────────────

function getClassWeight(ciClass?: string): number {
  return CLASS_WEIGHTS[ciClass || ""] ?? 5;
}

function getEnvMultiplier(env?: string): number {
  return ENV_MULTIPLIERS[env || ""] ?? 1.0;
}

function getPriority(riskScore: number): "critical" | "high" | "medium" | "low" {
  if (riskScore >= 75) return "critical";
  if (riskScore >= 50) return "high";
  if (riskScore >= 25) return "medium";
  return "low";
}

interface RawCi {
  id: string;
  name: string;
  class?: string;
  environment?: string;
  distance: number;
  direction: "upstream" | "downstream";
}

function scoreAffectedCi(ci: RawCi): ScoredCi {
  const weight = getClassWeight(ci.class);
  const envMult = getEnvMultiplier(ci.environment);
  const decay = 1 / Math.max(ci.distance, 1);
  const directionMult = ci.direction === "downstream" ? DOWNSTREAM_MULTIPLIER : UPSTREAM_MULTIPLIER;
  const contribution = weight * envMult * decay * directionMult;

  return {
    ciId: ci.id,
    name: ci.name,
    class: ci.class || "Unknown",
    environment: ci.environment || "Unknown",
    distance: ci.distance,
    direction: ci.direction,
    contribution: Math.round(contribution * 100) / 100,
  };
}

function computeBaseCriticality(primaryClass?: string, primaryEnv?: string): number {
  return getClassWeight(primaryClass) * getEnvMultiplier(primaryEnv);
}

// ─────────────────────────────────────────────────────────────
// Direction detection via Neo4j
// ─────────────────────────────────────────────────────────────

async function determineDirection(
  session: any,
  primaryId: string,
  ciId: string
): Promise<"upstream" | "downstream"> {
  // Downstream = there is a path from primary TO ci
  const downstreamResult = await session.run(
    `MATCH path = shortestPath((primary:ConfigurationItem {id: $primaryId})-[:DEPENDS_ON|PART_OF|HOSTED_ON*1..5]->(ci:ConfigurationItem {id: $ciId}))
     RETURN length(path) as len`,
    { primaryId, ciId }
  );
  if (downstreamResult.records.length > 0) {
    return "downstream";
  }

  // Upstream = there is a path from ci TO primary
  const upstreamResult = await session.run(
    `MATCH path = shortestPath((ci:ConfigurationItem {id: $ciId})-[:DEPENDS_ON|PART_OF|HOSTED_ON*1..5]->(primary:ConfigurationItem {id: $primaryId}))
     RETURN length(path) as len`,
    { primaryId, ciId }
  );
  if (upstreamResult.records.length > 0) {
    return "upstream";
  }

  // Fallback: bidirectional or no path — treat as upstream (less risky)
  return "upstream";
}

// ─────────────────────────────────────────────────────────────
// Health lookup
// ─────────────────────────────────────────────────────────────

async function fetchHealthScores(
  session: any,
  ciIds: string[]
): Promise<Record<string, number>> {
  if (ciIds.length === 0) return {};
  const result = await session.run(
    `MATCH (n:ConfigurationItem) WHERE n.id IN $ids
     RETURN n.id as id, n.healthOverall as health`,
    { ids: ciIds }
  );
  const scores: Record<string, number> = {};
  for (const record of result.records) {
    const id = record.get("id");
    const health = record.get("health");
    scores[id] = typeof health === "number" ? health : parseFloat(health) || 1.0;
  }
  // Default to 1.0 for CIs without health data
  for (const id of ciIds) {
    if (!(id in scores)) scores[id] = 1.0;
  }
  return scores;
}

// ─────────────────────────────────────────────────────────────
// Overlapping RFC penalty
// ─────────────────────────────────────────────────────────────

async function countOverlappingRfcs(
  pg: any,
  rfcId: string,
  ciIds: string[]
): Promise<number> {
  const result = await pg.query(
    `SELECT COUNT(DISTINCT crc.change_request_id) as count
     FROM change_request_cis crc
     JOIN change_requests cr ON cr.id = crc.change_request_id
     WHERE crc.change_request_id <> $1
       AND crc.ci_id = ANY($2)
       AND cr.status IN ('pending_approval', 'approved', 'implemented')`,
    [rfcId, ciIds]
  );
  return parseInt(result.rows[0]?.count || "0", 10);
}

// ─────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────

async function buildImpactScore(
  fastify: FastifyInstance,
  primaryCiId: string,
  affectedCiIds: string[],
  options: { skipConflictCheck?: boolean; rfcId?: string } = {}
): Promise<ImpactScore> {
  const session = fastify.neo4j.session();

  try {
    // 1. Fetch primary CI details
    const primaryResult = await session.run(
      `MATCH (n:ConfigurationItem {id: $id}) RETURN n.class as class, n.environment as environment`,
      { id: primaryCiId }
    );
    const primaryClass = primaryResult.records[0]?.get("class") || "";
    const primaryEnv = primaryResult.records[0]?.get("environment") || "";

    // 2. Fetch affected CI details + distance from the 3-hop query
    const affectedResult = await session.run(
      `MATCH path = (primary:ConfigurationItem {id: $primaryId})-[:PART_OF|DEPENDS_ON|HOSTED_ON|MANAGED_BY|OWNED_BY|LOCATED_AT*1..3]-(related:ConfigurationItem)
       WHERE related.id <> $primaryId AND related.id IN $affectedIds
       WITH related, min(length(path)) as distance
       RETURN related.id as id, related.name as name, related.class as class, related.environment as environment, distance`,
      { primaryId: primaryCiId, affectedIds: affectedCiIds }
    );

    const rawCis: RawCi[] = [];
    for (const record of affectedResult.records) {
      const ciId = record.get("id");
      const direction = await determineDirection(session, primaryCiId, ciId);
      rawCis.push({
        id: ciId,
        name: record.get("name"),
        class: record.get("class"),
        environment: record.get("environment"),
        distance: record.get("distance").toNumber(),
        direction,
      });
    }

    // 3. Score each CI
    const scoredCis = rawCis.map(scoreAffectedCi);

    // 4. Compute aggregate metrics
    const baseCriticality = computeBaseCriticality(primaryClass, primaryEnv);
    const totalContribution = scoredCis.reduce((sum, ci) => sum + ci.contribution, 0);
    const downstreamCount = scoredCis.filter((ci) => ci.direction === "downstream").length;
    const productionCount = scoredCis.filter((ci) => ci.environment === "Production").length;
    const businessServiceCount = scoredCis.filter((ci) => ci.class === "BusinessService").length;

    // 5. Health penalty
    const healthScores = await fetchHealthScores(session, affectedCiIds);
    const healthValues = Object.values(healthScores);
    const averageHealth = healthValues.length > 0
      ? healthValues.reduce((a, b) => a + b, 0) / healthValues.length
      : 1.0;
    const healthPenalty = (1 - averageHealth) * HEALTH_PENALTY_MAX;

    // 6. Conflict penalty (optional)
    let conflictPenalty = 0;
    if (!options.skipConflictCheck && options.rfcId) {
      const overlappingCount = await countOverlappingRfcs(fastify.pg, options.rfcId, affectedCiIds);
      conflictPenalty = Math.min(overlappingCount * CONFLICT_PENALTY_PER_RFC, CONFLICT_PENALTY_MAX);
    }

    // 7. Final score
    const blastRadius = Math.round(totalContribution * 100) / 100;
    const riskScore = Math.min(
      MAX_RISK_SCORE,
      Math.round(baseCriticality + totalContribution + healthPenalty + conflictPenalty)
    );

    return {
      riskScore,
      blastRadius,
      priority: getPriority(riskScore),
      breakdown: {
        primaryCriticality: Math.round(baseCriticality * 100) / 100,
        downstreamCount,
        productionCount,
        businessServiceCount,
        averageHealth: Math.round(averageHealth * 100) / 100,
      },
      affectedCis: scoredCis,
    };
  } finally {
    await session.close();
  }
}

export async function computeImpactScore(
  fastify: FastifyInstance,
  rfcId: string,
  primaryCiId: string,
  affectedCiIds: string[]
): Promise<ImpactScore> {
  return buildImpactScore(fastify, primaryCiId, affectedCiIds, { rfcId });
}

export async function previewImpactScore(
  fastify: FastifyInstance,
  primaryCiId: string,
  affectedCiIds: string[]
): Promise<ImpactScore> {
  return buildImpactScore(fastify, primaryCiId, affectedCiIds, { skipConflictCheck: true });
}

export async function recordRiskScoreHistory(
  fastify: FastifyInstance,
  rfcId: string,
  score: ImpactScore,
  computedBy = "system"
): Promise<void> {
  await fastify.pg.query(
    `INSERT INTO change_request_risk_history (change_request_id, risk_score, blast_radius, priority, computed_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [rfcId, score.riskScore, score.blastRadius, score.priority, computedBy]
  );
}

export async function getRiskScoreHistory(
  fastify: FastifyInstance,
  rfcId: string,
  limit = 30
): Promise<Array<{ riskScore: number; blastRadius: number; priority: string; computedAt: string; computedBy: string }>> {
  const result = await fastify.pg.query(
    `SELECT risk_score, blast_radius, priority, computed_at, computed_by
     FROM change_request_risk_history
     WHERE change_request_id = $1
     ORDER BY computed_at DESC
     LIMIT $2`,
    [rfcId, limit]
  );
  return result.rows.map((r: any) => ({
    riskScore: r.risk_score,
    blastRadius: r.blast_radius,
    priority: r.priority,
    computedAt: r.computed_at,
    computedBy: r.computed_by,
  }));
}
