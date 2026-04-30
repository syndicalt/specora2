import type { FastifyInstance } from "fastify";
import { requirePermission } from "../../services/rbac";
import { recordAuditEvent } from "../../services/auditLog";

const API_PUBLIC_URL = process.env.API_PUBLIC_URL || (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/graphql").replace("/graphql", "");

type SsoProvider = "saml" | "oidc";
type SsoStatus = "active" | "inactive";
type AttributeMapping = { email: string; name: string; groups: string };
type SsoConfigInput = {
  name?: string;
  provider?: SsoProvider;
  status?: SsoStatus;
  emailDomains?: string[];
  idpEntityId?: string;
  idpSsoUrl?: string;
  idpCert?: string;
  spEntityId?: string;
  metadataUrl?: string;
  metadataXml?: string;
  clientId?: string;
  clientSecretRef?: string;
  issuerUrl?: string;
  oidcJwksUrl?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  userinfoUrl?: string;
  scopes?: string[];
  enforceSso?: boolean;
  jitEnabled?: boolean;
  defaultRole?: string;
  attributeMapping?: AttributeMapping;
  idpCertPresent?: boolean;
  metadataXmlPresent?: boolean;
};
type SsoConfigDbRow = {
  id: string;
  name: string;
  provider: SsoProvider;
  status: SsoStatus;
  email_domains?: unknown;
  idp_entity_id?: string | null;
  idp_sso_url?: string | null;
  idp_cert?: string | null;
  sp_entity_id?: string | null;
  metadata_url?: string | null;
  metadata_xml?: string | null;
  jit_enabled?: boolean;
  client_id?: string | null;
  client_secret_ref?: string | null;
  issuer_url?: string | null;
  oidc_jwks_url?: string | null;
  authorization_url?: string | null;
  token_url?: string | null;
  userinfo_url?: string | null;
  scopes?: unknown;
  enforce_sso?: boolean;
  default_role?: string | null;
  attribute_mapping?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

function normalizeStringArray(value: unknown, fallback: string[] = []) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\n]/)
      : fallback;
  return Array.from(new Set(raw.map((item) => String(item).trim()).filter(Boolean)));
}

function persistedStringArray(value: unknown, fallback: string[] = []) {
  if (Array.isArray(value)) return normalizeStringArray(value, fallback);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return normalizeStringArray(parsed, fallback);
    } catch {
      return normalizeStringArray(value, fallback);
    }
  }
  return fallback;
}

function persistedAttributeMapping(value: unknown): AttributeMapping {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value || "{}");
    } catch {
      parsed = {};
    }
  }
  const source = objectValue(parsed);
  return {
    email: String(source.email || "email"),
    name: String(source.name || "name"),
    groups: String(source.groups || "groups"),
  };
}

function parseSamlMetadata(metadataXml?: string) {
  if (!metadataXml) return {};
  const entityMatch = metadataXml.match(/<[^>]*EntityDescriptor\b[^>]*\bentityID=["']([^"']+)["']/i);
  const ssoMatch = metadataXml.match(/<[^>]*SingleSignOnService\b[^>]*\bLocation=["']([^"']+)["']/i);
  const certMatch = metadataXml.match(/<[^>]*X509Certificate[^>]*>([\s\S]*?)<\/[^>]*X509Certificate>/i);
  return {
    idpEntityId: entityMatch?.[1]?.trim(),
    idpSsoUrl: ssoMatch?.[1]?.trim(),
    idpCert: certMatch?.[1]?.replace(/\s+/g, ""),
  };
}

function spEntityIdFor(configId: string, configured?: string | null) {
  return configured || `${API_PUBLIC_URL}/saml/sp/${configId}`;
}

function spAcsUrlFor(configId: string) {
  return `${API_PUBLIC_URL}/api/auth/sso/${configId}/acs`;
}

