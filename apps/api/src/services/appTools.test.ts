import { describe, it, expect, vi, beforeEach } from "vitest";

const mockTools: any[] = [];

vi.mock("@specora/sdk", () => ({
  registerTool: vi.fn((_appId: string, tool: any, _handler: any) => {
    mockTools.push({ ...tool, name: `${_appId}_${tool.name}` });
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

  it("registers app tools on module load", async () => {
    await import("./appTools");
    expect(mockTools.length).toBeGreaterThan(0);
    expect(mockTools.some((t) => t.name.startsWith("change-manager_"))).toBe(true);
    expect(mockTools.some((t) => t.name.startsWith("health-monitor_"))).toBe(true);
    expect(mockTools.some((t) => t.name.startsWith("discovery-insights_"))).toBe(true);
  });
});
