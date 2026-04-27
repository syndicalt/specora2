import { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "crypto";
import { issueAuthTokens, listUserSessions, revokeRefreshToken, revokeUserSession, rotateRefreshToken } from "../services/authSessions";
import { recordAuditEvent } from "../services/auditLog";

type OAuthProfile = {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  raw: Record<string, unknown>;
};

type SsoConfig = {
  id: string;
  name: string;
  provider: "saml" | "oidc";
  enforce_sso?: boolean;
  authorization_url?: string;
  token_url?: string;
  userinfo_url?: string;
  client_id?: string;
  client_secret_ref?: string;
  issuer_url?: string;
  scopes?: string[];
  idp_sso_url?: string;
  jit_enabled?: boolean;
  default_role?: string;
  attribute_mapping?: { email?: string; name?: string; groups?: string };
};

const WEB_PUBLIC_URL = process.env.WEB_PUBLIC_URL || process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000";
const API_PUBLIC_URL = process.env.API_PUBLIC_URL || (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/graphql").replace("/graphql", "");
const OAUTH_DEFAULT_ROLE = process.env.OAUTH_DEFAULT_ROLE || "user";
const AUTH_HANDOFF_TTL_MS = Number(process.env.AUTH_HANDOFF_TTL_SECONDS || 90) * 1000;

function hashCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

function safeReturnPath(returnTo?: string) {
  if (!returnTo) return "/";
  try {
    if (returnTo.startsWith("/")) return returnTo.startsWith("//") ? "/" : returnTo;
    const target = new URL(returnTo);
    const web = new URL(WEB_PUBLIC_URL);
    return target.origin === web.origin ? `${target.pathname}${target.search}${target.hash}` : "/";
  } catch {
    return "/";
  }
}

function webUrl(path: string) {
  const url = new URL(safeReturnPath(path), WEB_PUBLIC_URL);
  return url;
}

function resolveSecret(ref?: string | null) {
  if (!ref) return "";
  if (ref.startsWith("env:")) return process.env[ref.slice(4)] || "";
  return process.env[ref] || "";
}

function configuredOAuthProviders() {
  return [
    { id: "google", name: "Google", configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) },
    { id: "github", name: "GitHub", configured: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) },
  ];
}

function providerRedirectUri(provider: string) {
  return `${API_PUBLIC_URL}/api/auth/oauth/${provider}/callback`;
}

function authUrl(provider: string, state: string) {
  if (provider === "google") {
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      redirect_uri: providerRedirectUri(provider),
      response_type: "code",
      scope: "openid email profile",
      state,
      access_type: "offline",
      prompt: "select_account",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }
  if (provider === "github") {
    const params = new URLSearchParams({
      client_id: process.env.GITHUB_CLIENT_ID || "",
      redirect_uri: providerRedirectUri(provider),
      scope: "read:user user:email",
      state,
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }
  return null;
}

async function exchangeOAuthCode(provider: string, code: string): Promise<OAuthProfile> {
  if (provider === "google") {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID || "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
        code,
        grant_type: "authorization_code",
        redirect_uri: providerRedirectUri(provider),
      }),
    });
    if (!tokenResponse.ok) throw new Error("Google token exchange failed");
    const tokens = await tokenResponse.json() as { access_token?: string };
    const userResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token || ""}` },
    });
    if (!userResponse.ok) throw new Error("Google profile fetch failed");
    const profile = await userResponse.json() as any;
    return {
      id: String(profile.sub),
      email: String(profile.email || ""),
      name: String(profile.name || profile.email || "Google User"),
      emailVerified: profile.email_verified === true,
      raw: profile,
    };
  }

  if (provider === "github") {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GITHUB_CLIENT_ID || "",
        client_secret: process.env.GITHUB_CLIENT_SECRET || "",
        code,
        redirect_uri: providerRedirectUri(provider),
      }),
    });
    if (!tokenResponse.ok) throw new Error("GitHub token exchange failed");
    const tokens = await tokenResponse.json() as { access_token?: string };
    const [userResponse, emailResponse] = await Promise.all([
      fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${tokens.access_token || ""}`, Accept: "application/vnd.github+json" } }),
      fetch("https://api.github.com/user/emails", { headers: { Authorization: `Bearer ${tokens.access_token || ""}`, Accept: "application/vnd.github+json" } }),
    ]);
    if (!userResponse.ok || !emailResponse.ok) throw new Error("GitHub profile fetch failed");
    const user = await userResponse.json() as any;
    const emails = await emailResponse.json() as any[];
    const primary = emails.find((email) => email.primary) || emails[0];
    return {
      id: String(user.id),
      email: String(primary?.email || user.email || ""),
      name: String(user.name || user.login || primary?.email || "GitHub User"),
      emailVerified: primary?.verified === true,
      raw: { user, emails },
    };
  }

  throw new Error("Unsupported OAuth provider");
}

