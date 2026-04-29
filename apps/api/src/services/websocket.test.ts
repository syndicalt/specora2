import { describe, it, expect, vi, beforeEach } from "vitest";
import { broadcast, closeAllConnections, getConnectionCount } from "./websocket";

function mockSocketStream() {
  const sent: string[] = [];
  const closed = { code: undefined as number | undefined, reason: undefined as string | undefined };
  return {
    socket: {
      send: vi.fn((data: string) => { sent.push(data); }),
      close: vi.fn((code?: number, reason?: string) => { closed.code = code; closed.reason = reason; }),
      on: vi.fn(),
    } as any,
    sent,
    closed,
  };
}

describe("websocket service", () => {
  beforeEach(() => {
    closeAllConnections();
  });

  it("broadcast sends to subscribed clients", async () => {
    const c1 = mockSocketStream();
    const c2 = mockSocketStream();
    // Import websocketRoutes to register connections via route handler
    // Instead, we test indirectly by importing the module which shares state
    const { websocketRoutes } = await import("./websocket");
    const app = (await import("fastify")).default();
    app.decorate("jwt", { verify: vi.fn(() => ({ id: "u1", type: "ws-ticket" })) });
    await app.register((await import("@fastify/websocket")).default);
    await app.register(websocketRoutes);

    const address = await app.listen({ port: 0 });
    const port = (app.server.address() as any).port;
    const ticket = "valid-ticket";

    const WebSocket = (await import("ws")).default;
    const ws1 = new WebSocket(`ws://localhost:${port}/api/events/live?ticket=${ticket}`);
    const ws2 = new WebSocket(`ws://localhost:${port}/api/events/live?ticket=${ticket}`);

    await new Promise<void>((resolve) => {
      let connected = 0;
      const onOpen = () => {
        connected++;
        if (connected === 2) resolve();
      };
      ws1.on("open", onOpen);
      ws2.on("open", onOpen);
    });

    // Subscribe ws1 to test.event, ws2 to other.event
    ws1.send(JSON.stringify({ action: "subscribe", types: ["test.event"] }));
    ws2.send(JSON.stringify({ action: "subscribe", types: ["other.event"] }));

    await new Promise((r) => setTimeout(r, 50));

    broadcast("test.event", { msg: "hello" });

    await new Promise((r) => setTimeout(r, 50));

    const ws1Messages = [] as any[];
    const ws2Messages = [] as any[];
    ws1.on("message", (data: any) => ws1Messages.push(JSON.parse(data.toString())));
    ws2.on("message", (data: any) => ws2Messages.push(JSON.parse(data.toString())));

    // Re-broadcast after attaching listeners
    broadcast("test.event", { msg: "hello" });
    broadcast("other.event", { msg: "world" });

    await new Promise((r) => setTimeout(r, 50));

    expect(ws1Messages.some((m) => m.type === "test.event")).toBe(true);
    expect(ws1Messages.some((m) => m.type === "other.event")).toBe(false);
    expect(ws2Messages.some((m) => m.type === "other.event")).toBe(true);

    ws1.close();
    ws2.close();
    await app.close();
  });

  it("getConnectionCount returns 0 when no connections", () => {
    expect(getConnectionCount()).toBe(0);
  });

  it("streams subscribed events over SSE", async () => {
    const { websocketRoutes } = await import("./websocket");
    const app = (await import("fastify")).default();
    app.decorate("jwt", { verify: vi.fn(() => ({ id: "u1", type: "ws-ticket" })) });
    await app.register((await import("@fastify/websocket")).default);
    await app.register(websocketRoutes);

    await app.listen({ port: 0 });
    const port = (app.server.address() as any).port;
    const controller = new AbortController();
    const response = await fetch(`http://localhost:${port}/api/events/stream?ticket=tok&types=test.event`, {
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    expect(getConnectionCount()).toBe(1);

    broadcast("other.event", { ignored: true });
    broadcast("test.event", { msg: "hello" });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let received = "";
    const deadline = Date.now() + 1000;
    while (!received.includes("\"test.event\"") && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      received += decoder.decode(value);
    }

    controller.abort();
    expect(received).toContain("\"type\":\"test.event\"");
    expect(received).toContain("\"msg\":\"hello\"");
    expect(received).not.toContain("\"other.event\"");

    await app.close();
  });

  it("closeAllConnections clears all clients", async () => {
    const { websocketRoutes } = await import("./websocket");
    const app = (await import("fastify")).default();
    app.decorate("jwt", { verify: vi.fn(() => ({ id: "u1", type: "ws-ticket" })) });
    await app.register((await import("@fastify/websocket")).default);
    await app.register(websocketRoutes);

    const address = await app.listen({ port: 0 });
    const port = (app.server.address() as any).port;
    const WebSocket = (await import("ws")).default;
    const ws = new WebSocket(`ws://localhost:${port}/api/events/live?ticket=tok`);

    await new Promise<void>((resolve) => ws.on("open", resolve));
    expect(getConnectionCount()).toBe(1);

    closeAllConnections();
    expect(getConnectionCount()).toBe(0);

    await app.close();
  });
});
