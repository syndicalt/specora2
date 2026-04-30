import type { FastifyInstance } from "fastify";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

export const CREDENTIAL_PROVIDER_MODES = ["managed", "env", "external"] as const;
export type CredentialProviderMode = typeof CREDENTIAL_PROVIDER_MODES[number];

const SECRET_KEY_PATTERN = /(secret|password|token|api[_-]?key|private[_-]?key|client[_-]?secret|credential|authorization)/i;
const ENCRYPTION_ALGORITHM = "aes-256-gcm";

type EncryptedSecret = {
  algorithm: string;
  iv: string;
  tag: string;
  ciphertext: string;
};

export type CredentialReference = {
  id: string;
  ref: string;
  name: string;
  provider: CredentialProviderMode | string;
  status: string;
  description: string;
  scope: string;
  secretEnvKey: string;
  externalRef: string;
  secretPresent: boolean;
  metadata: Record<string, unknown>;
  lastTestedAt: unknown;
  lastStatus: string | null;
  lastError: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: unknown;
  updatedAt: unknown;
};

type CredentialReferenceDbRow = {
  id: string;
  ref: string;
  name: string;
  provider: CredentialProviderMode | string;
  status: string;
  description?: string | null;
  scope?: string | null;
  secret_env_key?: string | null;
  external_ref?: string | null;
  secret_present?: boolean | null;
  encrypted_secret?: unknown;
  metadata?: unknown;
  last_tested_at?: unknown;
  last_status?: string | null;
  last_error?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: unknown;
  updated_at?: unknown;
};

type NormalizedCredentialBody = {
  name?: string;
  ref?: string;
  provider?: CredentialProviderMode;
  status?: string;
  description?: string;
  scope?: string;
  secretEnvKey?: string;
  externalRef?: string;
  secretValue?: string;
  metadata?: Record<string, unknown>;
};

type CredentialValidationResult = {
  ok: boolean;
  status: string;
  message: string | null;
  credential: CredentialReference | null;
};

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function encryptedSecretValue(value: unknown): EncryptedSecret | null {
  if (!value || typeof value !== "object") return null;
  const secret = value as Partial<EncryptedSecret>;
  return typeof secret.iv === "string" && typeof secret.tag === "string" && typeof secret.ciphertext === "string"
    ? {
        algorithm: typeof secret.algorithm === "string" ? secret.algorithm : ENCRYPTION_ALGORITHM,
        iv: secret.iv,
        tag: secret.tag,
        ciphertext: secret.ciphertext,
      }
    : null;
}

function encryptionKey() {
  const configured = process.env.CREDENTIAL_ENCRYPTION_KEY || process.env.JWT_SECRET || "dev-secret-change-me";
  return createHash("sha256").update(configured).digest();
}

export function encryptCredentialSecret(value: string | undefined): EncryptedSecret | null {
  if (!value) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    algorithm: ENCRYPTION_ALGORITHM,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptCredentialSecret(value: unknown): string | null {
  const secret = encryptedSecretValue(value);
  if (!secret) return null;
  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, encryptionKey(), Buffer.from(secret.iv, "base64"));
  decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function credentialSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function buildCredentialReference(input: { provider?: string; scope?: string; name?: string }) {
  const provider = credentialSlug(input.provider || "env") || "env";
  const scope = credentialSlug(input.scope || "discovery") || "discovery";
  const name = credentialSlug(input.name || "");
  return name ? `${provider}://${scope}/${name}` : "";
}

export function redactCredentialConfig(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactCredentialConfig(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SECRET_KEY_PATTERN.test(key) ? "[redacted]" : redactCredentialConfig(item),
  ]));
}

