import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { chatRoutes } from "../routes/chat";
import * as chatService from "../services/chat";

function mockPg(rows: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }),
  } as any;
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function buildApp(pgRows: any[] = []) {
    const app = Fastify();
    app.decorate("authenticate", async (request: any) => {
      request.user = { id: "u1", email: "alice@specora.dev" };
    });
    app.decorate("pg", mockPg(pgRows));
    await app.register(chatRoutes);
    return app;
  }

  it("returns assistant response for valid messages without sessionId", async () => {
    vi.spyOn(chatService, "chat").mockResolvedValue({ content: "Hello from AI" });
    const app = await buildApp([{ id: "sess-1", user_id: "u1", title: "Hi", created_at: new Date(), updated_at: new Date() }]);
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { messages: [{ role: "user", content: "Hi" }] },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.role).toBe("assistant");
    expect(body.content).toBe("Hello from AI");
    expect(body.sessionId).toBeDefined();
  });

  it("filters chat capabilities to apps visible to the signed-in user", async () => {
    const app = await buildApp([]);
    const res = await app.inject({
      method: "GET",
      url: "/api/chat/capabilities",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.capabilities.map((group: any) => group.appId)).toEqual(["customer-portal"]);
  });

  it("returns assistant response with existing sessionId", async () => {
    vi.spyOn(chatService, "chat").mockResolvedValue({ content: "Hello again" });
    const app = await buildApp([
      { id: "msg-1", session_id: "sess-1", role: "user", content: "Hi", tool_calls: null, tool_call_id: null, created_at: new Date() },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { messages: [{ role: "user", content: "Hi again" }], sessionId: "sess-1" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.content).toBe("Hello again");
    expect(body.sessionId).toBe("sess-1");
  });

  it("returns 400 for missing messages", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 500 when chat service throws", async () => {
    vi.spyOn(chatService, "chat").mockRejectedValueOnce(new Error("OpenAI down"));
    const app = await buildApp([{ id: "sess-1", user_id: "u1", title: "Hi", created_at: new Date(), updated_at: new Date() }]);
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { messages: [{ role: "user", content: "Hi" }] },
    });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toContain("OpenAI down");
  });

  it("returns generic error when thrown error has no message", async () => {
    vi.spyOn(chatService, "chat").mockRejectedValueOnce({ message: "" });
    const app = await buildApp([{ id: "sess-1", user_id: "u1", title: "Hi", created_at: new Date(), updated_at: new Date() }]);
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { messages: [{ role: "user", content: "Hi" }] },
    });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("Chat failed");
  });
});

describe("GET /api/chat/sessions", () => {
  async function buildApp(pgRows: any[] = []) {
    const app = Fastify();
    app.decorate("authenticate", async (request: any) => {
      request.user = { id: "u1", email: "alice@specora.dev" };
    });
    app.decorate("pg", mockPg(pgRows));
    await app.register(chatRoutes);
    return app;
  }

  it("returns sessions for the authenticated user", async () => {
    const app = await buildApp([
      { id: "sess-1", user_id: "u1", title: "Chat 1", created_at: new Date(), updated_at: new Date() },
    ]);
    const res = await app.inject({
      method: "GET",
      url: "/api/chat/sessions",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].id).toBe("sess-1");
  });
});

