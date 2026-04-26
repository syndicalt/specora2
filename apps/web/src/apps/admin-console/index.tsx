"use client";

import { useState, useEffect, useMemo } from "react";
import { getToken } from "@/lib/auth";
import {
  Activity,
  AlertTriangle,
  ChevronRight,
  CheckCircle2,
  ClipboardCheck,
  Database,
  Download,
  GitBranch,
  Hash,
  KeyRound,
  LayoutDashboard,
  Loader2,
  Plus,
  Save,
  Search,
  Settings,
  Shield,
  ShieldCheck,
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

interface AdminPanel {
  id: string;
  name: string;
  icon: string;
  permissions: string[];
  appId?: string;
}

interface RbacUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface RbacTarget {
  resource: string;
  action: string;
  risk: "low" | "medium" | "high" | "critical";
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
};

export default function AdminConsoleApp({ shell }: { shell: any }) {
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [panels, setPanels] = useState<AdminPanel[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [systemProps, setSystemProps] = useState<SystemProperty[]>([]);
  const [numberSequences, setNumberSequences] = useState<NumberSequence[]>([]);
  const [numberSequenceOptions, setNumberSequenceOptions] = useState<NumberSequenceOption[]>([]);
  const [rbacUsers, setRbacUsers] = useState<RbacUser[]>([]);
  const [rbacTargets, setRbacTargets] = useState<RbacTarget[]>([]);
  const [accessProbe, setAccessProbe] = useState({ userId: "", role: "", target: "" });
  const [accessAnalysis, setAccessAnalysis] = useState<AccessAnalysis | null>(null);
  const [provisioningJobs, setProvisioningJobs] = useState<ProvisioningJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [adminSearch, setAdminSearch] = useState("");

  const [newRole, setNewRole] = useState("");
  const [newResource, setNewResource] = useState("");
  const [newAction, setNewAction] = useState("");
  const [newPropKey, setNewPropKey] = useState("");
  const [newPropValue, setNewPropValue] = useState("");
  const [newSequence, setNewSequence] = useState({ appId: "", tableName: "", recordType: "", prefix: "", nextValue: "1", padding: "6" });

  const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace("/graphql", "");

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (newSequence.appId || !numberSequenceOptions.length) return;
    setNewSequenceFromOption(numberSequenceOptions[0]);
  }, [numberSequenceOptions, newSequence.appId]);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const token = getToken();
      const [permRes, propRes, panelRes, sequenceRes, sequenceOptionsRes, rbacOptionsRes, jobsRes] = await Promise.all([
        fetch(`${API_URL}/api/admin/permissions`, { headers: { Authorization: `Bearer ${token || ""}` } }),
        fetch(`${API_URL}/api/admin/system-properties`, { headers: { Authorization: `Bearer ${token || ""}` } }),
        fetch(`${API_URL}/api/admin/panels`, { headers: { Authorization: `Bearer ${token || ""}` } }),
        fetch(`${API_URL}/api/admin/number-sequences`, { headers: { Authorization: `Bearer ${token || ""}` } }),
        fetch(`${API_URL}/api/admin/number-sequences/options`, { headers: { Authorization: `Bearer ${token || ""}` } }),
        fetch(`${API_URL}/api/admin/rbac/options`, { headers: { Authorization: `Bearer ${token || ""}` } }),
        fetch(`${API_URL}/api/apps/provisioning-jobs`, { headers: { Authorization: `Bearer ${token || ""}` } }),
      ]);

      if (!permRes.ok) throw new Error("Failed to fetch permissions");
      if (!propRes.ok) throw new Error("Failed to fetch system properties");

      const permData = await permRes.json();
      const propData = await propRes.json();
      const panelData = panelRes.ok ? await panelRes.json() : { panels: [] };
      const sequenceData = sequenceRes.ok ? await sequenceRes.json() : { sequences: [] };
      const sequenceOptionsData = sequenceOptionsRes.ok ? await sequenceOptionsRes.json() : { options: [] };
      const rbacOptionsData = rbacOptionsRes.ok ? await rbacOptionsRes.json() : { users: [], targets: [] };
      const jobsData = jobsRes.ok ? await jobsRes.json() : { jobs: [] };

      setPermissions(permData.permissions || []);
      setSystemProps(propData.properties || []);
      setPanels(panelData.panels || []);
      setNumberSequences(sequenceData.sequences || []);
      setNumberSequenceOptions(sequenceOptionsData.options || []);
      setRbacUsers(rbacOptionsData.users || []);
      setRbacTargets(rbacOptionsData.targets || []);
      setProvisioningJobs(jobsData.jobs || []);
      setAccessProbe((current) => {
        if (current.userId || current.role || current.target) return current;
        const firstUser = rbacOptionsData.users?.[0];
        const firstTarget = rbacOptionsData.targets?.[0];
        return {
          userId: firstUser?.id || "",
          role: firstUser?.role || "",
          target: firstTarget ? `${firstTarget.resource}:${firstTarget.action}` : "",
        };
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
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
    const [resource, action] = accessProbe.target.split(":");
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
    { id: "rbac", name: "Users & Access", icon: "ShieldCheck", category: "Governance" },
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
    { label: "Admin panels", value: panels.length + 3, tone: "text-amber-200", detail: "Core and app-owned" },
  ];

  const renderTabContent = () => {
    if (activeTab === "overview") {
      return (
        <div className="space-y-6">
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

    if (activeTab === "rbac") {
      return (
        <div className="space-y-6">
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
              {accessAnalysis && (
                <div className={`rounded-full px-3 py-1 text-xs font-medium ${
                  accessAnalysis.allowed ? "bg-emerald-500/10 text-emerald-200" : "bg-red-500/10 text-red-200"
                }`}>
                  {accessAnalysis.allowed ? "Allowed" : "Denied"}
                </div>
              )}
            </div>

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
                  value: `${target.resource}:${target.action}`,
                  label: `${target.resource}:${target.action} (${target.risk})`,
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
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h2 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Permission
            </h2>
            <form onSubmit={addPermission} className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Role</label>
                <input type="text" value={newRole} onChange={(e) => setNewRole(e.target.value)} placeholder="e.g. operator"
                  className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-indigo-500" />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Resource</label>
                <input type="text" value={newResource} onChange={(e) => setNewResource(e.target.value)} placeholder="e.g. cmdb"
                  className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-indigo-500" />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Action</label>
                <input type="text" value={newAction} onChange={(e) => setNewAction(e.target.value)} placeholder="e.g. write"
                  className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-indigo-500" />
              </div>
              <button type="submit" disabled={saving || !newRole || !newResource || !newAction}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Add
              </button>
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

function FieldInput({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-500">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-indigo-500 focus:outline-none"
      />
    </div>
  );
}

function FieldSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
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