export function credentialReferenceRow(row: CredentialReferenceDbRow): CredentialReference {
  return {
    id: row.id,
    ref: row.ref,
    name: row.name,
    provider: row.provider,
    status: row.status,
    description: row.description || "",
    scope: row.scope || "discovery",
    secretEnvKey: row.secret_env_key || "",
    externalRef: row.external_ref || "",
    secretPresent: Boolean(row.secret_present ?? row.encrypted_secret),
    metadata: objectValue(row.metadata),
    lastTestedAt: row.last_tested_at || null,
    lastStatus: row.last_status || null,
    lastError: row.last_error || null,
    createdBy: row.created_by || null,
    updatedBy: row.updated_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function normalizeCredentialReferenceBody(body: unknown, partial = false): NormalizedCredentialBody | { error: string } {
  const source = objectValue(body);
  const name = source.name === undefined ? undefined : String(source.name).trim();
  const provider = source.provider === undefined ? undefined : String(source.provider).trim().toLowerCase();
  const status = source.status === undefined ? undefined : String(source.status).trim().toLowerCase();
  const scope = source.scope === undefined ? undefined : String(source.scope || "discovery").trim().toLowerCase();
  const metadata = source.metadata === undefined ? undefined : objectValue(source.metadata);

  if (!partial && (!name || !provider)) return { error: "name and provider are required" };
  if (provider !== undefined && !CREDENTIAL_PROVIDER_MODES.includes(provider as CredentialProviderMode)) return { error: "provider must be managed, env, or external" };
  if (status !== undefined && !["active", "disabled"].includes(status)) return { error: "status must be active or disabled" };
  if (scope !== undefined && !/^[a-z0-9][a-z0-9_-]{1,79}$/i.test(scope)) return { error: "scope must be 2-80 letters, numbers, dashes, or underscores" };
  if (!partial && provider === "managed" && !String(source.secretValue || "").trim()) return { error: "secretValue is required for managed credentials" };
  const ref = partial ? undefined : buildCredentialReference({ provider, scope, name });
  if (!partial && !ref) return { error: "name must include at least one letter or number" };

  return {
    name,
    ref,
    provider: provider as CredentialProviderMode | undefined,
    status,
    description: source.description === undefined ? undefined : String(source.description || "").trim(),
    scope,
    secretEnvKey: source.secretEnvKey === undefined ? undefined : String(source.secretEnvKey || "").trim(),
    externalRef: source.externalRef === undefined ? undefined : String(source.externalRef || "").trim(),
    secretValue: source.secretValue === undefined ? undefined : String(source.secretValue || ""),
    metadata,
  };
}

export async function testCredentialReference(fastify: FastifyInstance, ref: string | null | undefined): Promise<CredentialValidationResult> {
  const normalizedRef = String(ref || "").trim();
  if (!normalizedRef) {
    return { ok: false, status: "credential_missing", message: "Credential reference is required", credential: null };
  }
  const result = await fastify.pg.query(
    `SELECT id, ref, name, provider, status, description, scope, secret_env_key, external_ref, encrypted_secret, metadata,
            last_tested_at, last_status, last_error, created_by, updated_by, created_at, updated_at
     FROM credential_references
     WHERE ref = $1`,
    [normalizedRef]
  );
  const row = result.rows[0] as CredentialReferenceDbRow | undefined;
  if (!row) {
    return { ok: false, status: "credential_unavailable", message: "Credential reference is not registered", credential: null };
  }
  const credential = credentialReferenceRow(row);
  if (row.status !== "active") {
    return { ok: false, status: "credential_unavailable", message: "Credential reference is disabled", credential };
  }
  if (row.provider === "none") return { ok: false, status: "credential_unavailable", message: "Credential provider is no longer supported", credential };
  if (row.provider === "managed") {
    try {
      const secret = decryptCredentialSecret(row.encrypted_secret);
      if (!secret) return { ok: false, status: "credential_unavailable", message: "Managed secret is not configured", credential };
      return { ok: true, status: "ok", message: null, credential };
    } catch {
      return { ok: false, status: "credential_unavailable", message: "Managed secret cannot be decrypted", credential };
    }
  }
  if (row.provider === "env") {
    if (!row.secret_env_key || !process.env[row.secret_env_key]) {
      return { ok: false, status: "credential_unavailable", message: "Environment secret is not configured", credential };
    }
    return { ok: true, status: "ok", message: null, credential };
  }
  if (row.provider === "external") {
    if (!row.external_ref && !row.ref) {
      return { ok: false, status: "credential_unavailable", message: "External credential reference is incomplete", credential };
    }
    return { ok: true, status: "ok", message: null, credential };
  }
  return { ok: false, status: "credential_unavailable", message: "Credential provider is unsupported", credential };
}

export async function validateDiscoveryCredential(fastify: FastifyInstance, sourceType: string, config: unknown, credentialRef?: string | null): Promise<CredentialValidationResult> {
  const normalizedType = String(sourceType || "").toLowerCase();
  const normalizedConfig = objectValue(config);
  if (["csv", "file", "manual"].includes(normalizedType)) {
    return { ok: true, status: "ok", message: null, credential: null };
  }
  if (normalizedType === "edge") {
    return normalizedConfig.collectorId
      ? { ok: true, status: "ok", message: null, credential: null }
      : { ok: false, status: "needs_configuration", message: "Edge collector source requires a collector binding", credential: null };
  }
  if (!normalizedConfig.endpoint && !normalizedConfig.connection && !normalizedConfig.account) {
    return { ok: false, status: "needs_configuration", message: "Source configuration is incomplete", credential: null };
  }
  return testCredentialReference(fastify, credentialRef || (typeof normalizedConfig.credentialRef === "string" ? normalizedConfig.credentialRef : null));
}
