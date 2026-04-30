import { FastifyInstance } from "fastify";
import { requirePermission } from "../../services/rbac";
import { recordAuditEvent } from "../../services/auditLog";

const API_PUBLIC_URL = process.env.API_PUBLIC_URL || (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/graphql").replace("/graphql", "");

function normalizeStringArray(value: unknown, fallback: string[] = []) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\n]/)
      : fallback;
  return Array.from(new Set(raw.map((item) => String(item).trim()).filter(Boolean)));
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

function normalizeSsoConfigBody(body: any, partial = false) {
  const provider = body.provider === undefined ? undefined : String(body.provider).toLowerCase();
  if (provider !== undefined && !["saml", "oidc"].includes(provider)) {
    return { error: "provider must be saml or oidc" };
  }
  const status = body.status === undefined ? undefined : String(body.status).toLowerCase();
  if (status !== undefined && !["active", "inactive"].includes(status)) {
    return { error: "status must be active or inactive" };
  }
  const domains = body.emailDomains === undefined ? undefined : normalizeStringArray(body.emailDomains).map((domain) => domain.toLowerCase());
  if (!partial && (!body.name || !provider || !domains?.length)) {
    return { error: "name, provider, and at least one email domain are required" };
  }
  if (domains?.some((domain) => !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain))) {
    return { error: "email domains must be valid domain names" };
  }
  const scopes = body.scopes === undefined ? undefined : normalizeStringArray(body.scopes, ["openid", "email", "profile"]);
  const metadataXml = body.metadataXml === undefined ? undefined : String(body.metadataXml).trim();
  const metadataValues = parseSamlMetadata(metadataXml);
  const attributeMapping = body.attributeMapping === undefined ? undefined : {
    email: String(body.attributeMapping?.email || "email"),
    name: String(body.attributeMapping?.name || "name"),
    groups: String(body.attributeMapping?.groups || "groups"),
  };
  return {
    name: body.name === undefined ? undefined : String(body.name).trim(),
    provider,
    status,
    emailDomains: domains,
    idpEntityId: body.idpEntityId === undefined ? metadataValues.idpEntityId : String(body.idpEntityId).trim() || metadataValues.idpEntityId,
    idpSsoUrl: body.idpSsoUrl === undefined ? metadataValues.idpSsoUrl : String(body.idpSsoUrl).trim() || metadataValues.idpSsoUrl,
    idpCert: body.idpCert === undefined ? metadataValues.idpCert : String(body.idpCert).trim() || metadataValues.idpCert,
    spEntityId: body.spEntityId === undefined ? undefined : String(body.spEntityId).trim(),
    metadataUrl: body.metadataUrl === undefined ? undefined : String(body.metadataUrl).trim(),
    metadataXml,
    clientId: body.clientId === undefined ? undefined : String(body.clientId).trim(),
    clientSecretRef: body.clientSecretRef === undefined ? undefined : String(body.clientSecretRef).trim(),
    issuerUrl: body.issuerUrl === undefined ? undefined : String(body.issuerUrl).trim(),
    oidcJwksUrl: body.oidcJwksUrl === undefined ? undefined : String(body.oidcJwksUrl).trim(),
    authorizationUrl: body.authorizationUrl === undefined ? undefined : String(body.authorizationUrl).trim(),
    tokenUrl: body.tokenUrl === undefined ? undefined : String(body.tokenUrl).trim(),
    userinfoUrl: body.userinfoUrl === undefined ? undefined : String(body.userinfoUrl).trim(),
    scopes,
    enforceSso: body.enforceSso === undefined ? undefined : body.enforceSso === true,
    jitEnabled: body.jitEnabled === undefined ? undefined : body.jitEnabled !== false,
    defaultRole: body.defaultRole === undefined ? undefined : String(body.defaultRole || "user").trim(),
    attributeMapping,
  };
}

function validateSsoConfigReadiness(config: any) {
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

function ssoConfigRow(row: any) {
  const config = {
    id: row.id,
    name: row.name,
    provider: row.provider,
    status: row.status,
    emailDomains: row.email_domains || [],
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
    scopes: row.scopes || ["openid", "email", "profile"],
    enforceSso: row.enforce_sso,
    defaultRole: row.default_role || "user",
    attributeMapping: row.attribute_mapping || { email: "email", name: "name", groups: "groups" },
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
        configs: result.rows.map(ssoConfigRow),
        providers: [
          { id: "saml", name: "SAML 2.0" },
          { id: "oidc", name: "OpenID Connect" },
        ],
      };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to fetch identity providers" });
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
      const row = ssoConfigRow(result.rows[0]);
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "identity.sso_config.created",
        entityType: "SsoConfig",
        entityId: row.id,
        newValues: row,
        metadata: { source: "api.admin", surface: "admin-console", provider: row.provider },
      });
      return { config: row };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to create identity provider" });
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
      const existingRow = existing.rows[0];
      if (!existingRow) return reply.status(404).send({ error: "Identity provider not found" });
      const candidate = {
        name: config.name ?? existingRow.name,
        provider: config.provider ?? existingRow.provider,
        status: config.status ?? existingRow.status,
        emailDomains: config.emailDomains ?? existingRow.email_domains,
        idpEntityId: config.idpEntityId ?? existingRow.idp_entity_id,
        idpSsoUrl: config.idpSsoUrl ?? existingRow.idp_sso_url,
        idpCert: config.idpCert ?? existingRow.idp_cert,
        idpCertPresent: Boolean(config.idpCert ?? existingRow.idp_cert),
        metadataXml: config.metadataXml ?? existingRow.metadata_xml,
        metadataXmlPresent: Boolean(config.metadataXml ?? existingRow.metadata_xml),
        clientId: config.clientId ?? existingRow.client_id,
        clientSecretRef: config.clientSecretRef ?? existingRow.client_secret_ref,
        issuerUrl: config.issuerUrl ?? existingRow.issuer_url,
        oidcJwksUrl: config.oidcJwksUrl ?? existingRow.oidc_jwks_url,
        authorizationUrl: config.authorizationUrl ?? existingRow.authorization_url,
        tokenUrl: config.tokenUrl ?? existingRow.token_url,
        userinfoUrl: config.userinfoUrl ?? existingRow.userinfo_url,
        scopes: config.scopes ?? existingRow.scopes,
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
      const row = ssoConfigRow(result.rows[0]);
      await recordAuditEvent(fastify, {
        actorId: (request.user as any)?.id,
        action: "identity.sso_config.updated",
        entityType: "SsoConfig",
        entityId: row.id,
        oldValues: existing.rows[0] ? ssoConfigRow(existing.rows[0]) : undefined,
        newValues: row,
        metadata: { source: "api.admin", surface: "admin-console", provider: row.provider },
      });
      return { config: row };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to update identity provider" });
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
        actorId: (request.user as any)?.id,
        action: "identity.sso_config.deleted",
        entityType: "SsoConfig",
        entityId: id,
        oldValues: existing.rows[0] || { id },
        metadata: { source: "api.admin", surface: "admin-console" },
      });
      return { success: true };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Failed to delete identity provider" });
    }
  });
}
