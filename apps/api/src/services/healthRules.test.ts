import { describe, it, expect, vi } from "vitest";
import { runHardcodedRules, HARDCODED_RULES } from "./healthRules";

function mockFastify(recordSets: any[][] = [[]]) {
  let callIndex = 0;
  return {
    neo4j: {
      session: vi.fn().mockReturnValue({
        run: vi.fn().mockImplementation(() => {
          const records = recordSets[callIndex] !== undefined ? recordSets[callIndex] : [];
          callIndex++;
          return Promise.resolve({ records });
        }),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    },
    log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  } as any;
}

describe("healthRules", () => {
  it("returns all rule definitions", () => {
    expect(HARDCODED_RULES.length).toBe(8);
    expect(HARDCODED_RULES[0].id).toBe("bs-missing-app");
    expect(HARDCODED_RULES[0].severity).toBe("critical");
  });

  it("runs all rules and aggregates violations", async () => {
    const records = [
      // bs-missing-app rule result
      [
        { get: (k: string) => (k === "ciId" ? "bs-1" : k === "ciName" ? "Portal" : "BusinessService") },
      ],
      // findFixTarget for bs-missing-app (no suitable app found)
      [],
      // app-missing-tech rule result
      [],
      // db-not-hosted rule result
      [
        { get: (k: string) => (k === "ciId" ? "db-1" : k === "ciName" ? "Payments DB" : "Database") },
      ],
      // findFixTarget for db-not-hosted (no suitable server found)
      [],
      // app-not-hosted rule result
      [],
      // server-unmanaged rule result
      [],
      // bs-no-owner rule result
      [],
      // orphaned-cis rule result
      [],
      // network-gear-no-location rule result
      [],
    ];
    const fastify = mockFastify(records);
    const violations = await runHardcodedRules(fastify);

    expect(violations.length).toBe(2);
    const ruleIds = violations.map((v) => v.ruleId);
    expect(ruleIds).toContain("bs-missing-app");
    expect(ruleIds).toContain("db-not-hosted");
  });

  it("returns empty array when no violations", async () => {
    const fastify = mockFastify([[], [], [], [], [], [], [], []]);
    const violations = await runHardcodedRules(fastify);
    expect(violations).toEqual([]);
  });

  it("continues when individual rule query fails", async () => {
    const fastify = {
      neo4j: {
        session: vi.fn().mockReturnValue({
          run: vi.fn().mockRejectedValue(new Error("Syntax error")),
          close: vi.fn().mockResolvedValue(undefined),
        }),
      },
      log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    } as any;

    const violations = await runHardcodedRules(fastify);
    expect(violations).toEqual([]);
    expect(fastify.log.warn).toHaveBeenCalled();
  });
});
