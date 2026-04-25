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

function record(values: Record<string, string>) {
  return { get: (key: string) => values[key] };
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

  it("suggests fixes for every fixable hardcoded rule", async () => {
    const records = [
      [record({ ciId: "bs-1", ciName: "Portal", ciClass: "BusinessService" })],
      [record({ id: "app-1", name: "Portal API" })],
      [record({ ciId: "app-1", ciName: "Portal API", ciClass: "ApplicationService" })],
      [record({ id: "ts-1", name: "Cache" })],
      [record({ ciId: "db-1", ciName: "DB", ciClass: "Database" })],
      [record({ id: "srv-1", name: "Server" })],
      [record({ ciId: "app-2", ciName: "Web", ciClass: "Application" })],
      [record({ id: "srv-1", name: "Server" })],
      [record({ ciId: "srv-1", ciName: "Server", ciClass: "Server" })],
      [record({ id: "usr-1", name: "Alice" })],
      [record({ ciId: "bs-2", ciName: "Billing", ciClass: "BusinessService" })],
      [record({ id: "usr-1", name: "Alice" })],
      [record({ ciId: "orphan-1", ciName: "Orphan", ciClass: "Server" })],
      [record({ ciId: "net-1", ciName: "Switch", ciClass: "NetworkGear" })],
      [record({ id: "loc-1", name: "DC1" })],
    ];
    const fastify = mockFastify(records);

    const violations = await runHardcodedRules(fastify);

    expect(violations).toHaveLength(8);
    expect(violations.filter((v) => v.suggestedFix)).toHaveLength(7);
    expect(violations.find((v) => v.ruleId === "bs-missing-app")?.suggestedFix).toMatchObject({
      sourceId: "app-1",
      targetId: "bs-1",
      relType: "PART_OF",
    });
    expect(violations.find((v) => v.ruleId === "network-gear-no-location")?.suggestedFix).toMatchObject({
      sourceId: "net-1",
      targetId: "loc-1",
      relType: "LOCATED_AT",
    });
    expect(violations.find((v) => v.ruleId === "orphaned-cis")?.suggestedFix).toBeUndefined();
  });
});
