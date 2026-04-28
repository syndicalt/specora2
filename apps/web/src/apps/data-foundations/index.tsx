"use client";

import { useEffect, useMemo, useState } from "react";
import type { ShellAPI } from "@/sdk/types";
import { AlertTriangle, Building2, CheckCircle2, Database, Edit3, Link2, ListChecks, RefreshCw, Save, ShieldCheck, Trash2 } from "lucide-react";

type FoundationTable = {
  table: string;
  className: string;
  displayName: string;
  registered: boolean;
  recordCount: number;
  requiredAttributes: Array<{ name: string; displayName: string }>;
  completeness: number | null;
  missingRequiredCount: number;
};

type FoundationSummary = {
  totalTables: number;
  registeredTables: number;
  totalRecords: number;
  averageCompleteness: number;
  tablesNeedingAttention: number;
  openIssues?: number;
};

type FoundationIssue = {
  id: string;
  severity: "high" | "medium" | "low";
  className: string;
  displayName: string;
  recordId?: string;
  recordName?: string;
  field?: string;
  fieldDisplayName?: string;
  title: string;
  description: string;
  action: "register_class" | "add_records" | "edit_record" | "define_key";
};

type ValidationCheck = {
  id: string;
  title: string;
  status: "pass" | "warn" | "fail";
  affectedCount: number;
  detail: string;
};
type RelationshipType = {
  id: string;
  name: string;
  displayName: string;
  description?: string | null;
  color: string;
  active: boolean;
  directed: boolean;
  isSystem: boolean;
  sortOrder: number;
};

