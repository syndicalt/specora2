import type { AdminScreenContextInput } from "./types";

export const ADMIN_SCREEN_CONTEXT: Record<string, { purpose: string; primaryActions: string[]; state?: (input: AdminScreenContextInput) => Record<string, string | number | boolean> }> = {
  overview: {
    purpose: "Administrative command overview for platform readiness, operational posture, governance signals, and shortcuts into admin surfaces.",
    primaryActions: ["Review readiness metrics", "Inspect operational intelligence", "Open native operational apps", "Navigate to focused admin areas"],
  },
  users: {
    purpose: "User management console for platform accounts, roles, profile metadata, active sessions, grants, groups, audit history, and access recommendations.",
    primaryActions: ["Create users", "Edit display name and role", "Inspect inherited access", "Review sessions and audit events"],
    state: ({ managedUsers }) => ({ users: managedUsers.length }),
  },
  "edge-enrollment": {
    purpose: "Edge enrollment administration for issuing enrollment tokens, reviewing registered collectors, deleting registrations, and viewing runtime config material.",
    primaryActions: ["Issue enrollment tokens", "Copy one-time tokens", "Review collector health", "Delete collector registrations", "Inspect public signing key and runtime config"],
    state: ({ edgeCollectors, edgeEnrollmentTokens }) => ({ collectors: edgeCollectors.length, enrollmentTokens: edgeEnrollmentTokens.length }),
  },
  rbac: {
    purpose: "Access governance workspace for permissions, group grants, access analysis, app/tool/table access explainers, field restrictions, policy drift, and audit integrity.",
    primaryActions: ["Grant or revoke permissions", "Analyze user/resource access", "Explain app, tool, table, and field access", "Review policy drift and audit integrity"],
    state: ({ permissions }) => ({ permissionGrants: permissions.length }),
  },
  credentials: {
    purpose: "Credential reference manager for scoped managed secrets, environment variable references, and external credential-store pointers.",
    primaryActions: ["Create credential references", "Set managed secret values", "Test credential availability", "Disable or delete credential references"],
    state: ({ credentials }) => ({ credentialRefs: credentials.length }),
  },
  identity: {
    purpose: "Identity provider and group administration for SAML/OIDC configuration, JIT settings, identity groups, group members, and group permissions.",
    primaryActions: ["Register identity providers", "Configure SAML or OIDC metadata", "Manage identity groups", "Grant group permissions"],
    state: ({ ssoConfigs }) => ({ identityProviders: ssoConfigs.length }),
  },
  environments: {
    purpose: "Environment registry for admin-managed environment choices used by CI and table reference fields.",
    primaryActions: ["Create environment choices", "Mark environments active or inactive", "Set production-like flags", "Control sort order"],
    state: ({ environmentChoices }) => ({ environments: environmentChoices.length }),
  },
  "number-sequences": {
    purpose: "Number sequence registry for table and app record identifiers.",
    primaryActions: ["Create sequence definitions", "Set prefixes and padding", "Enable or disable counters", "Review next generated values"],
    state: ({ numberSequences }) => ({ sequences: numberSequences.length }),
  },
  packages: {
    purpose: "Package provisioning console for app install/uninstall jobs, retention behavior, and provisioning status.",
    primaryActions: ["Review provisioning jobs", "Inspect install/uninstall status", "Verify retention and cleanup policy"],
    state: ({ provisioningJobs }) => ({ provisioningJobs: provisioningJobs.length }),
  },
  "system-properties": {
    purpose: "System property registry for operational platform configuration.",
    primaryActions: ["Create system properties", "Edit property values", "Delete obsolete properties"],
    state: ({ systemProps }) => ({ systemProperties: systemProps.length }),
  },
};