async function auditAuth(fastify: FastifyInstance, input: { actorId?: string | null; action: string; entityId: string; metadata?: Record<string, unknown> }) {
  try {
    await recordAuditEvent(fastify, {
      actorId: input.actorId,
      action: input.action,
      entityType: "AuthSession",
      entityId: input.entityId,
      metadata: input.metadata,
    });
  } catch (error) {
    fastify.log.warn({ err: error }, "auth audit event could not be recorded");
  }
}

async function discoverSsoConfig(fastify: FastifyInstance, email?: string) {
  const domain = email?.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  const result = await fastify.pg.query(
    `SELECT id, name, provider, enforce_sso, authorization_url, client_id, scopes, idp_sso_url
     FROM sso_configs
     WHERE status = 'active'
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(email_domains) AS domain WHERE lower(domain) = $1
       )
     ORDER BY enforce_sso DESC, created_at DESC
     LIMIT 1`,
    [domain]
  );
  return result.rows[0] || null;
}

async function loadSsoConfig(fastify: FastifyInstance, id: string): Promise<SsoConfig | null> {
  const result = await fastify.pg.query(
    `SELECT id, name, provider, enforce_sso, authorization_url, token_url, userinfo_url, client_id,
            client_secret_ref, issuer_url, scopes, idp_sso_url, jit_enabled, default_role, attribute_mapping
     FROM sso_configs
     WHERE id = $1 AND status = 'active'`,
    [id]
  );
  return result.rows[0] || null;
}

async function upsertOAuthUser(fastify: FastifyInstance, provider: string, profile: OAuthProfile) {
  if (!profile.email || !profile.emailVerified) throw new Error("OAuth account must expose a verified email");

  const existingAccount = await fastify.pg.query(
    `SELECT u.id, u.name, u.email, u.role
     FROM oauth_accounts oa
     JOIN users u ON u.id = oa.user_id
     WHERE oa.provider = $1 AND oa.provider_account_id = $2`,
    [provider, profile.id]
  );
  if (existingAccount.rows[0]) return existingAccount.rows[0];

  const existingUser = await fastify.pg.query("SELECT id, name, email, role FROM users WHERE lower(email) = lower($1)", [profile.email]);
  const user = existingUser.rows[0] || {
    id: randomUUID(),
    name: profile.name,
    email: profile.email,
    role: OAUTH_DEFAULT_ROLE,
  };
  if (!existingUser.rows[0]) {
    await fastify.pg.query(
      "INSERT INTO users (id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, $5)",
      [user.id, user.email, user.name, `oauth:${provider}:${randomBytes(16).toString("hex")}`, user.role]
    );
  }
  await fastify.pg.query(
    `INSERT INTO oauth_accounts (user_id, provider, provider_account_id, email, email_verified, profile)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (provider, provider_account_id) DO UPDATE SET
       email = EXCLUDED.email,
       email_verified = EXCLUDED.email_verified,
       profile = EXCLUDED.profile,
       updated_at = NOW()`,
    [user.id, provider, profile.id, profile.email, profile.emailVerified, JSON.stringify(profile.raw)]
  );
  return user;
}

