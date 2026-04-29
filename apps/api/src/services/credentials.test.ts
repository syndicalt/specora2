import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCredentialReference,
  credentialReferenceRow,
  decryptCredentialSecret,
  encryptCredentialSecret,
  normalizeCredentialReferenceBody,
  redactCredentialConfig,
  testCredentialReference,
  validateDiscoveryCredential,
} from "./credentials";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

function fastifyWithRows(rows: any[]) {
  return {
    pg: {
      query: vi.fn(async () => ({ rows })),
    },
  } as any;
}

describe("credential service", () => {
  it("builds stable references and validates create/update bodies", () => {
    expect(buildCredentialReference({ provider: "Managed Store", scope: "Discovery Ops", name: "Inventory API!" })).toBe(
      "managed-store://discovery-ops/inventory-api"
    );
    expect(buildCredentialReference({ provider: "env", scope: "discovery", name: "!!!" })).toBe("");

    expect(normalizeCredentialReferenceBody({})).toEqual({ error: "name and provider are required" });
    expect(normalizeCredentialReferenceBody({ name: "Inventory", provider: "unsupported" })).toEqual({ error: "provider must be managed, env, or external" });
    expect(normalizeCredentialReferenceBody({ name: "Inventory", provider: "env", status: "deleted" })).toEqual({ error: "status must be active or disabled" });
    expect(normalizeCredentialReferenceBody({ name: "Inventory", provider: "env", scope: "x" })).toEqual({
      error: "scope must be 2-80 letters, numbers, dashes, or underscores",
    });
    expect(normalizeCredentialReferenceBody({ name: "Inventory", provider: "managed" })).toEqual({ error: "secretValue is required for managed credentials" });

    expect(normalizeCredentialReferenceBody({
      name: "Inventory API",
      provider: "managed",
      scope: "discovery",
      status: "active",
      description: "  main source ",
      secretValue: "secret",
      metadata: ["bad"],
    })).toMatchObject({
      name: "Inventory API",
      provider: "managed",
      ref: "managed://discovery/inventory-api",
      description: "main source",
      metadata: {},
    });

    expect(normalizeCredentialReferenceBody({ status: "disabled" }, true)).toMatchObject({ status: "disabled", ref: undefined });
  });

  it("encrypts, decrypts, redacts, and maps rows for UI/API callers", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = "unit-test-key";
    expect(encryptCredentialSecret(undefined)).toBeNull();
    const encrypted = encryptCredentialSecret("top-secret");

    expect(encrypted).toMatchObject({ algorithm: "aes-256-gcm" });
    expect(decryptCredentialSecret(encrypted)).toBe("top-secret");
    expect(decryptCredentialSecret(null)).toBeNull();
    expect(redactCredentialConfig({
      username: "api",
      password: "hidden",
      nested: { apiKey: "hidden", safe: "shown" },
      list: [{ token: "hidden" }],
    })).toEqual({
      username: "api",
      password: "[redacted]",
      nested: { apiKey: "[redacted]", safe: "shown" },
      list: [{ token: "[redacted]" }],
    });

    expect(credentialReferenceRow({
      id: "cred-1",
      ref: "managed://discovery/inventory",
      name: "Inventory",
      provider: "managed",
      status: "active",
      encrypted_secret: encrypted,
      metadata: null,
      created_at: "created",
      updated_at: "updated",
    })).toMatchObject({
      id: "cred-1",
      scope: "discovery",
      secretPresent: true,
      metadata: {},
      createdAt: "created",
      updatedAt: "updated",
    });
  });

  it("tests managed, env, external, disabled, missing, and unsupported credential references", async () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = "unit-test-key";
    process.env.INVENTORY_TOKEN = "token";
    const encrypted = encryptCredentialSecret("secret");

    await expect(testCredentialReference(fastifyWithRows([]), "")).resolves.toMatchObject({
      ok: false,
      status: "credential_missing",
    });
    await expect(testCredentialReference(fastifyWithRows([]), "missing")).resolves.toMatchObject({
      ok: false,
      message: "Credential reference is not registered",
    });
    await expect(testCredentialReference(fastifyWithRows([{ ref: "env://discovery/api", provider: "env", status: "disabled" }]), "env://discovery/api")).resolves.toMatchObject({
      ok: false,
      message: "Credential reference is disabled",
    });
    await expect(testCredentialReference(fastifyWithRows([{ ref: "none://discovery/api", provider: "none", status: "active" }]), "none://discovery/api")).resolves.toMatchObject({
      ok: false,
      message: "Credential provider is no longer supported",
    });
    await expect(testCredentialReference(fastifyWithRows([{ ref: "managed://discovery/api", provider: "managed", status: "active", encrypted_secret: encrypted }]), "managed://discovery/api")).resolves.toMatchObject({
      ok: true,
      status: "ok",
    });
    await expect(testCredentialReference(fastifyWithRows([{ ref: "managed://discovery/api", provider: "managed", status: "active", encrypted_secret: { ...encrypted, tag: "bad" } }]), "managed://discovery/api")).resolves.toMatchObject({
      ok: false,
      message: "Managed secret cannot be decrypted",
    });
    await expect(testCredentialReference(fastifyWithRows([{ ref: "env://discovery/api", provider: "env", status: "active", secret_env_key: "INVENTORY_TOKEN" }]), "env://discovery/api")).resolves.toMatchObject({
      ok: true,
      status: "ok",
    });
    await expect(testCredentialReference(fastifyWithRows([{ ref: "", provider: "external", status: "active", external_ref: "" }]), "external://discovery/api")).resolves.toMatchObject({
      ok: false,
      message: "External credential reference is incomplete",
    });
    await expect(testCredentialReference(fastifyWithRows([{ ref: "external://discovery/api", provider: "external", status: "active", external_ref: "vault/path" }]), "external://discovery/api")).resolves.toMatchObject({
      ok: true,
      status: "ok",
    });
    await expect(testCredentialReference(fastifyWithRows([{ ref: "custom://discovery/api", provider: "custom", status: "active" }]), "custom://discovery/api")).resolves.toMatchObject({
      ok: false,
      message: "Credential provider is unsupported",
    });
  });

  it("validates discovery credential requirements by source type", async () => {
    const fastify = fastifyWithRows([{ ref: "env://discovery/api", provider: "env", status: "active", secret_env_key: "API_TOKEN" }]);
    process.env.API_TOKEN = "token";

    await expect(validateDiscoveryCredential(fastify, "csv", {}, null)).resolves.toMatchObject({ ok: true, credential: null });
    await expect(validateDiscoveryCredential(fastify, "edge", {}, null)).resolves.toMatchObject({
      ok: false,
      status: "needs_configuration",
    });
    await expect(validateDiscoveryCredential(fastify, "edge", { collectorId: "collector-1" }, null)).resolves.toMatchObject({ ok: true });
    await expect(validateDiscoveryCredential(fastify, "rest", {}, null)).resolves.toMatchObject({
      ok: false,
      message: "Source configuration is incomplete",
    });
    await expect(validateDiscoveryCredential(fastify, "rest", { endpoint: "https://inventory.example" }, "env://discovery/api")).resolves.toMatchObject({
      ok: true,
      status: "ok",
    });
  });
});
