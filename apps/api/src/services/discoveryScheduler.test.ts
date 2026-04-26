import { describe, expect, it, vi } from "vitest";
import {
  claimDueDiscoverySchedules,
  nextDiscoveryRunAt,
  normalizeScheduleInterval,
  runDiscoverySchedulerCycle,
  runSavedDiscoveryPipeline,
} from "./discoveryScheduler";

function pipelineDefinition() {
  return {
    sample: { rows: [{ hostname: "WEB01", environment: "prod" }] },
    proposal: {
      title: "Server import",
      summary: "Import servers",
      confidence: 0.9,
      sourceProfile: { sourceName: "servers.csv", columns: ["hostname", "environment"], sampleRows: [] },
      classRoutes: [{ targetClass: "Server", sourcePattern: "hostname", confidence: 0.9, rationale: "host column" }],
      fieldMappings: [
        { sourceField: "hostname", targetClass: "Server", targetField: "name", transform: "trim_lowercase", confidence: 0.9 },
        { sourceField: "environment", targetClass: "Server", targetField: "environment", transform: "normalize_environment", confidence: 0.9 },
      ],
      relationshipRules: [],
      reconciliationRules: [{ targetClass: "Server", matchKeys: ["name"], strategy: "create_or_update" }],
      assumptions: [],
      risks: [],
      aiGenerated: false,
    },
  };
}

function fastifyWithPg(pg: any = {}) {
  return {
    pg: {
      query: vi.fn(),
      connect: vi.fn(),
      ...pg,
    },
    neo4j: {
      session: vi.fn(() => ({
        run: vi.fn(async () => ({ records: [] })),
        close: vi.fn(async () => {}),
      })),
    },
    log: { info: vi.fn(), error: vi.fn() },
    addHook: vi.fn(),
  } as any;
}

describe("discoveryScheduler", () => {
  it("normalizes schedule intervals", () => {
    expect(normalizeScheduleInterval("daily")).toBe("daily");
    expect(normalizeScheduleInterval("nonsense")).toBe("manual");
    expect(normalizeScheduleInterval(null)).toBe("manual");
  });

  it("calculates next run times", () => {
    const from = new Date("2026-04-26T10:00:00.000Z");
    expect(nextDiscoveryRunAt("manual", from)).toBeNull();
    expect(nextDiscoveryRunAt("hourly", from)?.toISOString()).toBe("2026-04-26T11:00:00.000Z");
    expect(nextDiscoveryRunAt("daily", from)?.toISOString()).toBe("2026-04-27T10:00:00.000Z");
    expect(nextDiscoveryRunAt("weekly", from)?.toISOString()).toBe("2026-05-03T10:00:00.000Z");
    expect(nextDiscoveryRunAt("monthly", from)?.toISOString()).toBe("2026-05-26T10:00:00.000Z");
  });

  it("claims due schedules transactionally and advances next run", async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT pipeline_id")) return { rows: [{ pipeline_id: "pipe-1", interval: "hourly", next_run_at: "2026-04-26T09:00:00.000Z" }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const fastify = fastifyWithPg({ connect: vi.fn(async () => client) });

    const due = await claimDueDiscoverySchedules(fastify, new Date("2026-04-26T10:00:00.000Z"), 5);

    expect(due).toEqual([{ pipeline_id: "pipe-1", interval: "hourly", next_run_at: "2026-04-26T09:00:00.000Z" }]);
    expect(client.query).toHaveBeenCalledWith("BEGIN");
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("FOR UPDATE SKIP LOCKED"), ["2026-04-26T10:00:00.000Z", 5]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("UPDATE discovery_pipeline_schedules"), [
      "pipe-1",
      "2026-04-26T10:00:00.000Z",
      "2026-04-26T11:00:00.000Z",
    ]);
    expect(client.query).toHaveBeenCalledWith("COMMIT");
    expect(client.release).toHaveBeenCalled();
  });

  it("rolls back when schedule claiming fails", async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT pipeline_id")) throw new Error("db down");
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const fastify = fastifyWithPg({ connect: vi.fn(async () => client) });

    await expect(claimDueDiscoverySchedules(fastify)).rejects.toThrow("db down");
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalled();
  });

  it("runs a saved pipeline by staging and enqueueing it", async () => {
    const fastify = fastifyWithPg({
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM discovery_pipelines")) return { rows: [{ id: "pipe-1", name: "Servers", definition: pipelineDefinition() }] };
        if (sql.includes("INSERT INTO discovery_jobs")) return { rows: [{ id: "dj-1", status: "staged", stats: {}, created_at: "now", updated_at: "now" }] };
        if (sql.includes("INSERT INTO jobs")) return { rows: [{ id: "job-1", type: "discovery_pipeline", payload: {}, status: "pending", priority: 1, retries: 0, max_retries: 3, created_at: "now", updated_at: "now" }] };
        return { rows: [] };
      }),
    });

    const result = await runSavedDiscoveryPipeline(fastify, "pipe-1", [], "scheduled");

    expect(result).toMatchObject({ ok: true, pipelineId: "pipe-1", discoveryJobId: "dj-1" });
    expect(fastify.pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO jobs"), [
      "discovery_pipeline",
      JSON.stringify({
        pipelineId: "pipe-1",
        discoveryJobId: "dj-1",
        preview: { rows: 1, stagedRecords: 1, relationshipCandidates: 0, errors: 0, warnings: 0 },
        source: "scheduled",
      }),
      1,
    ]);
  });

  it("processes due schedules and records run results", async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT pipeline_id")) return { rows: [{ pipeline_id: "pipe-1", interval: "daily", next_run_at: "2026-04-26T09:00:00.000Z" }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const fastify = fastifyWithPg({
      connect: vi.fn(async () => client),
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM discovery_pipelines")) return { rows: [{ id: "pipe-1", name: "Servers", definition: pipelineDefinition() }] };
        if (sql.includes("INSERT INTO discovery_jobs")) return { rows: [{ id: "dj-1", status: "staged", stats: {}, created_at: "now", updated_at: "now" }] };
        if (sql.includes("INSERT INTO jobs")) return { rows: [{ id: "job-1", type: "discovery_pipeline", payload: {}, status: "pending", priority: 1, retries: 0, max_retries: 3, created_at: "now", updated_at: "now" }] };
        return { rows: [] };
      }),
    });

    const results = await runDiscoverySchedulerCycle(fastify, new Date("2026-04-26T10:00:00.000Z"));

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ok: true, discoveryJobId: "dj-1" });
    expect(fastify.pg.query).toHaveBeenCalledWith(expect.stringContaining("last_discovery_job_id"), [
      "pipe-1",
      "dj-1",
      "queued",
      null,
    ]);
  });
});
