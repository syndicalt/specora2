import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import bcrypt from "bcryptjs";
import { authRoutes } from "../routes/auth";
import { hashRefreshToken } from "../services/authSessions";

class FakePg {
  users: any[];
  sessions: any[] = [];
  handoffs: any[] = [];
  ssoConfigs: any[] = [];
  audit: any[] = [];

  constructor(users: any[] = []) {
    this.users = users;
  }

  query = vi.fn(async (sql: string, params: any[] = []) => {
    if (sql.includes("FROM users WHERE lower(email)")) {
      const email = String(params[0]).toLowerCase();
      const user = this.users.find((item) => item.email.toLowerCase() === email);
      return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
    }
    if (sql.includes("INSERT INTO users")) {
      const user = { id: params[0], email: params[1], name: params[2], password_hash: params[3], role: params[4] };
      this.users.push(user);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO auth_sessions")) {
      this.sessions.push({
        id: params[0],
        user_id: params[1],
        refresh_token_hash: params[2],
        refresh_token_family: params[3],
        access_jti: params[4],
        user_agent: params[5],
        ip_address: params[6],
        expires_at: params[7],
        last_used_at: new Date().toISOString(),
        revoked_at: null,
        revoked_reason: null,
        created_at: new Date().toISOString(),
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("FROM auth_sessions s") && sql.includes("JOIN users u")) {
      const session = this.sessions.find((item) => item.refresh_token_hash === params[0]);
      const user = session ? this.users.find((item) => item.id === session.user_id) : null;
      return {
        rows: session && user ? [{
          id: session.id,
          user_id: session.user_id,
          refresh_token_family: session.refresh_token_family,
          revoked_at: session.revoked_at,
          expires_at: session.expires_at,
          email: user.email,
          name: user.name,
          role: user.role,
        }] : [],
        rowCount: session && user ? 1 : 0,
      };
    }
    if (sql.includes("WHERE refresh_token_family = $1")) {
      this.sessions
        .filter((item) => item.refresh_token_family === params[0])
        .forEach((item) => {
          item.revoked_at = item.revoked_at || new Date().toISOString();
          item.revoked_reason = item.revoked_reason || "refresh_reuse";
        });
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("WHERE id = $1") && sql.includes("revoked_reason = 'rotated'")) {
      const session = this.sessions.find((item) => item.id === params[0]);
      if (session) {
        session.revoked_at = new Date().toISOString();
        session.revoked_reason = "rotated";
      }
      return { rows: [], rowCount: session ? 1 : 0 };
    }
    if (sql.includes("WHERE id = $1") && sql.includes("revoked_reason = 'expired'")) {
      const session = this.sessions.find((item) => item.id === params[0]);
      if (session) {
        session.revoked_at = new Date().toISOString();
        session.revoked_reason = "expired";
      }
      return { rows: [], rowCount: session ? 1 : 0 };
    }
    if (sql.includes("WHERE refresh_token_hash = $1 RETURNING id, user_id")) {
      const session = this.sessions.find((item) => item.refresh_token_hash === params[0]);
      if (session) {
        session.revoked_at = session.revoked_at || new Date().toISOString();
        session.revoked_reason = session.revoked_reason || params[1];
      }
      return { rows: session ? [{ id: session.id, user_id: session.user_id }] : [], rowCount: session ? 1 : 0 };
    }
    if (sql.includes("WHERE id = $1 AND user_id = $2 RETURNING id")) {
      const session = this.sessions.find((item) => item.id === params[0] && item.user_id === params[1]);
      if (session) {
        session.revoked_at = session.revoked_at || new Date().toISOString();
        session.revoked_reason = session.revoked_reason || params[2];
      }
      return { rows: session ? [{ id: session.id }] : [], rowCount: session ? 1 : 0 };
    }
    if (sql.includes("SELECT id FROM auth_sessions WHERE refresh_token_hash")) {
      const session = this.sessions.find((item) => item.refresh_token_hash === params[0]);
      return { rows: session ? [{ id: session.id }] : [], rowCount: session ? 1 : 0 };
    }
    if (sql.includes("FROM auth_sessions") && sql.includes("WHERE user_id = $1")) {
      return { rows: this.sessions.filter((item) => item.user_id === params[0]), rowCount: this.sessions.length };
    }
    if (sql.includes("INSERT INTO auth_handoffs")) {
      this.handoffs.push({
        code_hash: params[0],
        access_token: params[1],
        refresh_token: params[2],
        return_to: params[3],
        provider: params[4],
        user_id: params[5],
        expires_at: params[6],
        used_at: null,
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("UPDATE auth_handoffs")) {
      const handoff = this.handoffs.find((item) =>
        item.code_hash === params[0] &&
        !item.used_at &&
        new Date(item.expires_at).getTime() > Date.now()
      );
      if (handoff) handoff.used_at = new Date().toISOString();
      return {
        rows: handoff ? [{
          access_token: handoff.access_token,
          refresh_token: handoff.refresh_token,
          return_to: handoff.return_to,
          provider: handoff.provider,
          user_id: handoff.user_id,
        }] : [],
        rowCount: handoff ? 1 : 0,
      };
    }
    if (sql.includes("FROM sso_configs")) {
      if (sql.includes("WHERE id = $1")) {
        const config = this.ssoConfigs.find((item) => item.id === params[0] && item.status === "active");
        return { rows: config ? [config] : [], rowCount: config ? 1 : 0 };
      }
      const domain = params[0];
      const config = this.ssoConfigs.find((item) => item.status === "active" && item.email_domains?.includes(domain));
      return { rows: config ? [config] : [], rowCount: config ? 1 : 0 };
    }
    if (sql.includes("SELECT entry_hash FROM audit_log")) return { rows: [], rowCount: 0 };
    if (sql.includes("INSERT INTO audit_log")) {
      this.audit.push(params);
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
}

async function buildApp(pg: FakePg, user: any = { id: "550e8400-e29b-41d4-a716-446655440001", email: "alice@specora.dev", role: "operator" }) {
  const app = Fastify();
  app.decorate("pg", pg as any);
  app.decorate("neo4j", { session: () => ({ run: vi.fn().mockResolvedValue({ records: [] }), close: vi.fn() }) });
  app.decorate("jwt", {
    sign: vi.fn(async (payload: any) => `token-${payload.sid || payload.type || payload.typ || "access"}-${payload.jti || ""}`),
    verify: vi.fn(async (token: string) => JSON.parse(Buffer.from(token, "base64url").toString("utf8"))),
  });
  app.decorate("authenticate", vi.fn(async (request: any) => {
    request.user = user;
  }));
  await app.register(authRoutes);
  return app;
}

describe("auth routes", () => {
  it("logs in with short-lived access token and opaque refresh token", async () => {
    const hash = await bcrypt.hash("secret123", 10);
    const pg = new FakePg([{ id: "550e8400-e29b-41d4-a716-446655440001", email: "alice@specora.dev", name: "Alice", password_hash: hash, role: "operator" }]);
    const app = await buildApp(pg);

    const res = await app.inject({ method: "POST", url: "/api/login", payload: { email: "alice@specora.dev", password: "secret123" } });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toContain("token-");
    expect(body.refreshToken).toEqual(expect.any(String));
    expect(body.expiresIn).toBe(900);
    expect(pg.sessions).toHaveLength(1);
    expect(pg.sessions[0].refresh_token_hash).toBe(hashRefreshToken(body.refreshToken));
  });

  it("rejects invalid credentials and audits the failure", async () => {
    const hash = await bcrypt.hash("secret123", 10);
    const pg = new FakePg([{ id: "550e8400-e29b-41d4-a716-446655440001", email: "alice@specora.dev", name: "Alice", password_hash: hash, role: "operator" }]);
    const app = await buildApp(pg);

    const res = await app.inject({ method: "POST", url: "/api/login", payload: { email: "alice@specora.dev", password: "wrong" } });

    expect(res.statusCode).toBe(401);
    expect(pg.audit.some((entry) => entry.includes("auth.login.failed"))).toBe(true);
  });

  it("blocks password login when SSO is enforced for the email domain", async () => {
    const hash = await bcrypt.hash("secret123", 10);
    const pg = new FakePg([{ id: "550e8400-e29b-41d4-a716-446655440001", email: "alice@example.com", name: "Alice", password_hash: hash, role: "operator" }]);
    pg.ssoConfigs.push({
      id: "sso-1",
      name: "Okta",
      provider: "oidc",
      status: "active",
      enforce_sso: true,
      email_domains: ["example.com"],
      authorization_url: "https://idp.example/authorize",
      client_id: "client-1",
      scopes: ["openid", "email", "profile"],
    });
    const app = await buildApp(pg);

    const res = await app.inject({ method: "POST", url: "/api/login", payload: { email: "alice@example.com", password: "secret123" } });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.ssoRequired).toBe(true);
    expect(body.startUrl).toContain("/api/auth/sso/sso-1/start");
  });

  it("rotates refresh tokens and rejects reuse of the old token", async () => {
    const hash = await bcrypt.hash("secret123", 10);
    const pg = new FakePg([{ id: "550e8400-e29b-41d4-a716-446655440001", email: "alice@specora.dev", name: "Alice", password_hash: hash, role: "operator" }]);
    const app = await buildApp(pg);
    const login = await app.inject({ method: "POST", url: "/api/login", payload: { email: "alice@specora.dev", password: "secret123" } });
    const first = JSON.parse(login.body);

    const refresh = await app.inject({ method: "POST", url: "/api/auth/refresh", payload: { refreshToken: first.refreshToken } });
    expect(refresh.statusCode).toBe(200);
    const rotated = JSON.parse(refresh.body);
    expect(rotated.refreshToken).not.toBe(first.refreshToken);
    expect(pg.sessions).toHaveLength(2);
    expect(pg.sessions[0].revoked_reason).toBe("rotated");

    const reuse = await app.inject({ method: "POST", url: "/api/auth/refresh", payload: { refreshToken: first.refreshToken } });
    expect(reuse.statusCode).toBe(401);
    expect(pg.sessions.every((session) => session.revoked_at)).toBe(true);
    expect(pg.audit.some((entry) => entry.includes("auth.refresh.reuse_detected"))).toBe(true);
  });

  it("rejects expired refresh sessions", async () => {
    const hash = await bcrypt.hash("secret123", 10);
    const pg = new FakePg([{ id: "550e8400-e29b-41d4-a716-446655440001", email: "alice@specora.dev", name: "Alice", password_hash: hash, role: "operator" }]);
    const app = await buildApp(pg);
    const login = await app.inject({ method: "POST", url: "/api/login", payload: { email: "alice@specora.dev", password: "secret123" } });
    const first = JSON.parse(login.body);
    pg.sessions[0].expires_at = new Date(Date.now() - 1000).toISOString();

    const refresh = await app.inject({ method: "POST", url: "/api/auth/refresh", payload: { refreshToken: first.refreshToken } });

    expect(refresh.statusCode).toBe(401);
    expect(pg.sessions[0].revoked_reason).toBe("expired");
  });

  it("lists, revokes, and logs out sessions", async () => {
    const hash = await bcrypt.hash("secret123", 10);
    const user = { id: "550e8400-e29b-41d4-a716-446655440001", email: "alice@specora.dev", role: "operator" };
    const pg = new FakePg([{ ...user, name: "Alice", password_hash: hash }]);
    const app = await buildApp(pg, user);
    const login = await app.inject({ method: "POST", url: "/api/login", payload: { email: "alice@specora.dev", password: "secret123" } });
    const body = JSON.parse(login.body);

    const sessions = await app.inject({ method: "GET", url: "/api/auth/sessions" });
    expect(sessions.statusCode).toBe(200);
    expect(JSON.parse(sessions.body).sessions).toHaveLength(1);

    const revoke = await app.inject({ method: "DELETE", url: `/api/auth/sessions/${pg.sessions[0].id}` });
    expect(revoke.statusCode).toBe(200);
    expect(pg.sessions[0].revoked_reason).toBe("user_revoked");

    const logout = await app.inject({ method: "POST", url: "/api/auth/logout", payload: { refreshToken: body.refreshToken } });
    expect(logout.statusCode).toBe(200);
  });

  it("creates a user with refresh-backed auth during registration", async () => {
    const pg = new FakePg();
    const app = await buildApp(pg);

    const res = await app.inject({
      method: "POST",
      url: "/api/register",
      payload: { email: "bob@specora.dev", password: "secret", name: "Bob" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.refreshToken).toEqual(expect.any(String));
    expect(pg.users[0].email).toBe("bob@specora.dev");
    expect(pg.sessions).toHaveLength(1);
  });

  it("exchanges auth handoff codes exactly once", async () => {
    const hash = await bcrypt.hash("secret123", 10);
    const pg = new FakePg([{ id: "550e8400-e29b-41d4-a716-446655440001", email: "alice@specora.dev", name: "Alice", password_hash: hash, role: "operator" }]);
    const app = await buildApp(pg);
    await (app as any).pg.query(
      `INSERT INTO auth_handoffs (code_hash, access_token, refresh_token, return_to, provider, user_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [hashRefreshToken("handoff-code"), "access", "refresh", "/cmdb", "oauth:google", "550e8400-e29b-41d4-a716-446655440001", new Date(Date.now() + 60000).toISOString()]
    );

    const first = await app.inject({ method: "POST", url: "/api/auth/handoff", payload: { code: "handoff-code" } });
    expect(first.statusCode).toBe(200);
    expect(JSON.parse(first.body)).toMatchObject({ token: "access", refreshToken: "refresh", returnTo: "/cmdb" });

    const second = await app.inject({ method: "POST", url: "/api/auth/handoff", payload: { code: "handoff-code" } });
    expect(second.statusCode).toBe(401);
  });

  it("starts OIDC SSO with provider-specific callback state", async () => {
    const pg = new FakePg();
    pg.ssoConfigs.push({
      id: "sso-1",
      name: "Okta",
      provider: "oidc",
      status: "active",
      enforce_sso: true,
      email_domains: ["example.com"],
      authorization_url: "https://idp.example/authorize",
      client_id: "client-1",
      scopes: ["openid", "email"],
    });
    const app = await buildApp(pg);

    const res = await app.inject({ method: "GET", url: "/api/auth/sso/sso-1/start?returnTo=https://evil.test/phish" });

    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    expect(location).toContain("https://idp.example/authorize");
    expect(location).toContain("redirect_uri=http%3A%2F%2Flocalhost%3A4000%2Fapi%2Fauth%2Fsso%2Fsso-1%2Fcallback");
    expect(location).toContain("client_id=client-1");
  });
});

describe("POST /api/ws-ticket", () => {
  it("returns a short-lived websocket ticket", async () => {
    const pg = new FakePg();
    const app = await buildApp(pg);

    const res = await app.inject({ method: "POST", url: "/api/ws-ticket" });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ticket).toContain("token-ws-ticket");
    expect((app as any).jwt.sign).toHaveBeenCalledWith({ id: "550e8400-e29b-41d4-a716-446655440001", type: "ws-ticket" }, { expiresIn: "60s" });
  });
});
