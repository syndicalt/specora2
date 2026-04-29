"use client";

import { useState, useEffect, useMemo } from "react";
import { getToken } from "@/lib/auth";
import { getApiBase } from "@/lib/runtimeApi";
import {
  Activity,
  ClipboardCheck,
  Database,
  Download,
  GitBranch,
  Hash,
  KeyRound,
  LayoutDashboard,
  Loader2,
  Radio,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Users,
} from "lucide-react";
import ChangeStateMachinePanel from "@/apps/change-manager/StateMachinePanel";
import { CredentialsPanel } from "./CredentialsPanel";
import { EdgeEnrollmentPanel } from "./EdgeEnrollmentPanel";
import { EnvironmentsPanel } from "./EnvironmentsPanel";
import { IdentityPanel } from "./IdentityPanel";
import { PackageProvisioningPanel } from "./PackageProvisioningPanel";
import { OverviewPanel } from "./OverviewPanel";
import { RbacAccessAnalyzerSection } from "./RbacAccessAnalyzerSection";
import { RbacAppAccessSection } from "./RbacAppAccessSection";
import { RbacAuditSection } from "./RbacAuditSection";
import { RbacFieldRestrictionsSection } from "./RbacFieldRestrictionsSection";
import { RbacGrantBuilderSection } from "./RbacGrantBuilderSection";
import { RbacPolicyDriftSection } from "./RbacPolicyDriftSection";
import { RbacRoleGrantsSection } from "./RbacRoleGrantsSection";
import { RbacTableAccessSection } from "./RbacTableAccessSection";
import { RbacToolAccessSection } from "./RbacToolAccessSection";
import { SystemPropertiesPanel } from "./SystemPropertiesPanel";
import { UsersPanel } from "./UsersPanel";
import {
  type NumberSequence,
  type SystemProperty,
} from "./components";
import { NumberSequencesPanel } from "./NumberSequencesPanel";
import {
  PERMISSION_VALUE_SEPARATOR,
  buildCredentialRef,
  decodePermissionValue,
  encodePermissionValue,
} from "./helpers";
import type {
  AccessAnalysis,
  AdminPanel,
  AppAccessExplanation,
  AuditEntry,
  AuditIntegrity,
  CmdbGroupOption,
  CredentialReference,
  EdgeCollector,
  EdgeEnrollmentToken,
  EdgeRuntimeConfig,
  EnvironmentChoice,
  FieldRestrictionField,
  FieldRestrictionTable,
  IdentityGroup,
  IdentityGroupMembership,
  IdentityGroupPermission,
  ManagedUser,
  ManagedUserDetail,
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
  TableAccessExplanation,
  ToolAccessExplanation,
  AdminScreenContextInput,
} from "./types";



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

