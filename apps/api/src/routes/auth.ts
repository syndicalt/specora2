import { FastifyInstance, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "crypto";
import { deflateRawSync } from "zlib";
import { issueAuthTokens, listUserSessions, revokeRefreshToken, revokeUserSession, rotateRefreshToken } from "../services/authSessions";
import { recordAuditEvent } from "../services/auditLog";
import { clearPermissionCache } from "../services/rbac";

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
  idp_entity_id?: string;
  idp_sso_url?: string;
  idp_cert?: string;
  sp_entity_id?: string;
  jit_enabled?: boolean;
  default_role?: string;
  attribute_mapping?: { email?: string; name?: string; groups?: string };
};

const WEB_PUBLIC_URL = process.env.WEB_PUBLIC_URL || process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000";
const CONFIGURED_API_PUBLIC_URL = process.env.API_PUBLIC_URL || process.env.NEXT_PUBLIC_API_URL?.replace("/graphql", "");
const DEFAULT_API_PUBLIC_URL = "http://localhost:4000";
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

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function publicApiUrl(request?: FastifyRequest) {
  if (CONFIGURED_API_PUBLIC_URL) return CONFIGURED_API_PUBLIC_URL.replace(/\/$/, "");
  const host = headerValue(request?.headers["x-forwarded-host"]) || headerValue(request?.headers.host);
  if (host && !host.startsWith("localhost:") && !host.startsWith("127.0.0.1:")) {
    const proto = headerValue(request?.headers["x-forwarded-proto"]) || "https";
    return `${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`.replace(/\/$/, "");
  }
  return DEFAULT_API_PUBLIC_URL;
}

function samlSpEntityId(config: SsoConfig, apiBase = publicApiUrl()) {
  return config.sp_entity_id || `${apiBase}/saml/sp/${config.id}`;
}

function samlAcsUrl(config: SsoConfig, apiBase = publicApiUrl()) {
  return `${apiBase}/api/auth/sso/${config.id}/acs`;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveSecret(ref?: string | null) {
  if (!ref) return "";
  if (ref.startsWith("env:")) return process.env[ref.slice(4)] || "";
  return process.env[ref] || "";
}

function slugifyIdentityGroup(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "group";
}

function readMappedClaim(source: Record<string, unknown>, path?: string) {
  if (!path) return undefined;
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, source);
}

function normalizeGroupClaims(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function configuredOAuthProviders() {
  return [
    { id: "google", name: "Google", configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) },
    { id: "github", name: "GitHub", configured: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) },
  ];
}

