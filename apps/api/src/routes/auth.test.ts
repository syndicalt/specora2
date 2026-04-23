import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { authRoutes } from "../routes/auth";
import bcrypt from "bcryptjs";

function mockNeo4jSession(records: any[] = []) {
  return {
    run: vi.fn().mockResolvedValue({ records }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

async function buildApp(neo4jSession?: any) {
  const app = Fastify();
  app.decorate("neo4j", { session: () => neo4jSession || mockNeo4jSession() });
  app.decorate("jwt", {
    sign: vi.fn().mockReturnValue("mock-token"),
  });
  await app.register(authRoutes);
  return app;
}

describe("POST /api/login", () => {
  it("returns token for valid credentials", async () => {
    const hash = await bcrypt.hash("secret123", 10);
    const session = mockNeo4jSession([
      { get: (k: string) => k === "u" ? { properties: { id: "usr-1", email: "alice@specora.dev", passwordHash: hash, name: "Alice" } } : undefined },
    ]);
    const app = await buildApp(session);

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
    const session = mockNeo4jSession([
      { get: (k: string) => k === "u" ? { properties: { id: "usr-1", email: "alice@specora.dev", passwordHash: hash, name: "Alice" } } : undefined },
    ]);
    const app = await buildApp(session);

    const res = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { email: "alice@specora.dev", password: "wrong" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 401 for missing user", async () => {
    const session = mockNeo4jSession([]);
    const app = await buildApp(session);

    const res = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { email: "nobody@specora.dev", password: "secret" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 401 when user has no passwordHash", async () => {
    const session = mockNeo4jSession([
      { get: (k: string) => k === "u" ? { properties: { id: "usr-1", email: "alice@specora.dev", name: "Alice" } } : undefined },
    ]);
    const app = await buildApp(session);

    const res = await app.inject({
      method: "POST",
      url: "/api/login",
      payload: { email: "alice@specora.dev", password: "secret" },
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
    const session = mockNeo4jSession([]); // no existing user
    const app = await buildApp(session);

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
    const session = mockNeo4jSession([{ get: () => ({ id: "usr-1" }) }]);
    const app = await buildApp(session);

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
