import { describe, it, expect, vi } from "vitest";
import { jobQueueRoutes } from "./jobQueue";
import Fastify from "fastify";
import jwt from "@fastify/jwt";
import { authPlugin } from "../plugins/jwt";

describe("jobQueueRoutes", () => {
  async function buildApp(queryImpl?: (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number }>) {
    const app = Fastify();
    await app.register(jwt, { secret: "test-secret" });
    app.decorate("pg", {
      query: queryImpl || vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    });
    await app.register(authPlugin);
    await app.register(jobQueueRoutes);
    return app;
  }

  function authHeader(app: Fastify.FastifyInstance) {
    const token = app.jwt.sign({ id: "user-1", email: "test@test.com", role: "admin" });
    return { Authorization: `Bearer ${token}` };
  }

  it("POST /api/jobs enqueues a job", async () => {
    const app = await buildApp((sql: string) => {
      if (sql.includes("INSERT INTO jobs")) {
        return Promise.resolve({
          rows: [{
            id: "job-1", type: "scan", payload: { target: "all" }, status: "pending",
            priority: 1, retries: 0, max_retries: 3, error_message: null, worker_id: null,
            started_at: null, completed_at: null, created_at: "2024-01-01", updated_at: "2024-01-01",
          }],
          rowCount: 1,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/jobs",
      headers: { ...authHeader(app), "Content-Type": "application/json" },
      payload: { type: "scan", payload: { target: "all" }, priority: 1 },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.id).toBe("job-1");
    expect(body.type).toBe("scan");
  });

  it("POST /api/jobs rejects missing type or payload", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/jobs",
      headers: { ...authHeader(app), "Content-Type": "application/json" },
      payload: { type: "scan" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /api/jobs lists jobs", async () => {
    const app = await buildApp((sql: string) => {
      if (sql.includes("FROM jobs WHERE")) {
        return Promise.resolve({
          rows: [{
            id: "job-1", type: "scan", payload: {}, status: "pending",
            priority: 0, retries: 0, max_retries: 3, error_message: null, worker_id: null,
            started_at: null, completed_at: null, created_at: "2024-01-01", updated_at: "2024-01-01",
          }],
          rowCount: 1,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/jobs?status=pending",
      headers: authHeader(app),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.jobs).toHaveLength(1);
  });

  it("GET /api/jobs/summary returns queue posture", async () => {
    const calls = [
      { rows: [{ status: "pending", count: 2 }], rowCount: 1 },
      { rows: [{ count: 1 }], rowCount: 1 },
      { rows: [{ count: 0 }], rowCount: 1 },
    ];
    const app = await buildApp(vi.fn().mockImplementation(() => Promise.resolve(calls.shift() || { rows: [], rowCount: 0 })));
    const res = await app.inject({
      method: "GET",
      url: "/api/jobs/summary?staleAfterMinutes=15",
      headers: authHeader(app),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toMatchObject({ staleAfterMinutes: 15, staleRunning: 1 });
  });

  it("GET /api/jobs/dead-letter returns permanently failed jobs", async () => {
    const app = await buildApp((sql: string) => {
      if (sql.includes("status = 'failed'")) {
        return Promise.resolve({
          rows: [{
            id: "job-1", type: "scan", payload: {}, status: "failed",
            priority: 0, retries: 3, max_retries: 3, error_message: "boom", worker_id: null,
            started_at: null, completed_at: null, created_at: "2024-01-01", updated_at: "2024-01-01",
          }],
          rowCount: 1,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const res = await app.inject({ method: "GET", url: "/api/jobs/dead-letter", headers: authHeader(app) });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).jobs[0].status).toBe("failed");
  });

  it("POST /api/jobs/requeue-stale requeues stale running jobs", async () => {
    const app = await buildApp((sql: string) => {
      if (sql.includes("WITH stale AS")) {
        return Promise.resolve({
          rows: [{
            id: "job-1", type: "scan", payload: {}, status: "pending",
            priority: 0, retries: 1, max_retries: 3, error_message: "Requeued after stale running timeout", worker_id: null,
            started_at: null, completed_at: null, created_at: "2024-01-01", updated_at: "2024-01-01",
          }],
          rowCount: 1,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/jobs/requeue-stale",
      headers: { ...authHeader(app), "Content-Type": "application/json" },
      payload: { staleAfterMinutes: 15, limit: 10 },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).jobs).toHaveLength(1);
  });

  it("GET /api/jobs/:id returns a job", async () => {
    const app = await buildApp((sql: string) => {
      if (sql.includes("FROM jobs WHERE id = $1")) {
        return Promise.resolve({
          rows: [{
            id: "job-1", type: "scan", payload: {}, status: "pending",
            priority: 0, retries: 0, max_retries: 3, error_message: null, worker_id: null,
            started_at: null, completed_at: null, created_at: "2024-01-01", updated_at: "2024-01-01",
          }],
          rowCount: 1,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/jobs/job-1",
      headers: authHeader(app),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.id).toBe("job-1");
  });

  it("GET /api/jobs/:id returns 404 for missing job", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/jobs/missing",
      headers: authHeader(app),
    });
    expect(res.statusCode).toBe(404);
  });
});
