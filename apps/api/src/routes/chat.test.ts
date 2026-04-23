import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { chatRoutes } from "../routes/chat";
import * as chatService from "../services/chat";

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function buildApp() {
    const app = Fastify();
    app.decorate("authenticate", async () => {});
    await app.register(chatRoutes);
    return app;
  }

  it("returns assistant response for valid messages", async () => {
    vi.spyOn(chatService, "chat").mockResolvedValue("Hello from AI");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { messages: [{ role: "user", content: "Hi" }] },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.role).toBe("assistant");
    expect(body.content).toBe("Hello from AI");
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
    const app = await buildApp();
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
    const app = await buildApp();
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
