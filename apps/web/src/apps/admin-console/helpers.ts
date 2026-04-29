export const CREDENTIAL_SCOPE_OPTIONS = [
  { value: "discovery", label: "Discovery" },
  { value: "identity", label: "Identity Providers" },
  { value: "reporting", label: "Reporting" },
  { value: "integrations", label: "General Integrations" },
];

export const CREDENTIAL_PROVIDER_OPTIONS = [
  { value: "managed", label: "Managed Secret" },
  { value: "env", label: "Environment Variable (Dev)" },
  { value: "external", label: "External Store Reference" },
];

export const PERMISSION_VALUE_SEPARATOR = "\u0000";

export function credentialSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function buildCredentialRef(input: { provider: string; scope: string; name: string }) {
  const provider = credentialSlug(input.provider) || "managed";
  const scope = credentialSlug(input.scope) || "discovery";
  const name = credentialSlug(input.name);
  return name ? `${provider}://${scope}/${name}` : "";
}

export function formatDateTime(value?: string | null) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
}

export function encodePermissionValue(resource: string, action: string) {
  return `${resource}${PERMISSION_VALUE_SEPARATOR}${action}`;
}

export function decodePermissionValue(value: string) {
  const [resource, action] = value.split(PERMISSION_VALUE_SEPARATOR);
  return [resource || "", action || ""] as const;
}

export function appPermissionToResourceAction(permission: string) {
  const parts = permission.split(":");
  if (parts.length === 3 && parts[0] === "itsm") {
    const [, domain, action] = parts;
    const resourceMap: Record<string, string> = {
      change: "change-manager",
      incident: "incident-manager",
      knowledge: "knowledge-core",
      prevention: "prevention-center",
      asset: "asset-command",
      discovery: "discovery",
      health: "health-monitor",
    };
    return { resource: resourceMap[domain] || domain, action };
  }
  const [left, right] = parts;
  if (!left || !right) return null;
  if (["read", "write", "admin"].includes(left)) return { resource: right, action: left };
  return { resource: left, action: right };
}

export function riskClass(risk?: string) {
  if (risk === "critical") return "border-red-400/40 bg-red-500/10 text-red-200";
  if (risk === "high") return "border-orange-400/40 bg-orange-500/10 text-orange-200";
  if (risk === "medium") return "border-amber-400/40 bg-amber-500/10 text-amber-100";
  return "border-emerald-400/30 bg-emerald-500/10 text-emerald-200";
}

export function postureClass(posture?: string) {
  if (posture === "attention") return "border-red-500/30 bg-red-500/10 text-red-100";
  if (posture === "watch") return "border-amber-500/30 bg-amber-500/10 text-amber-100";
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
}

export function scoreText(score?: number) {
  if (score === undefined || score === null) return "-";
  return `${Math.round(score)}`;
}
