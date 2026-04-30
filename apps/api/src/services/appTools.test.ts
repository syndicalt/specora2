import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeTool } from "@specora/sdk";

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
  previewImpactScore: vi.fn(() => Promise.resolve({
    riskScore: 42,
    blastRadius: 3,
    priority: "medium",
    breakdown: { relationships: 12 },
    affectedCis: [{ ciId: "ci-2", contribution: 10 }],
  })),
  recordRiskScoreHistory: vi.fn(() => Promise.resolve()),
  getRiskScoreHistory: vi.fn(() => Promise.resolve([
    { riskScore: 42, createdAt: "2026-04-29T00:00:00.000Z" },
    { riskScore: 30, createdAt: "2026-04-28T00:00:00.000Z" },
  ])),
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

  it("customer portal tools model the home page and request lifecycle", async () => {
    await register();
    const home = tool("customer-portal_portal_home");
    const submit = tool("customer-portal_submit_request");
    const list = tool("customer-portal_list_my_requests");
    const details = tool("customer-portal_get_request_details");
    const handoff = tool("customer-portal_request_support_handoff");
    const pg = {
      query: vi.fn(async (sql: string, params?: any[]) => {
        if (sql.includes("FROM catalog_items WHERE status = 'published' ORDER BY category")) {
          return { rows: [{ id: "item-1", title: "Request software", item_type: "software_request", questions: "[{\"key\":\"app\",\"required\":true}]", fulfillment: "[{\"step\":\"approve\"}]", audience: "[\"employee\"]", related_knowledge_ids: "[\"kb-1\"]" }] };
        }
        if (sql.includes("FROM catalog_requests WHERE requester_id = $1")) {
          return { rows: [{ id: "req-1", number: "REQ0001", requester_id: params?.[0], title: "Existing request", answers: "{\"app\":\"IDE\"}", ai_resolution: "{}", fulfillment_plan: "[]" }] };
        }
        if (sql.includes("FROM support_channels WHERE enabled = TRUE ORDER BY priority, name LIMIT 8")) {
          return { rows: [{ id: "channel-1", name: "Service Desk", channel_type: "chat", priority: 1 }] };
        }
        if (sql === "SELECT * FROM catalog_items WHERE id = $1") {
          return { rows: [{ id: params?.[0], title: "Request software", item_type: "software_request", fulfillment: "[{\"step\":\"approve\"}]" }] };
        }
        if (sql.includes("INSERT INTO catalog_requests")) {
          return {
            rows: [{
              id: "req-2",
              number: "REQ0002",
              requester_id: params?.[0],
              catalog_item_id: params?.[1],
              title: params?.[2],
              description: params?.[3],
              request_type: params?.[4],
              priority: params?.[5],
              source: params?.[6],
              intent_summary: params?.[7],
              answers: params?.[8],
              ai_resolution: params?.[9],
              fulfillment_plan: params?.[10],
            }],
          };
        }
        if (sql.includes("INSERT INTO catalog_request_events")) {
          return { rows: [] };
        }
        if (sql.includes("FROM catalog_requests r") && sql.includes("WHERE 1=1")) {
          return { rows: [{ id: "req-2", title: "Request IDE", status: "open", answers: "{\"app\":\"IDE\"}", ai_resolution: "{}", fulfillment_plan: "[]", catalog_title: "Request software" }] };
        }
        if (sql.includes("FROM catalog_requests r LEFT JOIN catalog_items ci") && sql.includes("WHERE r.id = $1")) {
          return { rows: [{ id: params?.[0], title: "Request IDE", answers: "{\"app\":\"IDE\"}", ai_resolution: "{}", fulfillment_plan: "[{\"step\":\"approve\"}]", catalog_title: "Request software" }] };
        }
        if (sql.includes("FROM catalog_request_events WHERE request_id = $1")) {
          return { rows: [{ id: "event-1", type: "submitted", message: "Submitted" }] };
        }
        if (sql.includes("FROM support_handoffs h")) {
          return { rows: [{ id: "handoff-old", channel_name: "Service Desk", channel_type: "chat" }] };
        }
        if (sql.includes("SELECT * FROM support_channels WHERE id = $1 AND enabled = TRUE")) {
          return { rows: [{ id: params?.[0], name: "Service Desk", channel_type: "chat" }] };
        }
        if (sql.includes("INSERT INTO support_handoffs")) {
          return { rows: [{ id: "handoff-1", channel_id: params?.[0], request_id: params?.[2], reason: params?.[4], context: params?.[5] }] };
        }
        return { rows: [] };
      }),
    };

    const homeModel = await home({ _userId: "u1", limit: 99 }, { pg });
    expect(homeModel.featuredItems[0]).toMatchObject({ id: "item-1", questions: [{ key: "app", required: true }] });
    expect(homeModel.myRequests[0]).toMatchObject({ id: "req-1", answers: { app: "IDE" } });
    expect(homeModel.supportChannels[0]).toMatchObject({ id: "channel-1" });

    const created = await submit({
      catalogItemId: "item-1",
      title: "Request IDE",
      description: "Install an IDE",
      answers: { app: "IDE" },
      urgency: "high",
      _userId: "u1",
    }, { pg });
    expect(created).toMatchObject({ id: "req-2", request_type: "software_request", priority: 2, answers: { app: "IDE" } });

    const myRequests = await list({ _userId: "u1", status: "open", limit: 500 }, { pg });
    expect(myRequests[0]).toMatchObject({ id: "req-2", catalog_title: "Request software" });
    expect(pg.query.mock.calls.find((call: any[]) => String(call[0]).includes("WHERE 1=1"))?.[1]).toEqual(["u1", "open", 100]);

    const requestDetails = await details({ requestId: "req-2" }, { pg });
    expect(requestDetails).toMatchObject({ id: "req-2", events: [{ id: "event-1", type: "submitted" }], handoffs: [{ id: "handoff-old" }] });

    const supportHandoff = await handoff({ channelId: "channel-1", requestId: "req-2", reason: "Need a callback", context: { severity: "high" }, _userId: "u1" }, { pg });
    expect(supportHandoff).toMatchObject({ id: "handoff-1", channel: { id: "channel-1", name: "Service Desk" } });
  });

  it("customer portal resolves intents with catalog, knowledge, and support context", async () => {
    await register();
    const resolveIntent = tool("customer-portal_resolve_intent");
    const pg = {
      query: vi.fn(async (sql: string, params?: any[]) => {
        if (sql.includes("FROM catalog_items")) {
          return { rows: [{ id: "item-1", title: "Hardware request", item_type: params?.[0], questions: "[{\"key\":\"device\",\"required\":true}]", fulfillment: "[]", audience: "[]", related_knowledge_ids: "[]" }] };
        }
        if (sql.includes("FROM knowledge_items")) {
          return { rows: [{ id: "kb-1", title: "Laptop policy", type: "article", status: "published", trust_score: 0.91 }] };
        }
        if (sql.includes("FROM support_channels")) {
          return { rows: [{ id: "channel-1", name: "Service Desk", channel_type: "chat" }] };
        }
        return { rows: [] };
      }),
    };

    const result = await resolveIntent({ message: "I need a replacement laptop", urgency: "low", service: "Workplace" }, { pg });

    expect(result).toMatchObject({
      intent: "hardware_request",
      recommendedAction: "submit_or_deflect",
      priority: 4,
      catalogItem: { id: "item-1", title: "Hardware request" },
      knowledgeCandidates: [{ id: "kb-1", title: "Laptop policy" }],
      supportChannels: [{ id: "channel-1" }],
      missingFields: ["device"],
    });
  });

  it("customer portal intake routes clear winners and respects incident access boundaries", async () => {
    await register();
    const routeIntake = tool("customer-portal_route_intake");
    vi.mocked(executeTool)
      .mockResolvedValueOnce({ answer: "Use the published policy article." })
      .mockResolvedValueOnce({ id: "handoff-1", reason: "Database is down" });
    const pg = { query: vi.fn(async () => ({ rows: [] })) };

    const knowledge = await routeIntake({
      message: "How do I find the vacation policy?",
      urgency: "medium",
      _userId: "u1",
      _userRole: "employee",
    }, { pg });
    expect(knowledge).toMatchObject({ action: "deflected", routed: true, record: { answer: "Use the published policy article." } });
    expect(executeTool).toHaveBeenCalledWith("knowledge-core_answer", expect.objectContaining({
      query: "How do I find the vacation policy?",
      audience: "self_service",
    }), { pg });

    const incidentWithoutAccess = await routeIntake({
      message: "Database is down",
      urgency: "critical",
      _userId: "u1",
    }, { pg });
    expect(incidentWithoutAccess).toMatchObject({ action: "created_support_handoff", routed: true, record: { id: "handoff-1" } });
    expect(executeTool).toHaveBeenCalledWith("customer-portal_request_support_handoff", expect.objectContaining({
      reason: "Database is down",
      context: expect.objectContaining({ accessBoundary: "incident-manager:write not granted" }),
    }), { pg });
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

  it("change approval tools assign, approve, reject, comment, and list pending work", async () => {
    await register();
    const assign = tool("change-manager_assign_approvers");
    const approve = tool("change-manager_approve_rfc");
    const reject = tool("change-manager_reject_rfc");
    const comment = tool("change-manager_add_rfc_comment");
    const pending = tool("change-manager_list_pending_approvals");
    const affected = tool("change-manager_get_affected_cis");
    const client = {
      query: vi.fn(async (sql: string, params?: any[]) => {
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
        if (sql === "SELECT requester_id FROM change_requests WHERE id = $1") {
          return { rows: [{ requester_id: "owner" }] };
        }
        if (sql.includes("SELECT * FROM change_requests WHERE id = $1 FOR UPDATE")) {
          return { rows: [{ id: params?.[0], status: "pending_approval", requester_id: "requester" }] };
        }
        if (sql.includes("SELECT 1 FROM change_request_approvers")) {
          return { rows: [{ "?column?": 1 }] };
        }
        if (sql.includes("app_permissions")) {
          return { rows: [] };
        }
        if (sql.includes("COUNT(*) as pending")) {
          return { rows: [{ pending: "0" }] };
        }
        if (sql.includes("COUNT(*) as total")) {
          return { rows: [{ total: "1" }] };
        }
        if (sql === "SELECT status, requester_id FROM change_requests WHERE id = $1") {
          return { rows: [{ status: "pending_approval", requester_id: "owner" }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pg = {
      connect: vi.fn(async () => client),
      query: vi.fn(async (sql: string, params?: any[]) => {
        if (sql.includes("INSERT INTO change_request_comments")) {
          return { rows: [{ id: "comment-1", content: params?.[2], created_at: "now" }] };
        }
        if (sql.includes("JOIN change_request_approvers")) {
          return { rows: [{ id: "rfc-1", status: "pending_approval" }] };
        }
        return { rows: [] };
      }),
    };
    const neo4jClose = vi.fn();
    const neo4j = {
      session: () => ({
        run: vi.fn(async () => ({
          records: [{
            get: (key: string) => {
              if (key === "distance") return { toNumber: () => 2 };
              return ({ id: "ci-2", name: "Database", class: "Database", environment: "Production" } as any)[key];
            },
          }],
        })),
        close: neo4jClose,
      }),
    };

    await expect(assign({ rfcId: "rfc-1", userIds: ["approver-1"], _userId: "owner" }, { pg })).resolves.toEqual({ success: true });
    await expect(approve({ rfcId: "rfc-1", _userId: "approver-1", _userRole: "change_manager" }, { pg })).resolves.toMatchObject({ success: true, status: "approved", allApproversApproved: true });
    await expect(reject({ rfcId: "rfc-1", reason: "Window conflict", _userId: "owner", _userRole: "change_manager" }, { pg })).resolves.toEqual({ success: true, status: "rejected" });
    await expect(comment({ rfcId: "rfc-1", content: "Ready for CAB", _userId: "owner" }, { pg })).resolves.toMatchObject({ id: "comment-1", content: "Ready for CAB" });
    await expect(pending({ _userId: "approver-1" }, { pg })).resolves.toEqual([{ id: "rfc-1", status: "pending_approval" }]);
    await expect(affected({ ciId: "ci-1" }, { neo4j })).resolves.toEqual([{ id: "ci-2", name: "Database", class: "Database", environment: "Production", distance: 2 }]);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO change_request_approvers"),
      ["rfc-1", "approver-1"]
    );
    expect(neo4jClose).toHaveBeenCalled();
  });

  it("change CAB analysis tools grade risk, conflicts, health, impact, previews, and history", async () => {
    await register();
    const grade = tool("change-manager_grade_change_rfc");
    const conflicts = tool("change-manager_check_change_conflicts");
    const health = tool("change-manager_check_ci_health_before_change");
    const recent = tool("change-manager_list_recent_changes_for_ci");
    const impact = tool("change-manager_summarize_rfc_impact");
    const preview = tool("change-manager_preview_impact");
    const history = tool("change-manager_get_rfc_risk_history");
    const pg = {
      query: vi.fn(async (sql: string, params?: any[]) => {
        if (sql === "SELECT * FROM change_requests WHERE id = $1") {
          return { rows: [{ id: params?.[0], ci_id: "ci-1", title: "Patch API", status: "pending_approval", risk_score: 55, blast_radius: 4, priority: "high", planned_start_at: "2026-05-01T10:00:00Z", planned_end_at: "2026-05-01T11:00:00Z" }] };
        }
        if (sql.includes("SELECT ci_id, role FROM change_request_cis")) {
          return { rows: [{ ci_id: "ci-1", role: "primary" }, { ci_id: "ci-2", role: "affected" }] };
        }
        if (sql.includes("SELECT ci_id, planned_start_at")) {
          return { rows: [{ ci_id: "ci-1", planned_start_at: "2026-05-01T10:00:00Z", planned_end_at: "2026-05-01T11:00:00Z" }] };
        }
        if (sql.includes("JOIN change_request_cis crc")) {
          return { rows: [{ id: "rfc-2", number: "RFC0002", title: "DB patch", ci_id: "ci-1", conflicting_ci: "ci-1", status: "approved" }] };
        }
        if (sql.includes("cr.id <> ALL")) {
          return { rows: [{ id: "rfc-3", number: "RFC0003", title: "App patch", primary_ci: "ci-3", status: "pending_approval" }] };
        }
        if (sql.includes("FROM change_requests") && sql.includes("created_at > NOW()")) {
          return { rows: [{ id: "rfc-4", title: "Recent change", status: "closed" }] };
        }
        return { rows: [] };
      }),
    };
    const neo4j = {
      session: () => ({
        run: vi.fn(async (sql: string) => {
          if (sql.includes("RETURN n.class as class")) {
            return { records: [{ toObject: () => ({ class: "ApplicationService", environment: "Production" }) }] };
          }
          if (sql.includes("RETURN count(*) as pathCount")) {
            return { records: [{ get: () => ({ toNumber: () => 1 }) }] };
          }
          if (sql.includes("OPTIONAL MATCH (n)-[r]-()")) {
            return {
              records: [
                { get: (key: string) => key === "relCount" ? { toNumber: () => 2 } : ({ id: "ci-1", name: "API", class: "ApplicationService" } as any)[key] },
                { get: (key: string) => key === "relCount" ? { toNumber: () => 0 } : ({ id: "ci-2", name: "DB", class: "Database" } as any)[key] },
              ],
            };
          }
          if (sql.includes("shortestPath")) {
            return { records: [{ get: (key: string) => ({ affectedId: "ci-2", affectedName: "DB", rootName: "API", hops: { toNumber: () => 2 } } as any)[key] }] };
          }
          return { records: [] };
        }),
        close: vi.fn(async () => {}),
      }),
    };

    await expect(grade({ rfcId: "rfc-1" }, { pg, neo4j })).resolves.toMatchObject({
      blastRadius: 4,
      riskScore: 55,
      primaryCiClass: "ApplicationService",
      primaryCiEnvironment: "Production",
      isCriticalClass: true,
      hasSchedule: true,
    });
    await expect(conflicts({ rfcId: "rfc-1", windowHours: 24 }, { pg, neo4j })).resolves.toMatchObject({
      primaryCi: "ci-1",
      conflictCount: 2,
      directConflicts: 1,
      dependencyConflicts: 1,
      conflicts: [
        expect.objectContaining({ id: "rfc-2", conflictType: "direct", severity: "high" }),
        expect.objectContaining({ id: "rfc-3", conflictType: "dependency-aware", severity: "medium" }),
      ],
    });
    await expect(health({ rfcId: "rfc-1" }, { pg, neo4j })).resolves.toMatchObject({ healthy: false, ciHealth: [{ id: "ci-1", healthy: true }, { id: "ci-2", healthy: false }] });
    await expect(recent({ ciId: "ci-1" }, { pg })).resolves.toEqual({ ciId: "ci-1", recentChanges: [{ id: "rfc-4", title: "Recent change", status: "closed" }] });
    await expect(impact({ rfcId: "rfc-1" }, { pg, neo4j })).resolves.toEqual({ primaryCi: "ci-1", affectedCount: 1, dependencyPaths: [{ affectedId: "ci-2", affectedName: "DB", rootName: "API", hops: 2 }] });
    await expect(preview({ ciId: "ci-1", affectedCiIds: ["ci-2"] }, { pg, neo4j })).resolves.toMatchObject({ preview: true, primaryCi: "ci-1", riskScore: 42, priority: "medium" });
    await expect(history({ rfcId: "rfc-1", limit: 2 }, { pg })).resolves.toMatchObject({ rfcId: "rfc-1", count: 2, trend: 12 });
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

  it("knowledge tools list details, draft from records, and return stewardship work", async () => {
    await register();
    const { executeTool } = await import("@specora/sdk");
    const list = tool("knowledge-core_list_knowledge");
    const details = tool("knowledge-core_get_knowledge_details");
    const draft = tool("knowledge-core_draft_from_record");
    const stewardship = tool("knowledge-core_stewardship_queue");

    vi.mocked(executeTool).mockReset();
    vi.mocked(executeTool).mockResolvedValue({ id: "kb-draft", title: "Known error: API outage" });
    const pg = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT * FROM knowledge_items WHERE 1=1")) {
          return { rows: [{ id: "kb-1", title: "API runbook", status: "published", type: "runbook", tags: ["api"], trust_score: 0.8, reuse_count: 10, deflection_count: 2, last_validated_at: new Date().toISOString() }] };
        }
        if (sql === "SELECT * FROM knowledge_items WHERE id = $1") {
          return { rows: [{ id: "kb-1", title: "API runbook", content: "Restart API", status: "published", trust_score: 0.8, reuse_count: 10, deflection_count: 2, last_validated_at: new Date().toISOString() }] };
        }
        if (sql.includes("SELECT * FROM knowledge_links")) return { rows: [{ id: "link-1", target_type: "incident", target_id: "inc-1" }] };
        if (sql.includes("FROM knowledge_feedback")) return { rows: [{ id: "fb-1", outcome: "solved", user_name: "Ada" }] };
        if (sql.includes("FROM knowledge_events")) return { rows: [{ id: "evt-1", type: "created", actor: "Ada" }] };
        if (sql.includes("FROM incidents WHERE id = $1")) {
          return { rows: [{ title: "API outage", description: "Errors spiked", service: "Payments", ci_id: "ci-1", ai_summary: "Deploy correlated", ai_next_action: "Rollback check" }] };
        }
        if (sql.includes("FROM change_requests WHERE id = $1")) {
          return { rows: [{ title: "Patch API", description: "Apply patch", ci_id: "ci-1", priority: "medium" }] };
        }
        if (sql.includes("WHERE status IN ('draft', 'review')")) return { rows: [{ id: "kb-stale", title: "Old article", status: "draft", trust_score: 0.4 }] };
        if (sql.includes("FROM knowledge_gaps")) return { rows: [{ id: "gap-1", query: "vpn reset", demand_count: 4 }] };
        return { rows: [] };
      }),
    };

    const listed = await list({ type: "runbook", status: "published", tag: "API", ciId: "ci-1", limit: 999 }, { pg });
    expect(listed).toHaveLength(1);
    expect(pg.query).toHaveBeenCalledWith(expect.stringContaining("AND $3 = ANY(tags)"), ["runbook", "published", "api", "ci-1", 250]);

    await expect(details({ knowledgeId: "missing" }, { pg: { query: vi.fn(async () => ({ rows: [] })) } })).resolves.toEqual({ error: "Knowledge not found" });
    expect(await details({ knowledgeId: "kb-1" }, { pg })).toMatchObject({
      id: "kb-1",
      links: [{ id: "link-1" }],
      feedback: [{ id: "fb-1" }],
      events: [{ id: "evt-1" }],
    });
    expect(await draft({ sourceType: "incident", sourceId: "inc-1", _userId: "u1" }, { pg })).toMatchObject({ id: "kb-draft" });
    expect(vi.mocked(executeTool)).toHaveBeenCalledWith("knowledge-core_create_knowledge", expect.objectContaining({
      title: "Known error: API outage",
      type: "known_error",
      service: "Payments",
      ciId: "ci-1",
    }), { pg });
    expect(await draft({ sourceType: "change", sourceId: "rfc-1", _userId: "u1" }, { pg })).toMatchObject({ id: "kb-draft" });

    const queue = await stewardship({ limit: 999 }, { pg });
    expect(queue).toMatchObject({ items: [{ id: "kb-stale" }], gaps: [{ id: "gap-1" }] });
    expect(pg.query).toHaveBeenCalledWith(expect.stringContaining("FROM knowledge_gaps"), [100]);
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

  it("prevention tools detect recurring candidates, propose actions, and create known errors", async () => {
    await register();
    const { executeTool } = await import("@specora/sdk");
    const detect = tool("prevention-center_detect_candidates");
    const propose = tool("prevention-center_propose_actions");
    const createKnownError = tool("prevention-center_create_known_error");
    const details = tool("prevention-center_get_candidate_details");

    vi.mocked(executeTool).mockReset();
    vi.mocked(executeTool)
      .mockResolvedValueOnce({ error: "Prevention record not found" })
      .mockResolvedValueOnce({ id: "p1", title: "Prevent API repeats", description: "Recurring API failures", service: "Payments", ci_id: "ci-1" })
      .mockResolvedValueOnce({ id: "p1", title: "Prevent API repeats", description: "Recurring API failures", service: "Payments", ci_id: "ci-1" })
      .mockResolvedValueOnce({ id: "kb-1", title: "Known error: Prevent API repeats" });
    const pg = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM incidents")) {
          return { rows: [{ cluster_key: "Payments", service: "Payments", ci_id: "ci-1", recurrence_count: 4, max_severity: "high", examples: "API down; API slow" }] };
        }
        if (sql.includes("INSERT INTO prevention_records")) {
          return { rows: [{ id: "p1", title: "Prevent recurring incidents for Payments", priority: 1, service: "Payments" }] };
        }
        if (sql.includes("INSERT INTO prevention_actions")) {
          return { rows: [{ id: `pa-${Math.random()}`, prevention_id: "p1", type: "known_error" }] };
        }
        if (sql.includes("SELECT * FROM prevention_records WHERE id = $1")) {
          return { rows: [{ id: "p1", title: "Prevent API repeats", known_error_id: "kb-1" }] };
        }
        if (sql.includes("SELECT * FROM prevention_evidence")) return { rows: [{ id: "ev-1", source_type: "incident" }] };
        if (sql.includes("SELECT * FROM prevention_actions")) return { rows: [{ id: "act-1", type: "known_error" }] };
        if (sql.includes("FROM prevention_events")) return { rows: [{ id: "evt-1", type: "detected" }] };
        if (sql.includes("FROM knowledge_items WHERE id = $1")) return { rows: [{ id: "kb-1", title: "Known error", status: "draft" }] };
        return { rows: [] };
      }),
    };

    const detected = await detect({ windowDays: 14, minRecurrence: 3, _userId: "u1" }, { pg });
    expect(detected).toMatchObject({ count: 1, candidates: [{ id: "p1", service: "Payments" }] });
    expect(pg.query).toHaveBeenCalledWith(expect.stringContaining("HAVING COUNT(*) >= $2"), [14, 3]);

    await expect(propose({ preventionId: "missing" }, { pg })).resolves.toEqual({ error: "Prevention record not found" });
    expect(await propose({ preventionId: "p1", _userId: "u1" }, { pg })).toMatchObject({ preventionId: "p1", actions: expect.any(Array) });
    expect(await details({ preventionId: "p1" }, { pg })).toMatchObject({ id: "p1", knownError: { id: "kb-1" } });
    expect(await createKnownError({ preventionId: "p1", _userId: "u1" }, { pg })).toMatchObject({ id: "kb-1" });
    expect(vi.mocked(executeTool)).toHaveBeenCalledWith("knowledge-core_create_knowledge", expect.objectContaining({
      title: "Known error: Prevent API repeats",
      source: "prevention",
      sourceRef: "p1",
      links: [{ targetType: "prevention", targetId: "p1", relationship: "known_error_for" }],
    }), { pg });
  });

  it("incident tools create, list, load details, and map CI context", async () => {
    await register();
    const create = tool("incident-manager_create_incident");
    const list = tool("incident-manager_list_incidents");
    const details = tool("incident-manager_get_incident_details");

    const close = vi.fn();
    const run = vi.fn()
      .mockResolvedValueOnce({
        records: [{
          get: (key: string) => ({
            id: "ci-1",
            name: "Payments API",
            class: "ApplicationService",
            environment: "Production",
            health: 0.82,
            relCount: { toNumber: () => 3 },
          } as any)[key],
        }],
      })
      .mockResolvedValueOnce({
        records: [{
          get: (key: string) => ({
            sourceId: "ci-1",
            targetId: "ci-2",
            type: "DEPENDS_ON",
          } as any)[key],
        }],
      });
    const neo4j = { session: () => ({ run, close }) };
    const pg = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("INSERT INTO incidents")) {
          return { rows: [{ id: "inc-1", title: "API down", severity: "high", source: "alert", ci_id: "ci-1" }] };
        }
        if (sql.includes("FROM incidents i") && sql.includes("WHERE 1=1")) {
          return {
            rows: [{
              id: "inc-1",
              title: "API down",
              requester_id: "u1",
              requester_name: "Ada",
              requester_email: "ada@example.com",
              owner_id: "u2",
              owner_name: "Lin",
              owner_email: "lin@example.com",
            }],
          };
        }
        if (sql.includes("FROM incidents i") && sql.includes("WHERE i.id = $1")) {
          return {
            rows: [{
              id: "inc-1",
              title: "API down",
              severity: "high",
              requester_id: "u1",
              requester_name: "Ada",
              requester_email: "ada@example.com",
            }],
          };
        }
        if (sql.includes("FROM incident_cis")) return { rows: [{ ci_id: "ci-1", role: "primary", distance: 0 }] };
        if (sql.includes("FROM incident_events")) return { rows: [{ id: "evt-1", type: "created" }] };
        if (sql.includes("FROM incident_actions")) return { rows: [{ id: "act-1", name: "Restart" }] };
        if (sql.includes("FROM incident_roles")) return { rows: [{ user_id: "u2", role: "commander", name: "Lin" }] };
        if (sql.includes("FROM incident_postmortems")) return { rows: [] };
        if (sql.includes("FROM change_requests")) return { rows: [{ id: "rfc-1", title: "Deploy" }] };
        return { rows: [] };
      }),
    };

    const created = await create({
      title: "API down",
      severity: "high",
      source: "alert",
      externalRef: "alert-1",
      ciId: "ci-1",
      affectedCiIds: ["ci-1", "ci-2"],
      autoRemediationAllowed: true,
      _userId: "u1",
    }, { pg });
    expect(created).toMatchObject({ id: "inc-1", severity: "high" });
    expect(pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO incident_cis"), ["inc-1", "ci-2", "affected"]);

    const listed = await list({ status: "new", severity: "high", ciId: "ci-1", limit: 300 }, { pg });
    expect(listed[0]).toMatchObject({ requester: { id: "u1", name: "Ada", email: "ada@example.com" } });
    expect(pg.query).toHaveBeenCalledWith(expect.stringContaining("i.severity = $2"), ["new", "high", "ci-1", 200]);

    await expect(details({ incidentId: "missing" }, { pg: { query: vi.fn(async () => ({ rows: [] })) } })).resolves.toEqual({ error: "Incident not found" });
    const loaded = await details({ incidentId: "inc-1" }, { pg, neo4j });
    expect(loaded).toMatchObject({
      id: "inc-1",
      affectedCis: [{ ci_id: "ci-1", name: "Payments API", class: "ApplicationService" }],
      ciHealth: { "ci-1": { overall: 0.82, relationshipCount: 3 } },
      edges: [{ sourceId: "ci-1", targetId: "ci-2", type: "DEPENDS_ON" }],
    });
    expect(close).toHaveBeenCalled();
  });

  it("incident AI workflow tools triage, recommend, approve, execute, transition, and draft follow-ups", async () => {
    await register();
    const { executeTool } = await import("@specora/sdk");
    const triage = tool("incident-manager_triage_incident");
    const recommend = tool("incident-manager_recommend_remediation");
    const approve = tool("incident-manager_approve_action");
    const execute = tool("incident-manager_execute_remediation");
    const transition = tool("incident-manager_transition_incident");
    const event = tool("incident-manager_record_incident_event");
    const stakeholder = tool("incident-manager_draft_stakeholder_update");
    const postmortem = tool("incident-manager_generate_postmortem");

    vi.mocked(executeTool).mockReset();
    vi.mocked(executeTool).mockResolvedValue({
      id: "inc-1",
      title: "Payments outage",
      severity: "critical",
      status: "major",
      service: "Payments",
      ci_id: "ci-1",
      auto_remediation_allowed: false,
      affectedCis: [{ id: "ci-1" }],
      ciHealth: { "ci-1": { overall: 0.5, relationshipCount: 0 } },
      relatedChanges: [{ id: "rfc-1", status: "implemented" }],
      ai_summary: "Error rate elevated.",
      ai_next_action: "Inspect deploy.",
    });
    const pg = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("INSERT INTO incident_actions")) {
          return { rows: [{ id: `act-${Math.random()}`, incident_id: "inc-1", name: "Review change" }] };
        }
        if (sql.includes("SELECT * FROM incident_actions")) {
          return { rows: [{ id: "act-1", incident_id: "inc-1", name: "Restart", kind: "restart", requires_approval: true, status: "approved" }] };
        }
        if (sql.includes("UPDATE incident_actions SET status = 'approved'")) {
          return { rows: [{ id: "act-1", incident_id: "inc-1", name: "Restart", status: "approved" }] };
        }
        if (sql.includes("UPDATE incident_actions SET status = 'executed'")) {
          return { rows: [{ id: "act-1", incident_id: "inc-1", status: "executed", result: "Recovered" }] };
        }
        if (sql.includes("UPDATE incidents SET status = $1::text")) {
          return { rows: [{ id: "inc-1", status: "resolved" }] };
        }
        if (sql.includes("INSERT INTO incident_events")) return { rows: [{ id: "evt-1", incident_id: "inc-1" }] };
        if (sql.includes("INSERT INTO incident_postmortems")) return { rows: [{ id: "pm-1", incident_id: "inc-1" }] };
        return { rows: [] };
      }),
    };

    expect(await triage({ incidentId: "inc-1", confidence: 0.7 }, { pg })).toMatchObject({
      decision: "request-approval",
      unhealthyCount: 1,
      relatedChangeCount: 1,
    });
    expect(await recommend({ incidentId: "inc-1" }, { pg })).toMatchObject({ incidentId: "inc-1", actions: expect.any(Array) });
    expect(await approve({ actionId: "act-1", _userId: "u1" }, { pg })).toMatchObject({ status: "approved" });
    expect(await execute({ actionId: "act-1", result: "Recovered", _userId: "u1" }, { pg })).toMatchObject({ status: "executed" });
    expect(await transition({ incidentId: "inc-1", status: "resolved", note: "Fixed", _userId: "u1" }, { pg })).toMatchObject({ status: "resolved" });
    expect(await event({ incidentId: "inc-1", message: "Customer update sent" }, { pg })).toMatchObject({ id: "evt-1" });
    expect(await stakeholder({ incidentId: "inc-1" }, { pg })).toMatchObject({ audience: "executive-and-customer" });
    expect(await postmortem({ incidentId: "inc-1", _userId: "u1" }, { pg })).toMatchObject({ id: "pm-1" });
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

  it("asset tools list details, ingest procurement, record software usage, and build dashboards", async () => {
    await register();
    const list = tool("asset-command_list_assets");
    const details = tool("asset-command_get_asset_details");
    const procurement = tool("asset-command_ingest_procurement");
    const usage = tool("asset-command_record_software_usage");
    const dashboard = tool("asset-command_dashboard");
    vi.mocked(executeTool).mockReset();
    vi.mocked(executeTool).mockResolvedValueOnce({ id: "asset-from-po", name: "Docking station" });
    const pg = {
      query: vi.fn(async (sql: string, params?: any[]) => {
        if (sql.includes("SELECT * FROM asset_records WHERE 1=1")) {
          return { rows: [{ id: "asset-1", name: "Laptop", category: "hardware", status: "verified", location: "HQ" }] };
        }
        if (sql === "SELECT * FROM asset_records WHERE id = $1") {
          return { rows: [{ id: params?.[0], name: "Laptop", serial_number: "S1" }] };
        }
        if (sql.includes("FROM asset_evidence")) return { rows: [{ id: "ev-1", evidence_type: "asset.create" }] };
        if (sql.includes("FROM asset_scan_events")) return { rows: [{ id: "scan-1", value: "S1" }] };
        if (sql.includes("FROM software_usage WHERE asset_id")) return { rows: [{ id: "usage-asset-1", product: "M365" }] };
        if (sql.includes("FROM asset_exceptions WHERE asset_id")) return { rows: [{ id: "ex-1", severity: "high" }] };
        if (sql.includes("INSERT INTO asset_contracts")) return { rows: [{ id: "contract-1", name: "Adobe procurement" }] };
        if (sql.includes("INSERT INTO software_entitlements")) return { rows: [{ id: "ent-1", publisher: "Adobe", product: "Acrobat" }] };
        if (sql.includes("INSERT INTO software_usage")) return { rows: [{ id: "usage-1", publisher: params?.[0], product: params?.[1], normalized_product: params?.[2] }] };
        if (sql.includes("COUNT(*)::int as count FROM asset_records")) return { rows: [{ count: 7 }] };
        if (sql.includes("COUNT(*)::int as count FROM asset_contracts")) return { rows: [{ count: 2 }] };
        if (sql.includes("COUNT(*)::int as count, COALESCE(SUM(quantity), 0)::numeric as quantity FROM software_entitlements")) return { rows: [{ count: 5, quantity: 100 }] };
        if (sql.includes("COUNT(*)::int as count, COALESCE(SUM(quantity), 0)::numeric as quantity FROM software_usage")) return { rows: [{ count: 4, quantity: 80 }] };
        if (sql.includes("COUNT(*)::int as count, COALESCE(SUM(financial_impact), 0)::numeric as impact")) return { rows: [{ count: 1, impact: 1200 }] };
        if (sql.includes("SELECT * FROM asset_reconciliation_runs")) return { rows: [{ id: "run-1", risk_score: 25 }] };
        return { rows: [] };
      }),
    };

    const listed = await list({ category: "hardware", status: "verified", lifecycleState: "in_use", ciId: "ci-1", location: "HQ", limit: 999 }, { pg });
    expect(listed).toEqual([{ id: "asset-1", name: "Laptop", category: "hardware", status: "verified", location: "HQ" }]);
    expect(pg.query.mock.calls.find((call: any[]) => String(call[0]).includes("SELECT * FROM asset_records WHERE 1=1"))?.[1]).toEqual(["hardware", "verified", "in_use", "ci-1", "HQ", 250]);

    await expect(details({ assetId: "missing" }, { pg: { query: vi.fn(async () => ({ rows: [] })) } })).resolves.toEqual({ error: "Asset not found" });
    await expect(details({ assetId: "asset-1" }, { pg })).resolves.toMatchObject({
      id: "asset-1",
      evidence: [{ id: "ev-1" }],
      scans: [{ id: "scan-1" }],
      usage: [{ id: "usage-asset-1" }],
      exceptions: [{ id: "ex-1" }],
    });

    const procured = await procurement({
      source: "erp",
      externalRef: "PO-1",
      vendor: "Adobe",
      purchaseOrder: "PO-1",
      items: [
        { category: "software", product: "Acrobat", quantity: 50, metric: "user" },
        { name: "Docking station", serialNumber: "D1" },
      ],
    }, { pg });
    expect(procured).toMatchObject({ count: 2, created: [{ type: "entitlement", item: { id: "ent-1" } }, { type: "asset", item: { id: "asset-from-po" } }] });
    expect(executeTool).toHaveBeenCalledWith("asset-command_create_asset", expect.objectContaining({ name: "Docking station", purchaseOrder: "PO-1" }), { pg });

    await expect(usage({ publisher: "Microsoft Corporation", product: "M365 Software", version: "1.0", assetId: "asset-1" }, { pg })).resolves.toMatchObject({
      id: "usage-1",
      normalized_product: "m365",
    });
    await expect(dashboard({}, { pg })).resolves.toMatchObject({
      assets: { count: 7 },
      contracts: { count: 2 },
      entitlements: { quantity: 100 },
      usage: { quantity: 80 },
      exceptions: { impact: 1200 },
      recentRuns: [{ id: "run-1" }],
    });
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
