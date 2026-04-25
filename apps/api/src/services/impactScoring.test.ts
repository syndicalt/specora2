import { describe, it, expect, vi } from "vitest";
import { computeImpactScore } from "./impactScoring";

function mockRecord(getFn: (k: string) => any) {
  return { get: getFn };
}

function mockSession(cis: any[], paths: Record<string, any> = {}, healthScores: Record<string, number> = {}) {
  return {
    run: vi.fn().mockImplementation((cypher: string, params: any) => {
      // Primary CI lookup
      if (cypher.includes("n.class as class, n.environment as environment")) {
        return Promise.resolve({
          records: [mockRecord((k: string) => (k === "class" ? "Server" : "Production"))],
        });
      }
      // Affected CIs lookup
      if (cypher.includes("min(length(path)) as distance")) {
        return Promise.resolve({
          records: cis.map((ci) =>
            mockRecord((k: string) => {
              if (k === "id") return ci.id;
              if (k === "name") return ci.name;
              if (k === "class") return ci.class;
              if (k === "environment") return ci.environment;
              if (k === "distance") return { toNumber: () => ci.distance };
              return null;
            })
          ),
        });
      }
      // shortestPath queries for direction
      if (cypher.includes("shortestPath")) {
        const key = `${params.primaryId}->${params.ciId}`;
        const hasPath = paths[key] || false;
        return Promise.resolve({
          records: hasPath ? [mockRecord(() => ({ toNumber: () => 2 }))] : [],
        });
      }
      // Health scores
      if (cypher.includes("n.healthOverall as health")) {
        return Promise.resolve({
          records: Object.entries(healthScores).map(([id, health]) =>
            mockRecord((k: string) => (k === "id" ? id : health))
          ),
        });
      }
      return Promise.resolve({ records: [] });
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function mockFastify(session: any, overlappingRfcs = 0) {
  return {
    neo4j: { session: vi.fn().mockReturnValue(session) },
    pg: {
      query: vi.fn().mockImplementation((sql: string, params: any[]) => {
        if (sql.includes("COUNT(DISTINCT")) {
          return Promise.resolve({ rows: [{ count: String(overlappingRfcs) }] });
        }
        return Promise.resolve({ rows: [] });
      }),
    },
  } as any;
}

describe("impactScoring", () => {
  it("scores a low-risk change (single dev server)", async () => {
    const session = mockSession(
      [{ id: "srv-2", name: "Dev Box", class: "Server", environment: "Development", distance: 1 }],
      { "srv-1->srv-2": true }, // downstream
      { "srv-2": 1.0 }
    );
    const fastify = mockFastify(session, 0);
    const score = await computeImpactScore(fastify, "rfc-1", "srv-1", ["srv-2"]);

    expect(score.riskScore).toBeLessThan(40);
    expect(score.priority).toBe("medium");
    expect(score.blastRadius).toBeGreaterThan(0);
    expect(score.affectedCis).toHaveLength(1);
    expect(score.affectedCis[0].direction).toBe("downstream");
  });

  it("scores a high-risk change (production database + business service)", async () => {
    const session = mockSession(
      [
        { id: "db-1", name: "Prod DB", class: "Database", environment: "Production", distance: 1 },
        { id: "bs-1", name: "Portal", class: "BusinessService", environment: "Production", distance: 2 },
      ],
      { "srv-1->db-1": true, "srv-1->bs-1": true },
      { "db-1": 1.0, "bs-1": 1.0 }
    );
    const fastify = mockFastify(session, 0);
    const score = await computeImpactScore(fastify, "rfc-1", "srv-1", ["db-1", "bs-1"]);

    expect(score.riskScore).toBeGreaterThanOrEqual(50);
    expect(score.priority).toBe("critical");
    expect(score.breakdown.productionCount).toBe(2);
    expect(score.breakdown.businessServiceCount).toBe(1);
  });

  it("applies health penalty for unhealthy CIs", async () => {
    const session = mockSession(
      [{ id: "db-1", name: "Sick DB", class: "Database", environment: "Production", distance: 1 }],
      { "srv-1->db-1": true },
      { "db-1": 0.3 }
    );
    const fastify = mockFastify(session, 0);
    const score = await computeImpactScore(fastify, "rfc-1", "srv-1", ["db-1"]);

    // Same topology as healthy case should score higher due to penalty
    expect(score.breakdown.averageHealth).toBe(0.3);
    expect(score.riskScore).toBeGreaterThan(50);
  });

  it("applies conflict penalty for overlapping RFCs", async () => {
    const session = mockSession(
      [{ id: "db-1", name: "Prod DB", class: "Database", environment: "Production", distance: 1 }],
      { "srv-1->db-1": true },
      { "db-1": 1.0 }
    );
    const fastify = mockFastify(session, 3); // 3 overlapping RFCs
    const score = await computeImpactScore(fastify, "rfc-1", "srv-1", ["db-1"]);

    expect(score.riskScore).toBeGreaterThan(40);
  });

  it("caps risk score at 100", async () => {
    const session = mockSession(
      Array.from({ length: 20 }, (_, i) => ({
        id: `bs-${i}`,
        name: `Biz ${i}`,
        class: "BusinessService",
        environment: "Production",
        distance: 1,
      })),
      Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`srv-1->bs-${i}`, true])),
      Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`bs-${i}`, 0.5]))
    );
    const fastify = mockFastify(session, 5);
    const score = await computeImpactScore(
      fastify,
      "rfc-1",
      "srv-1",
      Array.from({ length: 20 }, (_, i) => `bs-${i}`)
    );

    expect(score.riskScore).toBe(100);
    expect(score.priority).toBe("critical");
  });

  it("handles empty affected CI list", async () => {
    const session = mockSession([], {}, {});
    const fastify = mockFastify(session, 0);
    const score = await computeImpactScore(fastify, "rfc-1", "srv-1", []);

    expect(score.riskScore).toBeGreaterThan(0);
    expect(score.affectedCis).toHaveLength(0);
    expect(score.blastRadius).toBe(0);
  });
});
