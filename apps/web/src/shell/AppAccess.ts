import type { RegistryEntry } from "../sdk/types";

const ROLE_PERMISSIONS: Record<string, string[]> = {
  viewer: [
    "read:cmdb", "read:relationships", "read:discovery",
    "itsm:change:read", "itsm:incident:read", "itsm:knowledge:read", "itsm:prevention:read", "itsm:asset:read", "itsm:discovery:read", "itsm:health:read",
    "audit-log:read", "read:profile", "write:profile", "read:chat",
    "reporting:read", "tables:read", "data-foundations:read", "customer-portal:read", "customer-portal:write", "engage:agent:read",
  ],
  operator: [
    "read:cmdb", "write:cmdb", "read:relationships", "write:relationships",
    "read:discovery", "write:discovery",
    "itsm:change:read", "itsm:change:write",
    "itsm:incident:read", "itsm:incident:write", "itsm:incident:remediate",
    "itsm:knowledge:read", "itsm:knowledge:write",
    "itsm:prevention:read", "itsm:prevention:write",
    "itsm:asset:read", "itsm:asset:write",
    "itsm:discovery:read",
    "itsm:health:read", "itsm:health:write",
    "it-visibility:read",
    "audit-log:read", "read:profile", "write:profile", "read:chat",
    "reporting:read", "reporting:write", "tables:read", "tables:write", "data-foundations:read", "customer-portal:read", "customer-portal:write", "engage:agent:read", "engage:agent:write",
  ],
  admin: [
    "read:cmdb", "write:cmdb", "read:relationships", "write:relationships",
    "read:discovery", "write:discovery",
    "itsm:change:read", "itsm:change:write",
    "itsm:incident:read", "itsm:incident:write", "itsm:incident:remediate",
    "itsm:knowledge:read", "itsm:knowledge:write", "itsm:knowledge:govern",
    "itsm:prevention:read", "itsm:prevention:write", "itsm:prevention:govern",
    "itsm:asset:read", "itsm:asset:write", "itsm:asset:govern",
    "itsm:discovery:read",
    "itsm:health:read", "itsm:health:write",
    "it-visibility:read", "it-visibility:write", "it-visibility:operate",
    "audit-log:read", "read:profile", "write:profile", "read:chat",
    "app:install", "app:uninstall", "admin:cmdb",
    "number-sequences:read", "number-sequences:write",
    "reporting:read", "reporting:write", "tables:read", "tables:write", "data-foundations:read", "data-foundations:write", "customer-portal:read", "customer-portal:write", "engage:agent:read", "engage:agent:write",
  ],
  security_admin: [
    "rbac:read", "rbac:write",
    "number-sequences:read", "number-sequences:write",
    "system-properties:read", "system-properties:write",
    "audit-log:read",
    "app:install", "app:uninstall",
    "read:profile", "write:profile", "read:chat",
    "itsm:incident:read", "itsm:incident:write", "itsm:incident:remediate",
    "itsm:knowledge:read", "itsm:knowledge:write", "itsm:knowledge:govern",
    "itsm:prevention:read", "itsm:prevention:write", "itsm:prevention:govern",
    "itsm:asset:read", "itsm:asset:write", "itsm:asset:govern",
    "it-visibility:read", "it-visibility:write", "it-visibility:operate",
    "reporting:read", "reporting:write", "tables:read", "tables:write", "data-foundations:read", "data-foundations:write", "customer-portal:read", "customer-portal:write", "engage:agent:read", "engage:agent:write",
  ],
};

const AUTHENTICATED_APP_PERMISSIONS = [
  "read:profile",
  "write:profile",
  "read:chat",
  "customer-portal:read",
  "customer-portal:write",
];

export function filterRegistryByRole(registry: RegistryEntry[], role: string | null): RegistryEntry[] {
  if (role === "admin" || role === "security_admin") return registry;
  const allowed = new Set(role ? (ROLE_PERMISSIONS[role] || AUTHENTICATED_APP_PERMISSIONS) : AUTHENTICATED_APP_PERMISSIONS);
  return registry.filter((entry) => entry.permissions.some((permission) => allowed.has(permission)));
}
