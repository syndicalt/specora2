import { createHash, createPrivateKey, createPublicKey, sign as cryptoSign } from "crypto";

export const EDGE_JOB_SIGNING_KEY_ID = process.env.EDGE_JOB_SIGNING_KEY_ID || "specora-dev-edge-key";

export function edgeJobPrivateKey() {
  const raw = process.env.EDGE_JOB_SIGNING_PRIVATE_KEY;
  if (!raw) return null;
  if (raw.includes("BEGIN")) return createPrivateKey(raw.replace(/\\n/g, "\n"));
  const key = Buffer.from(raw, "base64");
  if (key.length === 48 || key.length === 64) {
    const prefix = Buffer.from("302e020100300506032b657004220420", "hex");
    return createPrivateKey({ key: key.length === 64 ? Buffer.concat([prefix, key.subarray(0, 32)]) : key, format: "der", type: "pkcs8" });
  }
  return createPrivateKey(raw);
}

export function edgeJobPublicKeyBase64() {
  const override = process.env.EDGE_JOB_SIGNING_PUBLIC_KEY;
  if (override) return override;
  const privateKey = edgeJobPrivateKey();
  if (!privateKey) return "";
  const der = createPublicKey(privateKey).export({ type: "spki", format: "der" }) as Buffer;
  return der.subarray(-32).toString("base64");
}

export function buildEdgeRuntimeConfig() {
  const publicKey = edgeJobPublicKeyBase64();
  const digest = process.env.EDGE_OSQUERY_COLLECTOR_DIGEST || `sha256:${"0".repeat(64)}`;
  const digestConfigured = Boolean(process.env.EDGE_OSQUERY_COLLECTOR_DIGEST);
  const payload = {
    config_version: process.env.EDGE_RUNTIME_CONFIG_VERSION || "platform-1",
    key_id: EDGE_JOB_SIGNING_KEY_ID,
    keyring: publicKey ? { [EDGE_JOB_SIGNING_KEY_ID]: publicKey } : {},
    collector_manifest: [
      {
        id: "osquery",
        version: "1.0.0",
        capabilities: ["collector.query.osquery"],
        command: "specora-osquery-local",
        args: [],
        output_schema: "specora.evidence.v1",
        timeout_seconds: 60,
        digest,
      },
    ],
    capability_policy: {
      policy_version: process.env.EDGE_CAPABILITY_POLICY_VERSION || "platform-1",
      capabilities: {
        "collector.query.osquery": true,
      },
    },
    suggested_paths: {
      job_signing_keys_path: "/etc/specora-edge/job-signing-keys.json",
      collector_manifest_path: "/etc/specora-edge/collectors.json",
      collector_package_dir: "/opt/specora-edge/collectors",
      capability_policy_path: "/etc/specora-edge/capabilities.json",
    },
    readiness: {
      signing_key_configured: Boolean(edgeJobPrivateKey()),
      public_key_available: Boolean(publicKey),
      collector_digest_configured: digestConfigured,
    },
  };
  const signed_at = new Date().toISOString();
  const signature = signEdgeRuntimeConfig({ ...payload, signed_at });
  return { ...payload, signed_at, signature, signature_algorithm: "Ed25519-SHA256" };
}

export function signEdgeRuntimeConfig(payload: unknown) {
  const privateKey = edgeJobPrivateKey();
  if (!privateKey) return "";
  const message = createHash("sha256").update(JSON.stringify(payload)).digest();
  return cryptoSign(null, message, privateKey).toString("base64");
}