describe("POST /api/chat/sessions", () => {
  async function buildApp(pgRows: any[] = []) {
    const app = Fastify();
    app.decorate("authenticate", async (request: any) => {
      request.user = { id: "u1", email: "alice@specora.dev" };
    });
    app.decorate("pg", mockPg(pgRows));
    await app.register(chatRoutes);
    return app;
  }

  it("creates a new session", async () => {
    const app = await buildApp([{ id: "sess-1", user_id: "u1", title: "New Chat", created_at: new Date(), updated_at: new Date() }]);
    const res = await app.inject({
      method: "POST",
      url: "/api/chat/sessions",
      payload: { title: "New Chat" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.session).toBeDefined();
    expect(body.session.title).toBe("New Chat");
  });
});

describe("DELETE /api/chat/sessions/:id", () => {
  async function buildApp(pgRows: any[] = []) {
    const app = Fastify();
    app.decorate("authenticate", async (request: any) => {
      request.user = { id: "u1", email: "alice@specora.dev" };
    });
    app.decorate("pg", mockPg(pgRows));
    await app.register(chatRoutes);
    return app;
  }

  it("deletes a session", async () => {
    const app = await buildApp();
    (app.pg.query as any).mockResolvedValueOnce({ rowCount: 1 });
    const res = await app.inject({
      method: "DELETE",
      url: "/api/chat/sessions/sess-1",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
  });

  it("returns 404 for missing session", async () => {
    const app = await buildApp();
    (app.pg.query as any).mockResolvedValueOnce({ rowCount: 0 });
    const res = await app.inject({
      method: "DELETE",
      url: "/api/chat/sessions/missing",
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/chat/sessions/:id/messages", () => {
  async function buildApp(pgRows: any[] = []) {
    const app = Fastify();
    app.decorate("authenticate", async (request: any) => {
      request.user = { id: "u1", email: "alice@specora.dev" };
    });
    app.decorate("pg", mockPg(pgRows));
    await app.register(chatRoutes);
    return app;
  }

  it("returns messages for a session", async () => {
    const app = await buildApp([
      { id: "msg-1", session_id: "sess-1", role: "user", content: "Hi", tool_calls: null, tool_call_id: null, created_at: new Date() },
    ]);
    const res = await app.inject({
      method: "GET",
      url: "/api/chat/sessions/sess-1/messages",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].content).toBe("Hi");
  });

  it("returns 500 when getting messages fails", async () => {
    const app = await buildApp();
    (app.pg.query as any).mockRejectedValueOnce(new Error("DB error"));
    const res = await app.inject({
      method: "GET",
      url: "/api/chat/sessions/sess-1/messages",
    });

    expect(res.statusCode).toBe(500);
  });

  it("returns 500 when listing sessions fails", async () => {
    const app = await buildApp();
    (app.pg.query as any).mockRejectedValueOnce(new Error("DB error"));
    const res = await app.inject({
      method: "GET",
      url: "/api/chat/sessions",
    });

    expect(res.statusCode).toBe(500);
  });

  it("returns 500 when creating session fails", async () => {
    const app = await buildApp();
    (app.pg.query as any).mockRejectedValueOnce(new Error("DB error"));
    const res = await app.inject({
      method: "POST",
      url: "/api/chat/sessions",
      payload: { title: "Test" },
    });

    expect(res.statusCode).toBe(500);
  });

  it("returns 500 when deleting session fails", async () => {
    const app = await buildApp();
    (app.pg.query as any).mockRejectedValueOnce(new Error("DB error"));
    const res = await app.inject({
      method: "DELETE",
      url: "/api/chat/sessions/sess-1",
    });

    expect(res.statusCode).toBe(500);
  });

  it("returns 500 with generic error when err.message is empty", async () => {
    const app = await buildApp();
    (app.pg.query as any).mockRejectedValueOnce({ message: "" });
    const res = await app.inject({
      method: "GET",
      url: "/api/chat/sessions",
    });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("Failed to list sessions");
  });

  it("persists tool calls in session", async () => {
    vi.spyOn(chatService, "chat").mockResolvedValue({
      content: "Tool result",
      toolCalls: [{
        call: { id: "call-1", type: "function", function: { name: "count_cis", arguments: "{}" } } as any,
        result: { total: 5 },
      }],
    });
    const app = await buildApp([
      { id: "msg-1", session_id: "sess-1", role: "user", content: "Hi", tool_calls: null, tool_call_id: null, created_at: new Date() },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { messages: [{ role: "user", content: "Count" }], sessionId: "sess-1" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.content).toBe("Tool result");
    expect(app.pg.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO chat_messages"),
      expect.arrayContaining(["sess-1", "assistant", "Tool result", expect.anything(), null])
    );
  });
});

describe("POST /api/chat/stream", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function buildApp(pgRows: any[] = []) {
    const app = Fastify();
    app.decorate("authenticate", async (request: any) => {
      request.user = { id: "u1", email: "alice@specora.dev" };
    });
    app.decorate("pg", mockPg(pgRows));
    await app.register(chatRoutes);
    return app;
  }

  it("streams tokens via SSE", async () => {
    vi.spyOn(chatService, "chatStream").mockImplementation(async (_messages, _fastify, onEvent) => {
      onEvent({ type: "token", content: "Hello" });
      onEvent({ type: "token", content: " world" });
      return { content: "Hello world" };
    });
    const app = await buildApp([{ id: "sess-1", user_id: "u1", title: "Hi", created_at: new Date(), updated_at: new Date() }]);
    const res = await app.inject({
      method: "POST",
      url: "/api/chat/stream",
      payload: { messages: [{ role: "user", content: "Hi" }] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.body).toContain('event: token');
    expect(res.body).toContain('"content":"Hello"');
    expect(res.body).toContain('"content":" world"');
    expect(res.body).toContain('event: done');
  });

  it("streams tool_call and tool_result events", async () => {
    vi.spyOn(chatService, "chatStream").mockImplementation(async (_messages, _fastify, onEvent) => {
      onEvent({ type: "tool_call", name: "count_cis", arguments: {} });
      onEvent({ type: "tool_result", name: "count_cis", result: { total: 5 } });
      return { content: "There are 5 CIs.", toolCalls: [{ call: { id: "c1", type: "function", function: { name: "count_cis", arguments: "{}" } }, result: { total: 5 } }] };
    });
    const app = await buildApp([{ id: "sess-1", user_id: "u1", title: "Hi", created_at: new Date(), updated_at: new Date() }]);
    const res = await app.inject({
      method: "POST",
      url: "/api/chat/stream",
      payload: { messages: [{ role: "user", content: "Count" }] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('event: tool_call');
    expect(res.body).toContain('"name":"count_cis"');
    expect(res.body).toContain('event: tool_result');
    expect(res.body).toContain('"total":5');
  });

  it("returns 400 for missing messages", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/chat/stream",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it("emits error event on chatStream failure", async () => {
    vi.spyOn(chatService, "chatStream").mockImplementation(async (_messages, _fastify, onEvent) => {
      throw new Error("LLM failure");
    });
    const app = await buildApp([{ id: "sess-1", user_id: "u1", title: "Hi", created_at: new Date(), updated_at: new Date() }]);
    const res = await app.inject({
      method: "POST",
      url: "/api/chat/stream",
      payload: { messages: [{ role: "user", content: "Hi" }] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('event: error');
    expect(res.body).toContain("LLM failure");
  });

  it("saves assistant message with tool calls after streaming", async () => {
    vi.spyOn(chatService, "chatStream").mockImplementation(async (_messages, _fastify, onEvent) => {
      onEvent({ type: "token", content: "Result" });
      return {
        content: "Result",
        toolCalls: [{
          call: { id: "call-1", type: "function", function: { name: "count_cis", arguments: "{}" } } as any,
          result: { total: 5 },
        }],
      };
    });
    const app = await buildApp([
      { id: "msg-1", session_id: "sess-1", role: "user", content: "Hi", tool_calls: null, tool_call_id: null, created_at: new Date() },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/chat/stream",
      payload: { messages: [{ role: "user", content: "Count" }], sessionId: "sess-1" },
    });

    expect(res.statusCode).toBe(200);
    expect(app.pg.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO chat_messages"),
      expect.arrayContaining(["sess-1", "assistant", "Result", expect.anything(), null])
    );
  });
});