function normalizeSsoConfigBody(body: unknown, partial = false): SsoConfigInput | { error: string } {
  const source = objectValue(body);
  const provider = source.provider === undefined ? undefined : String(source.provider).toLowerCase();
  if (provider !== undefined && !["saml", "oidc"].includes(provider)) {
    return { error: "provider must be saml or oidc" };
  }
  const status = source.status === undefined ? undefined : String(source.status).toLowerCase();
  if (status !== undefined && !["active", "inactive"].includes(status)) {
    return { error: "status must be active or inactive" };
  }
  const domains = source.emailDomains === undefined ? undefined : normalizeStringArray(source.emailDomains).map((domain) => domain.toLowerCase());
  if (!partial && (!source.name || !provider || !domains?.length)) {
    return { error: "name, provider, and at least one email domain are required" };
  }
  if (domains?.some((domain) => !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain))) {
    return { error: "email domains must be valid domain names" };
  }
  const scopes = source.scopes === undefined ? undefined : normalizeStringArray(source.scopes, ["openid", "email", "profile"]);
  const metadataXml = source.metadataXml === undefined ? undefined : String(source.metadataXml).trim();
  const metadataValues = parseSamlMetadata(metadataXml);
  const attributeSource = objectValue(source.attributeMapping);
  const attributeMapping = source.attributeMapping === undefined ? undefined : {
    email: String(attributeSource.email || "email"),
    name: String(attributeSource.name || "name"),
    groups: String(attributeSource.groups || "groups"),
  };
  return {
    name: source.name === undefined ? undefined : String(source.name).trim(),
    provider: provider as SsoProvider | undefined,
    status: status as SsoStatus | undefined,
    emailDomains: domains,
    idpEntityId: source.idpEntityId === undefined ? metadataValues.idpEntityId : String(source.idpEntityId).trim() || metadataValues.idpEntityId,
    idpSsoUrl: source.idpSsoUrl === undefined ? metadataValues.idpSsoUrl : String(source.idpSsoUrl).trim() || metadataValues.idpSsoUrl,
    idpCert: source.idpCert === undefined ? metadataValues.idpCert : String(source.idpCert).trim() || metadataValues.idpCert,
    spEntityId: source.spEntityId === undefined ? undefined : String(source.spEntityId).trim(),
    metadataUrl: source.metadataUrl === undefined ? undefined : String(source.metadataUrl).trim(),
    metadataXml,
    clientId: source.clientId === undefined ? undefined : String(source.clientId).trim(),
    clientSecretRef: source.clientSecretRef === undefined ? undefined : String(source.clientSecretRef).trim(),
    issuerUrl: source.issuerUrl === undefined ? undefined : String(source.issuerUrl).trim(),
    oidcJwksUrl: source.oidcJwksUrl === undefined ? undefined : String(source.oidcJwksUrl).trim(),
    authorizationUrl: source.authorizationUrl === undefined ? undefined : String(source.authorizationUrl).trim(),
    tokenUrl: source.tokenUrl === undefined ? undefined : String(source.tokenUrl).trim(),
    userinfoUrl: source.userinfoUrl === undefined ? undefined : String(source.userinfoUrl).trim(),
    scopes,
    enforceSso: source.enforceSso === undefined ? undefined : source.enforceSso === true,
    jitEnabled: source.jitEnabled === undefined ? undefined : source.jitEnabled !== false,
    defaultRole: source.defaultRole === undefined ? undefined : String(source.defaultRole || "user").trim(),
    attributeMapping,
  };
}

function validateSsoConfigReadiness(config: SsoConfigInput) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const provider = config.provider;
  const status = config.status;
  if (status === "active") {
    if (!config.emailDomains?.length) errors.push("At least one email domain is required before activation");
    if (provider === "saml") {
      if (!config.idpEntityId) errors.push("SAML IdP entity ID is required before activation");
      if (!config.idpSsoUrl) errors.push("SAML IdP SSO URL is required before activation");
      if (!config.idpCert && !config.idpCertPresent) errors.push("SAML IdP signing certificate is required before activation");
      if (!config.metadataXml && !config.metadataXmlPresent) warnings.push("Store IdP metadata XML so future certificate rotation can be audited");
    }
    if (provider === "oidc") {
      if (!config.issuerUrl) errors.push("OIDC issuer URL is required before activation");
      if (!config.oidcJwksUrl) warnings.push("OIDC JWKS URL should be configured explicitly; otherwise runtime validation depends on issuer discovery");
      if (!config.authorizationUrl) errors.push("OIDC authorization URL is required before activation");
      if (!config.tokenUrl) errors.push("OIDC token URL is required before activation");
      if (!config.userinfoUrl) errors.push("OIDC userinfo URL is required before activation");
      if (!config.clientId) errors.push("OIDC client ID is required before activation");
      if (!config.clientSecretRef) errors.push("OIDC client secret reference is required before activation");
      const scopes = Array.isArray(config.scopes) ? config.scopes : [];
      if (!scopes.includes("openid")) errors.push("OIDC scope must include openid");
      if (!scopes.includes("email")) warnings.push("OIDC scope should include email for deterministic account linking");
      if (!config.issuerUrl?.startsWith("https://")) warnings.push("OIDC issuer should use HTTPS outside local development");
    }
  }
  return {
    status: errors.length ? "blocked" : warnings.length ? "warn" : "ready",
    errors,
    warnings,
  };
}