async function upsertFederatedUser(fastify: FastifyInstance, provider: string, profile: OAuthProfile, defaultRole = "user") {
  if (!profile.email || !profile.emailVerified) throw new Error("Federated account must expose a verified email");
  const existingUser = await fastify.pg.query("SELECT id, name, email, role FROM users WHERE lower(email) = lower($1)", [profile.email]);
  const user = existingUser.rows[0] || {
    id: randomUUID(),
    name: profile.name,
    email: profile.email,
    role: defaultRole || "user",
  };
  if (!existingUser.rows[0]) {
    await fastify.pg.query(
      "INSERT INTO users (id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, $5)",
      [user.id, user.email, user.name, `sso:${provider}:${randomBytes(16).toString("hex")}`, user.role]
    );
  }
  await fastify.pg.query(
    `INSERT INTO oauth_accounts (user_id, provider, provider_account_id, email, email_verified, profile)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (provider, provider_account_id) DO UPDATE SET
       email = EXCLUDED.email,
       email_verified = EXCLUDED.email_verified,
       profile = EXCLUDED.profile,
       updated_at = NOW()`,
    [user.id, provider, profile.id, profile.email, profile.emailVerified, JSON.stringify(profile.raw)]
  );
  return user;
}

async function createAuthHandoff(fastify: FastifyInstance, issued: Awaited<ReturnType<typeof issueAuthTokens>>, options: { returnTo?: string; provider: string }) {
  const code = randomBytes(32).toString("base64url");
  await fastify.pg.query(
    `INSERT INTO auth_handoffs (code_hash, access_token, refresh_token, return_to, provider, user_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      hashCode(code),
      issued.token,
      issued.refreshToken,
      safeReturnPath(options.returnTo),
      options.provider,
      issued.user.id,
      new Date(Date.now() + AUTH_HANDOFF_TTL_MS).toISOString(),
    ]
  );
  return code;
}

async function exchangeOidcCode(config: SsoConfig, code: string): Promise<OAuthProfile> {
  if (!config.token_url || !config.userinfo_url || !config.client_id) {
    throw new Error("OIDC provider is missing token URL, userinfo URL, or client ID");
  }
  const clientSecret = resolveSecret(config.client_secret_ref);
  if (!clientSecret) throw new Error("OIDC client secret reference could not be resolved");
  const tokenResponse = await fetch(config.token_url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${API_PUBLIC_URL}/api/auth/sso/${config.id}/callback`,
      client_id: config.client_id,
      client_secret: clientSecret,
    }),
  });
  if (!tokenResponse.ok) throw new Error("OIDC token exchange failed");
  const tokens = await tokenResponse.json() as { access_token?: string; id_token?: string };
  if (!tokens.access_token) throw new Error("OIDC token response did not include an access token");
  const userResponse = await fetch(config.userinfo_url, {
    headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: "application/json" },
  });
  if (!userResponse.ok) throw new Error("OIDC userinfo fetch failed");
  const profile = await userResponse.json() as Record<string, any>;
  const mapping = config.attribute_mapping || {};
  const emailKey = mapping.email || "email";
  const nameKey = mapping.name || "name";
  return {
    id: String(profile.sub || profile[emailKey]),
    email: String(profile[emailKey] || ""),
    name: String(profile[nameKey] || profile[emailKey] || "SSO User"),
    emailVerified: profile.email_verified !== false,
    raw: { ...profile, idTokenPresent: Boolean(tokens.id_token) },
  };
}

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post("/api/login", {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: "1 minute",
        keyGenerator: (req: any) => req.ip,
      },
    },
  }, async (request, reply) => {
    const body = request.body as { email?: string; password?: string };
    if (!body.email || !body.password) {
      return reply.status(400).send({ error: "email and password required" });
    }

    const enforcedSso = await discoverSsoConfig(fastify, body.email);
    if (enforcedSso?.enforce_sso) {
      await auditAuth(fastify, { action: "auth.login.failed", entityId: body.email, metadata: { reason: "sso_required", ssoConfigId: enforcedSso.id } });
      return reply.status(403).send({ error: "SSO is required for this email domain", ssoRequired: true, startUrl: `${API_PUBLIC_URL}/api/auth/sso/${enforcedSso.id}/start` });
    }

    const result = await fastify.pg.query(
      "SELECT id, name, email, password_hash, role FROM users WHERE lower(email) = lower($1)",
      [body.email]
    );
    const user = result.rows[0];
    if (!user) {
      await auditAuth(fastify, { action: "auth.login.failed", entityId: body.email, metadata: { reason: "missing_user" } });
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(body.password, user.password_hash || "");
    if (!valid) {
      await auditAuth(fastify, { actorId: user.id, action: "auth.login.failed", entityId: user.id, metadata: { reason: "bad_password" } });
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    const issued = await issueAuthTokens(fastify, user, request);
    await auditAuth(fastify, { actorId: user.id, action: "auth.login.success", entityId: user.id, metadata: { method: "password" } });
    return issued;
  });

  fastify.post("/api/register", async (request, reply) => {
    const body = request.body as { email?: string; password?: string; name?: string };
    if (!body.email || !body.password || !body.name) {
      return reply.status(400).send({ error: "email, password, and name required" });
    }

    const existing = await fastify.pg.query("SELECT id FROM users WHERE lower(email) = lower($1)", [body.email]);
    if (existing.rows.length > 0) {
      return reply.status(409).send({ error: "User already exists" });
    }

    const id = randomUUID();
    const passwordHash = await bcrypt.hash(body.password, 10);

    await fastify.pg.query(
      "INSERT INTO users (id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, $5)",
      [id, body.email, body.name, passwordHash, "operator"]
    );

    const session = fastify.neo4j.session();
    try {
      await session.run(
        `CREATE (u:User:ConfigurationItem {id: $ciId, name: $name, email: $email, class: 'User', userId: $userId})`,
        { ciId: `usr-${id.slice(0, 8)}`, name: body.name, email: body.email, userId: id }
      );
    } finally {
      await session.close();
    }

    const issued = await issueAuthTokens(fastify, { id, email: body.email, name: body.name, role: "operator" }, request);
    await auditAuth(fastify, { actorId: id, action: "auth.register.success", entityId: id, metadata: { method: "password" } });
    return issued;
  });

  fastify.post("/api/auth/refresh", async (request, reply) => {
    const body = request.body as { refreshToken?: string };
    if (!body.refreshToken) return reply.status(400).send({ error: "refreshToken required" });
    const issued = await rotateRefreshToken(fastify, body.refreshToken, request);
    if (!issued) return reply.status(401).send({ error: "Invalid refresh token" });
    return issued;
  });

  fastify.post("/api/auth/logout", async (request) => {
    const body = request.body as { refreshToken?: string } | undefined;
    if (body?.refreshToken) await revokeRefreshToken(fastify, body.refreshToken, "logout");
    return { ok: true };
  });

  fastify.get("/api/auth/sessions", { onRequest: [fastify.authenticate] }, async (request) => {
    const user = request.user as { id: string };
    return { sessions: await listUserSessions(fastify, user.id) };
  });

  fastify.delete("/api/auth/sessions/:id", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user as { id: string };
    const params = request.params as { id: string };
    const revoked = await revokeUserSession(fastify, user.id, params.id, "user_revoked");
    if (!revoked) return reply.status(404).send({ error: "Session not found" });
    return { ok: true };
  });

  fastify.get("/api/auth/oauth/providers", async () => ({
    providers: configuredOAuthProviders().filter((provider) => provider.configured),
  }));

  fastify.get("/api/auth/oauth/:provider/start", async (request, reply) => {
    const params = request.params as { provider: string };
    const provider = configuredOAuthProviders().find((item) => item.id === params.provider && item.configured);
    if (!provider) return reply.status(404).send({ error: "OAuth provider is not configured" });
    const query = request.query as { returnTo?: string };
    const state = await fastify.jwt.sign({ typ: "oauth-state", provider: provider.id, returnTo: safeReturnPath(query.returnTo) }, { expiresIn: "10m" });
    const url = authUrl(provider.id, state);
    if (!url) return reply.status(404).send({ error: "OAuth provider is not supported" });
    return reply.redirect(url);
  });

  fastify.get("/api/auth/oauth/:provider/callback", async (request, reply) => {
    const params = request.params as { provider: string };
    const query = request.query as { code?: string; state?: string };
    if (!query.code || !query.state) return reply.status(400).send({ error: "code and state required" });
    let state: any;
    try {
      state = await fastify.jwt.verify(query.state);
    } catch {
      return reply.status(400).send({ error: "Invalid OAuth state" });
    }
    if (state.typ !== "oauth-state" || state.provider !== params.provider) return reply.status(400).send({ error: "Invalid OAuth state" });
    const profile = await exchangeOAuthCode(params.provider, query.code);
    const user = await upsertOAuthUser(fastify, params.provider, profile);
    const issued = await issueAuthTokens(fastify, user, request);
    await auditAuth(fastify, { actorId: user.id, action: "auth.login.success", entityId: user.id, metadata: { method: `oauth:${params.provider}` } });
    const code = await createAuthHandoff(fastify, issued, { returnTo: state.returnTo, provider: `oauth:${params.provider}` });
    const redirect = webUrl("/login");
    redirect.hash = new URLSearchParams({ handoff: code }).toString();
    return reply.redirect(redirect.toString());
  });

  fastify.post("/api/auth/handoff", async (request, reply) => {
    const body = request.body as { code?: string };
    if (!body.code) return reply.status(400).send({ error: "code required" });
    const result = await fastify.pg.query(
      `UPDATE auth_handoffs
       SET used_at = NOW()
       WHERE code_hash = $1
         AND used_at IS NULL
         AND expires_at > NOW()
       RETURNING access_token, refresh_token, return_to, provider, user_id`,
      [hashCode(body.code)]
    );
    const handoff = result.rows[0];
    if (!handoff) {
      await auditAuth(fastify, { action: "auth.handoff.invalid", entityId: hashCode(body.code).slice(0, 12), metadata: { reason: "missing_expired_or_used" } });
      return reply.status(401).send({ error: "Invalid auth handoff" });
    }
    await auditAuth(fastify, { actorId: handoff.user_id, action: "auth.handoff.exchanged", entityId: handoff.user_id, metadata: { provider: handoff.provider } });
    return {
      token: handoff.access_token,
      refreshToken: handoff.refresh_token,
      returnTo: safeReturnPath(handoff.return_to),
    };
  });

  fastify.get("/api/auth/sso/discover", async (request) => {
    const query = request.query as { email?: string };
    const config = await discoverSsoConfig(fastify, query.email);
    if (!config) return { sso: false };
    return { sso: true, provider: config.provider, name: config.name, enforceSso: config.enforce_sso, startUrl: `${API_PUBLIC_URL}/api/auth/sso/${config.id}/start` };
  });

  fastify.get("/api/auth/sso/:id/start", async (request, reply) => {
    const params = request.params as { id: string };
    const query = request.query as { returnTo?: string };
    const config = await loadSsoConfig(fastify, params.id);
    if (!config) return reply.status(404).send({ error: "SSO provider is not configured" });
    if (config.provider === "oidc") {
      if (!config.authorization_url || !config.client_id) return reply.status(400).send({ error: "OIDC provider is missing authorization URL or client ID" });
      const state = await fastify.jwt.sign({ typ: "sso-state", configId: params.id, returnTo: safeReturnPath(query.returnTo) }, { expiresIn: "10m" });
      const url = new URL(config.authorization_url);
      url.searchParams.set("client_id", config.client_id);
      url.searchParams.set("redirect_uri", `${API_PUBLIC_URL}/api/auth/sso/${params.id}/callback`);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", Array.isArray(config.scopes) ? config.scopes.join(" ") : "openid email profile");
      url.searchParams.set("state", state);
      return reply.redirect(url.toString());
    }
    if (!config.idp_sso_url) return reply.status(400).send({ error: "SAML provider is missing IdP SSO URL" });
    const url = new URL(config.idp_sso_url);
    url.searchParams.set("RelayState", query.returnTo || WEB_PUBLIC_URL);
    return reply.redirect(url.toString());
  });

  fastify.get("/api/auth/sso/:id/callback", async (request, reply) => {
    const params = request.params as { id: string };
    const query = request.query as { code?: string; state?: string; error?: string };
    if (query.error) {
      await auditAuth(fastify, { action: "auth.sso.failed", entityId: params.id, metadata: { reason: query.error } });
      return reply.status(401).send({ error: "SSO provider returned an error" });
    }
    if (!query.code || !query.state) return reply.status(400).send({ error: "code and state required" });
    let state: any;
    try {
      state = await fastify.jwt.verify(query.state);
    } catch {
      await auditAuth(fastify, { action: "auth.sso.failed", entityId: params.id, metadata: { reason: "invalid_state" } });
      return reply.status(400).send({ error: "Invalid SSO state" });
    }
    if (state.typ !== "sso-state" || state.configId !== params.id) return reply.status(400).send({ error: "Invalid SSO state" });
    const config = await loadSsoConfig(fastify, params.id);
    if (!config || config.provider !== "oidc") return reply.status(404).send({ error: "OIDC provider is not configured" });
    try {
      const profile = await exchangeOidcCode(config, query.code);
      if (config.jit_enabled === false) {
        const existing = await fastify.pg.query("SELECT id, name, email, role FROM users WHERE lower(email) = lower($1)", [profile.email]);
        if (!existing.rows[0]) return reply.status(403).send({ error: "JIT user creation is disabled for this provider" });
      }
      const user = await upsertFederatedUser(fastify, `sso:${params.id}`, profile, config.default_role || "user");
      const issued = await issueAuthTokens(fastify, user, request);
      await auditAuth(fastify, { actorId: user.id, action: "auth.login.success", entityId: user.id, metadata: { method: "sso:oidc", ssoConfigId: params.id } });
      const code = await createAuthHandoff(fastify, issued, { returnTo: state.returnTo, provider: `sso:${params.id}` });
      const redirect = webUrl("/login");
      redirect.hash = new URLSearchParams({ handoff: code }).toString();
      return reply.redirect(redirect.toString());
    } catch (err: any) {
      await auditAuth(fastify, { action: "auth.sso.failed", entityId: params.id, metadata: { reason: err.message || "callback_failed" } });
      return reply.status(401).send({ error: "SSO login failed" });
    }
  });

  fastify.post("/api/auth/sso/:id/acs", async (request, reply) => {
    const params = request.params as { id: string };
    await auditAuth(fastify, { action: "auth.sso.failed", entityId: params.id, metadata: { reason: "saml_acs_not_configured" } });
    return reply.status(501).send({ error: "SAML assertion validation is not enabled in this build" });
  });

  fastify.post("/api/ws-ticket", { onRequest: [fastify.authenticate] }, async (request) => {
    const user = request.user as { id: string };
    const ticket = await fastify.jwt.sign({ id: user.id, type: "ws-ticket" }, { expiresIn: "60s" });
    return { ticket };
  });
}
