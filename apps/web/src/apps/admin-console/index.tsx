"use client";

import { useState, useEffect, useMemo } from "react";
import { getToken } from "@/lib/auth";
import { getApiBase } from "@/lib/runtimeApi";
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Clipboard,
  ClipboardCheck,
  Database,
  Download,
  GitBranch,
  Hash,
  KeyRound,
  LayoutDashboard,
  Loader2,
  Eye,
  EyeOff,
  Plus,
  Radio,
  Save,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  UserCog,
  UserPlus,
  Users,
  LogOut,
  Trash2,
  XCircle,
} from "lucide-react";
import ChangeStateMachinePanel from "@/apps/change-manager/StateMachinePanel";

interface Permission {
  id: string;
  role: string;
  resource: string;
  action: string;
}

interface SystemProperty {
  key: string;
  value: string;
  updated_at: string;
}

interface NumberSequence {
  id: string;
  app_id: string | null;
  table_name: string;
  record_type: string;
  prefix: string;
  next_value: number;
  padding: number;
  enabled: boolean;
}

interface NumberSequenceOption {
  appId: string;
  appName: string;
  tableName: string;
  recordType: string;
  defaultPrefix: string;
}

type EnvironmentChoice = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  sortOrder: number;
  isProductionLike: boolean;
  createdAt: string;
  updatedAt: string;
};

interface SsoConfig {
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
}

type CredentialReference = {
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

const CREDENTIAL_SCOPE_OPTIONS = [
  { value: "discovery", label: "Discovery" },
  { value: "identity", label: "Identity Providers" },
  { value: "reporting", label: "Reporting" },
  { value: "integrations", label: "General Integrations" },
];

const CREDENTIAL_PROVIDER_OPTIONS = [
  { value: "managed", label: "Managed Secret" },
  { value: "env", label: "Environment Variable (Dev)" },
  { value: "external", label: "External Store Reference" },
];

function credentialSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function buildCredentialRef(input: { provider: string; scope: string; name: string }) {
  const provider = credentialSlug(input.provider) || "managed";
  const scope = credentialSlug(input.scope) || "discovery";
  const name = credentialSlug(input.name);
  return name ? `${provider}://${scope}/${name}` : "";
}

interface IdentityGroup {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  source: string;
  external_id?: string | null;
  cmdb_ci_id?: string | null;
}

interface IdentityGroupMembership {
  id: string;
  group_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  source: string;
}

interface IdentityGroupPermission {
  id: string;
  group_id: string;
  resource: string;
  action: string;
}

interface AdminPanel {
  id: string;
  name: string;
  icon: string;
  permissions: string[];
  appId?: string;
}

interface CmdbGroupOption {
  id: string;
  name: string;
}

interface RbacUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface ManagedUser extends RbacUser {
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
}

interface ManagedUserDetail {
  user: ManagedUser;
  directGrants: Array<{ id: string; role: string; resource: string; action: string; risk: string; source: string }>;
  inheritedGroups: Array<{ id: string; name: string; slug: string; source: string; cmdb_ci_id?: string | null }>;
  inheritedGrants: Array<{ id: string; group_id: string; group_name: string; resource: string; action: string; risk: string; source: string }>;
  sessions: Array<{ id: string; userAgent?: string | null; ipAddress?: string | null; expiresAt?: string | null; lastUsedAt?: string | null; revokedAt?: string | null; revokedReason?: string | null; createdAt?: string | null; active: boolean }>;
  auditEvents: Array<{ id: string; action: string; entityType: string; entityId: string; metadata: any; createdAt?: string | null }>;
  impact: Record<string, number>;
  recommendations: Array<{ severity: string; title: string; rationale: string; action: string }>;
}

interface EdgeEnrollmentToken {
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
}

interface EdgeCollector {
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
}

interface EdgeRuntimeConfig {
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
}

interface RbacGroup {
  id: string;
  name: string;
  slug: string;
  source: string;
  cmdb_ci_id?: string | null;
}

interface RbacTarget {
  resource: string;
  action: string;
  risk: "low" | "medium" | "high" | "critical";
  label?: string;
  description?: string;
  category?: string;
  source?: string;
}

interface RbacApp {
  id: string;
  name: string;
  permissions: string[];
}

interface RbacTool {
  appId: string;
  toolName: string;
  fullName: string;
  description?: string;
  resource: string;
  action: string;
}

interface RbacTable {
  id: string;
  name: string;
  label: string;
  provider: string;
  category?: string;
  fields: Array<{ name: string; label: string; writable: boolean }>;
}

interface FieldRestrictionField {
  name: string;
  label: string;
  writable: boolean;
  resource: string;
  restricted: boolean;
}

interface FieldRestrictionTable {
  id: string;
  name: string;
  label: string;
  provider: string;
  category?: string;
  fields: FieldRestrictionField[];
}

interface AccessAnalysis {
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
}

interface AppAccessExplanation {
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
}

interface ToolAccessExplanation {
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
}

interface TableAccessExplanation {
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
}

interface PolicyDriftReport {
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
}

interface AuditEntry {
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
}

function formatDateTime(value?: string | null) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
}

interface AuditIntegrity {
  verified: boolean;
  checked: number;
  legacyRows: number;
  headHash: string | null;
  failures: Array<{ id: string; reason: string; expected?: string; actual?: string }>;
}

interface ProvisioningJob {
  id: string;
  app_id: string;
  action: string;
  status: string;
  message: string | null;
  data_retention_policy: string;
  clear_data_on_uninstall: boolean;
  created_at: string;
  completed_at: string | null;
}

interface OperationalDomain {
  id: string;
  label: string;
  score: number;
  posture: "healthy" | "watch" | "attention" | string;
  metrics: { label: string; value: string | number | null }[];
}

interface OperationalSignal {
  severity: "critical" | "warning" | "info" | string;
  title: string;
  detail: string;
  action: string;
  appId: string;
}

interface OperationalIntelligence {
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
}



const PANEL_COMPONENTS: Record<string, React.ComponentType<{ shell: any }>> = {
  "change-manager-state-machine": ChangeStateMachinePanel,
};

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Activity,
  ClipboardCheck,
  Database,
  Download,
  GitBranch,
  Hash,
  KeyRound,
  LayoutDashboard,
  Settings,
  Shield,
  ShieldCheck,
  Users,
  Radio,
};

const PERMISSION_VALUE_SEPARATOR = "\u0000";

function encodePermissionValue(resource: string, action: string) {
  return `${resource}${PERMISSION_VALUE_SEPARATOR}${action}`;
}

function decodePermissionValue(value: string) {
  const [resource, action] = value.split(PERMISSION_VALUE_SEPARATOR);
  return [resource || "", action || ""] as const;
}

