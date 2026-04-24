import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { authRoutes } from "../routes/auth";
import bcrypt from "bcryptjs";

function mockPg(rows: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }),
  } as any;
}

function mockPgForSequence(results: { rows: any[]; rowCount?: number }[]) {
  let callIndex = 0;
  return {
    query: vi.fn().mockImplementation(() => {
      const result = results[callIndex] ?? { rows: [], rowCount: 0 };
      callIndex++;
      return Promise.resolve(result);
    }),
  } as any;
}

async function buildApp(pg?: any, neo4jSession?: any) {
  const app = Fastify();
  app.decorate("pg", pg || mockPg());
  app.decorate("neo4j", { session: () => neo4jSession || { run: vi.fn().mockResolvedValue({ records: [] }), close: vi.fn() } });
  app.decorate("jwt", {
    sign: vi.fn().mockReturnValue("mock-token"),
  });
  app.decorate("authenticate", vi.fn());
  await app.register(authRoutes);
  return app;
}

describe("POST /api/login", () => {
  it("returns token for valid credentials", async () => {
    const hash = await bcrypt.hash("secret123", 10);
    const pg = mockPg([
      { id: "550e8400-e29b-41d4-a716-446655440001", email: "alice@specora.dev", name: "Alice", password_hash: hash },
    ]);
    const app = await buildApp(pg);

    const res = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { email: "alice@specora.dev", password: "secret123" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toBe("mock-token");
    expect(body.user.email).toBe("alice@specora.dev");
  });

  it("returns 401 for wrong password", async () => {
    const hash = await bcrypt.hash("secret123", 10);
    const pg = mockPg([
      { id: "550e8400-e29b-41d4-a716-446655440001", email: "alice@specora.dev", name: "Alice", password_hash: hash },
    ]);
    const app = await buildApp(pg);

    const res = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { email: "alice@specora.dev", password: "wrong" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 401 for missing user", async () => {
    const pg = mockPg([]);
    const app = await buildApp(pg);

    const res = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { email: "nobody@specora.dev", password: "secret" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for missing fields", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { email: "alice@specora.dev" },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/register", () => {
  it("creates a new user and returns token", async () => {
    const pg = mockPgForSequence([
      { rows: [], rowCount: 0 }, // check existing
      { rows: [], rowCount: 1 }, // insert
    ]);
    const app = await buildApp(pg);

    const res = await app.inject({
      method: "POST",
      url: "/api/register",
      payload: { email: "bob@specora.dev", password: "secret", name: "Bob" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toBe("mock-token");
    expect(body.user.name).toBe("Bob");
  });

  it("returns 409 for duplicate email", async () => {
    const pg = mockPg([{ id: "550e8400-e29b-41d4-a716-446655440001" }]);
    const app = await buildApp(pg);

    const res = await app.inject({
      method: "POST",
      url: "/api/register",
      payload: { email: "alice@specora.dev", password: "secret", name: "Alice" },
    });

    expect(res.statusCode).toBe(409);
  });

  it("returns 400 for missing fields", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/register",
      payload: { email: "test@specora.dev" },
    });

    expect(res.statusCode).toBe(400);
  });
});
