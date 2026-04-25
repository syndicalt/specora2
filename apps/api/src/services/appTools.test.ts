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

  it("list_rfcs applies optional filters", async () => {
    await register();
    const handler = tool("change-manager_list_rfcs");
    const pg = { query: vi.fn(async () => ({ rows: [{ id: "r1" }] })) };

    const result = await handler({ status: "draft", ciId: "ci-1" }, { pg });

    expect(result).toEqual([{ id: "r1" }]);
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
});
