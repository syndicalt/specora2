import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "crypto";
import { buildEdgeRuntimeConfig, edgeJobPrivateKey, edgeJobPublicKeyBase64, signEdgeRuntimeConfig } from "./edgeRuntimeConfig";

describe("edgeRuntimeConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds unsigned readiness metadata when no signing key is configured", () => {
    vi.stubEnv("EDGE_JOB_SIGNING_PRIVATE_KEY", "");
    vi.stubEnv("EDGE_JOB_SIGNING_PUBLIC_KEY", "");
    vi.stubEnv("EDGE_OSQUERY_COLLECTOR_DIGEST", "");

    const config = buildEdgeRuntimeConfig();

    expect(config.keyring).toEqual({});
    expect(config.signature).toBe("");
    expect(config.readiness).toEqual({
      signing_key_configured: false,
      public_key_available: false,
      collector_digest_configured: false,
    });
    expect(config.collector_manifest[0].digest).toMatch(/^sha256:0{64}$/);
  });

  it("derives public key and signs runtime config from a PEM private key", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    vi.stubEnv("EDGE_JOB_SIGNING_PRIVATE_KEY", pem);
    vi.stubEnv("EDGE_OSQUERY_COLLECTOR_DIGEST", `sha256:${"a".repeat(64)}`);

    const publicKey = edgeJobPublicKeyBase64();
    const signature = signEdgeRuntimeConfig({ hello: "edge" });
    const config = buildEdgeRuntimeConfig();

    expect(publicKey).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(signature).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(config.keyring).toEqual({ "specora-dev-edge-key": publicKey });
    expect(config.readiness.signing_key_configured).toBe(true);
    expect(config.readiness.collector_digest_configured).toBe(true);
  });

  it("uses an explicitly configured public key override", () => {
    vi.stubEnv("EDGE_JOB_SIGNING_PRIVATE_KEY", "");
    vi.stubEnv("EDGE_JOB_SIGNING_PUBLIC_KEY", "public-key-override");

    expect(edgeJobPrivateKey()).toBeNull();
    expect(edgeJobPublicKeyBase64()).toBe("public-key-override");
  });
});
