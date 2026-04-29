"use client";

import { ADMIN_API_URL, adminAuthHeaders } from "./adminApi";
import type {
  AdminPanel,
  AuditEntry,
  AuditIntegrity,
  CredentialReference,
  EdgeCollector,
  EdgeEnrollmentToken,
  EdgeRuntimeConfig,
  FieldRestrictionTable,
  IdentityGroup,
  IdentityGroupMembership,
  IdentityGroupPermission,
  CmdbGroupOption,
  ManagedUser,
  NumberSequenceOption,
  OperationalIntelligence,
  Permission,
  PolicyDriftReport,
  ProvisioningJob,
  RbacApp,
  RbacGroup,
  RbacTable,
  RbacTarget,
  RbacTool,
  RbacUser,
  SsoConfig,
} from "./types";
import type { NumberSequence, SystemProperty } from "./components";

type AdminDataSnapshot = {
  permissions: Permission[];
  systemProps: SystemProperty[];
  panels: AdminPanel[];
  managedUsers: ManagedUser[];
  edgeEnrollmentTokens: EdgeEnrollmentToken[];
  edgeCollectors: EdgeCollector[];
  edgeRuntimeConfig: EdgeRuntimeConfig | null;
  numberSequences: NumberSequence[];
  numberSequenceOptions: NumberSequenceOption[];
  credentials: CredentialReference[];
  ssoConfigs: SsoConfig[];
  identityGroups: IdentityGroup[];
  identityGroupMemberships: IdentityGroupMembership[];
  identityGroupPermissions: IdentityGroupPermission[];
  cmdbGroupOptions: CmdbGroupOption[];
  rbacUsers: RbacUser[];
  rbacGroups: RbacGroup[];
  rbacTargets: RbacTarget[];
  rbacApps: RbacApp[];
  rbacTools: RbacTool[];
  rbacTables: RbacTable[];
  fieldRestrictionTables: FieldRestrictionTable[];
  policyDrift: PolicyDriftReport | null;
  auditEntries: AuditEntry[];
  auditTotal: number;
  auditIntegrity: AuditIntegrity | null;
  provisioningJobs: ProvisioningJob[];
  operationalIntelligence: OperationalIntelligence | null;
};

async function fetchJson<T>(path: string, fallback: T, required = false): Promise<T> {
  const response = await fetch(`${ADMIN_API_URL}${path}`, {
    headers: adminAuthHeaders(),
  });
  if (!response.ok) {
    if (required) throw new Error(`Failed to fetch ${path}`);
    return fallback;
  }
  return response.json().catch(() => fallback);
}

export async function loadAdminData(): Promise<AdminDataSnapshot> {
  const [
    permData,
    propData,
    panelData,
    userData,
    edgeEnrollmentData,
    edgeCollectorData,
    edgeRuntimeData,
    sequenceData,
    sequenceOptionsData,
    credentialData,
    identityData,
    groupsData,
    rbacOptionsData,
    fieldRestrictionsData,
    driftData,
    auditData,
    integrityData,
    jobsData,
    opsData,
  ] = await Promise.all([
    fetchJson<{ permissions: Permission[] }>("/api/admin/permissions", { permissions: [] }, true),
    fetchJson<{ properties: SystemProperty[] }>("/api/admin/system-properties", { properties: [] }, true),
    fetchJson<{ panels: AdminPanel[] }>("/api/admin/panels", { panels: [] }),
    fetchJson<{ users: ManagedUser[] }>("/api/admin/users", { users: [] }),
    fetchJson<{ tokens: EdgeEnrollmentToken[] }>("/api/admin/edge-enrollment/tokens", { tokens: [] }),
    fetchJson<{ collectors: EdgeCollector[] }>("/api/admin/edge-enrollment/collectors", { collectors: [] }),
    fetchJson<EdgeRuntimeConfig | null>("/api/admin/edge-enrollment/runtime-config", null),
    fetchJson<{ sequences: NumberSequence[] }>("/api/admin/number-sequences", { sequences: [] }),
    fetchJson<{ options: NumberSequenceOption[] }>("/api/admin/number-sequences/options", { options: [] }),
    fetchJson<{ credentials: CredentialReference[] }>("/api/admin/credentials", { credentials: [] }),
    fetchJson<{ configs: SsoConfig[] }>("/api/admin/identity/sso-configs", { configs: [] }),
    fetchJson<{ groups: IdentityGroup[]; memberships: IdentityGroupMembership[]; permissions: IdentityGroupPermission[]; cmdbGroupOptions: CmdbGroupOption[] }>("/api/admin/identity/groups", { groups: [], memberships: [], permissions: [], cmdbGroupOptions: [] }),
    fetchJson<{ users: RbacUser[]; groups: RbacGroup[]; targets: RbacTarget[]; apps: RbacApp[]; tools: RbacTool[]; tables: RbacTable[] }>("/api/admin/rbac/options", { users: [], groups: [], targets: [], apps: [], tools: [], tables: [] }),
    fetchJson<{ tables: FieldRestrictionTable[] }>("/api/admin/rbac/field-restrictions", { tables: [] }),
    fetchJson<PolicyDriftReport | null>("/api/admin/rbac/policy-drift", null),
    fetchJson<{ entries: AuditEntry[]; total: number }>("/api/admin/audit-log?limit=25", { entries: [], total: 0 }),
    fetchJson<AuditIntegrity | null>("/api/admin/audit-log/integrity", null),
    fetchJson<{ jobs: ProvisioningJob[] }>("/api/apps/provisioning-jobs", { jobs: [] }),
    fetchJson<OperationalIntelligence | null>("/api/admin/operational-intelligence", null),
  ]);

  return {
    permissions: permData.permissions || [],
    systemProps: propData.properties || [],
    panels: panelData.panels || [],
    managedUsers: userData.users || [],
    edgeEnrollmentTokens: edgeEnrollmentData.tokens || [],
    edgeCollectors: edgeCollectorData.collectors || [],
    edgeRuntimeConfig: edgeRuntimeData,
    numberSequences: sequenceData.sequences || [],
    numberSequenceOptions: sequenceOptionsData.options || [],
    credentials: credentialData.credentials || [],
    ssoConfigs: identityData.configs || [],
    identityGroups: groupsData.groups || [],
    identityGroupMemberships: groupsData.memberships || [],
    identityGroupPermissions: groupsData.permissions || [],
    cmdbGroupOptions: groupsData.cmdbGroupOptions || [],
    rbacUsers: rbacOptionsData.users || [],
    rbacGroups: rbacOptionsData.groups || [],
    rbacTargets: rbacOptionsData.targets || [],
    rbacApps: rbacOptionsData.apps || [],
    rbacTools: rbacOptionsData.tools || [],
    rbacTables: rbacOptionsData.tables || [],
    fieldRestrictionTables: fieldRestrictionsData.tables || [],
    policyDrift: driftData,
    auditEntries: auditData.entries || [],
    auditTotal: auditData.total || 0,
    auditIntegrity: integrityData,
    provisioningJobs: jobsData.jobs || [],
    operationalIntelligence: opsData,
  };
}
