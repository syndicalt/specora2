import { describe, it, expect, vi, beforeEach } from "vitest";
import { chat } from "../services/chat";

const mockCreate = vi.fn();

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    };
  },
}));

function mockNeo4jSession(recordSets: any[][] = [[]]) {
  let callIndex = 0;
  return {
    run: vi.fn().mockImplementation(() => {
      const records = recordSets[callIndex] || [];
      callIndex++;
      return Promise.resolve({ records });
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

const mockFastify = (recordSets: any[][] = [[]]) =>
  ({
    neo4j: {
      session: vi.fn().mockReturnValue(mockNeo4jSession(recordSets)),
    },
    log: { info: vi.fn(), error: vi.fn() },
  }) as any;

describe("chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockReset();
    process.env.OPENAI_API_KEY = "sk-test";
  });

  it("returns message when OpenAI key is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await chat([{ role: "user", content: "Hi" }], mockFastify());
    expect(result).toContain("OpenAI API key is not configured");
  });

  it("calls OpenAI and returns direct response", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "Direct response" } }],
    });
    const result = await chat([{ role: "user", content: "Hi" }], mockFastify());
    expect(result).toBe("Direct response");
  });

  it("returns fallback when direct response is empty", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "" } }],
    });
    const result = await chat([{ role: "user", content: "Hi" }], mockFastify());
    expect(result).toBe("I don't have a response for that.");
  });

  it("returns fallback when tool response is empty", async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call-1",
              function: { name: "count_cis", arguments: "{}" },
            }],
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "" } }],
      });

    const fastify = mockFastify([[
      { get: (k: string) => k === "total" ? { toNumber: () => 0 } : undefined },
    ]]);

    const result = await chat([{ role: "user", content: "Count" }], fastify);
    expect(result).toBe("I processed the data but have no response.");
  });

  it("executes search_cis tool with name filter", async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call-1",
              function: { name: "search_cis", arguments: JSON.stringify({ name: "web" }) },
            }],
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "Found 1 CI" } }],
      });

    const fastify = mockFastify([[
      { get: (k: string) => k === "n" ? { properties: { id: "srv-1", name: "web-01", class: "Server", environment: "Prod" } } : undefined },
    ]]);

    const result = await chat([{ role: "user", content: "Find servers" }], fastify);
    expect(result).toBe("Found 1 CI");
  });

  it("executes search_cis tool with no filters", async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call-1",
              function: { name: "search_cis", arguments: "{}" },
            }],
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "Found all" } }],
      });

    const fastify = mockFastify([[
      { get: (k: string) => k === "n" ? { properties: { id: "srv-1", name: "web-01", class: "Server" } } : undefined },
    ]]);

    const result = await chat([{ role: "user", content: "Find all" }], fastify);
    expect(result).toBe("Found all");
  });

  it("executes search_cis tool with class and environment filters", async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call-1",
              function: { name: "search_cis", arguments: JSON.stringify({ class: "Database", environment: "Prod" }) },
            }],
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "Found DBs" } }],
      });

    const fastify = mockFastify([[
      { get: (k: string) => k === "n" ? { properties: { id: "db-1", name: "postgres", class: "Database", environment: "Prod" } } : undefined },
    ]]);

    const result = await chat([{ role: "user", content: "Find DBs" }], fastify);
    expect(result).toBe("Found DBs");
  });

  it("executes get_ci_details tool with outgoing relationship", async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call-1",
              function: { name: "get_ci_details", arguments: JSON.stringify({ id: "bs-1" }) },
            }],
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "CI details" } }],
      });

    const fastify = mockFastify([
      [{ get: (k: string) => k === "n" ? { properties: { id: "bs-1", name: "Portal", class: "BusinessService" } } : undefined }],
      [{ get: (k: string) => {
        if (k === "r") return { type: "DEPENDS_ON", start: "bs-1", end: "as-1" };
        if (k === "target") return { properties: { id: "as-1", name: "API", class: "ApplicationService" } };
        return undefined;
      } }],
    ]);

    const result = await chat([{ role: "user", content: "Tell me about bs-1" }], fastify);
    expect(result).toBe("CI details");
  });

  it("executes get_ci_details tool with incoming relationship", async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call-1",
              function: { name: "get_ci_details", arguments: JSON.stringify({ id: "as-1" }) },
            }],
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "CI incoming" } }],
      });

    const fastify = mockFastify([
      [{ get: (k: string) => k === "n" ? { properties: { id: "as-1", name: "API", class: "ApplicationService" } } : undefined }],
      [{ get: (k: string) => {
        if (k === "r") return { type: "DEPENDS_ON", start: "bs-1", end: "as-1" };
        if (k === "target") return { properties: { id: "bs-1", name: "Portal", class: "BusinessService" } };
        return undefined;
      } }],
    ]);

    const result = await chat([{ role: "user", content: "Tell me about as-1" }], fastify);
    expect(result).toBe("CI incoming");
  });

  it("returns null for missing CI in get_ci_details", async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call-1",
              function: { name: "get_ci_details", arguments: JSON.stringify({ id: "missing" }) },
            }],
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "Not found" } }],
      });

    const fastify = mockFastify([[]]);

    const result = await chat([{ role: "user", content: "Find missing" }], fastify);
    expect(result).toBe("Not found");
  });

  it("executes count_cis tool with class filter", async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call-1",
              function: { name: "count_cis", arguments: JSON.stringify({ class: "Server" }) },
            }],
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "You have 5 servers" } }],
      });

    const fastify = mockFastify([[
      { get: (k: string) => k === "total" ? { toNumber: () => 5 } : undefined },
    ]]);

    const result = await chat([{ role: "user", content: "How many servers?" }], fastify);
    expect(result).toBe("You have 5 servers");
  });

  it("executes count_cis tool with environment filter", async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call-1",
              function: { name: "count_cis", arguments: JSON.stringify({ environment: "Production" }) },
            }],
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "You have 8 production CIs" } }],
      });

    const fastify = mockFastify([[
      { get: (k: string) => k === "total" ? { toNumber: () => 8 } : undefined },
    ]]);

    const result = await chat([{ role: "user", content: "How many production?" }], fastify);
    expect(result).toBe("You have 8 production CIs");
  });

  it("executes count_cis tool with no filters", async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call-1",
              function: { name: "count_cis", arguments: "{}" },
            }],
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "You have 100 CIs" } }],
      });

    const fastify = mockFastify([[
      { get: (k: string) => k === "total" ? { toNumber: () => 100 } : undefined },
    ]]);

    const result = await chat([{ role: "user", content: "How many total?" }], fastify);
    expect(result).toBe("You have 100 CIs");
  });

  it("executes get_service_map tool", async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call-1",
              function: { name: "get_service_map", arguments: JSON.stringify({ rootId: "bs-1" }) },
            }],
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "Service map" } }],
      });

    const fastify = mockFastify([[
      {
        get: (k: string) => {
          if (k === "root") return { properties: { id: "bs-1", name: "Portal", class: "BusinessService" } };
          if (k === "related") return { properties: { id: "as-1", name: "API", class: "ApplicationService" } };
          if (k === "rel") return { type: "DEPENDS_ON" };
          if (k === "src") return { properties: { id: "bs-1" } };
          if (k === "tgt") return { properties: { id: "as-1" } };
          return undefined;
        },
      },
    ]]);

    const result = await chat([{ role: "user", content: "Map bs-1" }], fastify);
    expect(result).toBe("Service map");
  });

  it("handles unknown tool gracefully", async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call-1",
              function: { name: "unknown_tool", arguments: "{}" },
            }],
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "Unknown tool handled" } }],
      });

    const result = await chat([{ role: "user", content: "Test" }], mockFastify());
    expect(result).toBe("Unknown tool handled");
  });
});
