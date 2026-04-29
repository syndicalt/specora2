import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import bcrypt from "bcryptjs";
import { createSign, generateKeyPairSync } from "crypto";
import { inflateRawSync } from "zlib";
import { SignedXml } from "xml-crypto";
import { authRoutes } from "../routes/auth";
import { hashRefreshToken } from "../services/authSessions";

class FakePg {
  users: any[];
  sessions: any[] = [];
  handoffs: any[] = [];
  ssoConfigs: any[] = [];
  identityGroups: any[] = [];
  identityMemberships: any[] = [];
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
    if (sql.includes("INSERT INTO identity_groups")) {
      const existing = this.identityGroups.find((item) => item.source === params[3] && item.external_id === params[4]);
      const group = existing || { id: `group-${this.identityGroups.length + 1}`, name: params[0], slug: params[1], description: params[2], source: params[3], external_id: params[4] };
      group.name = params[0];
      if (!existing) this.identityGroups.push(group);
      return { rows: [{ id: group.id }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO identity_group_memberships")) {
      const existing = this.identityMemberships.find((item) => item.group_id === params[0] && item.user_id === params[1]);
      if (!existing) this.identityMemberships.push({ group_id: params[0], user_id: params[1], source: params[2] });
      return { rows: [], rowCount: existing ? 0 : 1 };
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

function signedIdToken(payload: Record<string, unknown>, privateKey: string, kid = "test-key") {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${body}`);
  signer.end();
  return `${header}.${body}.${signer.sign(privateKey, "base64url")}`;
}

const SAML_TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC+kIZB2LHr2k2R
RQVQOsHtMKNLHq2cTfQLl988GWIgECkKP6xAxW6GWTqZ16ELZulcO0qePyyORJcp
J2fJviVejkrHZSU/F9Bziszm7VAfr1z42vno2lyZ+beOkhVPJhVhfq38obNfWR02
2LvzsJXqVO9DWaup5v6SYpR1Pbycp7e+VhQqJP6RgJ6Eo4HxadLxf/gIX94ajqB6
2HpNCZf0avOJF++5DAitqTbLaR1uCihiSSxNbHl5T71jifrOMJasn3ot4CsktxhY
pWBPCSNlfCs+CD9vM3rwf8EUs9YY7eWPyS0ghsX9ICCuH1EBGnOO8RYb6HQPUMdJ
/dePc7xNAgMBAAECggEAQa51n+ds97JQDvR/rtX5tmOPvNoPk7KonYBUoJXNJOj9
BDvLBq4l+Kdzk8fnCZOIdlI3V1DF7ilFApnC452mqq8Xph8+Fb+DCPf7xNJhzfH2
9Q0gmvn8ddPEyR6fup6ROv/bPxqKxR/lelx8d7NTEKgCqa+UA+UKtHDG45wKUOHD
pTY+TBsM0XJErTt60y/OaIt3XwM3GOEsL1RDDPKNfEh0lMTbrj4slid1WhOV8Osc
9xZzSOLK2SVPSCB8cH5j9ShVrMQHy+wzrkCezh9IkgFg76zlEGDOK5BQ1dfVDePk
OIKQZHhaBeWsvZyzCUbi2ufkMrbVsHQ1lNxc5zmk/wKBgQDf1zbsl9BCj+m+36iJ
vRjseVgZbXpjxIXzxl4Bv33wCL/l0cfL5+PIx8d18+8eBpXto3cJRifNUgaofhYf
oYLwD4/UXDHrA/7zWwAcWn18M1+Kfaq8KYr9tE9AdeCuIEH1wdPzE4OTEpYrOYT9
0o3MpGpSr86SdW3BHRsU7p3YAwKBgQDZ8WzCMTIkAtLdUML10Rv+7Zd/Ml6LJdYd
0leMjEfciuCtm6TLN/ToDmirV5xE4duOOqjhN+XsnJrfyLJ7j+zSmN1RoomzQbRh
dakm7xCeIa9XsPt9PWAEvIEN5fYgOnBVjKiQfpL16wYkCwMX0Cln2tmNHMSw0GgE
0fomJOOxbwKBgBE4i380Rs94JvGKX3sJU0uOIlsCczINwoh4sG7N/rBi2/CgbRCg
7INb61qFw9W5h/taYiQSg6lmMCDyYl1Ynaw+ZkBeP3DnQ8wRKjcENzdA9I7BEEud
npXaM2awKvL6hFiV6up+i9bazTbSHAszEbm2xH9MC0Z1RlZfGOBJY1dlAoGBAJHD
XrIipR5gpRdQRJST3t2JmqF/1qvKCoK3g8aErCtc1xhF2Nnx+uKZgHfYiLOpO2bM
5NZ8xFKUCyFQ4c6yW/oeMye+RcqWT0Y/o3peugaJEPTdcdY5jlacnNPm0c6MR0Vw
Zez+Otwu7FR+6PqsRoUnYgl3DDYVrPxMU7nfQkoRAoGAA4VGiAJjgFKW7A2R6Ope
zvzI5UGUBJbLr/M7NuTmfGH72MzZ7tbVgcFwc0M6xalJQ7OppRRiSwZdAxZ+4csL
EyHPHgVWma5G84eeAdJIY7OkTT2DIub7AZ/cf+5TuSw3lN0M9MKgbNQ2Bx81aJZi
qBlxv2F7IdsJ6AVlRVWLR3U=
-----END PRIVATE KEY-----`;

const SAML_TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIDGTCCAgGgAwIBAgIUHgrjBYQFi14xY/uYVbbzA58HHaYwDQYJKoZIhvcNAQEL
BQAwHDEaMBgGA1UEAwwRU3BlY29yYSBTQU1MIFRlc3QwHhcNMjYwNDI3MjMzOTU1
WhcNMjYwNDI4MjMzOTU1WjAcMRowGAYDVQQDDBFTcGVjb3JhIFNBTUwgVGVzdDCC
ASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAL6QhkHYsevaTZFFBVA6we0w
o0serZxN9AuX3zwZYiAQKQo/rEDFboZZOpnXoQtm6Vw7Sp4/LI5ElyknZ8m+JV6O
SsdlJT8X0HOKzObtUB+vXPja+ejaXJn5t46SFU8mFWF+rfyhs19ZHTbYu/OwlepU
70NZq6nm/pJilHU9vJynt75WFCok/pGAnoSjgfFp0vF/+Ahf3hqOoHrYek0Jl/Rq
84kX77kMCK2pNstpHW4KKGJJLE1seXlPvWOJ+s4wlqyfei3gKyS3GFilYE8JI2V8
Kz4IP28zevB/wRSz1hjt5Y/JLSCGxf0gIK4fUQEac47xFhvodA9Qx0n9149zvE0C
AwEAAaNTMFEwHQYDVR0OBBYEFAWh4TF9+hwgrO0ybliEPwq3NkUjMB8GA1UdIwQY
MBaAFAWh4TF9+hwgrO0ybliEPwq3NkUjMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZI
hvcNAQELBQADggEBAKQK9pUhk3S2Ey2xXMpOu7AOwXppEjUiVM6Z0aUUohsuii0n
G48/SsUjJ8Bv5of6K65Hkvw1dGOsEg56tavUpRIRO5h0I7DdrzBvvPuXZsD5m4+P
l9LYOLVPRc/EBV0XcWo+uhkk9tvzduDB6uUsm0zQsrf2NJAAj82Irzb2L5pmeuFG
QFL+djUbKPy5iVFKHNGQRaxgPYsGVzud4gdHYjuVUMMhQNagGQG7fIUSHynBIemq
exAfEku+K1tK2rB3LlcnwDSgT/ixav55snqGAc9MZ51YaaHPNIUImNWNwwBUym/6
EWFsMuKm3Njcdhbd7SvhfLxW6P8T/otoE/ZMdno=
-----END CERTIFICATE-----`;

const SAML_TEST_CERT_BODY = SAML_TEST_CERT
  .replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s+/g, "");

function signSamlAssertion(assertionXml: string, privateKey: string, publicCert: string) {
  const sig = new SignedXml({
    privateKey,
    publicCert,
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
  });
  sig.addReference({
    xpath: "//*[local-name(.)='Assertion']",
    transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"],
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
  });
  sig.computeSignature(assertionXml, { location: { reference: "//*[local-name(.)='Subject']", action: "before" } });
  return sig.getSignedXml();
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
      payload: { email: "bob@specora.dev", password: "secret123", name: "Bob" },
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

  it("starts SAML SSO with a service-provider AuthnRequest", async () => {
    const pg = new FakePg();
    pg.ssoConfigs.push({
      id: "saml-1",
      name: "Google SAML",
      provider: "saml",
      status: "active",
      enforce_sso: true,
      email_domains: ["example.com"],
      idp_sso_url: "https://accounts.google.com/o/saml2/idp?idpid=C01s6h8ff",
      sp_entity_id: "https://specora.test/saml/sp/saml-1",
    });
    const app = await buildApp(pg);

    const res = await app.inject({ method: "GET", url: "/api/auth/sso/saml-1/start?returnTo=/admin" });

    expect(res.statusCode).toBe(302);
    const location = new URL(res.headers.location as string);
    expect(location.origin + location.pathname).toBe("https://accounts.google.com/o/saml2/idp");
    expect(location.searchParams.get("idpid")).toBe("C01s6h8ff");
    expect(location.searchParams.get("RelayState")).toContain("token-saml-state");
    const request = inflateRawSync(Buffer.from(location.searchParams.get("SAMLRequest") || "", "base64")).toString("utf8");
    expect(request).toContain("<samlp:AuthnRequest");
    expect(request).toContain("AssertionConsumerServiceURL=\"http://localhost:4000/api/auth/sso/saml-1/acs\"");
    expect(request).toContain(">https://specora.test/saml/sp/saml-1</saml:Issuer>");
  });

  it("uses forwarded public host for generated SAML service-provider URLs", async () => {
    const pg = new FakePg();
    pg.ssoConfigs.push({
      id: "saml-1",
      name: "Google SAML",
      provider: "saml",
      status: "active",
      idp_sso_url: "https://accounts.google.com/o/saml2/idp?idpid=C01s6h8ff",
    });
    const app = await buildApp(pg);

    const res = await app.inject({
      method: "GET",
      url: "/api/auth/sso/saml-1/start?returnTo=/admin",
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "specora2.specora.org",
      },
    });

    expect(res.statusCode).toBe(302);
    const location = new URL(res.headers.location as string);
    const request = inflateRawSync(Buffer.from(location.searchParams.get("SAMLRequest") || "", "base64")).toString("utf8");
    expect(request).toContain("AssertionConsumerServiceURL=\"https://specora2.specora.org/api/auth/sso/saml-1/acs\"");
    expect(request).toContain(">https://specora2.specora.org/saml/sp/saml-1</saml:Issuer>");
  });

  it("syncs OIDC group claims into identity groups", async () => {
    process.env.TEST_OIDC_SECRET = "secret";
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicJwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
    const idToken = signedIdToken({
      iss: "https://idp.example",
      aud: "client-1",
      sub: "idp-user-1",
      exp: Math.floor(Date.now() / 1000) + 300,
    }, privateKey.export({ format: "pem", type: "pkcs8" }).toString());
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "access-token", id_token: idToken }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: "test-key", use: "sig", alg: "RS256" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        sub: "idp-user-1",
        email: "alice@example.com",
        name: "Alice",
        email_verified: true,
        groups: ["Service Desk", "Change Managers"],
      }), { status: 200 }));
    const pg = new FakePg();
    pg.ssoConfigs.push({
      id: "sso-1",
      name: "Okta",
      provider: "oidc",
      status: "active",
      enforce_sso: true,
      email_domains: ["example.com"],
      token_url: "https://idp.example/token",
      userinfo_url: "https://idp.example/userinfo",
      client_id: "client-1",
      client_secret_ref: "env:TEST_OIDC_SECRET",
      issuer_url: "https://idp.example",
      oidc_jwks_url: "https://idp.example/keys",
      default_role: "operator",
      attribute_mapping: { email: "email", name: "name", groups: "groups" },
    });
    const app = await buildApp(pg);
    const state = Buffer.from(JSON.stringify({ typ: "sso-state", configId: "sso-1", returnTo: "/admin" })).toString("base64url");

    const res = await app.inject({ method: "GET", url: `/api/auth/sso/sso-1/callback?code=abc&state=${state}` });

    expect(res.statusCode).toBe(302);
    expect(pg.identityGroups.map((group) => group.name)).toEqual(["Service Desk", "Change Managers"]);
    expect(pg.identityMemberships).toHaveLength(2);
    fetchMock.mockRestore();
    delete process.env.TEST_OIDC_SECRET;
  });

  it("rejects OIDC callbacks with invalid ID token audience", async () => {
    process.env.TEST_OIDC_SECRET = "secret";
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicJwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
    const idToken = signedIdToken({
      iss: "https://idp.example",
      aud: "other-client",
      sub: "idp-user-1",
      exp: Math.floor(Date.now() / 1000) + 300,
    }, privateKey.export({ format: "pem", type: "pkcs8" }).toString());
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "access-token", id_token: idToken }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: "test-key", use: "sig", alg: "RS256" }] }), { status: 200 }));
    const pg = new FakePg();
    pg.ssoConfigs.push({
      id: "sso-1",
      name: "Okta",
      provider: "oidc",
      status: "active",
      email_domains: ["example.com"],
      token_url: "https://idp.example/token",
      userinfo_url: "https://idp.example/userinfo",
      client_id: "client-1",
      client_secret_ref: "env:TEST_OIDC_SECRET",
      issuer_url: "https://idp.example",
      oidc_jwks_url: "https://idp.example/keys",
      attribute_mapping: { email: "email", name: "name", groups: "groups" },
    });
    const app = await buildApp(pg);
    const state = Buffer.from(JSON.stringify({ typ: "sso-state", configId: "sso-1", returnTo: "/admin" })).toString("base64url");

    const res = await app.inject({ method: "GET", url: `/api/auth/sso/sso-1/callback?code=abc&state=${state}` });

    expect(res.statusCode).toBe(401);
    expect(pg.users).toHaveLength(0);
    fetchMock.mockRestore();
    delete process.env.TEST_OIDC_SECRET;
  });

  it("accepts a valid SAML assertion and creates a login handoff", async () => {
    const pg = new FakePg();
    pg.ssoConfigs.push({
      id: "saml-1",
      name: "Google SAML",
      provider: "saml",
      status: "active",
      enforce_sso: true,
      email_domains: ["example.com"],
      idp_entity_id: "https://accounts.google.com/o/saml2?idpid=C01s6h8ff",
      idp_sso_url: "https://accounts.google.com/o/saml2/idp?idpid=C01s6h8ff",
      idp_cert: SAML_TEST_CERT_BODY,
      sp_entity_id: "http://localhost:4000/saml/sp/saml-1",
      default_role: "operator",
      attribute_mapping: { email: "email", name: "name", groups: "groups" },
    });
    const app = await buildApp(pg);
    const relayState = Buffer.from(JSON.stringify({ typ: "saml-state", configId: "saml-1", returnTo: "/admin" })).toString("base64url");
    const now = Date.now();
    const samlResponse = `
      <samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" Destination="http://localhost:4000/api/auth/sso/saml-1/acs">
        <saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">https://accounts.google.com/o/saml2?idpid=C01s6h8ff</saml:Issuer>
        <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_assertion-1">
          <saml:Subject>
            <saml:NameID>alice@example.com</saml:NameID>
            <saml:SubjectConfirmation>
              <saml:SubjectConfirmationData Recipient="http://localhost:4000/api/auth/sso/saml-1/acs" NotOnOrAfter="${new Date(now + 300000).toISOString()}"/>
            </saml:SubjectConfirmation>
          </saml:Subject>
          <saml:Conditions NotBefore="${new Date(now - 60000).toISOString()}" NotOnOrAfter="${new Date(now + 300000).toISOString()}">
            <saml:AudienceRestriction>
              <saml:Audience>http://localhost:4000/saml/sp/saml-1</saml:Audience>
            </saml:AudienceRestriction>
          </saml:Conditions>
          <saml:AttributeStatement>
            <saml:Attribute Name="email"><saml:AttributeValue>alice@example.com</saml:AttributeValue></saml:Attribute>
            <saml:Attribute Name="name"><saml:AttributeValue>Alice Example</saml:AttributeValue></saml:Attribute>
            <saml:Attribute Name="groups"><saml:AttributeValue>Service Desk</saml:AttributeValue></saml:Attribute>
          </saml:AttributeStatement>
        </saml:Assertion>
      </samlp:Response>`;

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/sso/saml-1/acs",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        SAMLResponse: Buffer.from(signSamlAssertion(samlResponse, SAML_TEST_PRIVATE_KEY, SAML_TEST_CERT), "utf8").toString("base64"),
        RelayState: relayState,
      }).toString(),
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("/login#handoff=");
    expect(pg.users[0]).toMatchObject({ email: "alice@example.com", name: "Alice Example", role: "operator" });
    expect(pg.identityGroups.map((group) => group.name)).toEqual(["Service Desk"]);
    expect(pg.handoffs).toHaveLength(1);
  });

  it("rejects SAML assertions for the wrong service-provider audience", async () => {
    const pg = new FakePg();
    pg.ssoConfigs.push({
      id: "saml-1",
      name: "Google SAML",
      provider: "saml",
      status: "active",
      idp_sso_url: "https://accounts.google.com/o/saml2/idp?idpid=C01s6h8ff",
      idp_cert: SAML_TEST_CERT_BODY,
      sp_entity_id: "http://localhost:4000/saml/sp/saml-1",
    });
    const app = await buildApp(pg);
    const relayState = Buffer.from(JSON.stringify({ typ: "saml-state", configId: "saml-1", returnTo: "/admin" })).toString("base64url");
    const samlResponse = `
      <samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">
        <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_assertion-bad-audience">
          <saml:Subject><saml:NameID>alice@example.com</saml:NameID></saml:Subject>
          <saml:Conditions NotOnOrAfter="${new Date(Date.now() + 300000).toISOString()}">
            <saml:AudienceRestriction><saml:Audience>https://wrong.example/sp</saml:Audience></saml:AudienceRestriction>
          </saml:Conditions>
        </saml:Assertion>
      </samlp:Response>`;

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/sso/saml-1/acs",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        SAMLResponse: Buffer.from(signSamlAssertion(samlResponse, SAML_TEST_PRIVATE_KEY, SAML_TEST_CERT), "utf8").toString("base64"),
        RelayState: relayState,
      }).toString(),
    });

    expect(res.statusCode).toBe(401);
    expect(pg.users).toHaveLength(0);
  });

  it("rejects unsigned SAML assertions", async () => {
    const pg = new FakePg();
    pg.ssoConfigs.push({
      id: "saml-1",
      name: "Google SAML",
      provider: "saml",
      status: "active",
      idp_sso_url: "https://accounts.google.com/o/saml2/idp?idpid=C01s6h8ff",
      idp_cert: SAML_TEST_CERT_BODY,
      sp_entity_id: "http://localhost:4000/saml/sp/saml-1",
    });
    const app = await buildApp(pg);
    const relayState = Buffer.from(JSON.stringify({ typ: "saml-state", configId: "saml-1", returnTo: "/admin" })).toString("base64url");
    const samlResponse = `
      <samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">
        <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_assertion-unsigned">
          <saml:Subject><saml:NameID>alice@example.com</saml:NameID></saml:Subject>
          <saml:Conditions NotOnOrAfter="${new Date(Date.now() + 300000).toISOString()}">
            <saml:AudienceRestriction><saml:Audience>http://localhost:4000/saml/sp/saml-1</saml:Audience></saml:AudienceRestriction>
          </saml:Conditions>
        </saml:Assertion>
      </samlp:Response>`;

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/sso/saml-1/acs",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        SAMLResponse: Buffer.from(samlResponse, "utf8").toString("base64"),
        RelayState: relayState,
      }).toString(),
    });

    expect(res.statusCode).toBe(401);
    expect(pg.users).toHaveLength(0);
  });

  it("rejects tampered signed SAML assertions", async () => {
    const pg = new FakePg();
    pg.ssoConfigs.push({
      id: "saml-1",
      name: "Google SAML",
      provider: "saml",
      status: "active",
      idp_sso_url: "https://accounts.google.com/o/saml2/idp?idpid=C01s6h8ff",
      idp_cert: SAML_TEST_CERT_BODY,
      sp_entity_id: "http://localhost:4000/saml/sp/saml-1",
    });
    const app = await buildApp(pg);
    const relayState = Buffer.from(JSON.stringify({ typ: "saml-state", configId: "saml-1", returnTo: "/admin" })).toString("base64url");
    const samlResponse = `
      <samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">
        <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_assertion-tampered">
          <saml:Subject><saml:NameID>alice@example.com</saml:NameID></saml:Subject>
          <saml:Conditions NotOnOrAfter="${new Date(Date.now() + 300000).toISOString()}">
            <saml:AudienceRestriction><saml:Audience>http://localhost:4000/saml/sp/saml-1</saml:Audience></saml:AudienceRestriction>
          </saml:Conditions>
        </saml:Assertion>
      </samlp:Response>`;
    const tampered = signSamlAssertion(samlResponse, SAML_TEST_PRIVATE_KEY, SAML_TEST_CERT)
      .replace("alice@example.com", "mallory@example.com");

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/sso/saml-1/acs",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        SAMLResponse: Buffer.from(tampered, "utf8").toString("base64"),
        RelayState: relayState,
      }).toString(),
    });

    expect(res.statusCode).toBe(401);
    expect(pg.users).toHaveLength(0);
  });

  it("rejects SAML responses with duplicate assertion IDs", async () => {
    const pg = new FakePg();
    pg.ssoConfigs.push({
      id: "saml-1",
      name: "Google SAML",
      provider: "saml",
      status: "active",
      idp_sso_url: "https://accounts.google.com/o/saml2/idp?idpid=C01s6h8ff",
      idp_cert: SAML_TEST_CERT_BODY,
      sp_entity_id: "http://localhost:4000/saml/sp/saml-1",
    });
    const app = await buildApp(pg);
    const relayState = Buffer.from(JSON.stringify({ typ: "saml-state", configId: "saml-1", returnTo: "/admin" })).toString("base64url");
    const signedResponse = signSamlAssertion(`
      <samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">
        <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_assertion-duplicate">
          <saml:Subject><saml:NameID>alice@example.com</saml:NameID></saml:Subject>
          <saml:Conditions NotOnOrAfter="${new Date(Date.now() + 300000).toISOString()}">
            <saml:AudienceRestriction><saml:Audience>http://localhost:4000/saml/sp/saml-1</saml:Audience></saml:AudienceRestriction>
          </saml:Conditions>
        </saml:Assertion>
      </samlp:Response>`, SAML_TEST_PRIVATE_KEY, SAML_TEST_CERT);
    const wrapped = signedResponse.replace(
      "</samlp:Response>",
      `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_assertion-duplicate">
        <saml:Subject><saml:NameID>mallory@example.com</saml:NameID></saml:Subject>
      </saml:Assertion></samlp:Response>`
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/sso/saml-1/acs",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        SAMLResponse: Buffer.from(wrapped, "utf8").toString("base64"),
        RelayState: relayState,
      }).toString(),
    });

    expect(res.statusCode).toBe(401);
    expect(pg.users).toHaveLength(0);
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
