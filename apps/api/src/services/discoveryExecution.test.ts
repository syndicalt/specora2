import { describe, expect, it, vi } from "vitest";
import {
  approveAllSafeStagedRecords,
  applyDiscoveryRollback,
  commitStagedDiscoveryJob,
  getStagedDiscoveryJob,
  previewDiscoveryPipelineWithReconciliation,
  stageDiscoveryPipeline,
  updateStagedDiscoveryRecords,
} from "./discoveryExecution";
import { stableDiscoveryCiId, type PipelineDefinition, type TargetClass } from "./discoveryTransform";

function neo4jRecord(values: Record<string, any>) {
  return { get: (key: string) => values[key] };
}

function intValue(value: number) {
  return { toNumber: () => value };
}

function sessionFactory(runImpls: Array<(query: string, params?: any) => Promise<{ records: any[] }>>) {
  let index = 0;
  const sessions: any[] = [];
  return {
    sessions,
    neo4j: {
      session: () => {
        const runImpl = runImpls[index++] || (async () => ({ records: [] }));
        const session = {
          run: vi.fn(runImpl),
          close: vi.fn().mockResolvedValue(undefined),
        };
        sessions.push(session);
        return session;
      },
    },
  };
}

function definition(rows: Record<string, unknown>[], overrides: Partial<PipelineDefinition["proposal"]> = {}): PipelineDefinition {
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  return {
    sample: { columns, rows },
    proposal: {
      title: "Inventory transform",
      summary: "Map host and dependency data",
      confidence: 0.9,
      sourceProfile: { sourceName: "inventory", columns, sampleRows: rows },
      classRoutes: [
        { sourcePattern: "*", targetClass: "Server", confidence: 0.9, rationale: "Host row" },
        { sourcePattern: "*", targetClass: "Database", confidence: 0.7, rationale: "Database dependency" },
      ],
      fieldMappings: [
        { sourceField: "hostname", targetClass: "Server", targetField: "name", transform: "trim_lowercase", confidence: 0.9 },
        { sourceField: "ip", targetClass: "Server", targetField: "ipAddress", transform: "trim", confidence: 0.9 },
        { sourceField: "environment", targetClass: "Server", targetField: "environment", transform: "normalize_environment", confidence: 0.8 },
        { sourceField: "db_host", targetClass: "Database", targetField: "name", transform: "trim_lowercase", confidence: 0.8 },
        { sourceField: "environment", targetClass: "Database", targetField: "environment", transform: "normalize_environment", confidence: 0.8 },
      ],
      relationshipRules: [
        { fromClass: "Server", toClass: "Database", type: "DEPENDS_ON", sourceField: "db_host", confidence: 0.8 },
        { fromClass: "Server", toClass: "Group", type: "OWNED_BY", sourceField: "owner_group", confidence: 0.7 },
        { fromClass: "Server", toClass: "ApplicationService", type: "HOSTED_ON", sourceField: "app_name", confidence: 0.6 },
      ],
      reconciliationRules: [
        { targetClass: "Server", matchKeys: ["name", "environment"], strategy: "create_or_update" },
        { targetClass: "Database", matchKeys: ["name"], strategy: "create_or_update" },
      ],
      assumptions: [],
      risks: [],
      aiGenerated: false,
      ...overrides,
    },
  };
}

const targetClasses: TargetClass[] = [
  { name: "Server", attributes: [{ name: "ipAddress", isMandatory: true }] },
  { name: "Database" },
  { name: "Group" },
  { name: "ApplicationService" },
];

