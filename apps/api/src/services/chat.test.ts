import { describe, it, expect, vi, beforeEach } from "vitest";
import { chat, chatStream } from "../services/chat";

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
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
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

  it("retries without tools when direct response is empty", async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [{ message: { content: "" } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "Retry response" } }],
      });
    const result = await chat([{ role: "user", content: "Hi" }], mockFastify());
    expect(result.content).toBe("Retry response");
  });

  it("returns fallback when retry also returns empty", async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [{ message: { content: "" } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "" } }],
      });
    const result = await chat([{ role: "user", content: "Hi" }], mockFastify());
    expect(result.content).toBe("I'm not sure how to respond to that. Could you rephrase or provide more detail?");
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
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: "" } }],
      });

    const fastify = mockFastify([[
      { get: (k: string) => k === "total" ? { toNumber: () => 0 } : undefined },
    ]]);

    const result = await chat([{ role: "user", content: "Count" }], fastify);
    expect(result.content).toBe("I'm not sure how to respond to that. Could you rephrase or provide more detail?");
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

  it("does not expose or execute CMDB tools for users without roles", async () => {
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
        choices: [{ message: { content: "I cannot access CMDB data for this account." } }],
      });

    const fastify = mockFastify();
    const result = await chat([{ role: "user", content: "Find servers" }], fastify, undefined, undefined, { id: "basic-1" });
    const firstCall = mockCreate.mock.calls[0]?.[0] as any;

    expect((firstCall.tools ?? []).some((tool: any) => tool.function.name === "search_cis")).toBe(false);
    expect(fastify.neo4j.session).not.toHaveBeenCalled();
    expect(result.toolCalls?.[0].result).toEqual({ error: "Forbidden: this account cannot read CMDB data." });
    expect(result.content).toBe("I cannot access CMDB data for this account.");
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
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
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

