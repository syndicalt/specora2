import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";

describe("API Server", () => {
  it("health check returns ok", async () => {
    const app = Fastify();
    app.get("/health", async () => ({ status: "ok" }));
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: "ok" });
  });
});