const ADMIN_SCREEN_CONTEXT: Record<string, { purpose: string; primaryActions: string[]; state?: (input: AdminScreenContextInput) => Record<string, string | number | boolean> }> = {
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
        <OverviewPanel
          operationalIntelligence={operationalIntelligence}
          adminReadiness={adminReadiness}
          availableSequenceOptions={availableSequenceOptions}
          permissions={permissions}
          onOpenNativeApp={openNativeApp}
          onSetActiveTab={setActiveTab}
        />
      );
    }

    if (activeTab === "users") {
      return (
        <UsersPanel
          managedUsers={managedUsers}
          filteredManagedUsers={filteredManagedUsers}
          selectedUserId={selectedUserId}
          setSelectedUserId={setSelectedUserId}
          selectedUserDetail={selectedUserDetail}
          setSelectedUserDetail={setSelectedUserDetail}
          selectedManagedUser={selectedManagedUser}
          userSearch={userSearch}
          setUserSearch={setUserSearch}
          userDraft={userDraft}
          setUserDraft={setUserDraft}
          userEditDraft={userEditDraft}
          setUserEditDraft={setUserEditDraft}
          allRoles={allRoles}
          rbacApps={rbacApps}
          saving={saving}
          onCreateUser={createManagedUser}
          onUpdateUser={updateManagedUser}
          onRevokeSessions={revokeManagedUserSessions}
          onExplainInRbac={(userId, role, appId) => {
            setActiveTab("rbac");
            setAppAccessProbe({ userId, role, appId });
            setOpenRbacUtilities((current) => ({ ...current, app: true }));
          }}
        />
      );
    }

    if (activeTab === "edge-enrollment") {
      return (
        <EdgeEnrollmentPanel
          apiUrl={API_URL}
          edgeEnrollmentDraft={edgeEnrollmentDraft}
          setEdgeEnrollmentDraft={setEdgeEnrollmentDraft}
          issuedEnrollmentToken={issuedEnrollmentToken}
          edgeRuntimeConfig={edgeRuntimeConfig}
          edgeEnrollmentTokens={edgeEnrollmentTokens}
          edgeCollectors={edgeCollectors}
          saving={saving}
          onCreateToken={createEdgeEnrollmentToken}
          onCopyIssuedToken={copyIssuedEnrollmentToken}
          onCopyRuntimeConfig={copyEdgeRuntimeConfig}
          onRevokeToken={revokeEdgeEnrollmentToken}
          onDeleteCollector={deleteEdgeCollector}
        />
      );
    }

    if (activeTab === "rbac") {
      return (
        <div className="space-y-6">
          <RbacAppAccessSection
            open={openRbacUtilities.app}
            saving={saving}
            appAccessProbe={appAccessProbe}
            setAppAccessProbe={setAppAccessProbe}
            appAccessExplanation={appAccessExplanation}
            rbacUsers={rbacUsers}
            allRoles={allRoles}
            rbacApps={rbacApps}
            onToggle={() => toggleRbacUtility("app")}
            onExplain={explainAppAccess}
            onPrepareGrant={prepareGrant}
          />

          <RbacPolicyDriftSection
            open={openRbacUtilities.drift}
            saving={saving}
            policyDrift={policyDrift}
            onToggle={() => toggleRbacUtility("drift")}
            onBulkGrant={bulkGrantPermissions}
          />

          <RbacAuditSection
            open={openRbacUtilities.audit}
            saving={saving}
            auditTotal={auditTotal}
            auditIntegrity={auditIntegrity}
            auditSearch={auditSearch}
            setAuditSearch={setAuditSearch}
            auditEntries={auditEntries}
            onToggle={() => toggleRbacUtility("audit")}
            onVerify={verifyAuditLog}
            onSearch={searchAuditLog}
            onExport={exportAuditLog}
          />

          <RbacFieldRestrictionsSection
            open={openRbacUtilities.fieldRestrictions}
            saving={saving}
            restrictedFieldCount={restrictedFieldCount}
            fieldRestrictionTables={fieldRestrictionTables}
            selectedFieldRestrictionTable={selectedFieldRestrictionTable}
            setFieldRestrictionTableId={setFieldRestrictionTableId}
            defaultGrantRole={newRole || fieldRestrictionGrantRole}
            onToggle={() => toggleRbacUtility("fieldRestrictions")}
            onPrepareGrant={prepareGrant}
            onToggleFieldRestriction={toggleFieldRestriction}
          />

          <RbacTableAccessSection
            open={openRbacUtilities.table}
            saving={saving}
            tableAccessProbe={tableAccessProbe}
            setTableAccessProbe={setTableAccessProbe}
            tableAccessExplanation={tableAccessExplanation}
            rbacUsers={rbacUsers}
            allRoles={allRoles}
            rbacTables={rbacTables}
            tableFieldOptions={tableFieldOptions}
            onToggle={() => toggleRbacUtility("table")}
            onExplain={explainTableAccess}
            onPrepareGrant={prepareGrant}
          />

          <RbacToolAccessSection
            open={openRbacUtilities.tool}
            saving={saving}
            toolAccessProbe={toolAccessProbe}
            setToolAccessProbe={setToolAccessProbe}
            toolAccessExplanation={toolAccessExplanation}
            rbacUsers={rbacUsers}
            allRoles={allRoles}
            rbacTools={rbacTools}
            onToggle={() => toggleRbacUtility("tool")}
            onExplain={explainToolAccess}
            onPrepareGrant={prepareGrant}
          />

          <RbacAccessAnalyzerSection
            open={openRbacUtilities.analyzer}
            saving={saving}
            accessProbe={accessProbe}
            setAccessProbe={setAccessProbe}
            accessAnalysis={accessAnalysis}
            rbacUsers={rbacUsers}
            allRoles={allRoles}
            rbacTargets={rbacTargets}
            onToggle={() => toggleRbacUtility("analyzer")}
            onAnalyze={analyzeAccess}
          />

          <RbacGrantBuilderSection
            saving={saving}
            rbacTargets={rbacTargets}
            filteredGrantTargets={filteredGrantTargets}
            selectedGrantTarget={selectedGrantTarget}
            selectedPermissionTarget={selectedPermissionTarget}
            selectedBulkGrants={selectedBulkGrants}
            selectedBulkGrantTargets={selectedBulkGrantTargets}
            setSelectedBulkGrants={setSelectedBulkGrants}
            grantScopes={grantScopes}
            grantScope={grantScope}
            setGrantScope={setGrantScope}
            grantSearch={grantSearch}
            setGrantSearch={setGrantSearch}
            newRole={newRole}
            setNewRole={setNewRole}
            newResource={newResource}
            setNewResource={setNewResource}
            newAction={newAction}
            setNewAction={setNewAction}
            allRoles={allRoles}
            existingGrant={existingGrant}
            onAddPermission={addPermission}
            onBulkGrant={bulkGrantPermissions}
          />
          <RbacRoleGrantsSection roles={roles} permissions={permissions} onDeletePermission={deletePermission} />
        </div>
      );
    }

    if (activeTab === "system-properties") {
      return (
        <SystemPropertiesPanel
          newPropKey={newPropKey}
          setNewPropKey={setNewPropKey}
          newPropValue={newPropValue}
          setNewPropValue={setNewPropValue}
          saving={saving}
          systemProps={systemProps}
          onAdd={addSystemProperty}
          onUpdate={updateSystemProperty}
          onDelete={deleteSystemProperty}
        />
      );
    }

    if (activeTab === "environments") {
      return (
        <EnvironmentsPanel
          environmentDraft={environmentDraft}
          setEnvironmentDraft={setEnvironmentDraft}
          environmentChoices={environmentChoices}
          setEnvironmentChoices={setEnvironmentChoices}
          saving={saving}
          onSave={saveEnvironmentChoice}
          onDelete={deleteEnvironmentChoice}
        />
      );
    }

    if (activeTab === "credentials") {
      return (
        <CredentialsPanel
          credentials={credentials}
          newCredential={newCredential}
          setNewCredential={setNewCredential}
          showCredentialSecret={showCredentialSecret}
          setShowCredentialSecret={setShowCredentialSecret}
          generatedCredentialRef={generatedCredentialRef}
          canAddCredential={canAddCredential}
          saving={saving}
          onAdd={addCredential}
          onUpdate={updateCredential}
          onTest={testCredential}
          onDelete={deleteCredential}
        />
      );
    }

    if (activeTab === "identity") {
      return (
        <IdentityPanel
          ssoConfigs={ssoConfigs}
          newSsoConfig={newSsoConfig}
          setNewSsoConfig={setNewSsoConfig}
          isSsoRegisterOpen={isSsoRegisterOpen}
          setIsSsoRegisterOpen={setIsSsoRegisterOpen}
          identityGroups={identityGroups}
          identityGroupMemberships={identityGroupMemberships}
          identityGroupPermissions={identityGroupPermissions}
          cmdbGroupOptions={cmdbGroupOptions}
          newIdentityGroup={newIdentityGroup}
          setNewIdentityGroup={setNewIdentityGroup}
          groupMemberUserId={groupMemberUserId}
          setGroupMemberUserId={setGroupMemberUserId}
          groupGrant={groupGrant}
          setGroupGrant={setGroupGrant}
          rbacUsers={rbacUsers}
          rbacTargets={rbacTargets}
          saving={saving}
          onAddSso={addSsoConfig}
          onUpdateSso={updateSsoConfig}
          onDeleteSso={deleteSsoConfig}
          onReadSamlMetadataFile={readSamlMetadataFile}
          onCopyValue={copyValue}
          onAddIdentityGroup={addIdentityGroup}
          onDeleteIdentityGroup={deleteIdentityGroup}
          onAddIdentityGroupMember={addIdentityGroupMember}
          onAddIdentityGroupGrant={addIdentityGroupGrant}
        />
      );
    }

    if (activeTab === "packages") {
      return <PackageProvisioningPanel provisioningJobs={provisioningJobs} />;
    }

    if (activeTab === "number-sequences") {
      return (
        <NumberSequencesPanel
          newSequence={newSequence}
          setNewSequence={setNewSequence}
          saving={saving}
          appOptions={appOptions}
          tableOptions={tableOptions}
          recordTypeOptions={recordTypeOptions}
          availableSequenceOptions={availableSequenceOptions}
          numberSequences={numberSequences}
          canAddSequence={canAddSequence}
          onAdd={addNumberSequence}
          onSelectApp={selectSequenceApp}
          onSelectTable={selectSequenceTable}
          onSelectRecordType={selectSequenceRecordType}
          onUpdate={updateNumberSequence}
        />
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
