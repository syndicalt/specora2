import type { NumberSequence, SystemProperty } from "./components";

export type Permission = {
  id: string;
  role: string;
  resource: string;
  action: string;
};

export type NumberSequenceOption = {
  appId: string;
  appName: string;
  tableName: string;
  recordType: string;
  defaultPrefix: string;
};

export type EnvironmentChoice = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  sortOrder: number;
  isProductionLike: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SsoConfig = {
  id: string;
  name: string;
  provider: "saml" | "oidc";
  status: "active" | "inactive";
  emailDomains: string[];
  idpEntityId: string;
  idpSsoUrl: string;
  idpCertPresent: boolean;
  spEntityId: string;
  spAcsUrl: string;
  metadataUrl: string;
  metadataXmlPresent: boolean;
  jitEnabled: boolean;
  clientId: string;
  clientSecretRef: string;
  issuerUrl: string;
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scopes: string[];
  enforceSso: boolean;
  defaultRole: string;
  attributeMapping: { email: string; name: string; groups: string };
  createdAt: string;
  updatedAt: string;
};

export type CredentialReference = {
  id: string;
  ref: string;
  name: string;
  provider: "managed" | "env" | "external";
  status: "active" | "disabled";
  description: string;
  scope: string;
  secretPresent: boolean;
  secretEnvKey: string;
  externalRef: string;
  metadata: Record<string, unknown>;
  lastTestedAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IdentityGroup = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  source: string;
  external_id?: string | null;
  cmdb_ci_id?: string | null;
};

export type IdentityGroupMembership = {
  id: string;
  group_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  source: string;
};

export type IdentityGroupPermission = {
  id: string;
  group_id: string;
  resource: string;
  action: string;
};

export type AdminPanel = {
  id: string;
  name: string;
  icon: string;
  permissions: string[];
  appId?: string;
};

export type CmdbGroupOption = {
  id: string;
  name: string;
};

export type RbacUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type ManagedUser = RbacUser & {
  createdAt?: string | null;
  updatedAt?: string | null;
  lastLoginAt?: string | null;
  activeSessions: number;
  failedLogins24h: number;
  groupCount: number;
  highRiskGrants: number;
  ownedRecords: number;
  status: string;
  authMethod: string;
  passwordChangeRequired?: boolean;
};

export type ManagedUserDetail = {
  user: ManagedUser;
  directGrants: Array<{ id: string; role: string; resource: string; action: string; risk: string; source: string }>;
  inheritedGroups: Array<{ id: string; name: string; slug: string; source: string; cmdb_ci_id?: string | null }>;
  inheritedGrants: Array<{ id: string; group_id: string; group_name: string; resource: string; action: string; risk: string; source: string }>;
  sessions: Array<{ id: string; userAgent?: string | null; ipAddress?: string | null; expiresAt?: string | null; lastUsedAt?: string | null; revokedAt?: string | null; revokedReason?: string | null; createdAt?: string | null; active: boolean }>;
  auditEvents: Array<{ id: string; action: string; entityType: string; entityId: string; metadata: any; createdAt?: string | null }>;
  impact: Record<string, number>;
  recommendations: Array<{ severity: string; title: string; rationale: string; action: string }>;
};

export type EdgeEnrollmentToken = {
  id: string;
  name: string;
  tokenPrefix: string;
  site: string;
  labels: Record<string, unknown>;
  expiresAt: string | null;
  maxUses: number;
  uses: number;
  collectorId: string | null;
  collectorName: string | null;
  revokedAt: string | null;
  createdAt: string | null;
  status: "active" | "used" | "expired" | "revoked" | string;
};