function ssoConfigRow(row: SsoConfigDbRow) {
  const config = {
    id: row.id,
    name: row.name,
    provider: row.provider,
    status: row.status,
    emailDomains: persistedStringArray(row.email_domains),
    idpEntityId: row.idp_entity_id || "",
    idpSsoUrl: row.idp_sso_url || "",
    idpCertPresent: Boolean(row.idp_cert),
    spEntityId: spEntityIdFor(row.id, row.sp_entity_id),
    spAcsUrl: spAcsUrlFor(row.id),
    metadataUrl: row.metadata_url || "",
    metadataXmlPresent: Boolean(row.metadata_xml),
    jitEnabled: row.jit_enabled,
    clientId: row.client_id || "",
    clientSecretRef: row.client_secret_ref || "",
    issuerUrl: row.issuer_url || "",
    oidcJwksUrl: row.oidc_jwks_url || "",
    authorizationUrl: row.authorization_url || "",
    tokenUrl: row.token_url || "",
    userinfoUrl: row.userinfo_url || "",
    scopes: persistedStringArray(row.scopes, ["openid", "email", "profile"]),
    enforceSso: row.enforce_sso,
    defaultRole: row.default_role || "user",
    attributeMapping: persistedAttributeMapping(row.attribute_mapping),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return {
    ...config,
    validation: validateSsoConfigReadiness(config),
  };
}

export function registerAdminIdentityProviderRoutes(fastify: FastifyInstance) {
  fastify.get("/api/admin/identity/sso-configs", { onRequest: [fastify.authenticate, requirePermission("identity", "read")] }, async (_request, reply) => {
    try {
      const result = await fastify.pg.query(
        `SELECT id, name, provider, status, email_domains, idp_entity_id, idp_sso_url, idp_cert, sp_entity_id,
                metadata_url, metadata_xml, jit_enabled, client_id, client_secret_ref, issuer_url, oidc_jwks_url, authorization_url,
                token_url, userinfo_url, scopes, enforce_sso, default_role, attribute_mapping, created_at, updated_at
         FROM sso_configs
         ORDER BY status DESC, name`
      );
      return {
        configs: (result.rows as SsoConfigDbRow[]).map(ssoConfigRow),
        providers: [
          { id: "saml", name: "SAML 2.0" },
          { id: "oidc", name: "OpenID Connect" },
        ],
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to fetch identity providers") });
    }
  });

  fastify.post("/api/admin/identity/sso-configs", { onRequest: [fastify.authenticate, requirePermission("identity", "write")] }, async (request, reply) => {
    const config = normalizeSsoConfigBody(request.body);
    if ("error" in config) return reply.status(400).send({ error: config.error });
    const validation = validateSsoConfigReadiness(config);
    if (validation.errors.length) return reply.status(400).send({ error: "Identity provider is not ready to activate", validation });
    try {
      const result = await fastify.pg.query(
        `INSERT INTO sso_configs (
           name, provider, status, email_domains, idp_entity_id, idp_sso_url, idp_cert, sp_entity_id,
           metadata_url, metadata_xml, jit_enabled, client_id, client_secret_ref, issuer_url, oidc_jwks_url, authorization_url,
           token_url, userinfo_url, scopes, enforce_sso, default_role, attribute_mapping
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
         RETURNING id, name, provider, status, email_domains, idp_entity_id, idp_sso_url, idp_cert, sp_entity_id,
                   metadata_url, metadata_xml, jit_enabled, client_id, client_secret_ref, issuer_url, oidc_jwks_url, authorization_url,
                   token_url, userinfo_url, scopes, enforce_sso, default_role, attribute_mapping, created_at, updated_at`,
        [
          config.name,
          config.provider,
          config.status || "inactive",
          JSON.stringify(config.emailDomains),
          config.idpEntityId || null,
          config.idpSsoUrl || null,
          config.idpCert || null,
          config.spEntityId || null,
          config.metadataUrl || null,
          config.metadataXml || null,
          config.jitEnabled !== false,
          config.clientId || null,
          config.clientSecretRef || null,
          config.issuerUrl || null,
          config.oidcJwksUrl || null,
          config.authorizationUrl || null,
          config.tokenUrl || null,
          config.userinfoUrl || null,
          JSON.stringify(config.scopes || ["openid", "email", "profile"]),
          config.enforceSso === true,
          config.defaultRole || "user",
          JSON.stringify(config.attributeMapping || { email: "email", name: "name", groups: "groups" }),
        ]
      );
      const row = ssoConfigRow(result.rows[0] as SsoConfigDbRow);
      await recordAuditEvent(fastify, {
        actorId: request.user?.id,
        action: "identity.sso_config.created",
        entityType: "SsoConfig",
        entityId: row.id,
        newValues: row,
        metadata: { source: "api.admin", surface: "admin-console", provider: row.provider },
      });
      return { config: row };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to create identity provider") });
    }
  });

  fastify.patch("/api/admin/identity/sso-configs/:id", { onRequest: [fastify.authenticate, requirePermission("identity", "write")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const config = normalizeSsoConfigBody(request.body, true);
    if ("error" in config) return reply.status(400).send({ error: config.error });
    try {
      const existing = await fastify.pg.query(
        `SELECT id, name, provider, status, email_domains, idp_entity_id, idp_sso_url, idp_cert, sp_entity_id,
                metadata_url, metadata_xml, jit_enabled, client_id, client_secret_ref, issuer_url, oidc_jwks_url, authorization_url,
                token_url, userinfo_url, scopes, enforce_sso, default_role, attribute_mapping, created_at, updated_at
         FROM sso_configs WHERE id = $1`,
        [id]
      );
      const existingRow = existing.rows[0] as SsoConfigDbRow | undefined;
      if (!existingRow) return reply.status(404).send({ error: "Identity provider not found" });
      const candidate = {
        name: config.name ?? existingRow.name,
        provider: config.provider ?? existingRow.provider,
        status: config.status ?? existingRow.status,
        emailDomains: config.emailDomains ?? persistedStringArray(existingRow.email_domains),
        idpEntityId: config.idpEntityId ?? existingRow.idp_entity_id ?? undefined,
        idpSsoUrl: config.idpSsoUrl ?? existingRow.idp_sso_url ?? undefined,
        idpCert: config.idpCert ?? existingRow.idp_cert ?? undefined,
        idpCertPresent: Boolean(config.idpCert ?? existingRow.idp_cert),
        metadataXml: config.metadataXml ?? existingRow.metadata_xml ?? undefined,
        metadataXmlPresent: Boolean(config.metadataXml ?? existingRow.metadata_xml),
        clientId: config.clientId ?? existingRow.client_id ?? undefined,
        clientSecretRef: config.clientSecretRef ?? existingRow.client_secret_ref ?? undefined,
        issuerUrl: config.issuerUrl ?? existingRow.issuer_url ?? undefined,
        oidcJwksUrl: config.oidcJwksUrl ?? existingRow.oidc_jwks_url ?? undefined,
        authorizationUrl: config.authorizationUrl ?? existingRow.authorization_url ?? undefined,
        tokenUrl: config.tokenUrl ?? existingRow.token_url ?? undefined,
        userinfoUrl: config.userinfoUrl ?? existingRow.userinfo_url ?? undefined,
        scopes: config.scopes ?? persistedStringArray(existingRow.scopes, ["openid", "email", "profile"]),
      };
      const validation = validateSsoConfigReadiness(candidate);
      if (validation.errors.length) return reply.status(400).send({ error: "Identity provider is not ready to activate", validation });
      const result = await fastify.pg.query(
        `UPDATE sso_configs SET
           name = COALESCE($2, name),
           provider = COALESCE($3, provider),
           status = COALESCE($4, status),
           email_domains = COALESCE($5, email_domains),
           idp_entity_id = COALESCE($6, idp_entity_id),
           idp_sso_url = COALESCE($7, idp_sso_url),
           idp_cert = COALESCE($8, idp_cert),
           sp_entity_id = COALESCE($9, sp_entity_id),
           metadata_url = COALESCE($10, metadata_url),
           metadata_xml = COALESCE($11, metadata_xml),
           jit_enabled = COALESCE($12, jit_enabled),
           client_id = COALESCE($13, client_id),
           client_secret_ref = COALESCE($14, client_secret_ref),
           issuer_url = COALESCE($15, issuer_url),
           oidc_jwks_url = COALESCE($16, oidc_jwks_url),
           authorization_url = COALESCE($17, authorization_url),
           token_url = COALESCE($18, token_url),
           userinfo_url = COALESCE($19, userinfo_url),
           scopes = COALESCE($20, scopes),
           enforce_sso = COALESCE($21, enforce_sso),
           default_role = COALESCE($22, default_role),
           attribute_mapping = COALESCE($23, attribute_mapping),
           updated_at = NOW()
         WHERE id = $1
         RETURNING id, name, provider, status, email_domains, idp_entity_id, idp_sso_url, idp_cert, sp_entity_id,
                   metadata_url, metadata_xml, jit_enabled, client_id, client_secret_ref, issuer_url, oidc_jwks_url, authorization_url,
                   token_url, userinfo_url, scopes, enforce_sso, default_role, attribute_mapping, created_at, updated_at`,
        [
          id,
          config.name || null,
          config.provider || null,
          config.status || null,
          config.emailDomains ? JSON.stringify(config.emailDomains) : null,
          config.idpEntityId || null,
          config.idpSsoUrl || null,
          config.idpCert || null,
          config.spEntityId || null,
          config.metadataUrl || null,
          config.metadataXml || null,
          config.jitEnabled ?? null,
          config.clientId || null,
          config.clientSecretRef || null,
          config.issuerUrl || null,
          config.oidcJwksUrl || null,
          config.authorizationUrl || null,
          config.tokenUrl || null,
          config.userinfoUrl || null,
          config.scopes ? JSON.stringify(config.scopes) : null,
          config.enforceSso ?? null,
          config.defaultRole || null,
          config.attributeMapping ? JSON.stringify(config.attributeMapping) : null,
        ]
      );
      if (!result.rows.length) return reply.status(404).send({ error: "Identity provider not found" });
      const row = ssoConfigRow(result.rows[0] as SsoConfigDbRow);
      await recordAuditEvent(fastify, {
        actorId: request.user?.id,
        action: "identity.sso_config.updated",
        entityType: "SsoConfig",
        entityId: row.id,
        oldValues: existingRow ? ssoConfigRow(existingRow) : undefined,
        newValues: row,
        metadata: { source: "api.admin", surface: "admin-console", provider: row.provider },
      });
      return { config: row };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to update identity provider") });
    }
  });

  fastify.delete("/api/admin/identity/sso-configs/:id", { onRequest: [fastify.authenticate, requirePermission("identity", "write")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const existing = await fastify.pg.query(
        "SELECT id, name, provider, status, email_domains FROM sso_configs WHERE id = $1",
        [id]
      );
      const result = await fastify.pg.query("DELETE FROM sso_configs WHERE id = $1 RETURNING id", [id]);
      if (!result.rows.length) return reply.status(404).send({ error: "Identity provider not found" });
      await recordAuditEvent(fastify, {
        actorId: request.user?.id,
        action: "identity.sso_config.deleted",
        entityType: "SsoConfig",
        entityId: id,
        oldValues: (existing.rows[0] as Record<string, unknown> | undefined) || { id },
        metadata: { source: "api.admin", surface: "admin-console" },
      });
      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: errorMessage(err, "Failed to delete identity provider") });
    }
  });
}