describe("chatStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockReset();
    process.env.OPENAI_API_KEY = "sk-test";
  });

  it("streams direct response without tool calls", async () => {
    mockCreate.mockResolvedValueOnce({
      [Symbol.asyncIterator]: async function* () {
        yield { choices: [{ delta: { content: "Hello" } }] };
        yield { choices: [{ delta: { content: " world" } }] };
      },
    });

    const events: any[] = [];
    const result = await chatStream([{ role: "user", content: "Hi" }], mockFastify(), (ev) => events.push(ev));
    expect(result.content).toBe("Hello world");
    expect(events.filter((e) => e.type === "token").map((e) => e.content)).toEqual(["Hello", " world"]);
  });

  it("streams tool call and then final answer", async () => {
    mockCreate
      .mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield {
            choices: [{
              delta: {
                content: null,
                tool_calls: [{
                  index: 0,
                  id: "call-1",
                  type: "function",
                  function: { name: "count_cis", arguments: "" },
                }],
              },
            }],
          };
          yield {
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  function: { arguments: "{}" },
                }],
              },
            }],
          };
        },
      })
      .mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: "You have 5 CIs" } }] };
        },
      });

    const fastify = mockFastify([[
      { get: (k: string) => k === "total" ? { toNumber: () => 5 } : undefined },
    ]]);

    const events: any[] = [];
    const result = await chatStream([{ role: "user", content: "How many?" }], fastify, (ev) => events.push(ev));
    expect(result.content).toBe("You have 5 CIs");
    expect(result.toolCalls).toHaveLength(1);
    expect(mockCreate).toHaveBeenNthCalledWith(1, expect.objectContaining({ tool_choice: "required" }));
    expect(mockCreate).toHaveBeenNthCalledWith(2, expect.objectContaining({ tool_choice: "auto" }));
    expect(events.some((e) => e.type === "tool_call")).toBe(true);
    expect(events.some((e) => e.type === "tool_result")).toBe(true);
  });

  it("retries without tools when streaming response is empty", async () => {
    mockCreate
      .mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: {} }] };
        },
      })
      .mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: "Retry stream" } }] };
        },
      });

    const result = await chatStream([{ role: "user", content: "Hi" }], mockFastify(), () => {});
    expect(result.content).toBe("Retry stream");
  });

  it("returns fallback when streaming retry also returns empty", async () => {
    mockCreate
      .mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: {} }] };
        },
      })
      .mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: {} }] };
        },
      });

    const result = await chatStream([{ role: "user", content: "Hi" }], mockFastify(), () => {});
    expect(result.content).toBe("I'm not sure how to respond to that. Could you rephrase or provide more detail?");
  });

  it("streams content interleaved with tool calls", async () => {
    mockCreate
      .mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield {
            choices: [{
              delta: {
                content: "Let me ",
                tool_calls: [{
                  index: 0,
                  id: "call-1",
                  type: "function",
                  function: { name: "count_cis", arguments: "" },
                }],
              },
            }],
          };
          yield {
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  function: { arguments: "{}" },
                }],
              },
            }],
          };
        },
      })
      .mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: "check: 5 CIs" } }] };
        },
      });

    const fastify = mockFastify([[
      { get: (k: string) => k === "total" ? { toNumber: () => 5 } : undefined },
    ]]);

    const events: any[] = [];
    const result = await chatStream([{ role: "user", content: "Count" }], fastify, (ev) => events.push(ev));
    expect(result.toolCalls).toHaveLength(1);
    expect(result.content).toBe("check: 5 CIs");
    expect(events.filter((e) => e.type === "token").map((e) => e.content)).toEqual(["Let me ", "check: 5 CIs"]);
  });

  it("continues streaming loop when model emits CMDB search action text", async () => {
    mockCreate
      .mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield {
            choices: [{
              delta: {
                content: 'I will search for that CI. [[action|open-cmdb-explorer|query=nb-lenovo|Open Search in CMDB Explorer]]',
              },
            }],
          };
        },
      })
      .mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: "I found nb-lenovo and can inspect its impact." } }] };
        },
      });

    const fastify = mockFastify([[
      { get: () => ({ properties: { id: "ci-1", name: "nb-lenovo", class: "Computer", environment: "Production" } }) },
    ]]);

    const events: any[] = [];
    const result = await chatStream([{ role: "user", content: "nb-lenovo" }], fastify, (ev) => events.push(ev));

    expect(result.content).toBe("I found nb-lenovo and can inspect its impact.");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0].call.function.name).toBe("search_cis");
    expect(JSON.parse(result.toolCalls?.[0].call.function.arguments)).toEqual({ query: "nb-lenovo" });
    expect(events.some((event) => event.type === "tool_call" && event.name === "search_cis")).toBe(true);
    expect(events.some((event) => event.type === "tool_result" && event.name === "search_cis")).toBe(true);
  });

  it("repairs promissory streaming search text into a CMDB search tool call", async () => {
    mockCreate
      .mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield {
            choices: [{
              delta: {
                content: 'I will search for the CI named "nb-lenovo" to locate its details and dependencies.',
              },
            }],
          };
        },
      })
      .mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: "nb-lenovo is a Computer with one dependency." } }] };
        },
      });

    const fastify = mockFastify([[
      { get: () => ({ properties: { id: "ci-1", name: "nb-lenovo", class: "Computer", environment: "Production" } }) },
    ]]);

    const events: any[] = [];
    const result = await chatStream([{ role: "user", content: "nb-lenovo" }], fastify, (ev) => events.push(ev));

    expect(result.content).toBe("nb-lenovo is a Computer with one dependency.");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0].call.function.name).toBe("search_cis");
    expect(JSON.parse(result.toolCalls?.[0].call.function.arguments)).toEqual({ query: "nb-lenovo" });
    expect(events.some((event) => event.type === "tool_call" && event.name === "search_cis")).toBe(true);
  });

  it("repairs promissory detail text after search into a CI details tool call", async () => {
    mockCreate
      .mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield {
            choices: [{
              delta: {
                content: 'I will search for the CI named "nb-lenovo" to locate it.',
              },
            }],
          };
        },
      })
      .mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield {
            choices: [{
              delta: {
                content: "I will now retrieve detailed information about its risk, dependencies, and relationships.",
              },
            }],
          };
        },
      })
      .mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: "nb-lenovo details are now available." } }] };
        },
      });

    const fastify = mockFastify([
      [{ get: () => ({ properties: { id: "ci-1", name: "nb-lenovo", class: "Computer", environment: "Production" } }) }],
      [{ get: () => ({ properties: { id: "ci-1", name: "nb-lenovo", class: "Computer", environment: "Production" } }) }],
      [],
    ]);

    const events: any[] = [];
    const result = await chatStream([{ role: "user", content: "nb-lenovo" }], fastify, (ev) => events.push(ev));

    expect(result.content).toBe("nb-lenovo details are now available.");
    expect(result.toolCalls?.map((item) => item.call.function.name)).toEqual(["search_cis", "get_ci_details"]);
    expect(JSON.parse(result.toolCalls?.[1].call.function.arguments)).toEqual({ id: "ci-1" });
    expect(events.some((event) => event.type === "tool_call" && event.name === "get_ci_details")).toBe(true);
  });

  it("repairs promissory service-map text after CI details into a service map tool call", async () => {
    mockCreate
      .mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield {
            choices: [{
              delta: {
                content: 'I will search for the CI named "nb-lenovo" to locate it.',
              },
            }],
          };
        },
      })
      .mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield {
            choices: [{
              delta: {
                content: "I will now retrieve detailed information about its risk and relationships.",
              },
            }],
          };
        },
      })
      .mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield {
            choices: [{
              delta: {
                content: "I will fetch the service map to analyze dependencies and impact.",
              },
            }],
          };
        },
      })
      .mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: "nb-lenovo has no downstream dependencies and two upstream relationships." } }] };
        },
      });

    const ciRecord = {
      get: (key: string) => ["n", "root"].includes(key)
        ? { properties: { id: "ci-1", name: "nb-lenovo", class: "Computer", environment: "Production" } }
        : undefined,
    };
    const fastify = mockFastify([[ciRecord], [ciRecord], [], [ciRecord], []]);

    const events: any[] = [];
    const result = await chatStream([{ role: "user", content: "nb-lenovo" }], fastify, (ev) => events.push(ev));

    expect(result.toolCalls?.map((item) => item.call.function.name)).toEqual(["search_cis", "get_ci_details", "get_service_map"]);
    expect(JSON.parse(result.toolCalls?.[2].call.function.arguments)).toEqual({ rootId: "ci-1" });
    expect(result.content).toContain("nb-lenovo has no downstream dependencies and two upstream relationships.");
    expect(events.some((event) => event.type === "tool_call" && event.name === "get_service_map")).toBe(true);
  });

  it("forces a final answer when a resolved CI prompt only promises more analysis", async () => {
    mockCreate
      .mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield {
            choices: [{
              delta: {
                content: 'I need to check the current health status and dependencies of "nb-lenovo" to determine top risks.',
              },
            }],
          };
        },
      })
      .mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: "Top risks: no downstream dependencies were found; verify missing health telemetry before taking action." } }] };
        },
      });

    const priorToolCall = {
      id: "call-map-1",
      type: "function",
      function: { name: "get_service_map", arguments: JSON.stringify({ rootId: "ci-1" }) },
    };
    const messages = [
      { role: "user" as const, content: "nb-lenovo" },
      { role: "assistant" as const, content: "", tool_calls: [priorToolCall] },
      {
        role: "tool" as const,
        tool_call_id: "call-map-1",
        content: JSON.stringify({
          rootId: "ci-1",
          nodes: [{ id: "ci-1", name: "nb-lenovo", class: "Computer" }],
          edges: [],
        }),
      },
      { role: "user" as const, content: "Summarize the top risks and recommended next actions from this answer." },
    ];

    const events: any[] = [];
    const result = await chatStream(messages, mockFastify(), (ev) => events.push(ev));

    expect(result.content).toBe("Top risks: no downstream dependencies were found; verify missing health telemetry before taking action.");
    expect(result.toolCalls).toBeUndefined();
    expect(events.some((event) => event.type === "tool_call")).toBe(false);
  });
});