function appPermissionToResourceAction(permission: string) {
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

function riskClass(risk?: string) {
  if (risk === "critical") return "border-red-400/40 bg-red-500/10 text-red-200";
  if (risk === "high") return "border-orange-400/40 bg-orange-500/10 text-orange-200";
  if (risk === "medium") return "border-amber-400/40 bg-amber-500/10 text-amber-100";
  return "border-emerald-400/30 bg-emerald-500/10 text-emerald-200";
}

function postureClass(posture?: string) {
  if (posture === "attention") return "border-red-500/30 bg-red-500/10 text-red-100";
  if (posture === "watch") return "border-amber-500/30 bg-amber-500/10 text-amber-100";
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
}

function scoreText(score?: number) {
  if (score === undefined || score === null) return "-";
  return `${Math.round(score)}`;
}

const ADMIN_SCREEN_CONTEXT: Record<string, { purpose: string; primaryActions: string[]; state?: (input: {
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
}) => Record<string, string | number | boolean> }> = {
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

export default function AdminConsoleApp({ shell }: { shell: any }) {
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [panels, setPanels] = useState<AdminPanel[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [systemProps, setSystemProps] = useState<SystemProperty[]>([]);
  const [numberSequences, setNumberSequences] = useState<NumberSequence[]>([]);
  const [numberSequenceOptions, setNumberSequenceOptions] = useState<NumberSequenceOption[]>([]);
  const [environmentChoices, setEnvironmentChoices] = useState<EnvironmentChoice[]>([]);
  const [environmentDraft, setEnvironmentDraft] = useState({ code: "", name: "", active: true, sortOrder: "100", isProductionLike: false });
  const [ssoConfigs, setSsoConfigs] = useState<SsoConfig[]>([]);
  const [credentials, setCredentials] = useState<CredentialReference[]>([]);
  const [identityGroups, setIdentityGroups] = useState<IdentityGroup[]>([]);
  const [identityGroupMemberships, setIdentityGroupMemberships] = useState<IdentityGroupMembership[]>([]);
  const [identityGroupPermissions, setIdentityGroupPermissions] = useState<IdentityGroupPermission[]>([]);
  const [cmdbGroupOptions, setCmdbGroupOptions] = useState<CmdbGroupOption[]>([]);
  const [newIdentityGroup, setNewIdentityGroup] = useState({ name: "", description: "", cmdbCiId: "" });
  const [groupMemberUserId, setGroupMemberUserId] = useState("");
  const [groupGrant, setGroupGrant] = useState({ resource: "", action: "" });
  const [newSsoConfig, setNewSsoConfig] = useState({
    name: "",
    provider: "saml" as "saml" | "oidc",
    status: "inactive" as "active" | "inactive",
    emailDomains: "",
    idpSsoUrl: "",
    idpEntityId: "",
    metadataUrl: "",
    metadataXml: "",
    issuerUrl: "",
    authorizationUrl: "",
    tokenUrl: "",
    userinfoUrl: "",
    clientId: "",
    clientSecretRef: "",
    scopes: "openid,email,profile",
    enforceSso: false,
    jitEnabled: true,
    defaultRole: "user",
  });
  const [isSsoRegisterOpen, setIsSsoRegisterOpen] = useState(false);
  const [newCredential, setNewCredential] = useState({
    name: "",
    ref: "",
    provider: "managed",
    status: "active",
    scope: "discovery",
    secretValue: "",
    secretEnvKey: "",
    externalRef: "",
    description: "",
  });
  const [rbacUsers, setRbacUsers] = useState<RbacUser[]>([]);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedUserDetail, setSelectedUserDetail] = useState<ManagedUserDetail | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [userDraft, setUserDraft] = useState({ email: "", name: "", role: "operator", password: "" });
  const [userEditDraft, setUserEditDraft] = useState({ name: "", role: "" });
  const [edgeEnrollmentTokens, setEdgeEnrollmentTokens] = useState<EdgeEnrollmentToken[]>([]);
  const [edgeCollectors, setEdgeCollectors] = useState<EdgeCollector[]>([]);
  const [edgeRuntimeConfig, setEdgeRuntimeConfig] = useState<EdgeRuntimeConfig | null>(null);
  const [edgeEnrollmentDraft, setEdgeEnrollmentDraft] = useState({ name: "", site: "", labels: "", expiresInHours: "24", maxUses: "1" });
  const [issuedEnrollmentToken, setIssuedEnrollmentToken] = useState("");
  const [rbacGroups, setRbacGroups] = useState<RbacGroup[]>([]);
  const [rbacTargets, setRbacTargets] = useState<RbacTarget[]>([]);
  const [rbacApps, setRbacApps] = useState<RbacApp[]>([]);
  const [rbacTools, setRbacTools] = useState<RbacTool[]>([]);
  const [rbacTables, setRbacTables] = useState<RbacTable[]>([]);
  const [accessProbe, setAccessProbe] = useState({ userId: "", role: "", target: "" });
  const [accessAnalysis, setAccessAnalysis] = useState<AccessAnalysis | null>(null);
  const [appAccessProbe, setAppAccessProbe] = useState({ userId: "", role: "", appId: "" });
  const [appAccessExplanation, setAppAccessExplanation] = useState<AppAccessExplanation | null>(null);
  const [toolAccessProbe, setToolAccessProbe] = useState({ userId: "", role: "", tool: "" });
  const [toolAccessExplanation, setToolAccessExplanation] = useState<ToolAccessExplanation | null>(null);
  const [tableAccessProbe, setTableAccessProbe] = useState({ userId: "", role: "", tableId: "", fieldName: "", accessMode: "read" });
  const [tableAccessExplanation, setTableAccessExplanation] = useState<TableAccessExplanation | null>(null);
  const [fieldRestrictionTables, setFieldRestrictionTables] = useState<FieldRestrictionTable[]>([]);
  const [fieldRestrictionTableId, setFieldRestrictionTableId] = useState("");
  const [policyDrift, setPolicyDrift] = useState<PolicyDriftReport | null>(null);
  const [selectedBulkGrants, setSelectedBulkGrants] = useState<Record<string, boolean>>({});
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditSearch, setAuditSearch] = useState("");
  const [auditIntegrity, setAuditIntegrity] = useState<AuditIntegrity | null>(null);
  const [openRbacUtilities, setOpenRbacUtilities] = useState<Record<string, boolean>>({
    app: true,
    tool: false,
    table: true,
    fieldRestrictions: false,
    analyzer: false,
    drift: false,
    audit: false,
  });
  const [provisioningJobs, setProvisioningJobs] = useState<ProvisioningJob[]>([]);
  const [operationalIntelligence, setOperationalIntelligence] = useState<OperationalIntelligence | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [adminSearch, setAdminSearch] = useState("");

  const [newRole, setNewRole] = useState("");
  const [newResource, setNewResource] = useState("");
  const [newAction, setNewAction] = useState("");
  const [grantScope, setGrantScope] = useState("All");
  const [grantSearch, setGrantSearch] = useState("");
  const [newPropKey, setNewPropKey] = useState("");
  const [newPropValue, setNewPropValue] = useState("");
  const [showCredentialSecret, setShowCredentialSecret] = useState(false);
  const [newSequence, setNewSequence] = useState({ appId: "", tableName: "", recordType: "", prefix: "", nextValue: "1", padding: "6" });

  const API_URL = getApiBase();

  useEffect(() => {
    fetchData();
    fetchEnvironmentChoices();
  }, []);

  async function adminGraphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const token = getToken();
    const res = await fetch(`${API_URL}/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
      body: JSON.stringify({ query, variables }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.errors?.length) {
      throw new Error(data.errors?.[0]?.message || "GraphQL request failed");
    }
    return data.data as T;
  }

  async function fetchEnvironmentChoices() {
    try {
      const data = await adminGraphql<{ ciEnvironmentChoices: EnvironmentChoice[] }>(`
        query AdminEnvironmentChoices {
          ciEnvironmentChoices(activeOnly: false) {
            id
            code
            name
            active
            sortOrder
            isProductionLike
            createdAt
            updatedAt
          }
        }
      `);
      setEnvironmentChoices(data.ciEnvironmentChoices || []);
    } catch (err: any) {
      setError(err.message || "Failed to fetch environment choices");
    }
  }

  useEffect(() => {
    if (newSequence.appId || !numberSequenceOptions.length) return;
    setNewSequenceFromOption(numberSequenceOptions[0]);
  }, [numberSequenceOptions, newSequence.appId]);

  useEffect(() => {
    if (activeTab !== "users" || !selectedUserId) return;
    fetchUserDetail(selectedUserId);
  }, [activeTab, selectedUserId]);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const token = getToken();
      const [permRes, propRes, panelRes, userRes, edgeEnrollmentRes, edgeCollectorRes, edgeRuntimeRes, sequenceRes, sequenceOptionsRes, credentialRes, identityRes, groupsRes, rbacOptionsRes, fieldRestrictionsRes, driftRes, auditRes, integrityRes, jobsRes, opsRes] = await Promise.all([
        fetch(`${API_URL}/api/admin/permissions`, { headers: { Authorization: `Bearer ${token || ""}` } }),
        fetch(`${API_URL}/api/admin/system-properties`, { headers: { Authorization: `Bearer ${token || ""}` } }),
        fetch(`${API_URL}/api/admin/panels`, { headers: { Authorization: `Bearer ${token || ""}` } }),
        fetch(`${API_URL}/api/admin/users`, { headers: { Authorization: `Bearer ${token || ""}` } }),
        fetch(`${API_URL}/api/admin/edge-enrollment/tokens`, { headers: { Authorization: `Bearer ${token || ""}` } }),
        fetch(`${API_URL}/api/admin/edge-enrollment/collectors`, { headers: { Authorization: `Bearer ${token || ""}` } }),
        fetch(`${API_URL}/api/admin/edge-enrollment/runtime-config`, { headers: { Authorization: `Bearer ${token || ""}` } }),
        fetch(`${API_URL}/api/admin/number-sequences`, { headers: { Authorization: `Bearer ${token || ""}` } }),
        fetch(`${API_URL}/api/admin/number-sequences/options`, { headers: { Authorization: `Bearer ${token || ""}` } }),
        fetch(`${API_URL}/api/admin/credentials`, { headers: { Authorization: `Bearer ${token || ""}` } }),
        fetch(`${API_URL}/api/admin/identity/sso-configs`, { headers: { Authorization: `Bearer ${token || ""}` } }),
        fetch(`${API_URL}/api/admin/identity/groups`, { headers: { Authorization: `Bearer ${token || ""}` } }),
        fetch(`${API_URL}/api/admin/rbac/options`, { headers: { Authorization: `Bearer ${token || ""}` } }),
        fetch(`${API_URL}/api/admin/rbac/field-restrictions`, { headers: { Authorization: `Bearer ${token || ""}` } }),
        fetch(`${API_URL}/api/admin/rbac/policy-drift`, { headers: { Authorization: `Bearer ${token || ""}` } }),
        fetch(`${API_URL}/api/admin/audit-log?limit=25`, { headers: { Authorization: `Bearer ${token || ""}` } }),
        fetch(`${API_URL}/api/admin/audit-log/integrity`, { headers: { Authorization: `Bearer ${token || ""}` } }),
        fetch(`${API_URL}/api/apps/provisioning-jobs`, { headers: { Authorization: `Bearer ${token || ""}` } }),
        fetch(`${API_URL}/api/admin/operational-intelligence`, { headers: { Authorization: `Bearer ${token || ""}` } }),
      ]);

      if (!permRes.ok) throw new Error("Failed to fetch permissions");
      if (!propRes.ok) throw new Error("Failed to fetch system properties");

      const permData = await permRes.json();
      const propData = await propRes.json();
      const panelData = panelRes.ok ? await panelRes.json() : { panels: [] };
      const userData = userRes.ok ? await userRes.json() : { users: [] };
      const edgeEnrollmentData = edgeEnrollmentRes.ok ? await edgeEnrollmentRes.json() : { tokens: [] };
      const edgeCollectorData = edgeCollectorRes.ok ? await edgeCollectorRes.json() : { collectors: [] };
      const edgeRuntimeData = edgeRuntimeRes.ok ? await edgeRuntimeRes.json() : null;
      const sequenceData = sequenceRes.ok ? await sequenceRes.json() : { sequences: [] };
      const sequenceOptionsData = sequenceOptionsRes.ok ? await sequenceOptionsRes.json() : { options: [] };
      const credentialData = credentialRes.ok ? await credentialRes.json() : { credentials: [] };
      const identityData = identityRes.ok ? await identityRes.json() : { configs: [] };
      const groupsData = groupsRes.ok ? await groupsRes.json() : { groups: [], memberships: [], permissions: [], cmdbGroupOptions: [] };
      const rbacOptionsData = rbacOptionsRes.ok ? await rbacOptionsRes.json() : { users: [], targets: [] };
      const fieldRestrictionsData = fieldRestrictionsRes.ok ? await fieldRestrictionsRes.json() : { tables: [] };
      const driftData = driftRes.ok ? await driftRes.json() : null;
      const auditData = auditRes.ok ? await auditRes.json() : { entries: [], total: 0 };
      const integrityData = integrityRes.ok ? await integrityRes.json() : null;
      const jobsData = jobsRes.ok ? await jobsRes.json() : { jobs: [] };
      const opsData = opsRes.ok ? await opsRes.json() : null;

      setPermissions(permData.permissions || []);
      setSystemProps(propData.properties || []);
      setPanels(panelData.panels || []);
      setManagedUsers(userData.users || []);
      setSelectedUserId((current) => current || userData.users?.[0]?.id || "");
      setEdgeEnrollmentTokens(edgeEnrollmentData.tokens || []);
      setEdgeCollectors(edgeCollectorData.collectors || []);
      setEdgeRuntimeConfig(edgeRuntimeData);
      setNumberSequences(sequenceData.sequences || []);
      setNumberSequenceOptions(sequenceOptionsData.options || []);
      setCredentials(credentialData.credentials || []);
      setSsoConfigs(identityData.configs || []);
      setIdentityGroups(groupsData.groups || []);
      setIdentityGroupMemberships(groupsData.memberships || []);
      setIdentityGroupPermissions(groupsData.permissions || []);
      setCmdbGroupOptions(groupsData.cmdbGroupOptions || []);
      setRbacUsers(rbacOptionsData.users || []);
      setRbacGroups(rbacOptionsData.groups || []);
      setRbacTargets(rbacOptionsData.targets || []);
      setRbacApps(rbacOptionsData.apps || []);
      setRbacTools(rbacOptionsData.tools || []);
      setRbacTables(rbacOptionsData.tables || []);
      setFieldRestrictionTables(fieldRestrictionsData.tables || []);
      setFieldRestrictionTableId((current) => current || fieldRestrictionsData.tables?.[0]?.id || "");
      setPolicyDrift(driftData);
      setAuditEntries(auditData.entries || []);
      setAuditTotal(auditData.total || 0);
      setAuditIntegrity(integrityData);
      setProvisioningJobs(jobsData.jobs || []);
      setOperationalIntelligence(opsData);
      setAccessProbe((current) => {
        if (current.userId || current.role || current.target) return current;
        const firstUser = rbacOptionsData.users?.[0];
        const firstTarget = rbacOptionsData.targets?.[0];
        return {
          userId: firstUser?.id || "",
          role: firstUser?.role || "",
          target: firstTarget ? encodePermissionValue(firstTarget.resource, firstTarget.action) : "",
        };
      });
      setAppAccessProbe((current) => {
        if (current.userId || current.role || current.appId) return current;
        const firstUser = rbacOptionsData.users?.[0];
        const firstApp = rbacOptionsData.apps?.[0];
        return {
          userId: firstUser?.id || "",
          role: firstUser?.role || "",
          appId: firstApp?.id || "",
        };
      });
      setToolAccessProbe((current) => {
        if (current.userId || current.role || current.tool) return current;
        const firstUser = rbacOptionsData.users?.[0];
        const firstTool = rbacOptionsData.tools?.[0];
        return {
          userId: firstUser?.id || "",
          role: firstUser?.role || "",
          tool: firstTool ? `${firstTool.appId}${PERMISSION_VALUE_SEPARATOR}${firstTool.toolName}` : "",
        };
      });
      setTableAccessProbe((current) => {
        if (current.userId || current.role || current.tableId) return current;
        const firstUser = rbacOptionsData.users?.[0];
        const firstTable = rbacOptionsData.tables?.[0];
        return {
          userId: firstUser?.id || "",
          role: firstUser?.role || "",
          tableId: firstTable?.id || "",
          fieldName: "",
          accessMode: "read",
        };
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function fetchUserDetail(userId: string) {
    if (!userId) return;
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/users/${userId}`, { headers: { Authorization: `Bearer ${token || ""}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch user detail");
      setSelectedUserDetail(data);
      setUserEditDraft({ name: data.user?.name || "", role: data.user?.role || "" });
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function createManagedUser(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
        body: JSON.stringify(userDraft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create user");
      setUserDraft({ email: "", name: "", role: "operator", password: "" });
      setSelectedUserId(data.user.id);
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function updateManagedUser() {
    if (!selectedUserId) return;
    setSaving(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/users/${selectedUserId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
        body: JSON.stringify(userEditDraft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update user");
      await fetchData();
      await fetchUserDetail(selectedUserId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function revokeManagedUserSessions() {
    if (!selectedUserId || !confirm("Revoke all active sessions for this user?")) return;
    setSaving(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/users/${selectedUserId}/revoke-sessions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token || ""}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to revoke sessions");
      await fetchData();
      await fetchUserDetail(selectedUserId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function parseLabels(value: string) {
    if (!value.trim()) return {};
    try {
      return JSON.parse(value);
    } catch {
      return Object.fromEntries(value.split(",").map((pair) => pair.trim()).filter(Boolean).map((pair) => {
        const [key, ...rest] = pair.split("=");
        return [key.trim(), rest.join("=").trim() || true];
      }));
    }
  }

  async function createEdgeEnrollmentToken(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setIssuedEnrollmentToken("");
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/edge-enrollment/tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
        body: JSON.stringify({
          name: edgeEnrollmentDraft.name,
          site: edgeEnrollmentDraft.site,
          labels: parseLabels(edgeEnrollmentDraft.labels),
          expiresInHours: Number(edgeEnrollmentDraft.expiresInHours || 24),
          maxUses: Number(edgeEnrollmentDraft.maxUses || 1),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create enrollment token");
      setIssuedEnrollmentToken(data.token || "");
      setEdgeEnrollmentDraft({ name: "", site: "", labels: "", expiresInHours: "24", maxUses: "1" });
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function revokeEdgeEnrollmentToken(id: string) {
    setSaving(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/edge-enrollment/tokens/${id}/revoke`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token || ""}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to revoke enrollment token");
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteEdgeCollector(id: string, name: string) {
    if (!confirm(`Delete edge collector registration "${name}"? This removes the registration from Specora but does not uninstall the edge server.`)) return;
    setSaving(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/edge-enrollment/collectors/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token || ""}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete edge collector");
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function copyEdgeRuntimeConfig() {
    if (!edgeRuntimeConfig) return;
    const value = JSON.stringify(edgeRuntimeConfig.runtimeConfig, null, 2);
    try {
      await navigator.clipboard.writeText(value);
      shell.dispatch?.({ type: "NOTIFY", notification: { id: crypto.randomUUID(), message: "Runtime config copied", type: "success" } });
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      shell.dispatch?.({ type: "NOTIFY", notification: { id: crypto.randomUUID(), message: "Runtime config copied", type: "success" } });
    }
  }

  async function copyIssuedEnrollmentToken() {
    if (!issuedEnrollmentToken) return;
    try {
      await navigator.clipboard.writeText(issuedEnrollmentToken);
      shell.dispatch?.({ type: "NOTIFY", notification: { id: crypto.randomUUID(), message: "Enrollment token copied", type: "success" } });
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = issuedEnrollmentToken;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      shell.dispatch?.({ type: "NOTIFY", notification: { id: crypto.randomUUID(), message: "Enrollment token copied", type: "success" } });
    }
  }

  async function addPermission(e: React.FormEvent) {
    e.preventDefault();
    if (!newRole || !newResource || !newAction) return;
    setSaving(true);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/permissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
        body: JSON.stringify({ role: newRole, resource: newResource, action: newAction }),
      });
      if (!res.ok) throw new Error("Failed to add permission");
      setNewRole(""); setNewResource(""); setNewAction("");
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function bulkGrantPermissions(role: string, grants: Array<{ resource: string; action: string }>) {
    if (!role || !grants.length) return;
    setSaving(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/rbac/bulk-permissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
        body: JSON.stringify({ role, grants }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to bulk grant permissions");
      setSelectedBulkGrants({});
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function searchAuditLog(e?: React.FormEvent) {
    e?.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const token = getToken();
      const params = new URLSearchParams({ limit: "50" });
      if (auditSearch.trim()) params.set("q", auditSearch.trim());
      const res = await fetch(`${API_URL}/api/admin/audit-log?${params.toString()}`, { headers: { Authorization: `Bearer ${token || ""}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to search audit log");
      setAuditEntries(data.entries || []);
      setAuditTotal(data.total || 0);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function verifyAuditLog() {
    setSaving(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/audit-log/integrity`, { headers: { Authorization: `Bearer ${token || ""}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to verify audit integrity");
      setAuditIntegrity(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function exportAuditLog() {
    const params = new URLSearchParams({ limit: "500", format: "csv" });
    if (auditSearch.trim()) params.set("q", auditSearch.trim());
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/audit-log?${params.toString()}`, { headers: { Authorization: `Bearer ${token || ""}` } });
      if (!res.ok) throw new Error("Failed to export audit log");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "specora-audit-log.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function deletePermission(id: string) {
    if (!confirm("Delete this permission?")) return;
    setSaving(true);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/permissions/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token || ""}` },
      });
      if (!res.ok) throw new Error("Failed to delete permission");
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function analyzeAccess(e?: React.FormEvent) {
    e?.preventDefault();
    const [resource, action] = decodePermissionValue(accessProbe.target);
    if ((!accessProbe.userId && !accessProbe.role) || !resource || !action) return;
    setSaving(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/rbac/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
        body: JSON.stringify({
          userId: accessProbe.userId || undefined,
          role: accessProbe.userId ? undefined : accessProbe.role,
          resource,
          action,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to analyze access");
      setAccessAnalysis(data.result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function explainAppAccess(e?: React.FormEvent) {
    e?.preventDefault();
    if ((!appAccessProbe.userId && !appAccessProbe.role) || !appAccessProbe.appId) return;
    setSaving(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/rbac/explain-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
        body: JSON.stringify({
          userId: appAccessProbe.userId || undefined,
          role: appAccessProbe.userId ? undefined : appAccessProbe.role,
          appId: appAccessProbe.appId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to explain access");
      setAppAccessExplanation(data.result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function explainToolAccess(e?: React.FormEvent) {
    e?.preventDefault();
    const [appId, toolName] = decodePermissionValue(toolAccessProbe.tool);
    if ((!toolAccessProbe.userId && !toolAccessProbe.role) || !appId || !toolName) return;
    setSaving(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/rbac/explain-tool-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
        body: JSON.stringify({
          userId: toolAccessProbe.userId || undefined,
          role: toolAccessProbe.userId ? undefined : toolAccessProbe.role,
          appId,
          toolName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to explain tool access");
      setToolAccessExplanation(data.result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function explainTableAccess(e?: React.FormEvent) {
    e?.preventDefault();
    if ((!tableAccessProbe.userId && !tableAccessProbe.role) || !tableAccessProbe.tableId) return;
    setSaving(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/rbac/explain-table-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
        body: JSON.stringify({
          userId: tableAccessProbe.userId || undefined,
          role: tableAccessProbe.userId ? undefined : tableAccessProbe.role,
          tableId: tableAccessProbe.tableId,
          fieldName: tableAccessProbe.fieldName || undefined,
          accessMode: tableAccessProbe.accessMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to explain table access");
      setTableAccessExplanation(data.result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function prepareGrant(role: string, resource: string, action: string) {
    setNewRole(role);
    setNewResource(resource);
    setNewAction(action);
    setGrantScope("All");
    setGrantSearch(resource);
  }

  function toggleRbacUtility(id: string) {
    setOpenRbacUtilities((current) => ({ ...current, [id]: !current[id] }));
  }

  async function toggleFieldRestriction(tableId: string, field: FieldRestrictionField, restricted: boolean) {
    setSaving(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/rbac/field-restrictions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
        body: JSON.stringify({ tableId, field: field.name, restricted }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update field restriction");
      setFieldRestrictionTables((current) => current.map((table) => table.id === tableId
        ? { ...table, fields: table.fields.map((candidate) => candidate.name === field.name ? { ...candidate, restricted } : candidate) }
        : table
      ));
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function addSystemProperty(e: React.FormEvent) {
    e.preventDefault();
    if (!newPropKey || !newPropValue) return;
    setSaving(true);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/system-properties`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
        body: JSON.stringify({ key: newPropKey, value: newPropValue }),
      });
      if (!res.ok) throw new Error("Failed to add system property");
      setNewPropKey(""); setNewPropValue("");
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveEnvironmentChoice(input = environmentDraft) {
    if (!input.name.trim()) {
      setError("Environment name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await adminGraphql(`
        mutation UpsertEnvironment($input: CIEnvironmentChoiceInput!) {
          upsertCIEnvironmentChoice(input: $input) {
            id
          }
        }
      `, {
        input: {
          code: input.code || input.name,
          name: input.name,
          active: input.active,
          sortOrder: Number(input.sortOrder) || 0,
          isProductionLike: input.isProductionLike,
        },
      });
      setEnvironmentDraft({ code: "", name: "", active: true, sortOrder: "100", isProductionLike: false });
      await fetchEnvironmentChoices();
    } catch (err: any) {
      setError(err.message || "Failed to save environment");
    } finally {
      setSaving(false);
    }
  }

  async function deleteEnvironmentChoice(id: string) {
    setSaving(true);
    setError(null);
    try {
      await adminGraphql(`
        mutation DeleteEnvironment($id: ID!) {
          deleteCIEnvironmentChoice(id: $id)
        }
      `, { id });
      await fetchEnvironmentChoices();
    } catch (err: any) {
      setError(err.message || "Failed to delete environment");
    } finally {
      setSaving(false);
    }
  }

  async function updateSystemProperty(key: string, value: string) {
    setSaving(true);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/system-properties/${key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) throw new Error("Failed to update system property");
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteSystemProperty(key: string) {
    if (!confirm(`Delete system property "${key}"?`)) return;
    setSaving(true);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/system-properties/${key}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token || ""}` },
      });
      if (!res.ok) throw new Error("Failed to delete system property");
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function parseList(value: string) {
    return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
  }

  async function readSamlMetadataFile(file?: File | null) {
    if (!file) return;
    const metadataXml = await file.text();
    setNewSsoConfig((current) => ({ ...current, metadataXml }));
  }

  function copyValue(value: string) {
    if (!value) return;
    navigator.clipboard?.writeText(value).catch(() => {});
  }

  function cmdbGroupLabel(id?: string | null) {
    if (!id) return "";
    const option = cmdbGroupOptions.find((group) => group.id === id);
    return option ? `${option.name} (${option.id})` : `CMDB ${id}`;
  }

  async function addSsoConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!newSsoConfig.name || !newSsoConfig.emailDomains) return;
    setSaving(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/identity/sso-configs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
        body: JSON.stringify({
          ...newSsoConfig,
          emailDomains: parseList(newSsoConfig.emailDomains),
          scopes: parseList(newSsoConfig.scopes),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add identity provider");
      setNewSsoConfig({
        name: "",
        provider: "saml",
        status: "inactive",
        emailDomains: "",
        idpSsoUrl: "",
        idpEntityId: "",
        metadataUrl: "",
        metadataXml: "",
        issuerUrl: "",
        authorizationUrl: "",
        tokenUrl: "",
        userinfoUrl: "",
        clientId: "",
        clientSecretRef: "",
        scopes: "openid,email,profile",
        enforceSso: false,
        jitEnabled: true,
        defaultRole: "user",
      });
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function updateSsoConfig(id: string, patch: Partial<SsoConfig>) {
    setSaving(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/identity/sso-configs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update identity provider");
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteSsoConfig(id: string) {
    if (!confirm("Delete this identity provider?")) return;
    setSaving(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/identity/sso-configs/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token || ""}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete identity provider");
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function addIdentityGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!newIdentityGroup.name) return;
    setSaving(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/identity/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
        body: JSON.stringify({
          name: newIdentityGroup.name,
          description: newIdentityGroup.description || undefined,
          cmdbCiId: newIdentityGroup.cmdbCiId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add identity group");
      setNewIdentityGroup({ name: "", description: "", cmdbCiId: "" });
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteIdentityGroup(group: IdentityGroup, memberCount: number, grantCount: number) {
    const impact = `${memberCount} member${memberCount === 1 ? "" : "s"} and ${grantCount} grant${grantCount === 1 ? "" : "s"}`;
    if (!confirm(`Delete identity group "${group.name}"? This removes ${impact}.`)) return;
    setSaving(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/identity/groups/${group.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token || ""}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete identity group");
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function addIdentityGroupMember(groupId: string) {
    if (!groupMemberUserId) return;
    setSaving(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/identity/groups/${groupId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
        body: JSON.stringify({ userId: groupMemberUserId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add group member");
      setGroupMemberUserId("");
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function addIdentityGroupGrant(groupId: string) {
    if (!groupGrant.resource || !groupGrant.action) return;
    setSaving(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/identity/groups/${groupId}/permissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
        body: JSON.stringify(groupGrant),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to grant group permission");
      setGroupGrant({ resource: "", action: "" });
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function addCredential(e: React.FormEvent) {
    e.preventDefault();
    const ref = buildCredentialRef(newCredential);
    if (!newCredential.name || !ref) return;
    setSaving(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
        body: JSON.stringify({ ...newCredential, ref }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add credential reference");
      setNewCredential({ name: "", ref: "", provider: "managed", status: "active", scope: "discovery", secretValue: "", secretEnvKey: "", externalRef: "", description: "" });
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function updateCredential(id: string, patch: Partial<CredentialReference>) {
    setSaving(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/credentials/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update credential reference");
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function testCredential(id: string) {
    setSaving(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/credentials/${id}/test`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token || ""}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to test credential reference");
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteCredential(id: string) {
    setSaving(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/credentials/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token || ""}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete credential reference");
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function addNumberSequence(e: React.FormEvent) {
    e.preventDefault();
    if (!newSequence.tableName || !newSequence.recordType || !newSequence.prefix) return;
    setSaving(true);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/number-sequences`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
        body: JSON.stringify({
          appId: newSequence.appId || undefined,
          tableName: newSequence.tableName,
          recordType: newSequence.recordType,
          prefix: newSequence.prefix,
          nextValue: Number(newSequence.nextValue) || 1,
          padding: Number(newSequence.padding) || 6,
        }),
      });
      if (!res.ok) throw new Error("Failed to add number sequence");
      await fetchData();
      setNewSequenceFromOption(availableSequenceOptions.find((option) =>
        option.appId !== newSequence.appId ||
        option.tableName !== newSequence.tableName ||
        option.recordType !== newSequence.recordType
      ));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function setNewSequenceFromOption(option: NumberSequenceOption | undefined) {
    if (!option) {
      setNewSequence({ appId: "", tableName: "", recordType: "", prefix: "", nextValue: "1", padding: "6" });
      return;
    }
    setNewSequence((current) => ({
      ...current,
      appId: option.appId,
      tableName: option.tableName,
      recordType: option.recordType,
      prefix: option.defaultPrefix,
    }));
  }

  async function updateNumberSequence(id: string, patch: Partial<NumberSequence>) {
    setSaving(true);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/admin/number-sequences/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
        body: JSON.stringify({
          appId: patch.app_id,
          recordType: patch.record_type,
          prefix: patch.prefix,
          nextValue: patch.next_value,
          padding: patch.padding,
          enabled: patch.enabled,
        }),
      });
      if (!res.ok) throw new Error("Failed to update number sequence");
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const roles = Array.from(new Set(permissions.map((p) => p.role)));
  const allRoles = Array.from(new Set([...roles, ...rbacUsers.map((user) => user.role)])).filter(Boolean).sort();
  const filteredManagedUsers = managedUsers.filter((user) => {
    const needle = userSearch.trim().toLowerCase();
    if (!needle) return true;
    return [user.name, user.email, user.role, user.status, user.authMethod].some((value) => String(value || "").toLowerCase().includes(needle));
  });
  const selectedManagedUser = selectedUserDetail?.user || managedUsers.find((user) => user.id === selectedUserId) || null;
  const selectedPermissionTarget = newResource && newAction ? encodePermissionValue(newResource, newAction) : "";
  const selectedGrantTarget = rbacTargets.find((target) => target.resource === newResource && target.action === newAction) || null;
  const grantScopes = ["All", ...Array.from(new Set(rbacTargets.map((target) => target.category || "Application"))).sort()];
  const filteredGrantTargets = rbacTargets.filter((target) => {
    const scopeMatch = grantScope === "All" || (target.category || "Application") === grantScope;
    const needle = grantSearch.trim().toLowerCase();
    const text = `${target.label || ""} ${target.resource} ${target.action} ${target.description || ""} ${target.source || ""}`.toLowerCase();
    return scopeMatch && (!needle || text.includes(needle));
  }).slice(0, 80);
  const selectedBulkGrantTargets = filteredGrantTargets
    .filter((target) => selectedBulkGrants[encodePermissionValue(target.resource, target.action)])
    .map((target) => ({ resource: target.resource, action: target.action }));
  const existingGrant = selectedGrantTarget && newRole
    ? permissions.find((permission) => permission.role === newRole && permission.resource === selectedGrantTarget.resource && permission.action === selectedGrantTarget.action)
    : null;
  const selectedRbacTable = rbacTables.find((table) => table.id === tableAccessProbe.tableId) || null;
  const tableFieldOptions = selectedRbacTable
    ? [{ value: "", label: "All fields" }, ...selectedRbacTable.fields.map((field) => ({ value: field.name, label: `${field.label}${field.writable ? "" : " (read only)"}` }))]
    : [{ value: "", label: "All fields" }];
  const selectedFieldRestrictionTable = fieldRestrictionTables.find((table) => table.id === fieldRestrictionTableId) || fieldRestrictionTables[0] || null;
  const restrictedFieldCount = fieldRestrictionTables.reduce((sum, table) => sum + table.fields.filter((field) => field.restricted).length, 0);
  const fieldRestrictionGrantRole = tableAccessProbe.role || appAccessProbe.role || accessProbe.role || allRoles[0] || "security_admin";
  const registeredSequenceKeys = new Set(numberSequences.map((sequence) => `${sequence.app_id || ""}:${sequence.table_name}:${sequence.record_type}`));
  const availableSequenceOptions = numberSequenceOptions.filter((option) => !registeredSequenceKeys.has(`${option.appId}:${option.tableName}:${option.recordType}`));
  const appOptions = Array.from(new Map(numberSequenceOptions.map((option) => [option.appId, option.appName])).entries());
  const tableOptions = numberSequenceOptions.filter((option) => option.appId === newSequence.appId);
  const recordTypeOptions = tableOptions.filter((option) => option.tableName === newSequence.tableName);
  const canAddSequence = availableSequenceOptions.some((option) =>
    option.appId === newSequence.appId &&
    option.tableName === newSequence.tableName &&
    option.recordType === newSequence.recordType
  ) && Boolean(newSequence.prefix);
  const generatedCredentialRef = buildCredentialRef(newCredential);
  const canAddCredential = Boolean(
    newCredential.name &&
    generatedCredentialRef &&
    (newCredential.provider !== "managed" || newCredential.secretValue.trim())
  );

  function selectSequenceApp(appId: string) {
    const option = numberSequenceOptions.find((candidate) => candidate.appId === appId);
    setNewSequenceFromOption(option);
  }

  function selectSequenceTable(tableName: string) {
    const option = numberSequenceOptions.find((candidate) => candidate.appId === newSequence.appId && candidate.tableName === tableName);
    setNewSequenceFromOption(option);
  }

  function selectSequenceRecordType(recordType: string) {
    const option = numberSequenceOptions.find((candidate) =>
      candidate.appId === newSequence.appId &&
      candidate.tableName === newSequence.tableName &&
      candidate.recordType === recordType
    );
    setNewSequenceFromOption(option);
  }

  const allTabs = useMemo(() => Array.from(new Map([
    { id: "overview", name: "Overview", icon: "LayoutDashboard", category: "Command" },
    { id: "users", name: "User Management", icon: "Users", category: "Governance" },
    { id: "edge-enrollment", name: "Edge Enrollment", icon: "Radio", category: "Governance" },
    { id: "rbac", name: "Users & Access", icon: "ShieldCheck", category: "Governance" },
    { id: "credentials", name: "Credentials", icon: "KeyRound", category: "Governance" },
    { id: "identity", name: "Identity Providers", icon: "KeyRound", category: "Governance" },
    { id: "environments", name: "Environments", icon: "Database", category: "Platform Registry" },
    { id: "number-sequences", name: "Number Sequences", icon: "Hash", category: "Platform Registry" },
    { id: "packages", name: "Package Provisioning", icon: "Download", category: "Platform Registry" },
    { id: "system-properties", name: "System Properties", icon: "Settings", category: "Platform Registry" },
    ...panels.map((p) => ({ id: p.id, name: p.name, icon: p.icon, category: "Application Admin" })),
  ].map((tab) => [tab.id, tab])).values()), [panels]);

  const filteredTabs = useMemo(() => {
    const needle = adminSearch.trim().toLowerCase();
    if (!needle) return allTabs;
    return allTabs.filter((tab) =>
      tab.name.toLowerCase().includes(needle) ||
      tab.id.toLowerCase().includes(needle) ||
      tab.category.toLowerCase().includes(needle)
    );
  }, [adminSearch, allTabs]);

  const groupedTabs = useMemo(() => {
    const groups = new Map<string, typeof allTabs>();
    for (const tab of filteredTabs) {
      const current = groups.get(tab.category) || [];
      current.push(tab);
      groups.set(tab.category, current);
    }
    return Array.from(groups.entries());
  }, [filteredTabs]);

  const adminReadiness = [
    { label: "Permission grants", value: permissions.length, tone: "text-indigo-200", detail: `${roles.length} active roles` },
    { label: "Counter registries", value: numberSequences.length, tone: "text-emerald-200", detail: `${availableSequenceOptions.length} available targets` },
    { label: "Package jobs", value: provisioningJobs.length, tone: "text-cyan-200", detail: "Install and uninstall history" },
    { label: "Identity providers", value: ssoConfigs.length, tone: "text-sky-200", detail: `${ssoConfigs.filter((config) => config.status === "active").length} active / ${rbacGroups.length} groups` },
    { label: "Credential refs", value: credentials.length, tone: "text-emerald-200", detail: `${credentials.filter((credential) => credential.status === "active").length} active` },
    { label: "Admin panels", value: panels.length + 5, tone: "text-amber-200", detail: "Core and app-owned" },
  ];

  useEffect(() => {
    const tab = allTabs.find((candidate) => candidate.id === activeTab);
    const context = ADMIN_SCREEN_CONTEXT[activeTab];
    shell.sendMessage?.({
      to: "*",
      type: "SCREEN_CONTEXT_UPDATED",
      payload: {
        appId: "admin-console",
        appName: "Admin Console",
        screenName: tab?.name || "Admin Console",
        purpose: context?.purpose,
        primaryActions: context?.primaryActions,
        boundaries: [
          "This is an administration surface, not the CMDB Explorer, Service Map, Incident Manager, Change Manager, Asset Command Center, Customer Portal, or Knowledge Core workspace.",
          "Describe administrative controls visible in this console; do not claim the user can directly perform operational app workflows from here unless a native app is opened.",
        ],
        state: context?.state?.({
          permissions,
          managedUsers,
          edgeCollectors,
          edgeEnrollmentTokens,
          credentials,
          ssoConfigs,
          environmentChoices,
          numberSequences,
          provisioningJobs,
          systemProps,
        }),
      },
    });
  }, [
    activeTab,
    allTabs,
    shell,
    permissions,
    managedUsers,
    edgeCollectors,
    edgeEnrollmentTokens,
    credentials,
    ssoConfigs,
    environmentChoices,
    numberSequences,
    provisioningJobs,
    systemProps,
  ]);

  function openNativeApp(appId: string) {
    const permissionMap: Record<string, string[]> = {
      "incident-manager": ["itsm:incident:read", "itsm:incident:write"],
      "change-manager": ["itsm:change:read", "itsm:change:write"],
      "knowledge-core": ["itsm:knowledge:read", "itsm:knowledge:write"],
      "asset-command": ["itsm:asset:read", "itsm:asset:write"],
      discovery: ["read:discovery", "write:discovery"],
    };
    shell.dispatch?.({
      type: "OPEN_APP",
      id: appId,
      installKey: `builtin_${appId}`,
      mode: "canvas",
      permissions: permissionMap[appId] || [],
    });
  }

  const renderTabContent = () => {
    if (activeTab === "overview") {
      return (
        <div className="space-y-6">
          {operationalIntelligence && (
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
                    <Activity className="h-4 w-4 text-cyan-300" />
                    Operational Intelligence
                  </div>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-500">
                    Cross-module readiness signals that show whether Specora is operating like a connected platform instead of isolated apps.
                  </p>
                </div>
                <div className={`rounded-lg border px-4 py-3 text-right ${postureClass(operationalIntelligence.overall.posture)}`}>
                  <div className="text-xs uppercase tracking-wide opacity-70">Platform Score</div>
                  <div className="mt-1 text-3xl font-semibold">{scoreText(operationalIntelligence.overall.score)}</div>
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-gray-800 bg-gray-950 px-4 py-3 text-sm leading-6 text-gray-400">
                {operationalIntelligence.overall.summary}
              </div>

              <div className="mt-4 grid gap-3 xl:grid-cols-3">
                {operationalIntelligence.domains.map((domain) => (
                  <div key={domain.id} className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-gray-100">{domain.label}</div>
                        <div className="mt-1 text-xs capitalize text-gray-500">{domain.posture}</div>
                      </div>
                      <div className={`rounded-md border px-2.5 py-1 text-sm font-semibold ${postureClass(domain.posture)}`}>
                        {scoreText(domain.score)}
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {domain.metrics.map((metric) => (
                        <div key={metric.label} className="rounded-md border border-gray-800 bg-gray-900 px-3 py-2">
                          <div className="text-[11px] uppercase tracking-wide text-gray-600">{metric.label}</div>
                          <div className="mt-1 text-sm font-medium text-gray-200">{metric.value ?? "-"}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-200">
                    <AlertTriangle className="h-4 w-4 text-amber-300" />
                    Priority Signals
                  </div>
                  <div className="space-y-2">
                    {operationalIntelligence.signals.length ? operationalIntelligence.signals.map((signal) => (
                      <div key={`${signal.appId}-${signal.title}`} className={`rounded-lg border p-3 ${signal.severity === "critical" ? "border-red-500/30 bg-red-500/10" : "border-amber-500/30 bg-amber-500/10"}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-gray-100">{signal.title}</div>
                            <div className="mt-1 text-sm leading-5 text-gray-400">{signal.detail}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => openNativeApp(signal.appId)}
                            className="shrink-0 rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-800"
                          >
                            {signal.action}
                          </button>
                        </div>
                      </div>
                    )) : (
                      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-100">
                        No high-priority cross-module signals are active.
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-200">
                    <Database className="h-4 w-4 text-indigo-300" />
                    Governance And Data Spine
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <MiniMetric label="Permission grants" value={operationalIntelligence.governance.permissionGrants} />
                    <MiniMetric label="Active counters" value={operationalIntelligence.governance.activeSequences} />
                    <MiniMetric label="Audit events 24h" value={operationalIntelligence.governance.auditEvents24h} />
                    <MiniMetric label="Package jobs" value={operationalIntelligence.governance.activePackageJobs} />
                    <MiniMetric label="CMDB CIs" value={operationalIntelligence.cmdb.ciCount ?? "-"} />
                    <MiniMetric label="CMDB relationships" value={operationalIntelligence.cmdb.relationshipCount ?? "-"} />
                  </div>
                  <div className="mt-3 text-xs text-gray-600">
                    Refreshed {new Date(operationalIntelligence.generatedAt).toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-4">
            {adminReadiness.map((item) => (
              <div key={item.label} className="rounded-lg border border-gray-800 bg-gray-900 p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500">{item.label}</div>
                <div className={`mt-3 text-3xl font-semibold ${item.tone}`}>{item.value}</div>
                <div className="mt-1 text-sm text-gray-500">{item.detail}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
                <ClipboardCheck className="h-4 w-4 text-indigo-300" />
                Admin Operating Model
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {[
                  ["Govern access first", "Use role-based grants before exposing apps, tables, or automation."],
                  ["Register platform objects", "Apps, tables, record types, counters, and panels should come from registries."],
                  ["Preview operational impact", "Admin changes should show what users, records, or automations they affect."],
                  ["Audit every change", "RBAC, registry, automation, and system settings need traceable ownership."],
                ].map(([title, body]) => (
                  <div key={title} className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                    <div className="font-medium text-gray-200">{title}</div>
                    <div className="mt-2 text-sm leading-6 text-gray-500">{body}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
                <Activity className="h-4 w-4 text-emerald-300" />
                Attention
              </div>
              <div className="mt-4 space-y-3">
                {availableSequenceOptions.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setActiveTab("number-sequences")}
                    className="flex w-full items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-left text-sm text-amber-100"
                  >
                    <span>{availableSequenceOptions.length} counter targets are available for registration</span>
                    <ChevronRight className="h-4 w-4" />
                  </button>
                ) : (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-100">
                    Counter registry coverage is complete.
                  </div>
                )}
                {!permissions.length && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("rbac")}
                    className="flex w-full items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-3 text-left text-sm text-red-100"
                  >
                    <span>No RBAC grants were returned for this admin view</span>
                    <ChevronRight className="h-4 w-4" />
                  </button>
                )}
                <div className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-3 text-sm leading-6 text-gray-500">
                  Contextual admin actions should open as small page-aware tools; durable administration belongs in this full workspace.
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (activeTab === "users") {
      const detail = selectedUserDetail;
      const effectiveGrants = [
        ...(detail?.directGrants || []),
        ...(detail?.inheritedGrants || []),
      ].sort((a, b) => `${a.resource}:${a.action}`.localeCompare(`${b.resource}:${b.action}`));
      const effectiveGrantKeys = new Set(effectiveGrants.map((grant) => `${grant.resource}:${grant.action}`));
      const selectedUserRole = selectedManagedUser?.role || "";
      const selectedUserAppAccess = selectedManagedUser ? rbacApps.map((app) => {
        const requirements = app.permissions.map((permission) => appPermissionToResourceAction(permission)).filter(Boolean) as Array<{ resource: string; action: string }>;
        const missing = requirements.filter((requirement) => {
          if (selectedUserRole === "security_admin") return false;
          if (selectedUserRole === "admin" && requirement.resource !== "rbac") return false;
          return !effectiveGrantKeys.has(`${requirement.resource}:${requirement.action}`);
        });
        return {
          app,
          requirements,
          missing,
          allowed: missing.length === 0,
        };
      }).sort((a, b) => {
        if (a.allowed !== b.allowed) return a.allowed ? 1 : -1;
        return a.app.name.localeCompare(b.app.name, undefined, { sensitivity: "base" });
      }) : [];
      const selectedUserAllowedApps = selectedUserAppAccess.filter((entry) => entry.allowed).length;
      return (
        <div className="space-y-5">
          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-lg border border-gray-800 bg-gray-900">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 px-4 py-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-100">
                    <Users className="h-4 w-4 text-indigo-300" />
                    Users
                  </div>
                  <div className="mt-1 text-xs text-gray-500">{managedUsers.length} accounts with session, group, and access posture</div>
                </div>
                <div className="relative w-full max-w-xs">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-500" />
                  <input
                    value={userSearch}
                    onChange={(event) => setUserSearch(event.target.value)}
                    placeholder="Search users"
                    className="w-full rounded-lg border border-gray-700 bg-gray-950 py-2 pl-9 pr-3 text-sm text-gray-200 outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
              <div className="max-h-[580px] overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-gray-900 text-xs uppercase tracking-wide text-gray-500">
                    <tr className="border-b border-gray-800">
                      <th className="px-4 py-3">User</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Risk</th>
                      <th className="px-4 py-3">Last login</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredManagedUsers.map((user) => (
                      <tr
                        key={user.id}
                        onClick={() => {
                          setSelectedUserId(user.id);
                          setSelectedUserDetail(null);
                          setUserEditDraft({ name: user.name || "", role: user.role || "" });
                        }}
                        className={`cursor-pointer border-b border-gray-800/60 hover:bg-gray-800/50 ${selectedUserId === user.id ? "bg-indigo-500/10" : ""}`}
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-100">{user.name}</div>
                          <div className="text-xs text-gray-500">{user.email}</div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-indigo-200">{user.role}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full border px-2 py-1 text-xs ${user.status === "active" ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : "border-gray-700 bg-gray-950 text-gray-400"}`}>
                            {user.status.replaceAll("_", " ")}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-xs text-gray-400">{user.highRiskGrants} critical grants</div>
                          <div className="text-xs text-gray-600">{user.groupCount} groups / {user.activeSessions} sessions</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">{formatDateTime(user.lastLoginAt)}</td>
                      </tr>
                    ))}
                    {!filteredManagedUsers.length && (
                      <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-500">No users match this search.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <form onSubmit={createManagedUser} className="rounded-lg border border-gray-800 bg-gray-900 p-4">
              <div className="mb-4 flex items-center gap-2 text-sm font-medium text-gray-100">
                <UserPlus className="h-4 w-4 text-emerald-300" />
                Invite platform user
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <FieldInput label="Name" value={userDraft.name} onChange={(value) => setUserDraft((current) => ({ ...current, name: value }))} placeholder="Avery Admin" autoComplete="off" />
                <FieldInput label="Email" value={userDraft.email} onChange={(value) => setUserDraft((current) => ({ ...current, email: value }))} placeholder="avery@example.com" type="email" autoComplete="off" />
                <FieldSelect label="Role" value={userDraft.role} onChange={(value) => setUserDraft((current) => ({ ...current, role: value }))} options={(allRoles.length ? allRoles : ["operator"]).map((role) => ({ value: role, label: role }))} />
                <FieldInput label="Temporary password" value={userDraft.password} onChange={(value) => setUserDraft((current) => ({ ...current, password: value }))} type="password" autoComplete="new-password" help="Use at least 8 characters. The user must change it on first login." />
              </div>
              <button type="submit" disabled={saving} className="mt-4 flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
                <UserPlus className="h-4 w-4" />
                Create user
              </button>
            </form>
          </div>

          {selectedManagedUser && (
            <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
              <div className="space-y-4">
                <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold text-gray-100">{selectedManagedUser.name}</div>
                      <div className="text-sm text-gray-500">{selectedManagedUser.email}</div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <span className="rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3 py-1 text-xs text-indigo-200">{selectedManagedUser.authMethod}</span>
                      {selectedManagedUser.passwordChangeRequired && <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-200">password change required</span>}
                    </div>
                  </div>
                  <div className="grid gap-3">
                    <FieldInput label="Display name" value={userEditDraft.name} onChange={(value) => setUserEditDraft((current) => ({ ...current, name: value }))} />
                    <FieldSelect label="Role" value={userEditDraft.role} onChange={(value) => setUserEditDraft((current) => ({ ...current, role: value }))} options={(allRoles.length ? allRoles : [selectedManagedUser.role]).map((role) => ({ value: role, label: role }))} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={updateManagedUser} disabled={saving} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
                      <UserCog className="h-4 w-4" />
                      Save profile
                    </button>
                    <button type="button" onClick={revokeManagedUserSessions} disabled={saving || selectedManagedUser.activeSessions === 0} className="flex items-center gap-2 rounded-lg border border-red-500/40 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-500/10 disabled:opacity-50">
                      <LogOut className="h-4 w-4" />
                      Revoke sessions
                    </button>
                  </div>
                </div>

                <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
                  <div className="mb-3 text-sm font-medium text-gray-100">Operational impact</div>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(detail?.impact || {}).map(([key, value]) => (
                      <MiniMetric key={key} label={key.replace(/([A-Z])/g, " $1")} value={value} />
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-gray-100">Application access</div>
                      <div className="mt-1 text-xs text-gray-500">
                        {selectedUserAllowedApps} of {selectedUserAppAccess.length} registered apps available
                      </div>
                    </div>
                    <ShieldCheck className="h-4 w-4 text-cyan-300" />
                  </div>
                  <div className="max-h-80 space-y-2 overflow-auto pr-1">
                    {selectedUserAppAccess.map(({ app, requirements, missing, allowed }) => (
                      <div key={app.id} className={`rounded-lg border px-3 py-2 ${allowed ? "border-emerald-500/20 bg-emerald-500/5" : "border-gray-800 bg-gray-950"}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-gray-100">{app.name}</div>
                            <div className="mt-1 text-xs text-gray-500">
                              {requirements.length} requirement{requirements.length === 1 ? "" : "s"}
                              {missing.length > 0 ? ` · missing ${missing.map((item) => `${item.resource}:${item.action}`).join(", ")}` : " · satisfied"}
                            </div>
                          </div>
                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${allowed ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : "border-red-400/30 bg-red-500/10 text-red-200"}`}>
                            {allowed ? "allowed" : "blocked"}
                          </span>
                        </div>
                        {!allowed && (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveTab("rbac");
                              setAppAccessProbe({ userId: selectedManagedUser.id, role: selectedManagedUser.role, appId: app.id });
                              setOpenRbacUtilities((current) => ({ ...current, app: true }));
                            }}
                            className="mt-2 inline-flex items-center gap-2 rounded-md border border-cyan-500/30 px-2.5 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/10"
                          >
                            Explain in RBAC
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                    {!selectedUserAppAccess.length && <div className="text-sm text-gray-500">No registered apps were returned for this admin view.</div>}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-100">
                    <ShieldCheck className="h-4 w-4 text-indigo-300" />
                    AI-style access rationale
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {(detail?.recommendations || []).map((item) => (
                      <div key={item.title} className={`rounded-lg border p-3 ${item.severity === "critical" ? "border-red-500/30 bg-red-500/10" : item.severity === "warning" ? "border-amber-500/30 bg-amber-500/10" : "border-sky-500/30 bg-sky-500/10"}`}>
                        <div className="text-sm font-medium text-gray-100">{item.title}</div>
                        <div className="mt-1 text-sm leading-5 text-gray-400">{item.rationale}</div>
                        <div className="mt-2 text-xs text-gray-500">{item.action}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
                    <div className="mb-3 text-sm font-medium text-gray-100">Effective grants</div>
                    <div className="max-h-80 space-y-2 overflow-auto pr-1">
                      {effectiveGrants.slice(0, 80).map((grant) => (
                        <div key={`${grant.source}-${grant.id}-${grant.resource}-${grant.action}`} className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs text-gray-200">{grant.resource}:{grant.action}</span>
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${riskClass(grant.risk)}`}>{grant.risk}</span>
                          </div>
                          <div className="mt-1 text-xs text-gray-600">{grant.source === "group" ? `Inherited from ${(grant as any).group_name}` : `Role ${selectedManagedUser.role}`}</div>
                        </div>
                      ))}
                      {!effectiveGrants.length && <div className="text-sm text-gray-500">No direct or inherited grants were found.</div>}
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
                    <div className="mb-3 text-sm font-medium text-gray-100">Groups, sessions, and audit</div>
                    <div className="space-y-4">
                      <div>
                        <div className="mb-2 text-xs uppercase tracking-wide text-gray-600">Groups</div>
                        <div className="flex flex-wrap gap-2">
                          {(detail?.inheritedGroups || []).map((group) => <span key={group.id} className="rounded-full border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-300">{group.name}</span>)}
                          {!detail?.inheritedGroups?.length && <span className="text-sm text-gray-500">No group memberships.</span>}
                        </div>
                      </div>
                      <div>
                        <div className="mb-2 text-xs uppercase tracking-wide text-gray-600">Sessions</div>
                        <div className="space-y-2">
                          {(detail?.sessions || []).slice(0, 4).map((session) => (
                            <div key={session.id} className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-xs text-gray-400">
                              <div className="flex justify-between gap-3">
                                <span>{session.active ? "Active" : "Inactive"} / {session.ipAddress || "unknown IP"}</span>
                                <span>{formatDateTime(session.lastUsedAt || session.createdAt)}</span>
                              </div>
                              <div className="mt-1 truncate text-gray-600">{session.userAgent || "Unknown user agent"}</div>
                            </div>
                          ))}
                          {!detail?.sessions?.length && <div className="text-sm text-gray-500">No sessions found.</div>}
                        </div>
                      </div>
                      <div>
                        <div className="mb-2 text-xs uppercase tracking-wide text-gray-600">Recent audit</div>
                        <div className="space-y-2">
                          {(detail?.auditEvents || []).slice(0, 4).map((event) => (
                            <div key={event.id} className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-xs">
                              <div className="text-gray-200">{event.action}</div>
                              <div className="mt-1 text-gray-600">{event.entityType} / {event.entityId} / {formatDateTime(event.createdAt)}</div>
                            </div>
                          ))}
                          {!detail?.auditEvents?.length && <div className="text-sm text-gray-500">No audit events found.</div>}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    if (activeTab === "edge-enrollment") {
      return (
        <div className="space-y-5">
          <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <form onSubmit={createEdgeEnrollmentToken} className="rounded-lg border border-gray-800 bg-gray-900 p-4">
              <div className="mb-4 flex items-center gap-2 text-sm font-medium text-gray-100">
                <Radio className="h-4 w-4 text-cyan-300" />
                Issue edge enrollment token
              </div>
              <div className="grid gap-3">
                <FieldInput label="Token name" value={edgeEnrollmentDraft.name} onChange={(value) => setEdgeEnrollmentDraft((current) => ({ ...current, name: value }))} placeholder="Austin edge enrollment" autoComplete="off" />
                <FieldInput label="Site" value={edgeEnrollmentDraft.site} onChange={(value) => setEdgeEnrollmentDraft((current) => ({ ...current, site: value }))} placeholder="Austin DC" autoComplete="off" />
                <FieldInput label="Labels" value={edgeEnrollmentDraft.labels} onChange={(value) => setEdgeEnrollmentDraft((current) => ({ ...current, labels: value }))} placeholder='{"zone":"prod"} or zone=prod,tier=edge' help="Labels are attached to the enrolled collector." />
                <div className="grid grid-cols-2 gap-3">
                  <FieldInput label="Expires in hours" value={edgeEnrollmentDraft.expiresInHours} onChange={(value) => setEdgeEnrollmentDraft((current) => ({ ...current, expiresInHours: value }))} type="number" />
                  <FieldInput label="Max uses" value={edgeEnrollmentDraft.maxUses} onChange={(value) => setEdgeEnrollmentDraft((current) => ({ ...current, maxUses: value }))} type="number" />
                </div>
              </div>
              <button type="submit" disabled={saving} className="mt-4 flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50">
                <Radio className="h-4 w-4" />
                Generate token
              </button>
            </form>

            <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
              <div className="text-sm font-medium text-gray-100">specora-edge enrollment flow</div>
              <div className="mt-3 rounded-lg border border-gray-800 bg-gray-950 p-3 font-mono text-xs leading-6 text-gray-300">
                POST {API_URL}/edge/enroll<br />
                {"{"}<br />
                &nbsp;&nbsp;"registration_token": "se_...",<br />
                &nbsp;&nbsp;"version": "dev",<br />
                &nbsp;&nbsp;"capabilities": ["collector.query.osquery"]<br />
                {"}"}
              </div>
              <div className="mt-3 text-sm leading-6 text-gray-500">
                The runtime exchange returns the tenant, relay, key, and policy identifiers specora-edge stores locally. Enrollment tokens are shown only once.
              </div>
              {issuedEnrollmentToken && (
                <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  <div className="text-xs uppercase tracking-wide text-amber-200">Copy this token now</div>
                  <div className="mt-2 flex items-stretch gap-2">
                    <div className="min-w-0 flex-1 break-all rounded border border-amber-500/30 bg-gray-950 p-2 font-mono text-sm text-amber-100">{issuedEnrollmentToken}</div>
                    <button
                      type="button"
                      onClick={copyIssuedEnrollmentToken}
                      className="flex shrink-0 items-center gap-2 rounded-lg border border-amber-400/40 px-3 py-2 text-sm font-medium text-amber-100 hover:bg-amber-500/10"
                    >
                      <Clipboard className="h-4 w-4" />
                      Copy
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-gray-800 bg-gray-900">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-800 px-4 py-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-gray-100">
                  <KeyRound className="h-4 w-4 text-cyan-300" />
                  Edge runtime configuration
                </div>
                <div className="mt-1 text-xs text-gray-500">Published for enrolled edge servers to fetch after registration. Operators still choose where these files are written locally.</div>
              </div>
              {edgeRuntimeConfig && (
                <button type="button" onClick={copyEdgeRuntimeConfig} className="flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-xs font-medium text-gray-200 hover:bg-gray-800">
                  <Clipboard className="h-4 w-4" />
                  Copy config
                </button>
              )}
            </div>
            {edgeRuntimeConfig ? (
              <div className="grid gap-4 p-4 xl:grid-cols-[0.9fr_1.1fr]">
                <div className="space-y-3">
                  <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                    <div className="text-xs uppercase tracking-wide text-gray-500">Fetch endpoint</div>
                    <div className="mt-2 break-all font-mono text-sm text-cyan-100">GET {API_URL}/edge/runtime-config</div>
                  </div>
                  <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                    <div className="text-xs uppercase tracking-wide text-gray-500">Public signing key</div>
                    <div className="mt-2 break-all font-mono text-sm text-gray-200">{edgeRuntimeConfig.publicSigningKey || "Not configured"}</div>
                    <div className="mt-2 text-xs text-gray-500">key_id: {edgeRuntimeConfig.runtimeConfig.key_id}</div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {Object.entries(edgeRuntimeConfig.runtimeConfig.readiness || {}).map(([key, value]) => (
                      <div key={key} className={`rounded-lg border p-3 ${value ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100" : "border-amber-400/30 bg-amber-500/10 text-amber-100"}`}>
                        <div className="text-xs font-medium">{value ? "Ready" : "Needs value"}</div>
                        <div className="mt-1 break-words text-xs text-current/80">{key.replaceAll("_", " ")}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                    <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">Keyring</div>
                    <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all text-xs leading-5 text-gray-300">{JSON.stringify(edgeRuntimeConfig.runtimeConfig.keyring, null, 2)}</pre>
                  </div>
                  <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                    <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">Suggested paths</div>
                    <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all text-xs leading-5 text-gray-300">{JSON.stringify(edgeRuntimeConfig.runtimeConfig.suggested_paths, null, 2)}</pre>
                  </div>
                  <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                    <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">Collector manifest</div>
                    <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all text-xs leading-5 text-gray-300">{JSON.stringify(edgeRuntimeConfig.runtimeConfig.collector_manifest, null, 2)}</pre>
                  </div>
                  <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                    <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">Capability policy</div>
                    <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all text-xs leading-5 text-gray-300">{JSON.stringify(edgeRuntimeConfig.runtimeConfig.capability_policy, null, 2)}</pre>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 text-sm text-gray-500">Runtime configuration is unavailable. Confirm the platform job signing key is configured.</div>
            )}
          </div>

          <div className="rounded-lg border border-gray-800 bg-gray-900">
            <div className="border-b border-gray-800 px-4 py-3">
              <div className="text-sm font-medium text-gray-100">Enrollment tokens</div>
              <div className="mt-1 text-xs text-gray-500">Hashed at rest, revocable, and tied to collectors after use.</div>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-950 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Prefix</th>
                    <th className="px-4 py-3">Site</th>
                    <th className="px-4 py-3">Uses</th>
                    <th className="px-4 py-3">Collector</th>
                    <th className="px-4 py-3">Expires</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {edgeEnrollmentTokens.map((token) => (
                    <tr key={token.id} className="border-t border-gray-800/70">
                      <td className="px-4 py-3 text-gray-100">{token.name}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full border px-2 py-1 text-xs ${token.status === "active" ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : "border-gray-700 bg-gray-950 text-gray-400"}`}>{token.status}</span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400">{token.tokenPrefix}...</td>
                      <td className="px-4 py-3 text-gray-400">{token.site || "-"}</td>
                      <td className="px-4 py-3 text-gray-400">{token.uses}/{token.maxUses}</td>
                      <td className="px-4 py-3 text-gray-400">{token.collectorName || token.collectorId || "-"}</td>
                      <td className="px-4 py-3 text-gray-500">{formatDateTime(token.expiresAt)}</td>
                      <td className="px-4 py-3 text-right">
                        {token.status === "active" && (
                          <button type="button" onClick={() => revokeEdgeEnrollmentToken(token.id)} className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/10">
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!edgeEnrollmentTokens.length && <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-500">No enrollment tokens have been issued.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border border-gray-800 bg-gray-900">
            <div className="border-b border-gray-800 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-100">
                <Radio className="h-4 w-4 text-cyan-300" />
                Enrolled edge servers
              </div>
              <div className="mt-1 text-xs text-gray-500">Collector posture, heartbeat freshness, source bindings, and network origin.</div>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-950 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Server</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Site</th>
                    <th className="px-4 py-3">Version</th>
                    <th className="px-4 py-3">Heartbeat</th>
                    <th className="px-4 py-3">Sources</th>
                    <th className="px-4 py-3">Last IP</th>
                    <th className="px-4 py-3">Labels</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {edgeCollectors.map((collector) => (
                    <tr key={collector.id} className="border-t border-gray-800/70">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-100">{collector.name}</div>
                        <div className="font-mono text-xs text-gray-600">{collector.id}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full border px-2 py-1 text-xs ${collector.status === "healthy" ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : collector.status === "degraded" ? "border-amber-400/30 bg-amber-500/10 text-amber-100" : "border-gray-700 bg-gray-950 text-gray-400"}`}>{collector.status}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-400">{collector.site || "-"}</td>
                      <td className="px-4 py-3 text-gray-400">{collector.version || "-"}</td>
                      <td className="px-4 py-3">
                        <div className="text-gray-300">{collector.heartbeatAgeMinutes === null ? "Never" : `${collector.heartbeatAgeMinutes}m ago`}</div>
                        <div className="text-xs text-gray-600">{formatDateTime(collector.lastHeartbeatAt)}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-400">{collector.sourceCount}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{collector.lastSeenIp || "-"}</td>
                      <td className="px-4 py-3">
                        <div className="max-w-xs truncate font-mono text-xs text-gray-500">{JSON.stringify(collector.labels || {})}</div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => deleteEdgeCollector(collector.id, collector.name)}
                          disabled={saving}
                          className="inline-flex items-center gap-2 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/10 disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!edgeCollectors.length && <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-gray-500">No edge servers have enrolled yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      );
    }

    if (activeTab === "rbac") {
      return (
        <div className="space-y-6">
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-medium text-gray-200">
                  <ShieldCheck className="h-4 w-4 text-cyan-300" />
                  Explain App Access
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Troubleshoot whether a user or role can open and operate a registered application.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {appAccessExplanation && (
                  <div className={`rounded-full px-3 py-1 text-xs font-medium ${
                    appAccessExplanation.allowed ? "bg-emerald-500/10 text-emerald-200" : "bg-red-500/10 text-red-200"
                  }`}>
                    {appAccessExplanation.allowed ? "Complete" : `${appAccessExplanation.missing.length} missing`}
                  </div>
                )}
                <button type="button" onClick={() => toggleRbacUtility("app")} className="rounded-lg border border-gray-700 p-2 text-gray-400 hover:text-gray-100">
                  {openRbacUtilities.app ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {openRbacUtilities.app && (
              <>
            <form onSubmit={explainAppAccess} className="mt-4 grid items-end gap-3 lg:grid-cols-[1.2fr_1fr_1.2fr_auto]">
              <FieldSelect
                label="User"
                value={appAccessProbe.userId}
                onChange={(value) => {
                  const user = rbacUsers.find((candidate) => candidate.id === value);
                  setAppAccessProbe((current) => ({ ...current, userId: value, role: user?.role || current.role }));
                }}
                options={[
                  { value: "", label: "Explain role only" },
                  ...rbacUsers.map((user) => ({ value: user.id, label: `${user.name || user.email} (${user.role})` })),
                ]}
              />
              <FieldSelect
                label="Role"
                value={appAccessProbe.role}
                onChange={(value) => setAppAccessProbe((current) => ({ ...current, role: value, userId: "" }))}
                options={allRoles.map((role) => ({ value: role, label: role }))}
              />
              <FieldSelect
                label="Application"
                value={appAccessProbe.appId}
                onChange={(value) => setAppAccessProbe((current) => ({ ...current, appId: value }))}
                options={rbacApps.map((app) => ({ value: app.id, label: `${app.name} (${app.permissions.length})` }))}
              />
              <button
                type="submit"
                disabled={saving || (!appAccessProbe.userId && !appAccessProbe.role) || !appAccessProbe.appId}
                className="flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Explain
              </button>
            </form>

            {appAccessExplanation && (
              <div className="mt-5 grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
                <div className={`rounded-lg border p-4 ${
                  appAccessExplanation.allowed ? "border-emerald-500/30 bg-emerald-500/10" : "border-red-500/30 bg-red-500/10"
                }`}>
                  <div className="flex items-center gap-2">
                    {appAccessExplanation.allowed ? <CheckCircle2 className="h-5 w-5 text-emerald-300" /> : <XCircle className="h-5 w-5 text-red-300" />}
                    <div className="font-medium text-gray-100">
                      {appAccessExplanation.role} {appAccessExplanation.allowed ? "has" : "does not have"} full access to {appAccessExplanation.app.name}
                    </div>
                  </div>
                  <div className="mt-3 text-sm leading-6 text-gray-400">{appAccessExplanation.app.description}</div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <MiniMetric label="Requirements" value={appAccessExplanation.requirements.length} />
                    <MiniMetric label="Missing" value={appAccessExplanation.missing.length} />
                    <MiniMetric label="Chat capabilities" value={appAccessExplanation.app.chatCapabilities} />
                    <MiniMetric label="Events" value={appAccessExplanation.app.events.length} />
                  </div>
                  {appAccessExplanation.trace.length > 0 && (
                    <div className="mt-4 space-y-2">
                      {appAccessExplanation.trace.map((step, index) => (
                        <div key={`${step.label}-${index}`} className="rounded-md border border-gray-800 bg-gray-950 px-3 py-2">
                          <div className="flex items-center gap-2 text-xs font-medium text-gray-300">
                            <span className={`h-2 w-2 rounded-full ${
                              step.status === "allow" ? "bg-emerald-400" : step.status === "deny" ? "bg-red-400" : "bg-cyan-400"
                            }`} />
                            {step.label}
                          </div>
                          <div className="mt-1 text-xs leading-5 text-gray-500">{step.detail}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-gray-200">Permission Requirements</div>
                    <div className="text-xs text-gray-600">{appAccessExplanation.app.permissions.join(", ")}</div>
                  </div>
                  <div className="space-y-2">
                    {appAccessExplanation.requirements.map((requirement) => (
                      <div key={`${requirement.resource}:${requirement.action}`} className="rounded-lg border border-gray-800 bg-gray-900 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`h-2 w-2 rounded-full ${requirement.allowed ? "bg-emerald-400" : "bg-red-400"}`} />
                              <span className="font-mono text-xs text-gray-300">{requirement.resource}:{requirement.action}</span>
                              <span className={`rounded border px-1.5 py-0.5 text-[10px] ${riskClass(requirement.risk)}`}>{requirement.risk}</span>
                            </div>
                            <div className="mt-2 text-sm leading-5 text-gray-500">{requirement.description}</div>
                            <div className="mt-1 text-xs text-gray-600">{requirement.reason.replaceAll("_", " ")}</div>
                          </div>
                          {!requirement.allowed && (
                            <button
                              type="button"
                              onClick={() => prepareGrant(appAccessExplanation.role, requirement.resource, requirement.action)}
                              className="shrink-0 rounded-md border border-indigo-500/40 px-3 py-1.5 text-xs text-indigo-200 hover:bg-indigo-500/10"
                            >
                              Prepare grant
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {appAccessExplanation.remediation.length > 0 && (
                    <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                      Add the missing grants below in Grant Builder, then rerun this explanation to verify access.
                    </div>
                  )}
                </div>
              </div>
            )}
              </>
            )}
          </div>

          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-medium text-gray-200">
                  <ClipboardCheck className="h-4 w-4 text-emerald-300" />
                  Policy Drift
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Compare registered native app and automation requirements against current role grants.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {policyDrift && (
                  <div className={`rounded-full px-3 py-1 text-xs font-medium ${postureClass(policyDrift.summary.posture)}`}>
                    {policyDrift.summary.orphaned} orphaned / {policyDrift.summary.missingHighRisk} high-risk gaps
                  </div>
                )}
                <button type="button" onClick={() => toggleRbacUtility("drift")} className="rounded-lg border border-gray-700 p-2 text-gray-400 hover:text-gray-100">
                  {openRbacUtilities.drift ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {openRbacUtilities.drift && policyDrift && (
              <div className="mt-4 grid gap-4 xl:grid-cols-[0.75fr_1.25fr]">
                <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                  <div className="grid grid-cols-2 gap-2">
                    <MiniMetric label="Roles" value={policyDrift.summary.roles} />
                    <MiniMetric label="Targets" value={policyDrift.summary.registeredTargets} />
                    <MiniMetric label="Grants" value={policyDrift.summary.grants} />
                    <MiniMetric label="Orphaned" value={policyDrift.summary.orphaned} />
                  </div>
                  <div className="mt-4 space-y-2">
                    {policyDrift.roleCoverage.map((coverage) => (
                      <div key={coverage.role} className="rounded-lg border border-gray-800 bg-gray-900 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium text-gray-200">{coverage.role}</div>
                          <div className={coverage.score >= 90 ? "text-emerald-300" : coverage.score >= 70 ? "text-amber-200" : "text-red-200"}>{coverage.score}%</div>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded bg-gray-800">
                          <div className="h-full bg-indigo-500" style={{ width: `${coverage.score}%` }} />
                        </div>
                        <div className="mt-2 text-xs text-gray-500">{coverage.granted} of {coverage.required} registered targets covered</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="rounded-lg border border-gray-800 bg-gray-950">
                    <div className="border-b border-gray-800 px-3 py-2 text-xs uppercase tracking-wide text-gray-500">Missing High-Risk Grants</div>
                    <div className="scrollbar-thin max-h-72 overflow-y-auto p-2">
                      {policyDrift.roleCoverage.flatMap((coverage) => coverage.missing.filter((item) => item.risk === "critical" || item.risk === "high")).slice(0, 20).map((item) => (
                        <div key={`${item.role}:${item.resource}:${item.action}`} className="mb-2 rounded-lg border border-gray-800 bg-gray-900 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium text-gray-100">{item.role}</span>
                                <span className={`rounded border px-1.5 py-0.5 text-[10px] ${riskClass(item.risk)}`}>{item.risk}</span>
                              </div>
                              <div className="mt-1 font-mono text-xs text-gray-500">{item.resource}:{item.action}</div>
                              <div className="mt-1 text-xs text-gray-600">{item.apps.map((app) => app.name).join(", ")}</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => bulkGrantPermissions(item.role, [{ resource: item.resource, action: item.action }])}
                              disabled={saving}
                              className="shrink-0 rounded-md border border-indigo-500/40 px-3 py-1.5 text-xs text-indigo-200 hover:bg-indigo-500/10 disabled:opacity-50"
                            >
                              Grant
                            </button>
                          </div>
                        </div>
                      ))}
                      {!policyDrift.roleCoverage.some((coverage) => coverage.missing.some((item) => item.risk === "critical" || item.risk === "high")) && (
                        <div className="px-3 py-8 text-center text-sm text-gray-500">No high-risk app drift detected.</div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-800 bg-gray-950">
                    <div className="border-b border-gray-800 px-3 py-2 text-xs uppercase tracking-wide text-gray-500">Orphaned Grants</div>
                    <div className="scrollbar-thin max-h-48 overflow-y-auto p-2">
                      {policyDrift.orphaned.slice(0, 20).map((grant) => (
                        <div key={grant.id} className="mb-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm text-gray-200">{grant.role}</div>
                              <div className="truncate font-mono text-xs text-gray-500">{grant.resource}:{grant.action}</div>
                            </div>
                            <span className={`rounded border px-2 py-0.5 text-[11px] ${riskClass(grant.risk)}`}>{grant.risk}</span>
                          </div>
                        </div>
                      ))}
                      {!policyDrift.orphaned.length && <div className="px-3 py-8 text-center text-sm text-gray-500">No orphaned grants detected.</div>}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-medium text-gray-200">
                  <Activity className="h-4 w-4 text-cyan-300" />
                  Audit Search
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Search administrative evidence and export the current result set for review.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="rounded-full border border-gray-700 bg-gray-950 px-3 py-1 text-xs text-gray-400">{auditTotal} events</div>
                <button type="button" onClick={() => toggleRbacUtility("audit")} className="rounded-lg border border-gray-700 p-2 text-gray-400 hover:text-gray-100">
                  {openRbacUtilities.audit ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {openRbacUtilities.audit && (
              <div className="mt-4 space-y-4">
                {auditIntegrity && (
                  <div className={`rounded-lg border p-3 ${auditIntegrity.verified ? "border-emerald-500/30 bg-emerald-500/10" : "border-red-500/30 bg-red-500/10"}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-gray-100">
                        {auditIntegrity.verified ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <XCircle className="h-4 w-4 text-red-300" />}
                        Audit chain {auditIntegrity.verified ? "verified" : "failed verification"}
                      </div>
                      <button type="button" onClick={verifyAuditLog} disabled={saving} className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-800 disabled:opacity-50">
                        Verify chain
                      </button>
                    </div>
                    <div className="mt-2 grid gap-2 text-xs text-gray-500 md:grid-cols-3">
                      <div>Checked <span className="text-gray-200">{auditIntegrity.checked}</span></div>
                      <div>Legacy <span className="text-gray-200">{auditIntegrity.legacyRows}</span></div>
                      <div>Failures <span className={auditIntegrity.failures.length ? "text-red-200" : "text-gray-200"}>{auditIntegrity.failures.length}</span></div>
                      <div className="truncate md:col-span-3">Head <span className="font-mono text-gray-400">{auditIntegrity.headHash || "-"}</span></div>
                    </div>
                  </div>
                )}
                <form onSubmit={searchAuditLog} className="flex flex-col gap-3 md:flex-row">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-500" />
                    <input
                      value={auditSearch}
                      onChange={(event) => setAuditSearch(event.target.value)}
                      placeholder="Search action, entity, actor email..."
                      className="w-full rounded-lg border border-gray-700 bg-gray-800 py-2 pl-9 pr-3 text-sm text-gray-200 outline-none focus:border-indigo-500"
                    />
                  </div>
                  <button type="submit" disabled={saving} className="flex items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search
                  </button>
                  <button type="button" onClick={exportAuditLog} className="flex items-center justify-center gap-2 rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-800">
                    <Download className="h-4 w-4" /> Export CSV
                  </button>
                </form>
                <div className="scrollbar-thin max-h-80 overflow-y-auto rounded-lg border border-gray-800 bg-gray-950">
                  {auditEntries.map((entry) => (
                    <div key={entry.id} className="border-b border-gray-800 px-3 py-3 last:border-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-mono text-xs text-gray-300">{entry.action}</div>
                        <div className="text-xs text-gray-600">{formatDateTime(entry.createdAt || entry.created_at)}</div>
                      </div>
                      <div className="mt-1 text-sm text-gray-400">{entry.entityType} <span className="font-mono text-xs text-gray-600">{entry.entityId}</span></div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-600">
                        <span>{entry.actorEmail || entry.actorName || entry.actorId || "system"}</span>
                        {entry.entryHash && <span className="font-mono">hash {entry.entryHash.slice(0, 12)}</span>}
                      </div>
                    </div>
                  ))}
                  {!auditEntries.length && <div className="px-3 py-8 text-center text-sm text-gray-500">No audit events match this search.</div>}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-medium text-gray-200">
                  <Shield className="h-4 w-4 text-amber-300" />
                  Field Restrictions
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Mark sensitive fields as explicitly restricted, then grant read/write access by role.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="rounded-full border border-gray-700 bg-gray-950 px-3 py-1 text-xs text-gray-400">
                  {restrictedFieldCount} restricted
                </div>
                <button type="button" onClick={() => toggleRbacUtility("fieldRestrictions")} className="rounded-lg border border-gray-700 p-2 text-gray-400 hover:text-gray-100">
                  {openRbacUtilities.fieldRestrictions ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {openRbacUtilities.fieldRestrictions && (
              <div className="mt-4 grid gap-4 xl:grid-cols-[320px_1fr]">
                <div className="space-y-3">
                  <FieldSelect
                    label="Table"
                    value={selectedFieldRestrictionTable?.id || ""}
                    onChange={setFieldRestrictionTableId}
                    options={fieldRestrictionTables.map((table) => ({ value: table.id, label: `${table.label} (${table.provider})` }))}
                  />
                  {selectedFieldRestrictionTable && (
                    <div className="rounded-lg border border-gray-800 bg-gray-950 p-3 text-sm text-gray-500">
                      <div className="text-gray-200">{selectedFieldRestrictionTable.label}</div>
                      <div className="mt-1 font-mono text-xs">{selectedFieldRestrictionTable.id}</div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <MiniMetric label="Fields" value={selectedFieldRestrictionTable.fields.length} />
                        <MiniMetric label="Restricted" value={selectedFieldRestrictionTable.fields.filter((field) => field.restricted).length} />
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-gray-800 bg-gray-950">
                  <div className="border-b border-gray-800 px-3 py-2 text-xs uppercase tracking-wide text-gray-500">
                    Field Policy
                  </div>
                  <div className="scrollbar-thin max-h-96 overflow-y-auto p-2">
                    {selectedFieldRestrictionTable?.fields.map((field) => (
                      <div key={field.resource} className="mb-2 rounded-lg border border-gray-800 bg-gray-900 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-gray-100">{field.label}</span>
                              <span className="font-mono text-xs text-gray-500">{field.name}</span>
                              {!field.writable && <span className="rounded border border-gray-700 px-1.5 py-0.5 text-[10px] text-gray-400">read only</span>}
                              {field.restricted && <span className="rounded border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-100">restricted</span>}
                            </div>
                            <div className="mt-1 font-mono text-xs text-gray-600">{field.resource}</div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              onClick={() => prepareGrant(newRole || fieldRestrictionGrantRole, field.resource, "read")}
                              className="rounded-md border border-indigo-500/40 px-2.5 py-1.5 text-xs text-indigo-200 hover:bg-indigo-500/10"
                            >
                              Grant read
                            </button>
                            {field.writable && (
                              <button
                                type="button"
                                onClick={() => prepareGrant(newRole || fieldRestrictionGrantRole, field.resource, "write")}
                                className="rounded-md border border-indigo-500/40 px-2.5 py-1.5 text-xs text-indigo-200 hover:bg-indigo-500/10"
                              >
                                Grant write
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => toggleFieldRestriction(selectedFieldRestrictionTable.id, field, !field.restricted)}
                              className={`rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                                field.restricted ? "border border-gray-700 text-gray-300 hover:bg-gray-800" : "bg-amber-600 text-white hover:bg-amber-500"
                              }`}
                            >
                              {field.restricted ? "Unrestrict" : "Restrict"}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                    {!selectedFieldRestrictionTable && (
                      <div className="px-3 py-8 text-center text-sm text-gray-500">No registered tables were returned.</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-medium text-gray-200">
                  <Database className="h-4 w-4 text-emerald-300" />
                  Explain Table & Field Access
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Verify table access and field-level restrictions using the same policy path enforced by table-backed APIs.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {tableAccessExplanation && (
                  <div className={`rounded-full px-3 py-1 text-xs font-medium ${
                    tableAccessExplanation.allowed ? "bg-emerald-500/10 text-emerald-200" : "bg-red-500/10 text-red-200"
                  }`}>
                    {tableAccessExplanation.allowed ? "Allowed" : `${tableAccessExplanation.missing.length} missing`}
                  </div>
                )}
                <button type="button" onClick={() => toggleRbacUtility("table")} className="rounded-lg border border-gray-700 p-2 text-gray-400 hover:text-gray-100">
                  {openRbacUtilities.table ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {openRbacUtilities.table && (
              <>
                <form onSubmit={explainTableAccess} className="mt-4 grid items-end gap-3 xl:grid-cols-[1.2fr_1fr_1.35fr_1fr_0.8fr_auto]">
                  <FieldSelect
                    label="User"
                    value={tableAccessProbe.userId}
                    onChange={(value) => {
                      const user = rbacUsers.find((candidate) => candidate.id === value);
                      setTableAccessProbe((current) => ({ ...current, userId: value, role: user?.role || current.role }));
                    }}
                    options={[
                      { value: "", label: "Explain role only" },
                      ...rbacUsers.map((user) => ({ value: user.id, label: `${user.name || user.email} (${user.role})` })),
                    ]}
                  />
                  <FieldSelect
                    label="Role"
                    value={tableAccessProbe.role}
                    onChange={(value) => setTableAccessProbe((current) => ({ ...current, role: value, userId: "" }))}
                    options={allRoles.map((role) => ({ value: role, label: role }))}
                  />
                  <FieldSelect
                    label="Table"
                    value={tableAccessProbe.tableId}
                    onChange={(value) => setTableAccessProbe((current) => ({ ...current, tableId: value, fieldName: "" }))}
                    options={rbacTables.map((table) => ({ value: table.id, label: `${table.label} (${table.provider})` }))}
                  />
                  <FieldSelect
                    label="Field"
                    value={tableAccessProbe.fieldName}
                    onChange={(value) => setTableAccessProbe((current) => ({ ...current, fieldName: value }))}
                    options={tableFieldOptions}
                  />
                  <FieldSelect
                    label="Mode"
                    value={tableAccessProbe.accessMode}
                    onChange={(value) => setTableAccessProbe((current) => ({ ...current, accessMode: value }))}
                    options={[
                      { value: "read", label: "Read" },
                      { value: "write", label: "Write" },
                    ]}
                  />
                  <button
                    type="submit"
                    disabled={saving || (!tableAccessProbe.userId && !tableAccessProbe.role) || !tableAccessProbe.tableId}
                    className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Explain
                  </button>
                </form>

                {tableAccessExplanation && (
                  <div className="mt-5 grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
                    <div className={`rounded-lg border p-4 ${
                      tableAccessExplanation.allowed ? "border-emerald-500/30 bg-emerald-500/10" : "border-red-500/30 bg-red-500/10"
                    }`}>
                      <div className="flex items-center gap-2">
                        {tableAccessExplanation.allowed ? <CheckCircle2 className="h-5 w-5 text-emerald-300" /> : <XCircle className="h-5 w-5 text-red-300" />}
                        <div className="font-medium text-gray-100">
                          {tableAccessExplanation.role} {tableAccessExplanation.allowed ? "can" : "cannot"} {tableAccessExplanation.accessMode} {tableAccessExplanation.table.label}
                        </div>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <MiniMetric label="Table read" value={tableAccessExplanation.tableAccess.read.allowed ? "allowed" : "missing"} />
                        <MiniMetric label="Table write" value={tableAccessExplanation.tableAccess.write.allowed ? "allowed" : "missing"} />
                        <MiniMetric label="Fields checked" value={tableAccessExplanation.fields.length} />
                        <MiniMetric label="Restricted" value={tableAccessExplanation.fields.filter((field) => field.restricted).length} />
                      </div>
                      {tableAccessExplanation.missing.length > 0 && (
                        <div className="mt-4 space-y-2">
                          {tableAccessExplanation.missing.map((item) => (
                            <button
                              key={`${item.resource}:${item.action}`}
                              type="button"
                              onClick={() => prepareGrant(tableAccessExplanation.role, item.resource, item.action)}
                              className="block w-full rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-100 hover:bg-amber-500/15"
                            >
                              Prepare {item.resource}:{item.action}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="text-sm font-medium text-gray-200">Field Decisions</div>
                        <span className="font-mono text-xs text-gray-600">{tableAccessExplanation.table.id}</span>
                      </div>
                      <div className="scrollbar-thin max-h-72 space-y-2 overflow-y-auto pr-1">
                        {tableAccessExplanation.fields.map((field) => (
                          <div key={field.field} className="rounded-lg border border-gray-800 bg-gray-900 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-medium text-gray-100">{field.label}</span>
                                  <span className="font-mono text-xs text-gray-500">{field.field}</span>
                                  {field.restricted && <span className="rounded border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-100">restricted</span>}
                                  {!field.writable && <span className="rounded border border-gray-700 px-1.5 py-0.5 text-[10px] text-gray-400">read only</span>}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                  <span className={field.read ? "text-emerald-300" : "text-red-300"}>read: {field.readReason.replaceAll("_", " ")}</span>
                                  <span className={field.write || !field.writable ? "text-emerald-300" : "text-red-300"}>write: {field.writeReason.replaceAll("_", " ")}</span>
                                </div>
                              </div>
                              {field.restricted && !field.read && (
                                <button
                                  type="button"
                                  onClick={() => prepareGrant(tableAccessExplanation.role, field.resource, "read")}
                                  className="shrink-0 rounded-md border border-indigo-500/40 px-2 py-1 text-xs text-indigo-200 hover:bg-indigo-500/10"
                                >
                                  Grant read
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-4 space-y-2">
                        {tableAccessExplanation.trace.map((step, index) => (
                          <div key={`${step.label}-${index}`} className="rounded-md border border-gray-800 bg-gray-900 px-3 py-2">
                            <div className="flex items-center gap-2 text-xs font-medium text-gray-300">
                              <span className={`h-2 w-2 rounded-full ${
                                step.status === "allow" ? "bg-emerald-400" : step.status === "deny" ? "bg-red-400" : "bg-cyan-400"
                              }`} />
                              {step.label}
                            </div>
                            <div className="mt-1 text-xs leading-5 text-gray-500">{step.detail}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-medium text-gray-200">
                  <Activity className="h-4 w-4 text-indigo-300" />
                  Explain Tool Access
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Troubleshoot chat, automation, and app-tool execution failures against the same policy used at runtime.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {toolAccessExplanation && (
                  <div className={`rounded-full px-3 py-1 text-xs font-medium ${
                    toolAccessExplanation.allowed ? "bg-emerald-500/10 text-emerald-200" : "bg-red-500/10 text-red-200"
                  }`}>
                    {toolAccessExplanation.allowed ? "Executable" : "Blocked"}
                  </div>
                )}
                <button type="button" onClick={() => toggleRbacUtility("tool")} className="rounded-lg border border-gray-700 p-2 text-gray-400 hover:text-gray-100">
                  {openRbacUtilities.tool ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {openRbacUtilities.tool && (
              <>
            <form onSubmit={explainToolAccess} className="mt-4 grid items-end gap-3 lg:grid-cols-[1.2fr_1fr_1.5fr_auto]">
              <FieldSelect
                label="User"
                value={toolAccessProbe.userId}
                onChange={(value) => {
                  const user = rbacUsers.find((candidate) => candidate.id === value);
                  setToolAccessProbe((current) => ({ ...current, userId: value, role: user?.role || current.role }));
                }}
                options={[
                  { value: "", label: "Explain role only" },
                  ...rbacUsers.map((user) => ({ value: user.id, label: `${user.name || user.email} (${user.role})` })),
                ]}
              />
              <FieldSelect
                label="Role"
                value={toolAccessProbe.role}
                onChange={(value) => setToolAccessProbe((current) => ({ ...current, role: value, userId: "" }))}
                options={allRoles.map((role) => ({ value: role, label: role }))}
              />
              <FieldSelect
                label="Tool"
                value={toolAccessProbe.tool}
                onChange={(value) => setToolAccessProbe((current) => ({ ...current, tool: value }))}
                options={rbacTools.map((tool) => ({
                  value: encodePermissionValue(tool.appId, tool.toolName),
                  label: `${tool.fullName} -> ${tool.resource}:${tool.action}`,
                }))}
              />
              <button
                type="submit"
                disabled={saving || (!toolAccessProbe.userId && !toolAccessProbe.role) || !toolAccessProbe.tool}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Explain
              </button>
            </form>

            {toolAccessExplanation && (
              <div className="mt-5 grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
                <div className={`rounded-lg border p-4 ${
                  toolAccessExplanation.allowed ? "border-emerald-500/30 bg-emerald-500/10" : "border-red-500/30 bg-red-500/10"
                }`}>
                  <div className="flex items-center gap-2">
                    {toolAccessExplanation.allowed ? <CheckCircle2 className="h-5 w-5 text-emerald-300" /> : <XCircle className="h-5 w-5 text-red-300" />}
                    <div className="font-medium text-gray-100">
                      {toolAccessExplanation.role} {toolAccessExplanation.allowed ? "can execute" : "cannot execute"} {toolAccessExplanation.tool.fullName}
                    </div>
                  </div>
                  <div className="mt-3 text-sm leading-6 text-gray-400">{toolAccessExplanation.tool.description || "No tool description registered."}</div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <MiniMetric label="Resolved resource" value={toolAccessExplanation.tool.resource} />
                    <MiniMetric label="Required action" value={toolAccessExplanation.tool.action} />
                    <MiniMetric label="Risk" value={toolAccessExplanation.tool.risk} />
                    <MiniMetric label="Policy result" value={toolAccessExplanation.requirement.reason.replaceAll("_", " ")} />
                  </div>
                  {!toolAccessExplanation.allowed && (
                    <button
                      type="button"
                      onClick={() => prepareGrant(toolAccessExplanation.role, toolAccessExplanation.tool.resource, toolAccessExplanation.tool.action)}
                      className="mt-4 rounded-md border border-indigo-500/40 px-3 py-1.5 text-xs text-indigo-200 hover:bg-indigo-500/10"
                    >
                      Prepare missing grant
                    </button>
                  )}
                </div>

                <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-gray-200">Runtime Decision Trace</div>
                    <span className={`rounded border px-2 py-0.5 text-xs ${riskClass(toolAccessExplanation.tool.risk)}`}>{toolAccessExplanation.tool.risk}</span>
                  </div>
                  <div className="space-y-2">
                    {toolAccessExplanation.trace.map((step, index) => (
                      <div key={`${step.label}-${index}`} className="rounded-md border border-gray-800 bg-gray-900 px-3 py-2">
                        <div className="flex items-center gap-2 text-xs font-medium text-gray-300">
                          <span className={`h-2 w-2 rounded-full ${
                            step.status === "allow" ? "bg-emerald-400" : step.status === "deny" ? "bg-red-400" : "bg-indigo-400"
                          }`} />
                          {step.label}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-gray-500">{step.detail}</div>
                      </div>
                    ))}
                  </div>
                  {toolAccessExplanation.remediation.length > 0 && (
                    <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                      This is the same resource/action check used by app tool REST, queued jobs, and chat tool execution.
                    </div>
                  )}
                </div>
              </div>
            )}
              </>
            )}
          </div>

          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-medium text-gray-200">
                  <KeyRound className="h-4 w-4 text-indigo-300" />
                  Access Analyzer
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Explain why a user or role can perform an action before changing grants.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {accessAnalysis && (
                  <div className={`rounded-full px-3 py-1 text-xs font-medium ${
                    accessAnalysis.allowed ? "bg-emerald-500/10 text-emerald-200" : "bg-red-500/10 text-red-200"
                  }`}>
                    {accessAnalysis.allowed ? "Allowed" : "Denied"}
                  </div>
                )}
                <button type="button" onClick={() => toggleRbacUtility("analyzer")} className="rounded-lg border border-gray-700 p-2 text-gray-400 hover:text-gray-100">
                  {openRbacUtilities.analyzer ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {openRbacUtilities.analyzer && (
              <>
            <form onSubmit={analyzeAccess} className="mt-4 grid items-end gap-3 lg:grid-cols-[1.2fr_1fr_1.2fr_auto]">
              <FieldSelect
                label="User"
                value={accessProbe.userId}
                onChange={(value) => {
                  const user = rbacUsers.find((candidate) => candidate.id === value);
                  setAccessProbe((current) => ({ ...current, userId: value, role: user?.role || current.role }));
                }}
                options={[
                  { value: "", label: "Analyze role only" },
                  ...rbacUsers.map((user) => ({ value: user.id, label: `${user.name || user.email} (${user.role})` })),
                ]}
              />
              <FieldSelect
                label="Role"
                value={accessProbe.role}
                onChange={(value) => setAccessProbe((current) => ({ ...current, role: value, userId: "" }))}
                options={allRoles.map((role) => ({ value: role, label: role }))}
              />
              <FieldSelect
                label="Permission"
                value={accessProbe.target}
                onChange={(value) => setAccessProbe((current) => ({ ...current, target: value }))}
                options={rbacTargets.map((target) => ({
                  value: encodePermissionValue(target.resource, target.action),
                  label: `${target.label || target.resource} - ${target.action} (${target.risk})`,
                }))}
              />
              <button
                type="submit"
                disabled={saving || (!accessProbe.userId && !accessProbe.role) || !accessProbe.target}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Analyze
              </button>
            </form>

            {accessAnalysis && (
              <div className="mt-5 grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
                <div className={`rounded-lg border p-4 ${
                  accessAnalysis.allowed ? "border-emerald-500/30 bg-emerald-500/10" : "border-red-500/30 bg-red-500/10"
                }`}>
                  <div className="flex items-center gap-2">
                    {accessAnalysis.allowed ? <CheckCircle2 className="h-5 w-5 text-emerald-300" /> : <XCircle className="h-5 w-5 text-red-300" />}
                    <div className="font-medium text-gray-100">
                      {accessAnalysis.role} {accessAnalysis.allowed ? "can" : "cannot"} {accessAnalysis.action} {accessAnalysis.resource}
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-gray-500">Reason</div>
                      <div className="mt-1 text-gray-300">{accessAnalysis.reason.replaceAll("_", " ")}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-gray-500">Risk</div>
                      <div className="mt-1 text-gray-300">{accessAnalysis.risk}</div>
                    </div>
                  </div>
                  {accessAnalysis.missing.length > 0 && (
                    <div className="mt-4 rounded-lg border border-red-500/20 bg-gray-950/60 p-3 text-sm text-red-100">
                      Missing grant: {accessAnalysis.missing.map((item) => `${item.resource}:${item.action}`).join(", ")}
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-200">
                    <AlertTriangle className="h-4 w-4 text-amber-300" />
                    Decision Trace
                  </div>
                  <div className="space-y-2">
                    {accessAnalysis.trace.map((step, index) => (
                      <div key={`${step.label}-${index}`} className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2">
                        <div className="flex items-center gap-2 text-sm text-gray-200">
                          <span className={`h-2 w-2 rounded-full ${
                            step.status === "allow" ? "bg-emerald-400" : step.status === "deny" ? "bg-red-400" : "bg-indigo-400"
                          }`} />
                          {step.label}
                        </div>
                        <div className="mt-1 text-sm text-gray-500">{step.detail}</div>
                      </div>
                    ))}
                  </div>
                  {accessAnalysis.relatedApps.length > 0 && (
                    <div className="mt-4 text-sm text-gray-500">
                      Related apps: <span className="text-gray-300">{accessAnalysis.relatedApps.map((app) => app.name).join(", ")}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
              </>
            )}
          </div>

          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-medium text-gray-200">
                  <Plus className="h-4 w-4 text-indigo-300" /> Grant Builder
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Search the registered permission catalog, preview impact, then grant the exact role/resource/action.
                </p>
              </div>
              <div className="rounded-full border border-gray-700 bg-gray-950 px-3 py-1 text-xs text-gray-400">
                {rbacTargets.length} registered targets
              </div>
            </div>

            <form onSubmit={addPermission} className="mt-4 grid gap-4 xl:grid-cols-[300px_1fr_360px]">
              <div className="space-y-3">
                <FieldSelect
                  label="Role"
                  value={newRole}
                  onChange={setNewRole}
                  options={[{ value: "", label: "Select role" }, ...allRoles.map((role) => ({ value: role, label: role }))]}
                />
                <div>
                  <label className="mb-1 block text-xs text-gray-500">Scope</label>
                  <div className="scrollbar-thin flex max-h-44 flex-wrap gap-2 overflow-y-auto rounded-lg border border-gray-800 bg-gray-950 p-2">
                    {grantScopes.map((scope) => (
                      <button
                        key={scope}
                        type="button"
                        onClick={() => setGrantScope(scope)}
                        className={`rounded-md px-2.5 py-1.5 text-xs ${grantScope === scope ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:text-gray-100"}`}
                      >
                        {scope}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-500">Search</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                    <input
                      value={grantSearch}
                      onChange={(event) => setGrantSearch(event.target.value)}
                      placeholder="Find app, table, field, action..."
                      className="w-full rounded-lg border border-gray-700 bg-gray-800 py-2 pl-9 pr-3 text-sm text-gray-200 outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>

              <div className="min-h-[320px] rounded-lg border border-gray-800 bg-gray-950">
                <div className="border-b border-gray-800 px-3 py-2 text-xs uppercase tracking-wide text-gray-500">
                  <div className="flex items-center justify-between gap-3">
                    <span>Permission Catalog</span>
                    <span>{selectedBulkGrantTargets.length} selected</span>
                  </div>
                </div>
                <div className="scrollbar-thin max-h-[430px] overflow-y-auto p-2">
                  {filteredGrantTargets.map((target) => {
                    const selected = selectedPermissionTarget === encodePermissionValue(target.resource, target.action);
                    const bulkKey = encodePermissionValue(target.resource, target.action);
                    const bulkSelected = Boolean(selectedBulkGrants[bulkKey]);
                    return (
                      <div
                        key={`${target.resource}:${target.action}`}
                        className={`mb-2 w-full rounded-lg border px-3 py-3 text-left transition-colors ${
                          selected ? "border-indigo-400 bg-indigo-500/15" : "border-gray-800 bg-gray-900 hover:border-gray-700"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => setSelectedBulkGrants((current) => ({ ...current, [bulkKey]: !current[bulkKey] }))}
                            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${bulkSelected ? "border-indigo-400 bg-indigo-500 text-white" : "border-gray-700 text-transparent"}`}
                            title={bulkSelected ? "Remove from bulk grant" : "Select for bulk grant"}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setNewResource(target.resource);
                              setNewAction(target.action);
                            }}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="truncate text-sm font-medium text-gray-100">{target.label || target.resource}</div>
                            <div className="mt-1 truncate font-mono text-xs text-gray-500">{target.resource}:{target.action}</div>
                          </button>
                          <span className={`shrink-0 rounded border px-2 py-0.5 text-[11px] ${riskClass(target.risk)}`}>{target.risk}</span>
                        </div>
                        <div className="mt-2 text-sm leading-5 text-gray-500">{target.description}</div>
                        <div className="mt-2 text-xs text-gray-600">{target.source || target.category}</div>
                      </div>
                    );
                  })}
                  {!filteredGrantTargets.length && (
                    <div className="px-3 py-10 text-center text-sm text-gray-500">No permissions match this filter.</div>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500">Grant Preview</div>
                {selectedGrantTarget ? (
                  <div className="mt-4 space-y-4">
                    <div>
                      <div className="text-sm font-medium text-gray-100">{selectedGrantTarget.label || selectedGrantTarget.resource}</div>
                      <div className="mt-1 font-mono text-xs text-gray-500">{selectedGrantTarget.resource}:{selectedGrantTarget.action}</div>
                    </div>
                    <div className="rounded-lg border border-gray-800 bg-gray-900 p-3 text-sm leading-6 text-gray-400">
                      {selectedGrantTarget.description}
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="text-xs uppercase tracking-wide text-gray-600">Scope</div>
                        <div className="mt-1 text-gray-300">{selectedGrantTarget.category || "Application"}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wide text-gray-600">Risk</div>
                        <div className={`mt-1 inline-flex rounded border px-2 py-0.5 text-xs ${riskClass(selectedGrantTarget.risk)}`}>{selectedGrantTarget.risk}</div>
                      </div>
                    </div>
                    <div className="rounded-lg border border-gray-800 bg-gray-900 p-3 text-sm text-gray-500">
                      {newRole ? (
                        existingGrant ? (
                          <span className="text-amber-200">Role {newRole} already has this grant.</span>
                        ) : (
                          <span>Role <span className="text-gray-200">{newRole}</span> will receive this exact permission.</span>
                        )
                      ) : "Select a role to preview who receives this grant."}
                    </div>
                    <button
                      type="button"
                      disabled={saving || !newRole || !selectedBulkGrantTargets.length}
                      onClick={() => bulkGrantPermissions(newRole, selectedBulkGrantTargets)}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-500/40 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-500/10 disabled:opacity-50"
                    >
                      <ClipboardCheck className="h-4 w-4" /> Bulk Grant Selected ({selectedBulkGrantTargets.length})
                    </button>
                    <button
                      type="submit"
                      disabled={saving || !newRole || !newResource || !newAction || Boolean(existingGrant)}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Grant Permission
                    </button>
                  </div>
                ) : (
                  <div className="mt-10 text-center text-sm leading-6 text-gray-500">
                    Select a permission target to see description, risk, and grant impact.
                  </div>
                )}
              </div>
            </form>
          </div>
          {roles.map((role) => (
            <div key={role} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-gray-800/50 border-b border-gray-800">
                <h3 className="text-sm font-medium text-gray-200 capitalize">{role}</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-800">
                    <th className="px-4 py-2 font-medium">Resource</th>
                    <th className="px-4 py-2 font-medium">Action</th>
                    <th className="px-4 py-2 font-medium w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {permissions.filter((p) => p.role === role).map((p) => (
                    <tr key={p.id} className="border-b border-gray-800/50 last:border-0">
                      <td className="px-4 py-2 text-gray-300">{p.resource}</td>
                      <td className="px-4 py-2 text-gray-300">{p.action}</td>
                      <td className="px-4 py-2">
                        <button onClick={() => deletePermission(p.id)} className="text-gray-500 hover:text-red-400 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      );
    }

    if (activeTab === "system-properties") {
      return (
        <div className="space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h2 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add System Property
            </h2>
            <form onSubmit={addSystemProperty} className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Key</label>
                <input type="text" value={newPropKey} onChange={(e) => setNewPropKey(e.target.value)} placeholder="e.g. max_upload_size"
                  className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-indigo-500" />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Value</label>
                <input type="text" value={newPropValue} onChange={(e) => setNewPropValue(e.target.value)} placeholder="e.g. 10485760"
                  className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-indigo-500" />
              </div>
              <button type="submit" disabled={saving || !newPropKey || !newPropValue}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Add
              </button>
            </form>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-800">
                  <th className="px-4 py-2 font-medium">Key</th>
                  <th className="px-4 py-2 font-medium">Value</th>
                  <th className="px-4 py-2 font-medium">Updated</th>
                  <th className="px-4 py-2 font-medium w-16"></th>
                </tr>
              </thead>
              <tbody>
                {systemProps.map((prop) => (
                  <SystemPropertyRow key={prop.key} prop={prop} onUpdate={updateSystemProperty} onDelete={deleteSystemProperty} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (activeTab === "environments") {
      return (
        <div className="space-y-6">
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <div className="mb-4">
              <h2 className="flex items-center gap-2 text-sm font-medium text-gray-200">
                <Database className="h-4 w-4 text-cyan-300" />
                Add environment
              </h2>
              <p className="mt-1 text-xs text-gray-500">Environment choices appear in CMDB and Tables pickers. Existing discovered string values are still preserved.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_120px_auto_auto]">
              <FieldInput label="Name" value={environmentDraft.name} onChange={(value) => setEnvironmentDraft((current) => ({ ...current, name: value }))} placeholder="Production" />
              <FieldInput label="Code" value={environmentDraft.code} onChange={(value) => setEnvironmentDraft((current) => ({ ...current, code: value }))} placeholder="production" help="Optional. Generated from name if blank." />
              <FieldInput label="Sort" value={environmentDraft.sortOrder} onChange={(value) => setEnvironmentDraft((current) => ({ ...current, sortOrder: value }))} type="number" />
              <label className="flex items-end gap-2 pb-2 text-sm text-gray-300">
                <input type="checkbox" checked={environmentDraft.isProductionLike} onChange={(event) => setEnvironmentDraft((current) => ({ ...current, isProductionLike: event.target.checked }))} className="rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500" />
                Production-like
              </label>
              <button type="button" onClick={() => saveEnvironmentChoice()} disabled={saving || !environmentDraft.name.trim()} className="self-end rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
                Add
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-gray-500">
                <tr className="border-b border-gray-800">
                  <th className="px-4 py-3">Environment</th>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Sort</th>
                  <th className="px-4 py-3">Flags</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {environmentChoices.map((choice) => (
                  <tr key={choice.id} className="border-b border-gray-800/70">
                    <td className="px-4 py-3">
                      <input value={choice.name} onChange={(event) => setEnvironmentChoices((current) => current.map((item) => item.id === choice.id ? { ...item, name: event.target.value } : item))} className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100 outline-none focus:border-indigo-500" />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-400">{choice.code}</td>
                    <td className="px-4 py-3">
                      <input type="number" value={choice.sortOrder} onChange={(event) => setEnvironmentChoices((current) => current.map((item) => item.id === choice.id ? { ...item, sortOrder: Number(event.target.value) || 0 } : item))} className="w-24 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100 outline-none focus:border-indigo-500" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <label className="inline-flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-950 px-2 py-1 text-xs text-gray-300">
                          <input type="checkbox" checked={choice.active} onChange={(event) => setEnvironmentChoices((current) => current.map((item) => item.id === choice.id ? { ...item, active: event.target.checked } : item))} className="rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500" />
                          Active
                        </label>
                        <label className="inline-flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-950 px-2 py-1 text-xs text-gray-300">
                          <input type="checkbox" checked={choice.isProductionLike} onChange={(event) => setEnvironmentChoices((current) => current.map((item) => item.id === choice.id ? { ...item, isProductionLike: event.target.checked } : item))} className="rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500" />
                          Prod-like
                        </label>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => saveEnvironmentChoice({ code: choice.code, name: choice.name, active: choice.active, sortOrder: String(choice.sortOrder), isProductionLike: choice.isProductionLike })} disabled={saving} className="rounded-lg border border-indigo-500/30 px-3 py-2 text-xs text-indigo-100 hover:bg-indigo-500/10 disabled:opacity-50">Save</button>
                        <button type="button" onClick={() => deleteEnvironmentChoice(choice.id)} disabled={saving} className="rounded-lg border border-red-500/30 px-3 py-2 text-xs text-red-200 hover:bg-red-500/10 disabled:opacity-50">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!environmentChoices.length && (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-500">No environments configured.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (activeTab === "credentials") {
      return (
        <div className="space-y-6">
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-medium text-gray-200">
                  <KeyRound className="h-4 w-4 text-emerald-300" />
                  Credential References
                </h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-500">
                  Register reusable refs for Discovery and integration clients while keeping secret values outside Specora.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-right text-sm">
                <MiniMetric label="Total" value={credentials.length} />
                <MiniMetric label="Active" value={credentials.filter((credential) => credential.status === "active").length} />
                <MiniMetric label="Healthy" value={credentials.filter((credential) => credential.lastStatus === "ok").length} />
              </div>
            </div>

            <form onSubmit={addCredential} className="mt-5 space-y-4" autoComplete="off">
              <div className="grid gap-4 xl:grid-cols-3">
                <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-gray-500">1. Usage</div>
                  <div className="mt-3 space-y-3">
                    <FieldInput
                      label="Display Name"
                      value={newCredential.name}
                      onChange={(value) => setNewCredential((current) => ({ ...current, name: value }))}
                      placeholder="Inventory API"
                      help="Human-readable label shown in Admin."
                      autoComplete="off"
                      inputName="credential-display-name"
                    />
                    <FieldSelect
                      label="Scope"
                      value={newCredential.scope}
                      onChange={(value) => setNewCredential((current) => ({ ...current, scope: value }))}
                      options={CREDENTIAL_SCOPE_OPTIONS}
                      help="Which product area is expected to use this credential."
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-gray-500">2. App Reference</div>
                  <div className="mt-3 space-y-3">
                    <ReadOnlyField
                      label="Generated Credential Ref"
                      value={generatedCredentialRef || "Set a display name to generate a ref"}
                      muted={!generatedCredentialRef}
                      help="Stable URI that apps store on records. Specora builds it from provider, scope, and display name."
                    />
                    <FieldSelect
                      label="Status"
                      value={newCredential.status}
                      onChange={(value) => setNewCredential((current) => ({ ...current, status: value }))}
                      options={[
                        { value: "active", label: "Active" },
                        { value: "disabled", label: "Disabled" },
                      ]}
                      help="Disabled refs remain registered but fail availability checks."
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-gray-500">3. Backing Secret</div>
                  <div className="mt-3 space-y-3">
                    <FieldSelect
                      label="Provider"
                      value={newCredential.provider}
                      onChange={(value) => setNewCredential((current) => ({ ...current, provider: value }))}
                      options={CREDENTIAL_PROVIDER_OPTIONS}
                      help="Managed secrets can be updated without restarting API. Env variables are for bootstrap or local development."
                    />
                    {newCredential.provider === "managed" && (
                      <FieldInput
                        label="Secret Value"
                        value={newCredential.secretValue}
                        onChange={(value) => setNewCredential((current) => ({ ...current, secretValue: value }))}
                      type={showCredentialSecret ? "text" : "password"}
                      placeholder="Paste API key or token"
                      help="Encrypted before storage and never returned by the API."
                      autoComplete="new-password"
                      inputName="credential-managed-secret"
                      trailing={
                          <button
                            type="button"
                            onClick={() => setShowCredentialSecret((visible) => !visible)}
                            className="rounded p-1 text-gray-500 hover:bg-gray-700 hover:text-gray-200"
                            title={showCredentialSecret ? "Mask secret value" : "Unmask secret value"}
                          >
                            {showCredentialSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        }
                      />
                    )}
                    {newCredential.provider === "env" && (
                      <FieldInput
                        label="Environment Key"
                        value={newCredential.secretEnvKey}
                        onChange={(value) => setNewCredential((current) => ({ ...current, secretEnvKey: value }))}
                        placeholder="DISCOVERY_TOKEN"
                        help="Name of the process environment variable that holds the secret."
                      />
                    )}
                    {newCredential.provider === "external" && (
                      <FieldInput
                        label="External Store Ref"
                        value={newCredential.externalRef}
                        onChange={(value) => setNewCredential((current) => ({ ...current, externalRef: value }))}
                        placeholder="vault/specora/discovery"
                        help="Path or identifier in an outside secret store. Specora records the pointer but does not ingest vault certificates yet."
                      />
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-950 px-4 py-3">
                <div className="text-xs leading-5 text-gray-500">
                  Discovery stores the Credential Ref on a source. At test or run time, the provider determines where the secret is resolved.
                </div>
                <button
                  type="submit"
                  disabled={saving || !canAddCredential}
                  className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Add Reference
                </button>
              </div>
            </form>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Ref</th>
                  <th className="px-4 py-3 font-medium">Provider</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Last Test</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {credentials.map((credential) => (
                  <tr key={credential.id} className="border-b border-gray-800/50 last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-100">{credential.name}</div>
                      <div className="mt-1 text-xs text-gray-500">{credential.scope}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-indigo-200">{credential.ref}</td>
                    <td className="px-4 py-3 capitalize text-gray-300">{credential.provider}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => updateCredential(credential.id, { status: credential.status === "active" ? "disabled" : "active" })}
                        className={`rounded-md border px-2.5 py-1 text-xs ${credential.status === "active" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-gray-700 bg-gray-800 text-gray-400"}`}
                      >
                        {credential.status}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className={`text-xs ${credential.lastStatus === "ok" ? "text-emerald-300" : credential.lastStatus ? "text-amber-300" : "text-gray-500"}`}>
                        {credential.lastStatus || "untested"}
                      </div>
                      {credential.lastError && <div className="mt-1 max-w-xs truncate text-xs text-gray-500">{credential.lastError}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => testCredential(credential.id)} className="rounded-md border border-gray-700 p-2 text-gray-300 hover:bg-gray-800" title="Test">
                          <CheckCircle2 className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => deleteCredential(credential.id)} className="rounded-md border border-gray-700 p-2 text-gray-400 hover:bg-gray-800" title="Delete">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!credentials.length && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">No credential references registered.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (activeTab === "identity") {
      return (
        <div className="space-y-6">
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-medium text-gray-200">
                  <KeyRound className="h-4 w-4 text-cyan-300" />
                  Multi-provider SSO
                </h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-500">
                  Register one provider per IdP, tenant, or domain set. Login discovery uses the user's email domain to route to the matching active provider.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-2">
                  <div className="text-lg font-semibold text-gray-100">{ssoConfigs.length}</div>
                  <div className="text-gray-500">providers</div>
                </div>
                <div className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-2">
                  <div className="text-lg font-semibold text-emerald-200">{ssoConfigs.filter((config) => config.status === "active").length}</div>
                  <div className="text-gray-500">active</div>
                </div>
                <div className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-2">
                  <div className="text-lg font-semibold text-amber-200">{ssoConfigs.filter((config) => config.enforceSso).length}</div>
                  <div className="text-gray-500">enforced</div>
                </div>
              </div>
            </div>
          </div>

          <form onSubmit={addSsoConfig} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <button type="button" onClick={() => setIsSsoRegisterOpen((open) => !open)} className="flex w-full items-center justify-between gap-3 text-left">
              <span className="flex items-center gap-2 text-sm font-medium text-gray-300">
                <Plus className="h-4 w-4" /> Register Identity Provider
              </span>
              {isSsoRegisterOpen ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-500" />}
            </button>
            {isSsoRegisterOpen && <div className="mt-4">
            <div className="mb-4 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3 text-sm text-cyan-100">
              <div className="font-medium">SAML service provider values are generated after saving the provider.</div>
              <div className="mt-1 text-cyan-200/70">Create the provider first, then copy the ACS URL and Entity ID from its card into the IdP configuration.</div>
            </div>
            <div className="grid gap-3 lg:grid-cols-4">
              <FieldInput label="Name" value={newSsoConfig.name} onChange={(value) => setNewSsoConfig((current) => ({ ...current, name: value }))} placeholder="Okta Workforce" />
              <FieldSelect
                label="Protocol"
                value={newSsoConfig.provider}
                onChange={(value) => setNewSsoConfig((current) => ({ ...current, provider: value as "saml" | "oidc" }))}
                options={[{ value: "saml", label: "SAML 2.0" }, { value: "oidc", label: "OpenID Connect" }]}
              />
              <FieldSelect
                label="Status"
                value={newSsoConfig.status}
                onChange={(value) => setNewSsoConfig((current) => ({ ...current, status: value as "active" | "inactive" }))}
                options={[{ value: "inactive", label: "Inactive" }, { value: "active", label: "Active" }]}
              />
              <FieldInput label="Domains" value={newSsoConfig.emailDomains} onChange={(value) => setNewSsoConfig((current) => ({ ...current, emailDomains: value }))} placeholder="example.com, corp.example" />
              {newSsoConfig.provider === "saml" ? (
                <>
                  <FieldInput label="IdP SSO URL" value={newSsoConfig.idpSsoUrl} onChange={(value) => setNewSsoConfig((current) => ({ ...current, idpSsoUrl: value }))} placeholder="https://idp.example/sso" />
                  <FieldInput label="IdP Entity ID" value={newSsoConfig.idpEntityId} onChange={(value) => setNewSsoConfig((current) => ({ ...current, idpEntityId: value }))} />
                  <FieldInput label="Metadata URL" value={newSsoConfig.metadataUrl} onChange={(value) => setNewSsoConfig((current) => ({ ...current, metadataUrl: value }))} />
                  <div>
                    <label className="mb-1 block text-xs text-gray-500">Metadata XML</label>
                    <input type="file" accept=".xml,text/xml,application/xml" onChange={(event) => readSamlMetadataFile(event.target.files?.[0])} className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-300 file:mr-3 file:rounded file:border-0 file:bg-gray-700 file:px-2 file:py-1 file:text-gray-200" />
                  </div>
                  <div className="lg:col-span-4">
                    <label className="mb-1 block text-xs text-gray-500">Paste Metadata XML</label>
                    <textarea
                      value={newSsoConfig.metadataXml}
                      onChange={(event) => setNewSsoConfig((current) => ({ ...current, metadataXml: event.target.value }))}
                      placeholder="<EntityDescriptor ...>"
                      rows={4}
                      className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </>
              ) : (
                <>
                  <FieldInput label="Issuer URL" value={newSsoConfig.issuerUrl} onChange={(value) => setNewSsoConfig((current) => ({ ...current, issuerUrl: value }))} />
                  <FieldInput label="Authorization URL" value={newSsoConfig.authorizationUrl} onChange={(value) => setNewSsoConfig((current) => ({ ...current, authorizationUrl: value }))} />
                  <FieldInput label="Token URL" value={newSsoConfig.tokenUrl} onChange={(value) => setNewSsoConfig((current) => ({ ...current, tokenUrl: value }))} />
                  <FieldInput label="Userinfo URL" value={newSsoConfig.userinfoUrl} onChange={(value) => setNewSsoConfig((current) => ({ ...current, userinfoUrl: value }))} />
                  <FieldInput label="Client ID" value={newSsoConfig.clientId} onChange={(value) => setNewSsoConfig((current) => ({ ...current, clientId: value }))} />
                  <FieldInput label="Secret Ref" value={newSsoConfig.clientSecretRef} onChange={(value) => setNewSsoConfig((current) => ({ ...current, clientSecretRef: value }))} placeholder="secret://identity/okta" />
                  <FieldInput label="Scopes" value={newSsoConfig.scopes} onChange={(value) => setNewSsoConfig((current) => ({ ...current, scopes: value }))} />
                </>
              )}
              <FieldInput label="Default Role" value={newSsoConfig.defaultRole} onChange={(value) => setNewSsoConfig((current) => ({ ...current, defaultRole: value }))} />
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-4 text-sm text-gray-400">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={newSsoConfig.jitEnabled} onChange={(event) => setNewSsoConfig((current) => ({ ...current, jitEnabled: event.target.checked }))} className="h-4 w-4 accent-cyan-400" />
                  JIT users
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={newSsoConfig.enforceSso} onChange={(event) => setNewSsoConfig((current) => ({ ...current, enforceSso: event.target.checked }))} className="h-4 w-4 accent-cyan-400" />
                  Require SSO for domains
                </label>
              </div>
              <button type="submit" disabled={saving || !newSsoConfig.name || !newSsoConfig.emailDomains} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Add Provider
              </button>
            </div>
            </div>}
          </form>

          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-medium text-gray-300">
              <ShieldCheck className="h-4 w-4 text-indigo-300" /> Identity Groups
            </h3>
            <form onSubmit={addIdentityGroup} className="grid items-end gap-3 lg:grid-cols-[1fr_1fr_1fr_auto]">
              <FieldInput label="Group Name" value={newIdentityGroup.name} onChange={(value) => setNewIdentityGroup((current) => ({ ...current, name: value }))} placeholder="Network Operations" />
              <FieldInput label="Description" value={newIdentityGroup.description} onChange={(value) => setNewIdentityGroup((current) => ({ ...current, description: value }))} />
              <FieldSelect
                label="Linked CMDB Group"
                value={newIdentityGroup.cmdbCiId}
                onChange={(value) => setNewIdentityGroup((current) => ({ ...current, cmdbCiId: value }))}
                options={[
                  { value: "", label: "Not linked" },
                  ...cmdbGroupOptions.map((group) => ({ value: group.id, label: `${group.name} (${group.id})` })),
                ]}
              />
              <button type="submit" disabled={saving || !newIdentityGroup.name} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Add Group
              </button>
            </form>
            <div className="mt-4 grid gap-3">
              {identityGroups.map((group) => {
                const members = identityGroupMemberships.filter((member) => member.group_id === group.id);
                const grants = identityGroupPermissions.filter((grant) => grant.group_id === group.id);
                return (
                  <div key={group.id} className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-gray-100">{group.name}</div>
                        <div className="mt-1 text-xs text-gray-500">{group.slug} · {group.source}{group.cmdb_ci_id ? ` · ${cmdbGroupLabel(group.cmdb_ci_id)}` : ""}</div>
                        {group.description && <div className="mt-2 text-sm text-gray-400">{group.description}</div>}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded bg-gray-800 px-2 py-1 text-gray-300">{members.length} members</span>
                        <span className="rounded bg-gray-800 px-2 py-1 text-gray-300">{grants.length} grants</span>
                        <button
                          type="button"
                          onClick={() => deleteIdentityGroup(group, members.length, grants.length)}
                          disabled={saving}
                          className="flex items-center gap-1 rounded border border-red-500/30 px-2 py-1 text-red-200 hover:border-red-400 disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </button>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                      <div>
                        <div className="mb-2 text-xs font-medium uppercase text-gray-500">Members</div>
                        <div className="space-y-1">
                          {members.map((member) => (
                            <div key={member.id} className="rounded bg-gray-900 px-2 py-1 text-sm text-gray-300">{member.user_name || member.user_email}</div>
                          ))}
                          {!members.length && <div className="text-sm text-gray-600">No members</div>}
                        </div>
                        <div className="mt-2 flex gap-2">
                          <select value={groupMemberUserId} onChange={(event) => setGroupMemberUserId(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-200">
                            <option value="">Add user...</option>
                            {rbacUsers.map((user) => <option key={user.id} value={user.id}>{user.name || user.email}</option>)}
                          </select>
                          <button onClick={() => addIdentityGroupMember(group.id)} className="rounded border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:border-indigo-400">Add</button>
                        </div>
                      </div>
                      <div>
                        <div className="mb-2 text-xs font-medium uppercase text-gray-500">Inherited Grants</div>
                        <div className="space-y-1">
                          {grants.map((grant) => (
                            <div key={grant.id} className="rounded bg-gray-900 px-2 py-1 text-sm text-gray-300">{grant.resource}:{grant.action}</div>
                          ))}
                          {!grants.length && <div className="text-sm text-gray-600">No grants</div>}
                        </div>
                        <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                          <select
                            value={groupGrant.resource && groupGrant.action ? encodePermissionValue(groupGrant.resource, groupGrant.action) : ""}
                            onChange={(event) => {
                              const [resource, action] = decodePermissionValue(event.target.value);
                              setGroupGrant({ resource, action });
                            }}
                            className="min-w-0 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-200"
                          >
                            <option value="">Grant permission...</option>
                            {rbacTargets.map((target) => (
                              <option key={`${target.resource}:${target.action}`} value={encodePermissionValue(target.resource, target.action)}>{target.label || target.resource}:{target.action}</option>
                            ))}
                          </select>
                          <button onClick={() => addIdentityGroupGrant(group.id)} className="rounded border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:border-indigo-400">Grant</button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {!identityGroups.length && <div className="rounded-lg border border-dashed border-gray-800 p-6 text-center text-sm text-gray-500">No identity groups are registered yet.</div>}
            </div>
          </div>

          <div className="grid gap-4">
            {ssoConfigs.map((config) => (
              <div key={config.id} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold text-gray-100">{config.name}</h3>
                      <span className="rounded border border-gray-700 bg-gray-950 px-2 py-0.5 text-xs uppercase text-gray-300">{config.provider}</span>
                      <span className={`rounded px-2 py-0.5 text-xs ${config.status === "active" ? "bg-emerald-500/10 text-emerald-300" : "bg-gray-800 text-gray-400"}`}>{config.status}</span>
                      {config.enforceSso && <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-200">SSO required</span>}
                    </div>
                    <div className="mt-2 text-sm text-gray-500">{config.emailDomains.join(", ")}</div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => updateSsoConfig(config.id, { status: config.status === "active" ? "inactive" : "active" })} className="rounded border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:border-cyan-400">
                      {config.status === "active" ? "Disable" : "Activate"}
                    </button>
                    <button onClick={() => updateSsoConfig(config.id, { enforceSso: !config.enforceSso })} className="rounded border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:border-cyan-400">
                      {config.enforceSso ? "Allow password" : "Require SSO"}
                    </button>
                    <button onClick={() => deleteSsoConfig(config.id)} className="rounded border border-red-500/30 px-3 py-1.5 text-sm text-red-200 hover:border-red-400">
                      Delete
                    </button>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                  <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                    <div className="text-xs text-gray-500">Start URL</div>
                    <div className="mt-1 truncate text-gray-300">{config.provider === "oidc" ? config.authorizationUrl || "-" : config.idpSsoUrl || "-"}</div>
                  </div>
                  <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                    <div className="text-xs text-gray-500">Issuer / Entity</div>
                    <div className="mt-1 truncate text-gray-300">{config.provider === "oidc" ? config.issuerUrl || "-" : config.idpEntityId || "-"}</div>
                  </div>
                  <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                    <div className="text-xs text-gray-500">JIT / Role</div>
                    <div className="mt-1 text-gray-300">{config.jitEnabled ? "JIT enabled" : "JIT disabled"} / {config.defaultRole}</div>
                    {config.provider === "saml" && <div className="mt-1 text-xs text-gray-600">{config.metadataXmlPresent ? "Metadata XML stored" : "No metadata XML"}</div>}
                  </div>
                </div>
                <div className="mt-3 grid gap-3">
                  <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs text-gray-500">SP ACS URL</div>
                        <div className="mt-1 break-all text-gray-300">{config.spAcsUrl || "-"}</div>
                      </div>
                      <button type="button" onClick={() => copyValue(config.spAcsUrl)} className="flex shrink-0 items-center gap-2 rounded-md border border-cyan-500/40 px-3 py-1.5 text-xs text-cyan-100 hover:bg-cyan-500/10">
                        <Clipboard className="h-3.5 w-3.5" /> Copy
                      </button>
                    </div>
                  </div>
                  <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs text-gray-500">SP Entity ID</div>
                        <div className="mt-1 break-all text-gray-300">{config.spEntityId || "-"}</div>
                      </div>
                      <button type="button" onClick={() => copyValue(config.spEntityId)} className="flex shrink-0 items-center gap-2 rounded-md border border-cyan-500/40 px-3 py-1.5 text-xs text-cyan-100 hover:bg-cyan-500/10">
                        <Clipboard className="h-3.5 w-3.5" /> Copy
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {!ssoConfigs.length && (
              <div className="rounded-xl border border-dashed border-gray-800 bg-gray-900 p-8 text-center text-sm text-gray-500">
                No identity providers are registered yet.
              </div>
            )}
          </div>
        </div>
      );
    }

    if (activeTab === "packages") {
      return (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <h2 className="flex items-center gap-2 text-sm font-medium text-gray-200">
              <Download className="h-4 w-4 text-cyan-300" />
              Package Provisioning
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Optional apps install and uninstall through server-side provisioning jobs. Install state is authoritative on the API, not local browser storage.
            </p>
          </div>
          <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
                  <th className="px-4 py-2 font-medium">App</th>
                  <th className="px-4 py-2 font-medium">Action</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Retention</th>
                  <th className="px-4 py-2 font-medium">Completed</th>
                </tr>
              </thead>
              <tbody>
                {provisioningJobs.length ? provisioningJobs.map((job) => (
                  <tr key={job.id} className="border-b border-gray-800/50 last:border-0">
                    <td className="px-4 py-3 text-gray-200">{job.app_id}</td>
                    <td className="px-4 py-3 text-gray-300">{job.action}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded px-2 py-0.5 text-xs ${job.status === "completed" ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-200"}`}>
                        {job.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{job.data_retention_policy}</td>
                    <td className="px-4 py-3 text-gray-500">{job.completed_at ? new Date(job.completed_at).toLocaleString() : "-"}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No package provisioning jobs yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (activeTab === "number-sequences") {
      return (
        <div className="space-y-6">
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-300">
              <Plus className="h-4 w-4" /> Register Sequence
            </h2>
            <form onSubmit={addNumberSequence} className="grid grid-cols-[1fr_1fr_1fr_120px_90px_90px_auto] items-end gap-3">
              <FieldSelect
                label="App"
                value={newSequence.appId}
                onChange={selectSequenceApp}
                options={appOptions.map(([value, label]) => ({ value, label }))}
              />
              <FieldSelect
                label="Table"
                value={newSequence.tableName}
                onChange={selectSequenceTable}
                options={tableOptions.map((option) => ({ value: option.tableName, label: option.tableName }))}
              />
              <FieldSelect
                label="Record Type"
                value={newSequence.recordType}
                onChange={selectSequenceRecordType}
                options={recordTypeOptions.map((option) => ({ value: option.recordType, label: option.recordType }))}
              />
              <FieldInput label="Prefix" value={newSequence.prefix} onChange={(value) => setNewSequence((s) => ({ ...s, prefix: value.toUpperCase() }))} placeholder="INC" />
              <FieldInput label="Next" value={newSequence.nextValue} onChange={(value) => setNewSequence((s) => ({ ...s, nextValue: value }))} type="number" />
              <FieldInput label="Padding" value={newSequence.padding} onChange={(value) => setNewSequence((s) => ({ ...s, padding: value }))} type="number" />
              <button type="submit" disabled={saving || !canAddSequence} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Add
              </button>
            </form>
            {!availableSequenceOptions.length && (
              <div className="mt-3 rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-400">
                All registered counter-capable app records already have number sequences.
              </div>
            )}
          </div>
          <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
                  <th className="px-4 py-2 font-medium">Prefix</th>
                  <th className="px-4 py-2 font-medium">Table</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Next</th>
                  <th className="px-4 py-2 font-medium">Padding</th>
                  <th className="px-4 py-2 font-medium">Enabled</th>
                </tr>
              </thead>
              <tbody>
                {numberSequences.map((sequence) => (
                  <NumberSequenceRow key={sequence.id} sequence={sequence} onUpdate={updateNumberSequence} />
                ))}
                {!numberSequences.length && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                      No number sequences are registered yet. Register one from the platform-owned app/table/type list above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    // Dynamic panel
    const PanelComponent = PANEL_COMPONENTS[activeTab];
    if (PanelComponent) {
      return <PanelComponent shell={shell} />;
    }

    return <div className="text-gray-500 text-center py-12">Unknown panel: {activeTab}</div>;
  };

  return (
    <div className="flex h-full bg-gray-950 text-gray-100">
      <aside className="flex w-80 shrink-0 flex-col border-r border-gray-800 bg-gray-950/95">
        <div className="border-b border-gray-800 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-indigo-500/40 bg-indigo-500/10">
              <Shield className="h-5 w-5 text-indigo-300" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Admin Console</h1>
              <p className="text-xs text-gray-500">Platform governance workspace</p>
            </div>
          </div>
          <div className="relative mt-5">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-500" />
            <input
              value={adminSearch}
              onChange={(event) => setAdminSearch(event.target.value)}
              placeholder="Search admin duties"
              className="w-full rounded-lg border border-gray-800 bg-gray-900 py-2 pl-9 pr-3 text-sm text-gray-200 outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <nav className="flex-1 overflow-auto p-3">
          {groupedTabs.map(([category, tabs]) => (
            <div key={category} className="mb-5">
              <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wide text-gray-600">{category}</div>
              <div className="space-y-1">
                {tabs.map((tab) => {
                  const Icon = ICONS[tab.icon] || Settings;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        activeTab === tab.id
                          ? "bg-indigo-600 text-white"
                          : "text-gray-400 hover:bg-gray-900 hover:text-gray-100"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{tab.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {!filteredTabs.length && (
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 text-sm text-gray-500">
              No admin areas match that search.
            </div>
          )}
        </nav>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-gray-800 px-8 py-5">
          <div className="text-xs uppercase tracking-wide text-gray-600">Administration</div>
          <div className="mt-1 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold text-gray-100">{allTabs.find((tab) => tab.id === activeTab)?.name || "Admin Console"}</h2>
              <p className="mt-1 text-sm text-gray-500">
                Manage platform controls through registered, auditable administrative surfaces.
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-8 pb-24">
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm">{error}</div>
        )}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
          </div>
        ) : (
          renderTabContent()
        )}
        </div>
      </main>
    </div>
  );
}

function SystemPropertyRow({
  prop,
  onUpdate,
  onDelete,
}: {
  prop: SystemProperty;
  onUpdate: (key: string, value: string) => void;
  onDelete: (key: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(prop.value);

  return (
    <tr className="border-b border-gray-800/50 last:border-0">
      <td className="px-4 py-2 text-gray-300 font-mono text-xs">{prop.key}</td>
      <td className="px-4 py-2">
        {editing ? (
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => { setEditing(false); if (value !== prop.value) onUpdate(prop.key, value); }}
            onKeyDown={(e) => { if (e.key === "Enter") { setEditing(false); if (value !== prop.value) onUpdate(prop.key, value); } }}
            autoFocus
            className="w-full px-2 py-1 rounded bg-gray-800 border border-indigo-500 text-sm text-gray-200 focus:outline-none"
          />
        ) : (
          <span onClick={() => setEditing(true)} className="text-gray-300 cursor-pointer hover:text-indigo-400 transition-colors">
            {prop.value}
          </span>
        )}
      </td>
      <td className="px-4 py-2 text-gray-500 text-xs">{new Date(prop.updated_at).toLocaleDateString()}</td>
      <td className="px-4 py-2">
        <button onClick={() => onDelete(prop.key)} className="text-gray-500 hover:text-red-400 transition-colors" title="Delete property">
          <Trash2 className="w-4 h-4" />
        </button>
      </td>
    </tr>
  );
}

function FieldInput({ label, value, onChange, placeholder, type = "text", help, trailing, autoComplete, inputName }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; help?: string; trailing?: React.ReactNode; autoComplete?: string; inputName?: string }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-500">{label}</label>
      <div className="relative">
        <input
          name={inputName}
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          className={`w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-indigo-500 focus:outline-none ${trailing ? "pr-10" : ""}`}
        />
        {trailing && <div className="absolute right-2 top-1/2 -translate-y-1/2">{trailing}</div>}
      </div>
      {help && <div className="mt-1 text-xs leading-5 text-gray-600">{help}</div>}
    </div>
  );
}

function ReadOnlyField({ label, value, help, muted = false }: { label: string; value: string; help?: string; muted?: boolean }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-500">{label}</label>
      <div className={`w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 font-mono text-sm ${muted ? "text-gray-600" : "text-indigo-200"}`}>
        {value}
      </div>
      {help && <div className="mt-1 text-xs leading-5 text-gray-600">{help}</div>}
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-gray-800 bg-gray-900 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-gray-600">{label}</div>
      <div className="mt-1 text-sm font-medium text-gray-200">{value}</div>
    </div>
  );
}

function FieldSelect({
  label,
  value,
  onChange,
  options,
  help,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  help?: string;
}) {
  const id = `admin-select-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs text-gray-500">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-indigo-500 focus:outline-none"
      >
        {!options.length && <option value="">No registered options</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {help && <div className="mt-1 text-xs leading-5 text-gray-600">{help}</div>}
    </div>
  );
}

function NumberSequenceRow({ sequence, onUpdate }: { sequence: NumberSequence; onUpdate: (id: string, patch: Partial<NumberSequence>) => void }) {
  return (
    <tr className="border-b border-gray-800/50 last:border-0">
      <td className="px-4 py-2 font-mono text-sm text-indigo-200">{sequence.prefix}</td>
      <td className="px-4 py-2">
        <div className="font-mono text-xs text-gray-300">{sequence.table_name}</div>
        {sequence.app_id && <div className="text-xs text-gray-500">{sequence.app_id}</div>}
      </td>
      <td className="px-4 py-2 text-gray-300">{sequence.record_type}</td>
      <td className="px-4 py-2">
        <input
          type="number"
          min={1}
          value={sequence.next_value}
          onChange={(event) => onUpdate(sequence.id, { next_value: Number(event.target.value) || 1 })}
          className="w-28 rounded bg-gray-800 px-2 py-1 text-sm text-gray-200 outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </td>
      <td className="px-4 py-2">
        <input
          type="number"
          min={0}
          value={sequence.padding}
          onChange={(event) => onUpdate(sequence.id, { padding: Number(event.target.value) || 0 })}
          className="w-20 rounded bg-gray-800 px-2 py-1 text-sm text-gray-200 outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </td>
      <td className="px-4 py-2">
        <label className="inline-flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={sequence.enabled}
            onChange={(event) => onUpdate(sequence.id, { enabled: event.target.checked })}
            className="rounded border-gray-700 bg-gray-800 text-indigo-500"
          />
          {sequence.enabled ? "Enabled" : "Disabled"}
        </label>
      </td>
    </tr>
  );
}