describe("discoveryExecution preview and staging", () => {
  it("reconciles existing CIs and explains ready, planned, and missing relationship targets", async () => {
    const row = { hostname: "WEB01", ip: "10.0.0.10", environment: "prod", db_host: "SQL01", owner_group: "Platform", app_name: "" };
    const serverId = stableDiscoveryCiId("Server", "web01", "Production");
    const { neo4j, sessions } = sessionFactory([
      async () => ({ records: [neo4jRecord({ ciId: serverId })] }),
      async () => ({ records: [neo4jRecord({ key: "1:1:Group:Platform" })] }),
    ]);
    const fastify = { pg: { query: vi.fn().mockResolvedValue({ rows: [] }) }, neo4j } as any;

    const preview = await previewDiscoveryPipelineWithReconciliation(fastify, definition([row]), targetClasses);

    expect(preview.records.find((record) => record.targetClass === "Server")).toMatchObject({ action: "update", name: "web01" });
    expect(preview.records.find((record) => record.targetClass === "Database")).toMatchObject({ action: "create", name: "sql01" });
    expect(preview.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ toClass: "Database", targetHint: "SQL01", status: "will_create_target", message: expect.stringContaining("will be created") }),
      expect.objectContaining({ toClass: "Group", targetHint: "Platform", status: "ready", message: expect.stringContaining("exists") }),
      expect.objectContaining({ toClass: "ApplicationService", targetHint: "", status: "missing_target", message: expect.stringContaining("No target value") }),
    ]));
    expect(preview.summary.warnings).toBe(1);
    expect(sessions).toHaveLength(2);
    expect(sessions.every((session) => session.close.mock.calls.length === 1)).toBe(true);
  });

  it("refuses to stage previews with errors or no staged records", async () => {
    const { neo4j } = sessionFactory([]);
    const fastify = { pg: { query: vi.fn() }, neo4j } as any;
    const ready = await stageDiscoveryPipeline(fastify, {
      pipelineId: "pipe-1",
      pipelineName: "Bad import",
      definition: definition([{ hostname: "web01", db_host: "sql01" }]),
      targetClasses,
    });

    expect(ready.ready).toBe(false);
    expect(ready.preview.summary.errors).toBeGreaterThan(0);
    expect(fastify.pg.query).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO discovery_jobs"), expect.anything());
  });

  it("stages records and normalizes supported relationships while blocking unsupported targets", async () => {
    const row = { hostname: "WEB01", ip: "10.0.0.10", environment: "prod", db_host: "SQL01", owner_group: "Platform", app_name: "" };
    const insertedRecords: any[] = [];
    const insertedRelationships: any[] = [];
    const pg = {
      query: vi.fn(async (sql: string, params?: any[]) => {
        if (sql.includes("SELECT name FROM relationship_types")) return { rows: [{ name: "DEPENDS_ON" }, { name: "OWNED_BY" }] };
        if (sql.includes("INSERT INTO discovery_jobs")) return { rows: [{ id: "job-1", status: "staged", stats: params?.[3], created_at: "now", updated_at: "now" }] };
        if (sql.includes("INSERT INTO discovery_staged_records")) {
          insertedRecords.push(params);
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO discovery_staged_relationships")) {
          insertedRelationships.push(params);
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };
    const { neo4j } = sessionFactory([
      async () => ({ records: [] }),
      async () => ({ records: [neo4jRecord({ key: "1:1:Group:Platform" })] }),
    ]);

    const result = await stageDiscoveryPipeline({ pg, neo4j } as any, {
      pipelineId: "pipe-1",
      pipelineName: "Inventory",
      pipelineVersion: 2,
      triggerSource: "scheduled",
      definition: definition([row]),
      targetClasses,
    });

    expect(result.ready).toBe(true);
    expect(insertedRecords).toHaveLength(2);
    expect(insertedRecords.map((params) => params[11])).toEqual(["staged", "staged"]);
    expect(insertedRelationships).toEqual(expect.arrayContaining([
      expect.arrayContaining(["DEPENDS_ON", "db_host", "SQL01", 0.8, "staged"]),
      expect.arrayContaining(["OWNED_BY", "owner_group", "Platform", 0.7, "staged"]),
      expect.arrayContaining(["HOSTED_ON", "app_name", null, 0.6, "blocked"]),
    ]));
  });

  it("loads and updates staged jobs", async () => {
    const pg = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM discovery_jobs")) return { rows: [{ id: "job-1", status: "staged" }] };
        if (sql.includes("FROM discovery_staged_records")) return { rows: [{ id: "rec-1", status: "staged" }] };
        if (sql.includes("FROM discovery_staged_relationships")) return { rows: [{ id: "rel-1", status: "staged" }] };
        if (sql.includes("UPDATE discovery_staged_records") && sql.includes("id = ANY")) return { rows: [{ id: "rec-1" }, { id: "rec-2" }] };
        if (sql.includes("UPDATE discovery_staged_records") && sql.includes("jsonb_array_length")) return { rows: [{ id: "rec-1" }] };
        return { rows: [] };
      }),
    };
    const fastify = { pg } as any;

    await expect(getStagedDiscoveryJob(fastify, "job-1")).resolves.toMatchObject({
      job: { id: "job-1" },
      records: [{ id: "rec-1" }],
      relationships: [{ id: "rel-1" }],
    });
    await expect(updateStagedDiscoveryRecords(fastify, "job-1", [], "skipped")).resolves.toEqual({ updated: 0 });
    await expect(updateStagedDiscoveryRecords(fastify, "job-1", ["rec-1", "rec-2"], "approved")).resolves.toEqual({ updated: 2 });
    await expect(approveAllSafeStagedRecords(fastify, "job-1")).resolves.toEqual({ updated: 1 });
  });
});