export type EdgeCollector = {
  id: string;
  name: string;
  status: string;
  site: string;
  version: string;
  labels: Record<string, unknown>;
  lastHeartbeatAt: string | null;
  heartbeatAgeMinutes: number | null;
  lastSeenIp: string | null;
  sourceCount: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export type EdgeRuntimeConfig = {
  publicSigningKey: string;
  runtimeConfig: {
    key_id: string;
    keyring: Record<string, string>;
    collector_manifest: Array<Record<string, unknown>>;
    capability_policy: Record<string, unknown>;
    suggested_paths: Record<string, string>;
    readiness: Record<string, boolean>;
    signature: string;
    signed_at: string;
  };
};

export type RbacGroup = {
  id: string;
  name: string;
  slug: string;
  source: string;
  cmdb_ci_id?: string | null;
};

export type RbacTarget = {
  resource: string;
  action: string;
  risk: "low" | "medium" | "high" | "critical";
  label?: string;
  description?: string;
  category?: string;
  source?: string;
};

export type RbacApp = {
  id: string;
  name: string;
  permissions: string[];
};

export type RbacTool = {
  appId: string;
  toolName: string;
  fullName: string;
  description?: string;
  resource: string;
  action: string;
};

export type RbacTable = {
  id: string;
  name: string;
  label: string;
  provider: string;
  category?: string;
  fields: Array<{ name: string; label: string; writable: boolean }>;
};

export type FieldRestrictionField = {
  name: string;
  label: string;
  writable: boolean;
  resource: string;
  restricted: boolean;
};

export type FieldRestrictionTable = {
  id: string;
  name: string;
  label: string;
  provider: string;
  category?: string;
  fields: FieldRestrictionField[];
};

export type AccessAnalysis = {
  allowed: boolean;
  reason: string;
  risk: string;
  user: RbacUser | null;
  role: string;
  resource: string;
  action: string;
  relatedApps: { id: string; name: string; permissions: string[] }[];
  missing: { resource: string; action: string }[];
  trace: { status: "allow" | "deny" | "info"; label: string; detail: string }[];
};

export type AppAccessExplanation = {
  allowed: boolean;
  user: RbacUser | null;
  role: string;
  app: {
    id: string;
    name: string;
    description?: string;
    permissions: string[];
    chatCapabilities: number;
    chatTools: number;
    events: string[];
    adminPanels: number;
  };
  requirements: Array<{
    declaredPermission: string;
    resource: string;
    action: string;
    allowed: boolean;
    reason: string;
    risk: string;
    description: string;
  }>;
  missing: Array<{ resource: string; action: string; risk: string }>;
  remediation: Array<{ role: string; resource: string; action: string; risk: string; reason: string }>;
  trace: { status: "allow" | "deny" | "info"; label: string; detail: string }[];
};

export type ToolAccessExplanation = {
  allowed: boolean;
  user: RbacUser | null;
  role: string;
  tool: {
    appId: string;
    toolName: string;
    fullName: string;
    description?: string;
    resource: string;
    action: string;
    risk: string;
  };
  requirement: {
    resource: string;
    action: string;
    allowed: boolean;
    reason: string;
    risk: string;
    description: string;
  };
  missing: Array<{ resource: string; action: string; risk: string }>;
  remediation: Array<{ role: string; resource: string; action: string; risk: string; reason: string }>;
  trace: { status: "allow" | "deny" | "info"; label: string; detail: string }[];
};

export type TableAccessExplanation = {
  allowed: boolean;
  user: RbacUser | null;
  role: string;
  accessMode: "read" | "write";
  table: {
    id: string;
    name: string;
    label: string;
    provider: string;
    category?: string;
    fieldCount: number;
  };
  tableAccess: {
    read: { allowed: boolean; reason: string; risk: string };
    write: { allowed: boolean; reason: string; risk: string };
  };
  fields: Array<{
    field: string;
    label: string;
    resource: string;
    writable: boolean;
    restricted: boolean;
    read: boolean;
    write: boolean;
    readReason: string;
    writeReason: string;
    readRisk: string;
    writeRisk: string;
  }>;
  missing: Array<{ resource: string; action: string; risk: string; field?: string }>;
  remediation: Array<{ role: string; resource: string; action: string; risk: string; reason: string }>;
  trace: { status: "allow" | "deny" | "info"; label: string; detail: string }[];
};

export type PolicyDriftReport = {
  generatedAt: string;
  summary: {
    roles: number;
    registeredTargets: number;
    grants: number;
    orphaned: number;
    missingHighRisk: number;
    duplicates: number;
    posture: string;
  };
  roleCoverage: Array<{
    role: string;
    required: number;
    granted: number;
    score: number;
    missing: Array<{ role: string; resource: string; action: string; risk: string; apps: Array<{ id: string; name: string }> }>;
  }>;
  orphaned: Array<{ id: string; role: string; resource: string; action: string; risk: string; reason: string }>;
};

export type AuditEntry = {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: any;
  previousHash: string | null;
  entryHash: string | null;
  integrityVersion: number;
  createdAt?: string | null;
  created_at?: string | null;
};

export type AuditIntegrity = {
  verified: boolean;
  checked: number;
  legacyRows: number;
  headHash: string | null;
  failures: Array<{ id: string; reason: string; expected?: string; actual?: string }>;
};

export type ProvisioningJob = {
  id: string;
  app_id: string;
  action: string;
  status: string;
  message: string | null;
  data_retention_policy: string;
  clear_data_on_uninstall: boolean;
  created_at: string;
  completed_at: string | null;
};

export type OperationalDomain = {
  id: string;
  label: string;
  score: number;
  posture: "healthy" | "watch" | "attention" | string;
  metrics: { label: string; value: string | number | null }[];
};

export type OperationalSignal = {
  severity: "critical" | "warning" | "info" | string;
  title: string;
  detail: string;
  action: string;
  appId: string;
};

export type OperationalIntelligence = {
  generatedAt: string;
  overall: { score: number; posture: string; summary: string };
  domains: OperationalDomain[];
  signals: OperationalSignal[];
  governance: {
    permissionGrants: number;
    activeSequences: number;
    auditEvents24h: number;
    activePackageJobs: number;
  };
  cmdb: { ciCount: number | null; relationshipCount: number | null };
};

export type AdminScreenContextInput = {
  permissions: Permission[];
  managedUsers: ManagedUser[];
  edgeCollectors: EdgeCollector[];
  edgeEnrollmentTokens: EdgeEnrollmentToken[];
  credentials: CredentialReference[];
  ssoConfigs: SsoConfig[];
  environmentChoices: EnvironmentChoice[];
  numberSequences: NumberSequence[];
  provisioningJobs: ProvisioningJob[];
  systemProps: SystemProperty[];
};
