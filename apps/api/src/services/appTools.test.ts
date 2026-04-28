import { describe, it, expect, vi, beforeEach } from "vitest";

const mockTools: any[] = [];

vi.mock("@specora/sdk", () => ({
  registerTool: vi.fn((_appId: string, tool: any, handler: any) => {
    mockTools.push({ ...tool, name: `${_appId}_${tool.name}`, handler });
  }),
  getToolsForSession: vi.fn(() => mockTools),
  executeTool: vi.fn(),
  unregisterAppTools: vi.fn((appId: string) => {
    for (let i = mockTools.length - 1; i >= 0; i--) {
      if (mockTools[i].name.startsWith(`${appId}_`)) {
        mockTools.splice(i, 1);
      }
    }
  }),
}));

vi.mock("./eventBus", () => ({
  emit: vi.fn(),
}));

vi.mock("../routes/admin", () => ({
  getStateMachineConfig: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("./impactScoring", () => ({
  computeImpactScore: vi.fn(() => Promise.resolve({
    riskScore: 25,
    blastRadius: 10,
    priority: "low",
    breakdown: {},
    affectedCis: [],
  })),
}));

describe("appTools", () => {
  beforeEach(() => {
    mockTools.length = 0;
  });

  async function register() {
    const { registerAllAppTools } = await import("./appTools");
    registerAllAppTools();
  }

  function tool(name: string) {
    const match = mockTools.find((t) => t.name === name);
    if (!match) throw new Error(`Missing tool ${name}`);
    return match.handler;
  }

  function pgClient(results: any[]) {
    let idx = 0;
    return {
      query: vi.fn(async (sql: string) => {
        const command = sql.trim().split(/\s+/)[0]?.toUpperCase();
        if (["BEGIN", "COMMIT", "ROLLBACK", "DELETE"].includes(command)) {
          return { rows: [] };
        }
        return results[idx++] ?? { rows: [] };
      }),
      release: vi.fn(),
    };
  }

  it("registers app tools explicitly", async () => {
    await register();
    expect(mockTools.length).toBeGreaterThan(0);
    expect(mockTools.some((t) => t.name.startsWith("change-manager_"))).toBe(true);
    expect(mockTools.some((t) => t.name.startsWith("health-monitor_"))).toBe(true);
    expect(mockTools.some((t) => t.name.startsWith("discovery-insights_"))).toBe(true);
  });

  it("discovery insight tools analyze coverage and suggest environment scans", async () => {
    await register();
    const analyze = tool("discovery-insights_analyze_coverage");
    const suggest = tool("discovery-insights_suggest_next_scan");
    const pg = {
      query: vi.fn(async () => ({
        rows: [
          { class: "Server" },
          { class: "Server" },
          { class: null },
        ],
      })),
    };
    const close = vi.fn();
    const neo4j = {
      session: () => ({
        run: vi.fn(async () => ({
          records: [
            { get: (key: string) => key === "class" ? "Server" : { toNumber: () => 2 } },
            { get: (key: string) => key === "class" ? "BusinessService" : { toNumber: () => 1 } },
          ],
        })),
        close,
      }),
    };

    expect(await analyze({ jobId: "job-1" }, { pg })).toEqual({
      jobId: "job-1",
      classCounts: { Server: 2, Unknown: 1 },
      total: 3,
    });
    const recommendation = await suggest({ environment: "Production" }, { neo4j });

    expect(recommendation.existing).toEqual({ Server: 2, BusinessService: 1 });
    expect(recommendation.gaps).toContain("Database");
    expect(recommendation.suggestion).toContain("Missing:");
    expect(close).toHaveBeenCalled();
  });

  it("health monitor tools find graph issues and score CIs", async () => {
    await register();
    const findCycles = tool("health-monitor_find_cycles");
    const findOrphaned = tool("health-monitor_find_orphaned");
    const findStale = tool("health-monitor_find_stale");
    const scoreCi = tool("health-monitor_score_ci");
    const close = vi.fn();
    const rel = { type: "DEPENDS_ON", start: { properties: { id: "a" } }, end: { properties: { id: "b" } } };
    const node = { properties: { id: "a", name: "API", class: "ApplicationService", environment: "Production", lastDiscoveredAt: Date.now() } };
    const run = vi.fn()
      .mockResolvedValueOnce({
        records: [{
          get: (key: string) => key === "cycleNodes" ? [node] : [rel],
        }],
      })
      .mockResolvedValueOnce({ records: [{ get: () => node }] })
      .mockResolvedValueOnce({ records: [{ get: () => node }] })
      .mockResolvedValueOnce({
        records: [{
          get: (key: string) => key === "n" ? node : { toNumber: () => 2 },
        }],
      });
    const neo4j = { session: () => ({ run, close }) };

    await expect(findCycles({ maxDepth: 1 }, { neo4j })).rejects.toThrow("maxDepth must be an integer between 2 and 50");
    expect(await findCycles({ maxDepth: 3 }, { neo4j })).toEqual([{
      nodes: [{ id: "a", name: "API", class: "ApplicationService" }],
      relationships: [{ type: "DEPENDS_ON", sourceId: "a", targetId: "b" }],
    }]);
    expect(await findOrphaned({ class: "Server" }, { neo4j })).toEqual([{ id: "a", name: "API", class: "ApplicationService", environment: "Production" }]);
    expect(await findStale({ days: 10 }, { neo4j })).toEqual([{ id: "a", name: "API", class: "ApplicationService", environment: "Production" }]);
    expect(await scoreCi({ ciId: "a" }, { neo4j })).toMatchObject({
      ciId: "a",
      scores: { completeness: 100, relationshipValidity: 100, freshness: 100, overall: 100 },
      relationshipCount: 2,
    });
  });

  it("health monitor score_ci returns not found when the CI is missing", async () => {
    await register();
    const scoreCi = tool("health-monitor_score_ci");
    const neo4j = { session: () => ({ run: vi.fn(async () => ({ records: [] })), close: vi.fn() }) };

    await expect(scoreCi({ ciId: "missing" }, { neo4j })).resolves.toEqual({ error: "CI not found" });
  });

  it("delete_rfc handles not found, non-draft, unauthorized, and success paths", async () => {
    await register();
    const handler = tool("change-manager_delete_rfc");

    const notFoundClient = pgClient([{ rows: [] }]);
    expect(await handler({ rfcId: "r1", _userId: "u1" }, { pg: { connect: async () => notFoundClient } })).toEqual({ error: "RFC not found" });

    const nonDraftClient = pgClient([{ rows: [{ status: "approved", requester_id: "u1" }] }]);
    expect(await handler({ rfcId: "r1", _userId: "u1" }, { pg: { connect: async () => nonDraftClient } })).toEqual({
      error: "Cannot delete RFC with status 'approved'. Only draft RFCs can be deleted.",
    });

    const unauthorizedClient = pgClient([
      { rows: [{ status: "draft", requester_id: "owner" }] },
      { rows: [{ role: "viewer" }] },
    ]);
    expect(await handler({ rfcId: "r1", _userId: "u2" }, { pg: { connect: async () => unauthorizedClient } })).toEqual({
      error: "Only the RFC requester or an admin can delete this RFC.",
    });

    const successClient = pgClient([{ rows: [{ status: "draft", requester_id: "u1" }] }]);
    expect(await handler({ rfcId: "r1", _userId: "u1" }, { pg: { connect: async () => successClient } })).toEqual({ deleted: true });
    expect(successClient.query).toHaveBeenCalledWith("COMMIT");
  });

  it("edit_rfc handles not found, unauthorized, no-op, and status update paths", async () => {
    await register();
    const handler = tool("change-manager_edit_rfc");

    const notFoundClient = pgClient([{ rows: [] }]);
    expect(await handler({ rfcId: "r1", _userId: "u1" }, { pg: { connect: async () => notFoundClient } })).toEqual({ error: "RFC not found" });

    const unauthorizedClient = pgClient([
      { rows: [{ status: "draft", requester_id: "owner" }] },
      { rows: [{ role: "viewer" }] },
    ]);
    expect(await handler({ rfcId: "r1", title: "New", _userId: "u2" }, { pg: { connect: async () => unauthorizedClient } })).toEqual({
      error: "Only the RFC requester, a change manager, or an admin can edit this RFC.",
    });

    const noopClient = pgClient([{ rows: [{ status: "draft", requester_id: "u1" }] }]);
    expect(await handler({ rfcId: "r1", _userId: "u1" }, { pg: { connect: async () => noopClient } })).toEqual({ error: "No fields to update" });

    const updateClient = pgClient([
      { rows: [{ status: "draft", requester_id: "u1" }] },
      { rows: [{ id: "r1", ci_id: "ci-1", title: "New", status: "pending_approval", updated_at: "now" }] },
    ]);
    const result = await handler(
      { rfcId: "r1", title: "New", status: "pending_approval", _userId: "u1", _userRole: "operator" },
      { pg: { connect: async () => updateClient } }
    );
    expect(result).toMatchObject({ id: "r1", title: "New", status: "pending_approval" });
  });

  it("create_rfc creates a draft, links affected CIs, emits, and starts scoring", async () => {
    await register();
    const handler = tool("change-manager_create_rfc");
    const txClient = pgClient([{ rows: [{ id: "r1", ci_id: "ci-1", title: "Patch API", status: "draft", created_at: "now" }] }]);
    const numberClient = pgClient([{ rows: [] }, { rows: [] }]);
    const pg = {
      connect: vi.fn()
        .mockResolvedValueOnce(txClient)
        .mockResolvedValueOnce(numberClient),
      query: vi.fn(async () => ({ rows: [] })),
    };
    const fastify = { pg, log: { warn: vi.fn() } };

    const result = await handler({
      ciId: "ci-1",
      title: "Patch API",
      description: "Apply security patch",
      plannedStartDate: "2026-05-01",
      plannedStartTime: "09:30",
      plannedEndDate: "2026-05-01",
      affectedCiIds: ["ci-1", "ci-2"],
      _userId: "u1",
    }, fastify);

    expect(result).toMatchObject({ id: "r1", title: "Patch API", status: "draft" });
    expect(txClient.query).toHaveBeenCalledWith("COMMIT");
    expect(txClient.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO change_request_cis"),
      ["r1", "ci-2"]
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pg.query).toHaveBeenCalledWith(expect.stringContaining("UPDATE change_requests SET risk_score"), [25, 10, "low", "r1"]);
  });

  it("create_rfc rolls back transaction failures", async () => {
    await register();
    const handler = tool("change-manager_create_rfc");
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("INSERT INTO change_requests")) throw new Error("insert failed");
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    await expect(handler({ ciId: "ci-1", title: "Patch API" }, { pg: { connect: async () => client } })).rejects.toThrow("insert failed");

    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalled();
  });

  it("list_rfcs applies optional filters", async () => {
    await register();
    const handler = tool("change-manager_list_rfcs");
    const pg = { query: vi.fn(async () => ({ rows: [{ id: "r1" }] })) };

    const result = await handler({ status: "draft", ciId: "ci-1" }, { pg });

    expect(result).toEqual([expect.objectContaining({ id: "r1" })]);
    expect(pg.query.mock.calls[0][0]).toContain("status = $1");
    expect(pg.query.mock.calls[0][0]).toContain("ci_id = $2");
    expect(pg.query.mock.calls[0][1]).toEqual(["draft", "ci-1"]);
  });

  it("get_rfc_details returns not found and maps Neo4j relationship data", async () => {
    await register();
    const handler = tool("change-manager_get_rfc_details");
    const missingPg = { query: vi.fn(async () => ({ rows: [] })) };
    expect(await handler({ rfcId: "missing" }, { pg: missingPg })).toEqual({ error: "RFC not found" });

    const pgResults = [
      { rows: [{ id: "r1", ci_id: "ci-1", risk_score: 10, blast_radius: 1, priority: "low" }] },
      { rows: [{ ci_id: "ci-1", role: "primary", distance: 0, direction: "upstream", contribution: 1 }] },
      { rows: [{ user_id: "u1", role: "approver", name: "Alice", email: "a@example.com" }] },
      { rows: [{ id: "c1", content: "ok", author: "Alice" }] },
    ];
    const pg = { query: vi.fn(async () => pgResults.shift()) };
    const neo4j = {
      session: () => ({
        run: vi.fn(async (query: string) => query.includes("RETURN n.id")
          ? { records: [{ get: (k: string) => (k === "id" ? "ci-1" : "Server 1") }] }
          : { records: [{ get: (k: string) => ({ sourceId: "ci-1", targetId: "ci-2", type: "DEPENDS_ON" } as any)[k] }] }),
        close: vi.fn(),
      }),
    };

    const result = await handler({ rfcId: "r1" }, { pg, neo4j });

    expect(result.affectedCis[0].name).toBe("Server 1");
    expect(result.edges).toEqual([{ sourceId: "ci-1", targetId: "ci-2", type: "DEPENDS_ON" }]);
  });

  it("find_critical_path falls back to change_requests.ci_id when no primary CI row exists", async () => {
    await register();
    const handler = tool("change-manager_find_critical_path");
    const pgResults = [
      { rows: [] },
      { rows: [{ ci_id: "ci-fallback" }] },
    ];
    const pg = { query: vi.fn(async () => pgResults.shift() ?? { rows: [] }) };
    const run = vi.fn(async () => ({
      records: [{
        get: (key: string) => ({
          targetId: "bs-1",
          targetName: "Billing Service",
          hops: { toNumber: () => 2 },
          pathWeight: 80,
          nodes: [{ id: "ci-fallback", name: "API", class: "ApplicationService" }],
        } as any)[key],
      }],
    }));
    const close = vi.fn();
    const neo4j = { session: () => ({ run, close }) };

    const result = await handler({ rfcId: "r1" }, { pg, neo4j });

    expect(result).toMatchObject({ primaryCi: "ci-fallback", criticalPath: { targetName: "Billing Service" } });
    expect(run).toHaveBeenCalledWith(expect.any(String), { primaryId: "ci-fallback" });
    expect(close).toHaveBeenCalled();
  });

  it("records and reloads CAB brief snapshots", async () => {
    await register();
    const record = tool("change-manager_record_cab_brief_snapshot");
    const latest = tool("change-manager_get_latest_cab_brief_snapshot");
    const snapshotRow = {
      id: "snap-1",
      change_request_id: "r1",
      generated_by: "u1",
      grade: { riskScore: 72, priority: "high" },
      conflicts: { conflictCount: 1, conflicts: [{ id: "r2", title: "Overlap" }] },
      health: { healthy: false },
      impact_path: { criticalPath: { targetName: "Billing" } },
      metadata: { source: "cab-workbench" },
      created_at: "2026-04-26T12:00:00.000Z",
    };
    const pg = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT id FROM change_requests")) return { rows: [{ id: "r1" }] };
        if (sql.includes("INSERT INTO change_cab_brief_snapshots")) return { rows: [snapshotRow] };
        if (sql.includes("INSERT INTO audit_log")) return { rows: [] };
        if (sql.includes("FROM change_cab_brief_snapshots")) return { rows: [snapshotRow] };
        return { rows: [] };
      }),
    };

    const created = await record({
      rfcId: "r1",
      grade: snapshotRow.grade,
      conflicts: snapshotRow.conflicts,
      health: snapshotRow.health,
      impactPath: snapshotRow.impact_path,
      metadata: snapshotRow.metadata,
      _userId: "u1",
    }, { pg });
    const loaded = await latest({ rfcId: "r1" }, { pg });

    expect(created).toMatchObject({ id: "snap-1", rfcId: "r1", generatedBy: "u1", conflicts: { conflictCount: 1 } });
    expect(loaded.snapshot).toMatchObject({ id: "snap-1", impactPath: { criticalPath: { targetName: "Billing" } } });
    expect(pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.any(Array));
  });

  it("knowledge tools create, answer, capture gaps, and publish", async () => {
    await register();
    const create = tool("knowledge-core_create_knowledge");
    const answer = tool("knowledge-core_answer");
    const publish = tool("knowledge-core_publish_knowledge");
    const recordFeedback = tool("knowledge-core_record_feedback");

    const pg = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("INSERT INTO knowledge_items")) return { rows: [{ id: "kb-1", title: "Restart worker", content: "Restart it", status: "draft", trust_score: 0.48, reuse_count: 0, deflection_count: 0 }] };
        if (sql.includes("SELECT * FROM knowledge_items") && sql.includes("status = 'published'")) return { rows: [{ id: "kb-1", title: "Restart worker", content: "Restart it", summary: "Restart the worker", status: "published", type: "runbook", trust_score: 0.8, reuse_count: 5, health_score: 0.8 }] };
        if (sql.includes("INSERT INTO knowledge_gaps")) return { rows: [{ id: "gap-1" }] };
        if (sql.includes("UPDATE knowledge_items SET status")) return { rows: [{ id: "kb-1", title: "Restart worker", status: "published", trust_score: 0.8, reuse_count: 5, deflection_count: 1, last_validated_at: new Date().toISOString() }] };
        if (sql.includes("INSERT INTO knowledge_feedback")) return { rows: [{ id: "fb-1", outcome: "deflected" }] };
        return { rows: [] };
      }),
    };

    expect(await create({ title: "Restart worker", content: "Restart it", status: "draft", tags: ["Ops"] }, { pg })).toMatchObject({ id: "kb-1" });
    expect(await answer({ query: "worker", _userId: "u1" }, { pg })).toMatchObject({ confidence: expect.any(Number) });
    expect(await publish({ knowledgeId: "kb-1", status: "published" }, { pg })).toMatchObject({ id: "kb-1", status: "published" });
    expect(await recordFeedback({ knowledgeId: "kb-1", outcome: "deflected", helpful: true }, { pg })).toMatchObject({ id: "fb-1" });

    const gapPg = { query: vi.fn(async (sql: string) => sql.includes("SELECT * FROM knowledge_items") ? { rows: [] } : { rows: [{ id: "gap-1" }] }) };
    const gap = await answer({ query: "missing topic" }, { pg: gapPg });
    expect(gap.confidence).toBe(0);
  });

  it("prevention tools create, list, propose, and transition candidates", async () => {
    await register();
    const create = tool("prevention-center_create_candidate");
    const list = tool("prevention-center_list_candidates");
    const details = tool("prevention-center_get_candidate_details");
    const transition = tool("prevention-center_transition_candidate");

    const pg = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("INSERT INTO prevention_records")) return { rows: [{ id: "p1", title: "Prevent API repeats", status: "candidate", recurrence_count: 3, impact_score: 60 }] };
        if (sql.includes("SELECT * FROM prevention_records WHERE id")) return { rows: [{ id: "p1", title: "Prevent API repeats", status: "candidate", known_error_id: null }] };
        if (sql.includes("SELECT * FROM prevention_records WHERE 1=1")) return { rows: [{ id: "p1", title: "Prevent API repeats", status: "candidate" }] };
        if (sql.includes("UPDATE prevention_records SET status")) return { rows: [{ id: "p1", status: "monitoring" }] };
        return { rows: [] };
      }),
    };

    expect(await create({ title: "Prevent API repeats", recurrenceCount: 3, impactScore: 60 }, { pg })).toMatchObject({ id: "p1" });
    expect(await list({ status: "candidate" }, { pg })).toHaveLength(1);
    expect(await details({ preventionId: "p1" }, { pg })).toMatchObject({ id: "p1", actions: [] });
    expect(await transition({ preventionId: "p1", status: "monitoring" }, { pg })).toMatchObject({ status: "monitoring" });
  });

  it("asset tools create assets, record scans, ingest contracts, and list exceptions", async () => {
    await register();
    const create = tool("asset-command_create_asset");
    const scan = tool("asset-command_record_scan");
    const contract = tool("asset-command_ingest_contract");
    const exceptions = tool("asset-command_list_exceptions");

    const pg = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("INSERT INTO asset_records")) return { rows: [{ id: "asset-1", name: "Laptop", category: "hardware", confidence: 0.8 }] };
        if (sql.includes("SELECT id FROM asset_records")) return { rows: [{ id: "asset-1" }] };
        if (sql.includes("INSERT INTO asset_scan_events")) return { rows: [{ id: "scan-1", asset_id: "asset-1" }] };
        if (sql.includes("INSERT INTO asset_contracts")) return { rows: [{ id: "contract-1", name: "Microsoft EA" }] };
        if (sql.includes("INSERT INTO software_entitlements")) return { rows: [{ id: "ent-1", product: "M365" }] };
        if (sql.includes("SELECT * FROM asset_exceptions")) return { rows: [{ id: "ex-1", type: "over_licensed" }] };
        return { rows: [] };
      }),
    };

    expect(await create({ name: "Laptop", serialNumber: "S1" }, { pg })).toMatchObject({ id: "asset-1" });
    expect(await scan({ value: "S1", location: "HQ" }, { pg })).toMatchObject({ id: "scan-1" });
    expect(await contract({ name: "Microsoft EA", vendor: "Microsoft", entitlements: [{ product: "M365", quantity: 10 }] }, { pg })).toMatchObject({ contract: { id: "contract-1" }, entitlements: [{ id: "ent-1", product: "M365" }] });
    expect(await exceptions({}, { pg })).toHaveLength(1);
  });

  it("asset SAM reconciliation creates no-entitlement, under-license, and over-license exceptions", async () => {
    await register();
    const reconcile = tool("asset-command_reconcile_sam");
    const pg = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM software_entitlements")) return { rows: [
          { publisher: "Microsoft", product: "Visio", metric: "user", quantity: "2", entitlement_id: "ent-under" },
          { publisher: "Adobe", product: "Acrobat", metric: "user", quantity: "10", entitlement_id: "ent-over" },
        ] };
        if (sql.includes("FROM software_usage")) return { rows: [
          { publisher: "Oracle", product: "Database", metric: "install", quantity: "1", usage_id: "use-none" },
          { publisher: "Microsoft", product: "Visio", metric: "user", quantity: "5", usage_id: "use-under" },
          { publisher: "Adobe", product: "Acrobat", metric: "user", quantity: "4", usage_id: "use-over" },
        ] };
        if (sql.includes("INSERT INTO asset_reconciliation_runs")) return { rows: [{ id: "run-1" }] };
        if (sql.includes("INSERT INTO asset_exceptions")) {
          const type = sql.includes("no_entitlement") ? "no_entitlement" : sql.includes("under_licensed") ? "under_licensed" : "over_licensed";
          return { rows: [{ id: `ex-${type}`, type, severity: type === "under_licensed" ? "critical" : "medium", financial_impact: 100 }] };
        }
        return { rows: [] };
      }),
    };

    const result = await reconcile({}, { pg });

    expect(result.exceptions.map((ex: any) => ex.type)).toEqual(["no_entitlement", "under_licensed", "over_licensed"]);
    expect(result.run.risk_score).toBeGreaterThan(0);
  });
});