describe("discoveryExecution commit and rollback", () => {
  it("blocks commit when staged records or relationships are blocked", async () => {
    const fastify = {
      pg: {
        query: vi.fn(async (sql: string) => {
          if (sql.includes("FROM discovery_jobs")) return { rows: [{ id: "job-1", status: "staged" }] };
          if (sql.includes("FROM discovery_staged_records")) return { rows: [{ id: "rec-1", status: "blocked" }] };
          if (sql.includes("FROM discovery_staged_relationships")) return { rows: [{ id: "rel-1", status: "blocked" }] };
          return { rows: [] };
        }),
      },
      neo4j: { session: vi.fn() },
    } as any;

    await expect(commitStagedDiscoveryJob(fastify, "job-1", "u1")).resolves.toEqual({ blocked: true, blockedRecords: 1, blockedRelationships: 1 });
    expect(fastify.neo4j.session).not.toHaveBeenCalled();
  });

  it("commits creates, updates, relationship links, reconciliation logs, and rollback records", async () => {
    const pgCalls: Array<{ sql: string; params?: any[] }> = [];
    const records = [
      { id: "rec-create", row_number: 1, action: "create", target_class: "Server", ci_id: "ci-new", name: "web01", environment: "Production", attributes: JSON.stringify({ ipAddress: "10.0.0.10", nested: { ignored: true } }), match_keys: ["name"], errors: [], warnings: [], status: "approved" },
      { id: "rec-update", row_number: 2, action: "update", target_class: "Server", ci_id: "ci-existing", name: "web02", environment: "Production", attributes: { ipAddress: "10.0.0.11", tags: ["prod"] }, match_keys: ["name"], errors: [], warnings: [], status: "staged" },
    ];
    const rels = [
      { id: "rel-1", row_number: 1, from_class: "Server", to_class: "Database", rel_type: "DEPENDS_ON", source_field: "db_host", target_hint: "sql01", confidence: 0.8, status: "approved", message: "ready" },
      { id: "rel-skip", row_number: 3, from_class: "Server", to_class: "Database", rel_type: "DEPENDS_ON", source_field: "db_host", target_hint: "sql02", confidence: 0.8, status: "skipped", message: "skip" },
    ];
    const pg = {
      query: vi.fn(async (sql: string, params?: any[]) => {
        pgCalls.push({ sql, params });
        if (sql.includes("FROM discovery_jobs")) return { rows: [{ id: "job-1", status: "staged" }] };
        if (sql.includes("FROM discovery_staged_records")) return { rows: records };
        if (sql.includes("FROM discovery_staged_relationships")) return { rows: rels };
        return { rows: [] };
      }),
    };
    const { neo4j, sessions } = sessionFactory([
      async (sql: string, params?: any) => {
        if (sql.includes("RETURN count(n) as count")) return { records: [neo4jRecord({ count: intValue(params.id === "ci-existing" ? 1 : 0) })] };
        if (sql.includes("RETURN properties(n) as props")) return { records: [neo4jRecord({ props: { id: "ci-existing", name: "old-web02", attributes: "{}" } })] };
        if (sql.includes("MERGE (n:ConfigurationItem")) return { records: [neo4jRecord({ n: { properties: { id: params.id } } })] };
        if (sql.includes("MERGE (source)-[r:DEPENDS_ON]")) return { records: [neo4jRecord({ count: intValue(1) })] };
        return { records: [] };
      },
    ]);

    const result = await commitStagedDiscoveryJob({ pg, neo4j } as any, "job-1", "u1");

    expect(result).toEqual({ blocked: false, created: 1, updated: 1, relationships: 1 });
    expect(sessions[0].run).toHaveBeenCalledWith(expect.stringContaining("n += $attributesMap"), expect.objectContaining({
      id: "ci-new",
      attributesMap: { ipAddress: "10.0.0.10" },
    }));
    expect(pgCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ sql: expect.stringContaining("UPDATE discovery_staged_records SET status = 'committed'"), params: ["ci-new", "rec-create"] }),
      expect.objectContaining({ sql: expect.stringContaining("UPDATE discovery_staged_relationships SET status = 'committed'"), params: ["rel-1"] }),
      expect.objectContaining({ sql: expect.stringContaining("INSERT INTO discovery_rollbacks"), params: expect.arrayContaining(["job-1", { created: 1, updated: 1, relationships: 1 }]) }),
      expect.objectContaining({ sql: "UPDATE discovery_jobs SET status = 'completed', stats = $1, updated_at = NOW() WHERE id = $2", params: [{ created: 1, updated: 1, relationships: 1 }, "job-1"] }),
    ]));
    const rollbackInsert = pgCalls.find((call) => call.sql.includes("INSERT INTO discovery_rollbacks"));
    expect(JSON.parse(rollbackInsert?.params?.[2])).toEqual(expect.arrayContaining([
      expect.objectContaining({ ciId: "ci-new", existedBefore: false }),
      expect.objectContaining({ ciId: "ci-existing", existedBefore: true, oldProperties: { id: "ci-existing", name: "old-web02", attributes: "{}" } }),
    ]));
    expect(JSON.parse(rollbackInsert?.params?.[3])).toEqual([expect.objectContaining({ sourceId: "ci-new", relType: "DEPENDS_ON", targetHint: "sql01" })]);
  });

  it("lists rollbacks and handles missing or already-applied rollback records", async () => {
    const pg = {
      query: vi.fn(async (sql: string, params?: any[]) => {
        if (sql.includes("FROM discovery_rollbacks") && sql.includes("ORDER BY")) return { rows: [{ id: "rb-1", discovery_job_id: params?.[0] || "job-1", status: "available" }] };
        if (sql.includes("FROM discovery_rollbacks") && params?.[0] === "missing") return { rows: [] };
        if (sql.includes("FROM discovery_rollbacks") && params?.[0] === "applied") return { rows: [{ id: "applied", discovery_job_id: "job-1", status: "applied", records: [], relationships: [] }] };
        return { rows: [] };
      }),
    };
    const { listDiscoveryRollbacks } = await import("./discoveryExecution");

    await expect(listDiscoveryRollbacks({ pg } as any, "job-1")).resolves.toEqual([{ id: "rb-1", discovery_job_id: "job-1", status: "available" }]);
    await expect(applyDiscoveryRollback({ pg, neo4j: { session: vi.fn() } } as any, "missing")).resolves.toBeNull();
    await expect(applyDiscoveryRollback({ pg, neo4j: { session: vi.fn() } } as any, "applied")).resolves.toMatchObject({ alreadyApplied: true, rollback: { id: "applied" } });
  });

  it("applies rollback by deleting relationships, restoring old CIs, and deleting newly-created CIs", async () => {
    const rollbackRecords = [
      { stagedRecordId: "rec-new", ciId: "ci-new", action: "create", targetClass: "Server", name: "web01", existedBefore: false, oldProperties: null, newProperties: { id: "ci-new" } },
      { stagedRecordId: "rec-old", ciId: "ci-old", action: "update", targetClass: "Server", name: "web02", existedBefore: true, oldProperties: { id: "ci-old", name: "web02-old", attributes: "{}" }, newProperties: { id: "ci-old" } },
    ];
    const rollbackRelationships = [
      { stagedRelationshipId: "rel-1", sourceId: "ci-new", relType: "DEPENDS_ON", toClass: "Database", targetHint: "sql01" },
      { stagedRelationshipId: "rel-unsupported", sourceId: "ci-new", relType: "DROP", toClass: "Database", targetHint: "sql02" },
    ];
    const pg = {
      query: vi.fn(async (sql: string, params?: any[]) => {
        if (sql.includes("SELECT name FROM relationship_types")) return { rows: [{ name: "DEPENDS_ON" }] };
        if (sql.includes("FROM discovery_rollbacks")) return { rows: [{ id: "rb-1", discovery_job_id: "job-1", status: "available", records: rollbackRecords, relationships: JSON.stringify(rollbackRelationships), summary: {} }] };
        if (sql.includes("UPDATE discovery_rollbacks")) return { rows: [{ id: "rb-1", discovery_job_id: "job-1", status: "applied", summary: JSON.parse(params?.[2] as string), created_at: "now", applied_at: "now", updated_at: "now" }] };
        return { rows: [] };
      }),
    };
    const { neo4j, sessions } = sessionFactory([
      async (sql: string) => {
        if (sql.includes("DELETE rel")) return { records: [neo4jRecord({ count: intValue(1) })] };
        if (sql.includes("SET n = $props")) return { records: [neo4jRecord({ n: { properties: { id: "ci-old" } } })] };
        if (sql.includes("DETACH DELETE node")) return { records: [neo4jRecord({ count: intValue(1) })] };
        return { records: [] };
      },
    ]);

    const result = await applyDiscoveryRollback({ pg, neo4j } as any, "rb-1", "u1");

    expect(result).toMatchObject({ alreadyApplied: false, restored: 1, deleted: 1, deletedRelationships: 1 });
    expect(sessions[0].run).toHaveBeenCalledWith(expect.stringContaining("[r:DEPENDS_ON]"), expect.objectContaining({ sourceId: "ci-new", targetHint: "sql01" }));
    expect(sessions[0].run).toHaveBeenCalledWith(expect.stringContaining("SET n = $props"), { id: "ci-old", props: rollbackRecords[1].oldProperties });
    expect(sessions[0].run).toHaveBeenCalledWith(expect.stringContaining("DETACH DELETE node"), { id: "ci-new" });
    expect(pg.query).toHaveBeenCalledWith(expect.stringContaining("UPDATE discovery_jobs"), ["job-1", JSON.stringify({ rollback: { restored: 1, deleted: 1, deletedRelationships: 1 } })]);
  });
});
