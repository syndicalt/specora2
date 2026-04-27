import { describe, it, expect, vi, beforeAll } from "vitest";
import Fastify from "fastify";
import { healthRoutes } from "./health";

vi.mock("../services/aiRuleGenerator", () => ({
  generateRules: vi.fn(() =>
    Promise.resolve([
      { name: "Test Rule", cypher: "MATCH (n) RETURN n.id as ciId", explanation: "test" },
    ])
  ),
  executeGeneratedRule: vi.fn(() =>
    Promise.resolve([{ ciId: "x-1", ciName: "X", ciClass: "Server" }])
  ),
}));

describe("healthRoutes", () => {
  async function buildApp() {
    const app = Fastify();
    app.decorate("authenticate", async () => {});
    app.decorate("pg", {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM jobs") && sql.includes("GROUP BY status")) return { rows: [{ status: "pending", count: 1 }] };
        if (sql.includes("status = 'running'")) return { rows: [{ count: 0 }] };
        if (sql.includes("status = 'failed'")) return { rows: [{ count: 0 }] };
        if (sql.includes("FROM discovery_jobs")) return { rows: [] };
        return { rows: [{ ok: 1 }] };
      }),
    });
    app.decorate("neo4j", {
      session: vi.fn().mockReturnValue({
        run: vi.fn().mockResolvedValue({ records: [] }),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    });
    // Fastify already has a log property; override methods instead
    Object.assign(app.log, { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() });
    await app.register(healthRoutes);
    return app;
  }

  it("lists hardcoded rule definitions", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/health/rules/definitions" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]).toHaveProperty("id");
    expect(body[0]).toHaveProperty("name");
  });

  it("reports runtime readiness", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/health/ready" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "postgres", status: "ok" }),
      expect.objectContaining({ name: "neo4j", status: "ok" }),
    ]));
  });

  it("reports production configuration posture", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/health/config" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "JWT_SECRET_STRENGTH" }),
    ]));
  });

  it("reports worker and queue posture", async () => {
    const previous = process.env.WORKER_GRPC_HOST;
    delete process.env.WORKER_GRPC_HOST;
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/health/worker" });
    if (previous) process.env.WORKER_GRPC_HOST = previous;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toMatchObject({
      status: "warn",
      grpc: { name: "worker.grpc", status: "warn" },
      signals: { deadLetter: 0, staleRunning: 0, failedDiscovery: 0 },
    });
  });

  it("runs hardcoded rules", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/health/rules" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toHaveProperty("totalRules");
    expect(body).toHaveProperty("violationCount");
    expect(body).toHaveProperty("violations");
  });

  it("runs a specific rule by ID", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/health/rules/bs-missing-app/run",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toHaveProperty("violations");
  });

  it("returns 404 for unknown rule", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/health/rules/unknown/run",
    });
    expect(res.statusCode).toBe(404);
  });

  it("generates AI rules", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/health/rules/generate",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.rules).toHaveLength(1);
    expect(body.rules[0].name).toBe("Test Rule");
  });

  it("executes a generated rule", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/health/rules/execute",
      payload: { cypher: "MATCH (n) RETURN n.id as ciId" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.violations).toHaveLength(1);
  });

  it("rejects execution without cypher", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/health/rules/execute",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
