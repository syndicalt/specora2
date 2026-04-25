import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { emit, eventBusRoutes, safeStringify, subscribe, initializeEventBus } from "./eventBus";
import { broadcast } from "./websocket";

vi.mock("./websocket", () => ({
  broadcast: vi.fn(),
}));

vi.mock("./redis", () => ({
  getRedis: vi.fn(() => null),
  getRedisSubscriber: vi.fn(() => null),
  isRedisAvailable: vi.fn(() => false),
}));

describe("eventBus routes", () => {
  async function buildApp() {
    const events: any[] = [];
    const app = Fastify();
    app.decorate("authenticate", async () => {});
    app.decorate("pg", {
      query: vi.fn().mockImplementation((sql: string, params: any[]) => {
        if (sql.includes("INSERT INTO events")) {
          events.push({ type: params[0], payload: params[1] });
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes("SELECT id, type, payload, created_at FROM events")) {
          return Promise.resolve({
            rows: [
              { id: "1", type: "test.event", payload: '{"foo":"bar"}', created_at: "2024-01-01T00:00:00Z" },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      }),
    });
    await app.register(eventBusRoutes);
    return { app, events };
  }

  it("emits and persists an event", async () => {
    const { app, events } = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/events",
      payload: { type: "test.event", payload: { foo: "bar" } },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(events).toHaveLength(1);
  });

  it("rejects event without type", async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/events",
      payload: { payload: {} },
    });
    expect(res.statusCode).toBe(400);
  });

  it("lists events with filters", async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/events?type=test.event&since=2024-01-01T00:00:00Z",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].type).toBe("test.event");
  });

  it("dispatches local subscribers and websocket broadcasts", async () => {
    const handler = vi.fn();
    const unsubscribe = subscribe("local.event", handler);

    emit("local.event", { value: 1 });
    unsubscribe();
    emit("local.event", { value: 2 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ value: 1 });
    expect(broadcast).toHaveBeenCalledWith("local.event", { value: 1 });
  });

  it("safeStringify handles circular payloads", () => {
    const payload: any = { name: "root" };
    payload.self = payload;

    expect(safeStringify(payload)).toContain("[Circular]");
  });

  it("initializeEventBus exits when Redis subscriber is unavailable", () => {
    expect(() => initializeEventBus()).not.toThrow();
  });
});
