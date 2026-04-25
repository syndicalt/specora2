import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyRemediation, getRemediationSuggestions } from "./remediation";

vi.mock("./healthRules", () => ({
  runHardcodedRules: vi.fn(async () => [
    { ruleId: "r1", ciId: "ci-1", suggestedFix: { type: "create_relationship", sourceId: "ci-1", targetId: "ci-2", relType: "DEPENDS_ON" } },
    { ruleId: "r2", ciId: "ci-3" },
  ]),
}));

vi.mock("./eventBus", () => ({
  emit: vi.fn(),
}));

function intRecord(value: number) {
  return { get: vi.fn(() => ({ toNumber: () => value })) };
}

function mockFastify(recordsByCall: any[][], rejectAtCall?: number) {
  let call = 0;
  const run = vi.fn(async () => {
    call += 1;
    if (rejectAtCall === call) throw new Error("neo4j failed");
    return { records: recordsByCall[call - 1] ?? [] };
  });
  const close = vi.fn(async () => {});
  return {
    neo4j: { session: () => ({ run, close }) },
    log: { warn: vi.fn() },
    _run: run,
    _close: close,
  } as any;
}

describe("remediation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only violations that have suggested fixes", async () => {
    const result = await getRemediationSuggestions({} as any);

    expect(result).toHaveLength(1);
    expect(result[0].ruleId).toBe("r1");
  });

  it("rejects unsupported fix types", async () => {
    const result = await applyRemediation({} as any, { type: "unknown", sourceId: "a", relType: "DEPENDS_ON" } as any);

    expect(result).toEqual({ success: false, message: "Unsupported fix type: unknown" });
  });

  it("rejects fixes without a target", async () => {
    const result = await applyRemediation({} as any, { type: "create_relationship", sourceId: "a", relType: "DEPENDS_ON" } as any);

    expect(result).toEqual({ success: false, message: "Fix is missing targetId" });
  });

  it("rejects when source or target CI is missing", async () => {
    const fastify = mockFastify([[]]);

    const result = await applyRemediation(fastify, {
      type: "create_relationship",
      sourceId: "a",
      targetId: "b",
      relType: "DEPENDS_ON",
    });

    expect(result).toEqual({ success: false, message: "Source or target CI not found" });
    expect(fastify._close).toHaveBeenCalledOnce();
  });

  it("rejects duplicate relationships", async () => {
    const fastify = mockFastify([[{}], [intRecord(1)]]);

    const result = await applyRemediation(fastify, {
      type: "create_relationship",
      sourceId: "a",
      targetId: "b",
      relType: "DEPENDS_ON",
    });

    expect(result).toEqual({ success: false, message: "Relationship already exists" });
  });

  it("creates missing relationships and emits an event", async () => {
    const { emit } = await import("./eventBus");
    const fastify = mockFastify([[{}], [intRecord(0)], [{}]]);

    const result = await applyRemediation(fastify, {
      type: "create_relationship",
      sourceId: "a",
      targetId: "b",
      relType: "DEPENDS_ON",
    }, "user-1");

    expect(result).toEqual({ success: true, message: "Created DEPENDS_ON relationship" });
    expect(emit).toHaveBeenCalledWith("relationship.created", {
      sourceId: "a",
      targetId: "b",
      type: "DEPENDS_ON",
      actorId: "user-1",
    });
  });

  it("logs and returns Neo4j errors", async () => {
    const fastify = mockFastify([[{}]], 1);

    const result = await applyRemediation(fastify, {
      type: "create_relationship",
      sourceId: "a",
      targetId: "b",
      relType: "DEPENDS_ON",
    });

    expect(result).toEqual({ success: false, message: "neo4j failed" });
    expect(fastify.log.warn).toHaveBeenCalled();
  });
});
