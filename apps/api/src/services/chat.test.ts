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

  it("returns message when no AI provider is configured", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.PROVARA_URL;
    delete process.env.PROVARA_API_KEY;
    const result = await chat([{ role: "user", content: "Hi" }], mockFastify());
    expect(result.content).toContain("AI chat is not configured");
  });

  it("calls OpenAI and returns direct response", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "Direct response" } }],
    });
    const result = await chat([{ role: "user", content: "Hi" }], mockFastify());
    expect(result.content).toBe("Direct response");
  });

  it("returns fallback when direct response is empty", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "" } }],
    });
    const result = await chat([{ role: "user", content: "Hi" }], mockFastify());
    expect(result.content).toBe("I don't have a response for that.");
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
    expect(result.content).toBe("I processed the data but have no response.");
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
    expect(result.content).toBe("Found 1 CI");
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
    expect(result.content).toBe("Found all");
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
    expect(result.content).toBe("Found DBs");
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
    expect(result.content).toBe("CI details");
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
    expect(result.content).toBe("CI incoming");
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
    expect(result.content).toBe("Not found");
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
    expect(result.content).toBe("You have 5 servers");
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
    expect(result.content).toBe("You have 8 production CIs");
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
    expect(result.content).toBe("You have 100 CIs");
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
    expect(result.content).toBe("Service map");
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
    expect(result.content).toBe("Unknown tool handled");
  });

  it("routes through Provara when configured", async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.PROVARA_URL = "https://api.provara.xyz";
    process.env.PROVARA_API_KEY = "pk-test";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: "Provara says hello" } }],
      }),
    });
    global.fetch = mockFetch;

    const result = await chat([{ role: "user", content: "Hi" }], mockFastify());
    expect(result.content).toBe("Provara says hello");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.provara.xyz/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer pk-test",
        }),
      })
    );

    delete process.env.PROVARA_URL;
    delete process.env.PROVARA_API_KEY;
  });

  it("sends X-Tenant-ID header when PROVARA_TENANT_ID is set", async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.PROVARA_URL = "https://api.provara.xyz";
    process.env.PROVARA_API_KEY = "pk-test";
    process.env.PROVARA_TENANT_ID = "MHgS8IpDodNe";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: "Hello tenant" } }],
      }),
    });
    global.fetch = mockFetch;

    const result = await chat([{ role: "user", content: "Hi" }], mockFastify());
    expect(result.content).toBe("Hello tenant");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.provara.xyz/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer pk-test",
          "X-Tenant-ID": "MHgS8IpDodNe",
        }),
      })
    );

    delete process.env.PROVARA_URL;
    delete process.env.PROVARA_API_KEY;
    delete process.env.PROVARA_TENANT_ID;
  });

  it("routes second completion through Provara when tool calls are used", async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.PROVARA_URL = "https://api.provara.xyz";
    process.env.PROVARA_API_KEY = "pk-test";

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: null,
              tool_calls: [{
                id: "call-1",
                function: { name: "count_cis", arguments: JSON.stringify({ class: "Server" }) },
              }],
            },
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: "Provara tool result" } }],
        }),
      });
    global.fetch = mockFetch;

    const fastify = mockFastify([[
      { get: (k: string) => k === "total" ? { toNumber: () => 5 } : undefined },
    ]]);

    const result = await chat([{ role: "user", content: "How many servers?" }], fastify);
    expect(result.content).toBe("Provara tool result");
    expect(mockFetch).toHaveBeenCalledTimes(2);

    delete process.env.PROVARA_URL;
    delete process.env.PROVARA_API_KEY;
  });

  it("throws when Provara returns an error", async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.PROVARA_URL = "https://api.provara.xyz";
    process.env.PROVARA_API_KEY = "pk-test";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal error"),
    });
    global.fetch = mockFetch;

    await expect(chat([{ role: "user", content: "Hi" }], mockFastify())).rejects.toThrow("Provara error 500");

    delete process.env.PROVARA_URL;
    delete process.env.PROVARA_API_KEY;
  });

  it("executes find_dependency_path tool", async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call-1",
              function: { name: "find_dependency_path", arguments: JSON.stringify({ fromId: "bs-1", toId: "db-1" }) },
            }],
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "Path found" } }],
      });

    const fastify = mockFastify([[
      {
        get: (k: string) => {
          if (k === "pathNodes") return [{ properties: { id: "bs-1", name: "Portal", class: "BusinessService" } }, { properties: { id: "db-1", name: "Postgres", class: "Database" } }];
          if (k === "pathRels") return [{ type: "DEPENDS_ON", start: { properties: { id: "bs-1" } }, end: { properties: { id: "db-1" } } }];
          return undefined;
        },
      },
    ]]);

    const result = await chat([{ role: "user", content: "Path from bs-1 to db-1" }], fastify);
    expect(result.content).toBe("Path found");
  });

  it("executes find_orphaned_cis tool", async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call-1",
              function: { name: "find_orphaned_cis", arguments: "{}" },
            }],
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "Found orphans" } }],
      });

    const fastify = mockFastify([[
      { get: (k: string) => k === "n" ? { properties: { id: "orph-1", name: "Lost Server", class: "Server", environment: "Prod" } } : undefined },
    ]]);

    const result = await chat([{ role: "user", content: "Find orphans" }], fastify);
    expect(result.content).toBe("Found orphans");
  });

  it("includes uiContext in system prompt when provided", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "Got context" } }],
    });
    const result = await chat([{ role: "user", content: "Hi" }], mockFastify(), undefined, "Active app: service-map");
    expect(result.content).toBe("Got context");
  });

  it("handles tool execution error gracefully", async () => {
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
        choices: [{ message: { content: "Handled error" } }],
      });

    const session = mockNeo4jSession([]);
    session.run = vi.fn().mockRejectedValue(new Error("Neo4j failure"));
    const fastify = {
      neo4j: { session: vi.fn().mockReturnValue(session) },
      log: { info: vi.fn(), error: vi.fn() },
    } as any;

    const result = await chat([{ role: "user", content: "Map" }], fastify);
    expect(result.content).toBe("Handled error");
    expect(result.toolCalls?.[0].result.error).toBe("Neo4j failure");
  });

  it("find_dependency_path returns empty when no path exists", async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call-1",
              function: { name: "find_dependency_path", arguments: JSON.stringify({ fromId: "a", toId: "b" }) },
            }],
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "No path" } }],
      });

    const fastify = mockFastify([[]]);
    const result = await chat([{ role: "user", content: "Path?" }], fastify);
    expect(result.content).toBe("No path");
  });

  it("throws when second completion fails with a trace", async () => {
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
      });
    mockCreate.mockRejectedValueOnce(new Error("Second call failed"));

    const traceMock = {
      span: vi.fn().mockReturnValue({
        end: vi.fn().mockResolvedValue(undefined),
      }),
      end: vi.fn().mockResolvedValue(undefined),
    };

    const fastify = mockFastify([[
      { get: (k: string) => k === "total" ? { toNumber: () => 0 } : undefined },
    ]]);

    await expect(chat([{ role: "user", content: "Count" }], fastify, traceMock as any)).rejects.toThrow("Second call failed");
  });
});