export default function DataFoundationsApp({ shell }: { shell: ShellAPI }) {
  const [summary, setSummary] = useState<FoundationSummary | null>(null);
  const [tables, setTables] = useState<FoundationTable[]>([]);
  const [issues, setIssues] = useState<FoundationIssue[]>([]);
  const [checks, setChecks] = useState<ValidationCheck[]>([]);
  const [relationshipTypes, setRelationshipTypes] = useState<RelationshipType[]>([]);
  const [relationshipForm, setRelationshipForm] = useState({ name: "", displayName: "", color: "#6366f1", description: "" });
  const [selectedIssue, setSelectedIssue] = useState<FoundationIssue | null>(null);
  const [editValue, setEditValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const sortedTables = useMemo(() => [...tables].sort((a, b) => {
    if (a.registered !== b.registered) return a.registered ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  }), [tables]);

  async function loadSummary() {
    setLoading(true);
    try {
      const [res, queueRes, validationRes] = await Promise.all([
        shell.fetch("/api/data-foundations/summary"),
        shell.fetch("/api/data-foundations/stewardship"),
        shell.fetch("/api/data-foundations/validation"),
      ]);
      if (!res.ok || !queueRes.ok || !validationRes.ok) throw new Error("Failed to fetch Data Foundations");
      const data = await res.json();
      const queue = await queueRes.json();
      const validation = await validationRes.json();
      setSummary(data.summary);
      setTables(data.tables || []);
      setIssues(queue.issues || []);
      setChecks(validation.checks || []);
      const relData = await shell.query(`query { relationshipTypes(activeOnly: false) { id name displayName description color active directed isSystem sortOrder } }`);
      setRelationshipTypes(relData.relationshipTypes || []);
      setSelectedIssue((current) => current ? (queue.issues || []).find((issue: FoundationIssue) => issue.id === current.id) || null : null);
    } catch {
      shell.notify("Failed to fetch Data Foundations", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSummary();
  }, []);

  function manageTable(table: FoundationTable) {
    if (!table.registered) {
      shell.notify(`${table.displayName} is not registered in CI Class Manager yet`, "error");
      return;
    }
    shell.dispatch({
      type: "OPEN_APP",
      id: "tables",
      installKey: "builtin_tables",
      mode: "canvas",
      permissions: ["tables:read", "tables:write"],
      launchPayload: { type: "SELECT_TABLE", tableId: table.table },
    });
    setTimeout(() => {
      shell.sendMessage({ type: "SELECT_TABLE", to: "tables", payload: { tableId: table.table } });
    }, 100);
  }

  function selectIssue(issue: FoundationIssue) {
    setSelectedIssue(issue);
    setEditValue("");
  }

  async function saveIssue() {
    if (!selectedIssue?.recordId || !selectedIssue.field || !editValue.trim()) return;
    setSaving(true);
    try {
      const res = await shell.fetch(`/api/data-foundations/foundation-records/${selectedIssue.className}/${selectedIssue.recordId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fields: { [selectedIssue.field]: editValue.trim() } }),
      });
      if (!res.ok) throw new Error("Failed to update foundation record");
      shell.notify("Foundation record updated", "success");
      await loadSummary();
    } catch {
      shell.notify("Foundation record could not be updated", "error");
    } finally {
      setSaving(false);
    }
  }

  async function saveRelationshipType() {
    if (!relationshipForm.displayName.trim()) return;
    setSaving(true);
    try {
      const name = relationshipForm.name.trim() || relationshipForm.displayName.trim();
      await shell.query(
        `mutation($input: RelationshipTypeInput!) {
          upsertRelationshipType(input: $input) { id }
        }`,
        {
          input: {
            name,
            displayName: relationshipForm.displayName.trim(),
            color: relationshipForm.color,
            description: relationshipForm.description.trim() || undefined,
            active: true,
            directed: true,
            sortOrder: 100,
          },
        }
      );
      setRelationshipForm({ name: "", displayName: "", color: "#6366f1", description: "" });
      shell.notify("Relationship type saved", "success");
      await loadSummary();
    } catch (err: any) {
      shell.notify(err.message || "Failed to save relationship type", "error");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRelationshipType(type: RelationshipType) {
    if (type.isSystem) return;
    if (!confirm(`Delete relationship type ${type.displayName}?`)) return;
    try {
      await shell.query(`mutation($id: ID!) { deleteRelationshipType(id: $id) }`, { id: type.id });
      shell.notify("Relationship type deleted", "success");
      await loadSummary();
    } catch (err: any) {
      shell.notify(err.message || "Failed to delete relationship type", "error");
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-gray-950 text-gray-100">
      <header className="flex shrink-0 items-center gap-3 border-b border-gray-800 px-5 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-300">
          <Building2 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Data Foundations</h1>
          <p className="text-xs text-gray-500">CSDMv5 foundation data readiness and governance</p>
        </div>
        <button onClick={loadSummary} className="ml-auto rounded-lg border border-gray-700 bg-gray-900 p-2 text-gray-300 hover:text-white" title="Refresh">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      <main className="flex-1 overflow-auto p-5">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Metric label="Registered Tables" value={`${summary?.registeredTables ?? 0}/${summary?.totalTables ?? 0}`} />
          <Metric label="Foundation Records" value={String(summary?.totalRecords ?? 0)} />
          <Metric label="Avg Completeness" value={`${Math.round((summary?.averageCompleteness ?? 0) * 100)}%`} />
          <Metric label="Open Issues" value={String(summary?.openIssues ?? summary?.tablesNeedingAttention ?? 0)} />
        </div>

        <div className="mt-5 grid min-h-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="min-w-0 overflow-hidden rounded-lg border border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-900/80">
                <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-3">Foundation Table</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Records</th>
                  <th className="px-4 py-3">Completeness</th>
                  <th className="px-4 py-3">Required Fields</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedTables.map((table) => {
                  const complete = table.completeness ?? 0;
                  return (
                    <tr key={table.table} className="border-b border-gray-900 bg-gray-950 hover:bg-gray-900/60">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-200">{table.displayName}</div>
                        <div className="font-mono text-xs text-gray-600">{table.table}</div>
                      </td>
                      <td className="px-4 py-3">
                        {table.registered ? (
                          <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-2 py-1 text-xs text-emerald-300">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Registered
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-md bg-yellow-500/15 px-2 py-1 text-xs text-yellow-300">
                            <AlertTriangle className="h-3.5 w-3.5" /> Missing class
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-300">{table.recordCount}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-28 overflow-hidden rounded bg-gray-800">
                            <div className="h-full bg-emerald-500" style={{ width: `${Math.round(complete * 100)}%` }} />
                          </div>
                          <span className="w-10 text-xs text-gray-400">{Math.round(complete * 100)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        {table.requiredAttributes.length > 0 ? table.requiredAttributes.map((attr) => attr.displayName).join(", ") : "None"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => manageTable(table)}
                          disabled={!table.registered}
                          className="inline-flex items-center gap-1.5 rounded-md border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-xs text-gray-300 hover:border-indigo-500/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          Manage
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <aside className="flex min-h-[560px] flex-col overflow-hidden rounded-lg border border-gray-800 bg-gray-900/40">
            <div className="border-b border-gray-800 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-100">
                <ListChecks className="h-4 w-4 text-emerald-300" />
                Stewardship Queue
              </div>
              <p className="mt-1 text-xs text-gray-500">{issues.length} prioritized data tasks</p>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {issues.slice(0, 30).map((issue) => (
                <button
                  key={issue.id}
                  onClick={() => selectIssue(issue)}
                  className={`block w-full border-b border-gray-800 px-4 py-3 text-left hover:bg-gray-800/70 ${selectedIssue?.id === issue.id ? "bg-gray-800/80" : ""}`}
                >
                  <div className="flex items-start gap-2">
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${issue.severity === "high" ? "bg-red-400" : issue.severity === "medium" ? "bg-yellow-400" : "bg-sky-400"}`} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-gray-100">{issue.title}</div>
                      <div className="mt-1 text-xs text-gray-500">{issue.displayName}{issue.recordName ? ` / ${issue.recordName}` : ""}</div>
                    </div>
                  </div>
                </button>
              ))}
              {issues.length === 0 && <div className="px-4 py-8 text-center text-sm text-gray-500">No stewardship issues.</div>}
            </div>
            <div className="border-t border-gray-800 p-4">
              {selectedIssue ? (
                <div>
                  <div className="text-sm font-semibold text-gray-100">{selectedIssue.title}</div>
                  <p className="mt-1 text-xs leading-5 text-gray-400">{selectedIssue.description}</p>
                  {selectedIssue.action === "edit_record" && selectedIssue.field && (
                    <div className="mt-3 space-y-2">
                      <label className="text-xs text-gray-500">{selectedIssue.fieldDisplayName || selectedIssue.field}</label>
                      <input
                        value={editValue}
                        onChange={(event) => setEditValue(event.target.value)}
                        className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-emerald-500"
                      />
                      <button
                        onClick={saveIssue}
                        disabled={saving || !editValue.trim()}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Save className="h-4 w-4" />
                        Save Fix
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-gray-500">Select an issue to review or fix it.</div>
              )}
            </div>
          </aside>
        </div>

        <section className="mt-4 rounded-lg border border-gray-800 bg-gray-900/40">
          <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-3 text-sm font-semibold text-gray-100">
            <ShieldCheck className="h-4 w-4 text-emerald-300" />
            Validation Report
          </div>
          <div className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-2 2xl:grid-cols-3">
            {checks.slice(0, 12).map((check) => (
              <div key={check.id} className="rounded-md border border-gray-800 bg-gray-950 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-sm font-medium text-gray-100">{check.title}</div>
                  <span className={`rounded px-2 py-0.5 text-xs ${check.status === "pass" ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>{check.status}</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-gray-500">{check.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-4 rounded-lg border border-gray-800 bg-gray-900/40">
          <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-3 text-sm font-semibold text-gray-100">
            <Link2 className="h-4 w-4 text-cyan-300" />
            Relationship Types
          </div>
          <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="overflow-hidden rounded-lg border border-gray-800">
              <table className="w-full text-sm">
                <thead className="bg-gray-950">
                  <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wider text-gray-500">
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {relationshipTypes.map((type) => (
                    <tr key={type.id} className="border-b border-gray-900 bg-gray-950">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: type.color }} />
                          <div>
                            <div className="font-medium text-gray-200">{type.displayName}</div>
                            <div className="font-mono text-xs text-gray-600">{type.name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-2 py-0.5 text-xs ${type.active ? "bg-emerald-500/15 text-emerald-300" : "bg-gray-700 text-gray-300"}`}>
                          {type.active ? "active" : "inactive"}
                        </span>
                        {type.isSystem && <span className="ml-2 rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">system</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-500">{type.description || "-"}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => deleteRelationshipType(type)}
                          disabled={type.isSystem}
                          className="inline-flex items-center gap-1 rounded border border-gray-700 px-2 py-1 text-xs text-gray-400 hover:border-red-500/50 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
              <div className="text-sm font-semibold text-gray-100">Add Relationship Type</div>
              <div className="mt-3 space-y-3">
                <input
                  value={relationshipForm.displayName}
                  onChange={(event) => setRelationshipForm((current) => ({ ...current, displayName: event.target.value }))}
                  placeholder="Display name"
                  className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan-500"
                />
                <input
                  value={relationshipForm.name}
                  onChange={(event) => setRelationshipForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Enum name, optional"
                  className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 font-mono text-sm text-gray-100 outline-none focus:border-cyan-500"
                />
                <input
                  value={relationshipForm.description}
                  onChange={(event) => setRelationshipForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Description"
                  className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan-500"
                />
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={relationshipForm.color}
                    onChange={(event) => setRelationshipForm((current) => ({ ...current, color: event.target.value }))}
                    className="h-10 w-12 rounded border border-gray-700 bg-gray-900"
                  />
                  <button
                    onClick={saveRelationshipType}
                    disabled={saving || !relationshipForm.displayName.trim()}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-cyan-600 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Save className="h-4 w-4" />
                    Save Type
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/60 px-4 py-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-gray-500">
        <Database className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-gray-100">{value}</div>
    </div>
  );
}