function providerRedirectUri(provider: string) {
  return `${publicApiUrl()}/api/auth/oauth/${provider}/callback`;
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
            client_secret_ref, issuer_url, scopes, idp_entity_id, idp_sso_url, idp_cert, sp_entity_id,
            jit_enabled, default_role, attribute_mapping
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

async function syncFederatedGroups(fastify: FastifyInstance, userId: string, config: SsoConfig, profile: OAuthProfile) {
  const mapping = config.attribute_mapping || {};
  const groupNames = normalizeGroupClaims(readMappedClaim(profile.raw, mapping.groups || "groups"));
  if (!groupNames.length) return;

  const source = `sso:${config.id}`;
  for (const groupName of groupNames) {
    const slug = `${slugifyIdentityGroup(source)}-${slugifyIdentityGroup(groupName)}`.slice(0, 120);
    const group = await fastify.pg.query(
      `INSERT INTO identity_groups (name, slug, description, source, external_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (source, external_id) DO UPDATE SET
         name = EXCLUDED.name,
         updated_at = NOW()
       RETURNING id`,
      [groupName, slug, `Federated group from ${config.name}`, source, groupName]
    );
    const groupId = group.rows[0]?.id;
    if (!groupId) continue;
    await fastify.pg.query(
      `INSERT INTO identity_group_memberships (group_id, user_id, source)
       VALUES ($1, $2, $3)
       ON CONFLICT (group_id, user_id) DO UPDATE SET source = EXCLUDED.source`,
      [groupId, userId, source]
    );
  }
  clearPermissionCache();
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
      redirect_uri: `${publicApiUrl()}/api/auth/sso/${config.id}/callback`,
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

function buildSamlAuthnRequest(config: SsoConfig, apiBase = publicApiUrl()) {
  if (!config.idp_sso_url) throw new Error("SAML provider is missing IdP SSO URL");
  const requestId = `_${randomUUID()}`;
  const xml = [
    `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="${escapeXml(requestId)}" Version="2.0" IssueInstant="${new Date().toISOString()}" Destination="${escapeXml(config.idp_sso_url)}" AssertionConsumerServiceURL="${escapeXml(samlAcsUrl(config, apiBase))}" ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">`,
    `<saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${escapeXml(samlSpEntityId(config, apiBase))}</saml:Issuer>`,
    `<samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/>`,
    `</samlp:AuthnRequest>`,
  ].join("");
  return deflateRawSync(Buffer.from(xml, "utf8")).toString("base64");
}

function xmlAttribute(block: string, name: string) {
  return block.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"))?.[1];
}

function xmlText(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<[^>]*${escapeRegExp(tag)}\\b[^>]*>([\\s\\S]*?)</[^>]*${escapeRegExp(tag)}>`, "i"));
  if (!match) return undefined;
  return decodeXmlEntities(match[1].replace(/<[^>]+>/g, "").trim());
}

function xmlFirstTag(xml: string, tag: string) {
  return xml.match(new RegExp(`<[^>]*${escapeRegExp(tag)}\\b[^>]*>`, "i"))?.[0];
}

function xmlTagBlocks(xml: string, tag: string) {
  return [...xml.matchAll(new RegExp(`<[^>]*${escapeRegExp(tag)}\\b[^>]*>[\\s\\S]*?</[^>]*${escapeRegExp(tag)}>`, "gi"))].map((match) => match[0]);
}

function samlAttributeValues(xml: string, names: string[]) {
  for (const name of names.filter(Boolean)) {
    const pattern = new RegExp(`<[^>]*Attribute\\b[^>]*(?:Name|FriendlyName)=["']${escapeRegExp(name)}["'][^>]*>([\\s\\S]*?)</[^>]*Attribute>`, "i");
    const match = xml.match(pattern);
    if (!match) continue;
    const values = [...match[1].matchAll(/<[^>]*AttributeValue\b[^>]*>([\s\S]*?)<\/[^>]*AttributeValue>/gi)]
      .map((value) => decodeXmlEntities(value[1].replace(/<[^>]+>/g, "").trim()))
      .filter(Boolean);
    if (values.length) return values;
  }
  return [];
}

function validateSamlTime(value?: string, mode: "notBefore" | "notOnOrAfter" = "notOnOrAfter") {
  if (!value) return;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) throw new Error("SAML assertion has an invalid timestamp");
  const skewMs = 5 * 60 * 1000;
  if (mode === "notBefore" && timestamp > Date.now() + skewMs) throw new Error("SAML assertion is not yet valid");
  if (mode === "notOnOrAfter" && timestamp <= Date.now() - skewMs) throw new Error("SAML assertion has expired");
}

function parseSamlProfile(config: SsoConfig, encodedResponse: string, apiBase = publicApiUrl()): OAuthProfile {
  const xml = Buffer.from(encodedResponse, "base64").toString("utf8");
  if (!xml.includes("Assertion")) throw new Error("SAML response did not include an assertion");

  const responseTag = xmlFirstTag(xml, "Response") || "";
  const responseDestination = xmlAttribute(responseTag, "Destination");
  if (responseDestination && responseDestination !== samlAcsUrl(config, apiBase)) throw new Error("SAML response destination does not match this service provider");

  const issuer = xmlText(xml, "Issuer");
  if (config.idp_entity_id && issuer && issuer !== config.idp_entity_id) throw new Error("SAML issuer does not match the configured IdP");

  const audienceValues = xmlTagBlocks(xml, "Audience").map((block) => decodeXmlEntities(block.replace(/<[^>]+>/g, "").trim())).filter(Boolean);
  if (audienceValues.length && !audienceValues.includes(samlSpEntityId(config, apiBase))) throw new Error("SAML audience does not match this service provider");

  const conditionsTag = xmlFirstTag(xml, "Conditions") || "";
  validateSamlTime(xmlAttribute(conditionsTag, "NotBefore"), "notBefore");
  validateSamlTime(xmlAttribute(conditionsTag, "NotOnOrAfter"), "notOnOrAfter");

  const confirmationTag = xmlFirstTag(xml, "SubjectConfirmationData") || "";
  const recipient = xmlAttribute(confirmationTag, "Recipient");
  if (recipient && recipient !== samlAcsUrl(config, apiBase)) throw new Error("SAML recipient does not match this service provider");
  validateSamlTime(xmlAttribute(confirmationTag, "NotOnOrAfter"), "notOnOrAfter");

  const mapping = config.attribute_mapping || {};
  const email = samlAttributeValues(xml, [
    mapping.email || "",
    "email",
    "Email",
    "mail",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
  ])[0] || xmlText(xml, "NameID") || "";
  const name = samlAttributeValues(xml, [
    mapping.name || "",
    "name",
    "displayName",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
  ])[0] || email || "SAML User";
  const groups = samlAttributeValues(xml, [
    mapping.groups || "",
    "groups",
    "Groups",
    "memberOf",
    "http://schemas.xmlsoap.org/claims/Group",
  ]);
  if (!email || !email.includes("@")) throw new Error("SAML assertion must include an email address");

  return {
    id: xmlText(xml, "NameID") || email,
    email,
    name,
    emailVerified: true,
    raw: { issuer, email, name, groups, samlResponsePresent: true },
  };
}

export async function authRoutes(fastify: FastifyInstance) {
  fastify.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });

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
      return reply.status(403).send({ error: "SSO is required for this email domain", ssoRequired: true, startUrl: `${publicApiUrl(request)}/api/auth/sso/${enforcedSso.id}/start` });
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
    return { sso: true, provider: config.provider, name: config.name, enforceSso: config.enforce_sso, startUrl: `${publicApiUrl(request)}/api/auth/sso/${config.id}/start` };
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
      url.searchParams.set("redirect_uri", `${publicApiUrl(request)}/api/auth/sso/${params.id}/callback`);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", Array.isArray(config.scopes) ? config.scopes.join(" ") : "openid email profile");
      url.searchParams.set("state", state);
      return reply.redirect(url.toString());
    }
    if (!config.idp_sso_url) return reply.status(400).send({ error: "SAML provider is missing IdP SSO URL" });
    const apiBase = publicApiUrl(request);
    const state = await fastify.jwt.sign({ typ: "saml-state", configId: params.id, returnTo: safeReturnPath(query.returnTo) }, { expiresIn: "10m" });
    const url = new URL(config.idp_sso_url);
    url.searchParams.set("SAMLRequest", buildSamlAuthnRequest(config, apiBase));
    url.searchParams.set("RelayState", state);
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
      await syncFederatedGroups(fastify, user.id, config, profile);
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
    const body = request.body as { SAMLResponse?: string; RelayState?: string };
    if (!body?.SAMLResponse || !body?.RelayState) return reply.status(400).send({ error: "SAMLResponse and RelayState required" });
    let state: any;
    try {
      state = await fastify.jwt.verify(body.RelayState);
    } catch {
      await auditAuth(fastify, { action: "auth.sso.failed", entityId: params.id, metadata: { reason: "invalid_saml_state" } });
      return reply.status(400).send({ error: "Invalid SAML state" });
    }
    if (state.typ !== "saml-state" || state.configId !== params.id) return reply.status(400).send({ error: "Invalid SAML state" });
    const config = await loadSsoConfig(fastify, params.id);
    if (!config || config.provider !== "saml") return reply.status(404).send({ error: "SAML provider is not configured" });
    try {
      const profile = parseSamlProfile(config, body.SAMLResponse, publicApiUrl(request));
      if (config.jit_enabled === false) {
        const existing = await fastify.pg.query("SELECT id, name, email, role FROM users WHERE lower(email) = lower($1)", [profile.email]);
        if (!existing.rows[0]) return reply.status(403).send({ error: "JIT user creation is disabled for this provider" });
      }
      const user = await upsertFederatedUser(fastify, `sso:${params.id}`, profile, config.default_role || "user");
      await syncFederatedGroups(fastify, user.id, config, profile);
      const issued = await issueAuthTokens(fastify, user, request);
      await auditAuth(fastify, { actorId: user.id, action: "auth.login.success", entityId: user.id, metadata: { method: "sso:saml", ssoConfigId: params.id } });
      const code = await createAuthHandoff(fastify, issued, { returnTo: state.returnTo, provider: `sso:${params.id}` });
      const redirect = webUrl("/login");
      redirect.hash = new URLSearchParams({ handoff: code }).toString();
      return reply.redirect(redirect.toString());
    } catch (err: any) {
      await auditAuth(fastify, { action: "auth.sso.failed", entityId: params.id, metadata: { reason: err.message || "saml_acs_failed" } });
      return reply.status(401).send({ error: "SAML login failed" });
    }
  });

  fastify.post("/api/ws-ticket", { onRequest: [fastify.authenticate] }, async (request) => {
    const user = request.user as { id: string };
    const ticket = await fastify.jwt.sign({ id: user.id, type: "ws-ticket" }, { expiresIn: "60s" });
    return { ticket };
  });
}
