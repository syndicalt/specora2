"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ShellAPI } from "@/sdk/types";
import { ImpactGraph } from "@/components/ImpactGraph";
import {
  AlertTriangle,
  Bot,
  CalendarDays,
  ChevronLeft,
  Clock,
  GitPullRequest,
  GitBranch,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Siren,
  TerminalSquare,
} from "lucide-react";

type RFC = {
  id: string;
  ci_id: string;
  title: string;
  description?: string;
  status: string;
  requester_id?: string;
  approver_id?: string;
  requester?: { id: string; name?: string | null; email?: string | null } | null;
  approver?: { id: string; name?: string | null; email?: string | null } | null;
  scheduled_at?: string;
  planned_start_at?: string;
  planned_end_at?: string;
  created_at: string;
  risk_score?: number;
  blast_radius?: number;
  priority?: string;
  affectedCis?: Array<{ ciId: string; role: string; name?: string; distance?: number; direction?: string; contribution?: number }>;
  approvers?: Array<{ user_id: string; name: string; email: string; role: string; approved_at: string | null }>;
  comments?: Array<{ id: string; content: string; author: string; created_at: string }>;
  edges?: Array<{ sourceId: string; targetId: string; type: string }>;
};

type CabBrief = {
  rfcId: string;
  grade?: any;
  conflicts?: any;
  health?: any;
  criticalPath?: any;
  snapshotId?: string;
  generatedBy?: string | null;
  createdAt?: string;
  generatedAt: number;
};

type ChangeConflict = {
  id: string;
  number?: string | null;
  title?: string;
  ci_id?: string;
  primary_ci?: string;
  conflicting_ci?: string;
  planned_start_at?: string;
  planned_end_at?: string;
  status?: string;
  conflictType?: string;
  severity?: string;
  reason?: string;
  suggestedAction?: string;
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-800 text-gray-300",
  pending_approval: "bg-amber-500/10 text-amber-200 border-amber-500/30",
  approved: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  implemented: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  closed: "bg-gray-800 text-gray-500",
  rejected: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  rolled_back: "bg-orange-500/10 text-orange-300 border-orange-500/30",
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  high: "bg-orange-500/10 text-orange-300 border-orange-500/30",
  medium: "bg-amber-500/10 text-amber-200 border-amber-500/30",
  low: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
};

function pretty(value?: string) {
  return value ? value.replace(/_/g, " ") : "unknown";
}

function riskBand(score = 0) {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 35) return "medium";
  return "low";
}

function timeLabel(value?: string) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Invalid date" : date.toLocaleString();
}

function userLabel(user?: { id: string; name?: string | null; email?: string | null } | null) {
  if (!user) return "Not recorded";
  return user.name || user.email || user.id;
}

function getConflicts(brief?: CabBrief): ChangeConflict[] {
  return Array.isArray(brief?.conflicts?.conflicts) ? brief.conflicts.conflicts : [];
}

function conflictSeverity(conflict: ChangeConflict) {
  return conflict.severity || (conflict.conflictType === "direct" ? "high" : "medium");
}

function conflictTitle(conflict: ChangeConflict) {
  return `${conflict.number || conflict.id}: ${conflict.title || "Untitled change"}`;
}

function conflictCi(conflict: ChangeConflict) {
  return conflict.conflicting_ci || conflict.primary_ci || conflict.ci_id || "Unknown CI";
}

function snapshotToBrief(snapshot: any): CabBrief | null {
  if (!snapshot) return null;
  return {
    rfcId: snapshot.rfcId,
    grade: snapshot.grade || {},
    conflicts: snapshot.conflicts || {},
    health: snapshot.health || {},
    criticalPath: snapshot.impactPath || {},
    snapshotId: snapshot.id,
    generatedBy: snapshot.generatedBy,
    createdAt: snapshot.createdAt,
    generatedAt: new Date(snapshot.createdAt || Date.now()).getTime(),
  };
}

export default function ChangeManagerApp({ shell }: { shell: ShellAPI }) {
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const [rfcs, setRfcs] = useState<RFC[]>([]);
  const [selected, setSelected] = useState<RFC | null>(null);
  const [briefs, setBriefs] = useState<Record<string, CabBrief>>({});
  const [view, setView] = useState<"command" | "cab" | "schedule" | "automation">("command");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const fetchJson = useCallback(async (path: string, init?: RequestInit) => {
    const res = await shellRef.current.fetch(path, init);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `Request failed: ${res.status}`);
    return data;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJson("/api/apps/change-manager/tools/list_rfcs");
      setRfcs(Array.isArray(data) ? data : []);
    } catch (err: any) {
      shellRef.current.notify(err.message || "Change requests could not be loaded", "error");
    } finally {
      setLoading(false);
    }
  }, [fetchJson]);

  const loadDetails = useCallback(async (rfcId: string) => {
    try {
      const data = await fetchJson(`/api/apps/change-manager/tools/get_rfc_details?rfcId=${encodeURIComponent(rfcId)}`);
      setSelected(data);
      setRfcs((prev) => prev.some((r) => r.id === data.id) ? prev.map((r) => r.id === data.id ? { ...r, ...data } : r) : [data, ...prev]);
      try {
        const snapshotData = await fetchJson(`/api/apps/change-manager/tools/get_latest_cab_brief_snapshot?rfcId=${encodeURIComponent(rfcId)}`);
        const brief = snapshotToBrief(snapshotData.snapshot);
        if (brief) setBriefs((prev) => ({ ...prev, [rfcId]: brief }));
      } catch {
        // Details should remain usable even if a historical CAB snapshot cannot be loaded.
      }
    } catch (err: any) {
      shellRef.current.notify(err.message || "RFC details could not be loaded", "error");
    }
  }, [fetchJson]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    return shellRef.current.onMessage((msg) => {
      if (msg.type === "FOCUS_RFC" && msg.payload?.rfcId) loadDetails(msg.payload.rfcId);
    });
  }, [loadDetails]);

  useEffect(() => {
    const events = ["rfc.created", "rfc.updated", "rfc.status_changed", "rfc.deleted"];
    const unsubs = events.map((event) => shellRef.current.eventBus.subscribe(event, (payload: any) => {
      refresh();
      if (payload?.rfcId && selected?.id === payload.rfcId) loadDetails(payload.rfcId);
    }));
    return () => unsubs.forEach((unsub) => unsub());
  }, [refresh, loadDetails, selected?.id]);

  const filtered = useMemo(() => rfcs.filter((rfc) => statusFilter ? rfc.status === statusFilter : true), [rfcs, statusFilter]);
  const pending = rfcs.filter((rfc) => rfc.status === "pending_approval");
  const active = rfcs.filter((rfc) => !["closed", "rejected"].includes(rfc.status));
  const risky = active.filter((rfc) => (rfc.risk_score || 0) >= 60 || ["critical", "high"].includes(rfc.priority || ""));
  const unscheduled = active.filter((rfc) => !rfc.planned_start_at && !rfc.scheduled_at);
  const upcoming = active
    .filter((rfc) => rfc.planned_start_at || rfc.scheduled_at)
    .sort((a, b) => new Date(a.planned_start_at || a.scheduled_at || 0).getTime() - new Date(b.planned_start_at || b.scheduled_at || 0).getTime());

  async function callTool(name: string, body: Record<string, unknown> = {}) {
    return fetchJson(`/api/apps/change-manager/tools/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function approve(rfcId: string) {
    setBusy(`approve:${rfcId}`);
    try {
      await callTool("approve_rfc", { rfcId });
      shell.notify("Approval recorded", "success");
      await refresh();
      if (selected?.id === rfcId) await loadDetails(rfcId);
    } catch (err: any) {
      shell.notify(err.message || "Approval failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function reject(rfcId: string) {
    const reason = prompt("Rejection reason");
    if (!reason?.trim()) return;
    setBusy(`reject:${rfcId}`);
    try {
      await callTool("reject_rfc", { rfcId, reason: reason.trim() });
      shell.notify("RFC rejected", "success");
      await refresh();
      if (selected?.id === rfcId) await loadDetails(rfcId);
    } catch (err: any) {
      shell.notify(err.message || "Reject failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function generateCabBrief(rfcId: string) {
    setBusy(`brief:${rfcId}`);
    try {
      const [grade, conflicts, health, criticalPath] = await Promise.all([
        callTool("grade_change_rfc", { rfcId }),
        callTool("check_change_conflicts", { rfcId, windowHours: 48 }),
        callTool("check_ci_health_before_change", { rfcId }),
        callTool("find_critical_path", { rfcId }),
      ]);
      const snapshot = await callTool("record_cab_brief_snapshot", {
        rfcId,
        grade,
        conflicts,
        health,
        impactPath: criticalPath,
        metadata: { source: "cab-workbench" },
      });
      const brief = snapshotToBrief(snapshot) || { rfcId, grade, conflicts, health, criticalPath, generatedAt: Date.now() };
      setBriefs((prev) => ({ ...prev, [rfcId]: brief }));
      shell.notify("CAB brief generated", "success");
    } catch (err: any) {
      shell.notify(err.message || "CAB brief failed", "error");
    } finally {
      setBusy(null);
    }
  }

  function orchestrateCabFromChat(rfc?: RFC) {
    const prompt = rfc
      ? `Prepare a CAB recommendation for RFC ${rfc.id}. Grade the change, check conflicts, check CI health, find the impact path, and recommend approve, reject, defer, or request more information.`
      : "Prepare the CAB agenda for pending changes. Prioritize by risk, schedule conflicts, CI health, blast radius, and approval readiness.";
    shell.runChatPrompt(prompt, { autoSend: true });
    shell.notify("CAB plan started in chat", "success");
  }

  const impactData = selected?.affectedCis?.length ? {
    nodes: selected.affectedCis.map((ci) => ({ id: ci.ciId, name: ci.name || ci.ciId, class: "CI", role: ci.role === "primary" ? "primary" : "affected" })),
    edges: selected.edges || [],
  } : null;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-gray-950 text-gray-100">
      <header className="flex shrink-0 items-center justify-between border-b border-gray-800 px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-indigo-500/40 bg-indigo-500/10">
            <GitPullRequest className="h-5 w-5 text-indigo-300" />
          </div>
          <div>
            <h1 className="text-base font-semibold">Change Command Center</h1>
            <p className="text-xs text-gray-500">CAB readiness, release safety, impact intelligence, and pipeline automation.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(["command", "cab", "schedule", "automation"] as const).map((tab) => (
            <button key={tab} onClick={() => setView(tab)} className={`rounded-md px-3 py-2 text-sm capitalize ${view === tab ? "bg-gray-800 text-white" : "text-gray-400 hover:bg-gray-900 hover:text-white"}`}>
              {tab}
            </button>
          ))}
          <button onClick={refresh} className="rounded-md p-2 text-gray-400 hover:bg-gray-900 hover:text-white" title="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[1fr_420px]">
        <section className="min-h-0 overflow-auto p-5 pb-24">
          {view === "command" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Metric icon={<GitBranch className="h-4 w-4" />} label="Active" value={active.length} />
                <Metric icon={<Clock className="h-4 w-4" />} label="Awaiting CAB" value={pending.length} />
                <Metric icon={<Siren className="h-4 w-4" />} label="High Risk" value={risky.length} />
                <Metric icon={<CalendarDays className="h-4 w-4" />} label="Unscheduled" value={unscheduled.length} />
              </div>
              <div className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
                <Panel title="Action Queue" icon={<AlertTriangle className="h-4 w-4" />}>
                  <RfcList rfcs={[...pending, ...risky].slice(0, 8)} selectedId={selected?.id} onSelect={loadDetails} empty="No high-priority work queued." />
                </Panel>
                <Panel title="Upcoming Change Schedule" icon={<CalendarDays className="h-4 w-4" />}>
                  <ScheduleList rfcs={upcoming.slice(0, 8)} onSelect={loadDetails} />
                </Panel>
              </div>
              <Panel title="All Changes" icon={<GitPullRequest className="h-4 w-4" />}>
                <div className="mb-3 flex flex-wrap gap-2">
                  {["", "draft", "pending_approval", "approved", "implemented", "closed", "rejected"].map((status) => (
                    <button key={status || "all"} onClick={() => setStatusFilter(status)} className={`rounded-md px-3 py-1.5 text-xs capitalize ${statusFilter === status ? "bg-indigo-500 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                      {status ? pretty(status) : "all"}
                    </button>
                  ))}
                </div>
                <RfcList rfcs={filtered} selectedId={selected?.id} onSelect={loadDetails} empty="No change requests found." />
              </Panel>
            </div>
          )}

          {view === "cab" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-4">
                <div>
                  <h2 className="text-sm font-semibold text-indigo-100">CAB Workbench</h2>
                  <p className="mt-1 text-sm text-indigo-100/70">Generate briefs, check health/conflicts, and approve from the same queue.</p>
                </div>
                <button onClick={() => orchestrateCabFromChat()} className="flex items-center gap-2 rounded-md bg-indigo-500 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-400">
                  <Bot className="h-4 w-4" />
                  Orchestrate in Chat
                </button>
              </div>
              <div className="grid gap-3">
                {pending.length ? pending.map((rfc) => (
                  <CabCard key={rfc.id} rfc={rfc} brief={briefs[rfc.id]} busy={busy} onSelect={loadDetails} onBrief={generateCabBrief} onApprove={approve} onReject={reject} onChat={() => orchestrateCabFromChat(rfc)} />
                )) : <Empty text="No changes are awaiting CAB review." />}
              </div>
            </div>
          )}

          {view === "schedule" && (
            <Panel title="Change Calendar Risk View" icon={<CalendarDays className="h-4 w-4" />}>
              <ScheduleList rfcs={upcoming} onSelect={loadDetails} dense={false} />
            </Panel>
          )}

          {view === "automation" && (
            <div className="grid gap-4 lg:grid-cols-2">
              <AutomationCard title="Create RFC from CI/CD" method="POST" path="/api/change-automation/requests" body={{ ciId: "demo-app-001", title: "Deploy build 2026.04.25", description: "Automated release from pipeline", plannedStartDate: "2026-04-25", plannedStartTime: "21:00", affectedCiIds: ["demo-db-001"] }} />
              <AutomationCard title="Pre-Deploy Gate" method="POST" path="/api/change-automation/gate" body={{ rfcId: "<rfc-id>", windowHours: 48 }} />
              <AutomationCard title="Proposed Change Gate" method="POST" path="/api/change-automation/gate" body={{ ciId: "demo-app-001", affectedCiIds: ["demo-db-001"] }} />
              <AutomationCard title="Transition After Deployment" method="POST" path="/api/change-automation/requests/<rfc-id>/transition" body={{ status: "implemented", comment: "Pipeline deployment completed successfully" }} />
            </div>
          )}
        </section>

        <aside className="min-h-0 overflow-auto border-t border-gray-800 bg-gray-950 p-5 pb-24 xl:border-l xl:border-t-0">
          {selected ? (
            <DetailPanel rfc={selected} impactData={impactData} brief={briefs[selected.id]} busy={busy} onBack={() => setSelected(null)} onBrief={generateCabBrief} onApprove={approve} onReject={reject} onChat={() => orchestrateCabFromChat(selected)} />
          ) : (
            <div className="rounded-lg border border-dashed border-gray-800 p-5 text-sm text-gray-500">
              Select a change to see impact, approvals, CAB readiness, and execution details.
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return <div className="rounded-lg border border-gray-800 bg-gray-900 p-4"><div className="mb-2 flex items-center gap-2 text-xs text-gray-500">{icon}{label}</div><div className="text-2xl font-semibold">{value}</div></div>;
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <section className="rounded-lg border border-gray-800 bg-gray-900 p-4"><div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-200"><span className="text-indigo-300">{icon}</span>{title}</div>{children}</section>;
}

function Badge({ value, colors }: { value?: string; colors: Record<string, string> }) {
  return <span className={`rounded-full border px-2 py-0.5 text-xs capitalize ${colors[value || ""] || "border-gray-700 bg-gray-800 text-gray-400"}`}>{pretty(value)}</span>;
}

function RfcList({ rfcs, selectedId, onSelect, empty }: { rfcs: RFC[]; selectedId?: string; onSelect: (id: string) => void; empty: string }) {
  if (!rfcs.length) return <Empty text={empty} />;
  return <div className="space-y-2">{rfcs.map((rfc) => <button key={rfc.id} onClick={() => onSelect(rfc.id)} className={`block w-full rounded-md border p-3 text-left hover:border-indigo-500/60 ${selectedId === rfc.id ? "border-indigo-500 bg-indigo-500/10" : "border-gray-800 bg-gray-950"}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-sm font-medium text-gray-100">{rfc.title}</div><div className="mt-1 text-xs text-gray-500">{rfc.ci_id} · {timeLabel(rfc.planned_start_at || rfc.scheduled_at)}</div><div className="mt-1 text-xs text-gray-500">Requester: {userLabel(rfc.requester)}</div></div><div className="flex shrink-0 gap-1"><Badge value={rfc.priority || riskBand(rfc.risk_score)} colors={PRIORITY_COLORS} /><Badge value={rfc.status} colors={STATUS_COLORS} /></div></div></button>)}</div>;
}

function ScheduleList({ rfcs, onSelect, dense = true }: { rfcs: RFC[]; onSelect: (id: string) => void; dense?: boolean }) {
  if (!rfcs.length) return <Empty text="No scheduled changes." />;
  return <div className="space-y-2">{rfcs.map((rfc) => <button key={rfc.id} onClick={() => onSelect(rfc.id)} className={`grid w-full grid-cols-[120px_1fr_auto] items-center gap-3 rounded-md border border-gray-800 bg-gray-950 p-3 text-left hover:border-indigo-500/60 ${dense ? "text-sm" : ""}`}><div className="text-xs text-gray-500">{timeLabel(rfc.planned_start_at || rfc.scheduled_at)}</div><div className="min-w-0"><div className="truncate text-sm font-medium">{rfc.title}</div><div className="text-xs text-gray-500">{rfc.ci_id}</div></div><Badge value={rfc.priority || riskBand(rfc.risk_score)} colors={PRIORITY_COLORS} /></button>)}</div>;
}

function CabCard({ rfc, brief, busy, onSelect, onBrief, onApprove, onReject, onChat }: { rfc: RFC; brief?: CabBrief; busy: string | null; onSelect: (id: string) => void; onBrief: (id: string) => void; onApprove: (id: string) => void; onReject: (id: string) => void; onChat: () => void }) {
  const conflicts = getConflicts(brief);
  const conflictCount = brief?.conflicts?.conflictCount ?? conflicts.length;
  return (
    <div className={`rounded-lg border p-4 ${conflictCount > 0 ? "border-amber-500/40 bg-amber-500/[0.04]" : "border-gray-800 bg-gray-900"}`}>
      <div className="flex items-start justify-between gap-3">
        <button onClick={() => onSelect(rfc.id)} className="min-w-0 text-left">
          <div className="truncate text-sm font-semibold">{rfc.title}</div>
          <div className="mt-1 text-xs text-gray-500">{rfc.ci_id} · risk {rfc.risk_score ?? 0}/100 · blast radius {rfc.blast_radius ?? 0}</div>
        </button>
        <div className="flex gap-1">
          <Badge value={rfc.priority || riskBand(rfc.risk_score)} colors={PRIORITY_COLORS} />
          <Badge value={rfc.status} colors={STATUS_COLORS} />
        </div>
      </div>
      {brief && (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <CabSignal label="Conflicts" value={conflictCount} bad={conflictCount > 0} />
            <CabSignal label="CI Health" value={brief.health?.healthy === false ? "Review" : "OK"} bad={brief.health?.healthy === false} />
            <CabSignal label="Impact Path" value={brief.criticalPath?.criticalPath ? "Found" : "Clear"} bad={false} />
          </div>
          {brief.createdAt && <div className="mt-2 text-xs text-gray-500">Snapshot: {timeLabel(brief.createdAt)}</div>}
          <ConflictList conflicts={conflicts} compact />
        </>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => onBrief(rfc.id)} disabled={busy === `brief:${rfc.id}`} className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800">CAB brief</button>
        <button onClick={onChat} className="rounded-md border border-indigo-500/40 px-3 py-1.5 text-xs text-indigo-200 hover:bg-indigo-500/10">Chat plan</button>
        <button onClick={() => onApprove(rfc.id)} disabled={busy === `approve:${rfc.id}`} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500">Approve</button>
        <button onClick={() => onReject(rfc.id)} disabled={busy === `reject:${rfc.id}`} className="rounded-md border border-rose-700 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10">Reject</button>
      </div>
    </div>
  );
}

function CabSignal({ label, value, bad }: { label: string; value: string | number; bad: boolean }) {
  return <div className={`rounded-md p-2 ${bad ? "bg-amber-500/10 text-amber-200" : "bg-gray-950 text-gray-300"}`}><div className="text-gray-500">{label}</div><div className="font-medium">{value}</div></div>;
}

function ConflictList({ conflicts, compact = false }: { conflicts: ChangeConflict[]; compact?: boolean }) {
  if (!conflicts.length) {
    return compact ? null : <div className="rounded-md border border-gray-800 bg-gray-950 p-3 text-sm text-gray-500">No conflicts found in the CAB window.</div>;
  }
  const visible = compact ? conflicts.slice(0, 2) : conflicts;
  return (
    <div className={compact ? "mt-3 space-y-2" : "space-y-2"}>
      {visible.map((conflict) => (
        <div key={`${conflict.id}-${conflict.conflicting_ci || conflict.primary_ci || "ci"}`} className="rounded-md border border-amber-500/20 bg-gray-950 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-amber-100">{conflictTitle(conflict)}</div>
              <div className="mt-1 text-xs text-gray-500">
                {pretty(conflict.conflictType)} · {conflictCi(conflict)} · {timeLabel(conflict.planned_start_at)}{conflict.planned_end_at ? ` - ${timeLabel(conflict.planned_end_at)}` : ""}
              </div>
            </div>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs capitalize ${conflictSeverity(conflict) === "high" ? "border-rose-500/30 bg-rose-500/10 text-rose-200" : "border-amber-500/30 bg-amber-500/10 text-amber-200"}`}>{conflictSeverity(conflict)}</span>
          </div>
          {!compact && (
            <div className="mt-2 space-y-1 text-xs text-gray-400">
              <p>{conflict.reason || "This change collides with another active scheduled change."}</p>
              <p className="text-gray-500">Suggested action: {conflict.suggestedAction || "Review schedule, ownership, and rollback coordination before approval."}</p>
            </div>
          )}
        </div>
      ))}
      {compact && conflicts.length > visible.length && <div className="text-xs text-amber-200">+{conflicts.length - visible.length} more conflict{conflicts.length - visible.length === 1 ? "" : "s"} on the change record</div>}
    </div>
  );
}

function DetailPanel({ rfc, impactData, brief, busy, onBack, onBrief, onApprove, onReject, onChat }: { rfc: RFC; impactData: any; brief?: CabBrief; busy: string | null; onBack: () => void; onBrief: (id: string) => void; onApprove: (id: string) => void; onReject: (id: string) => void; onChat: () => void }) {
  const conflicts = getConflicts(brief);
  const conflictCount = brief?.conflicts?.conflictCount ?? conflicts.length;
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-400 hover:text-white"><ChevronLeft className="h-4 w-4" /> Clear selection</button>
      <div>
        <h2 className="text-lg font-semibold">{rfc.title}</h2>
        <p className="mt-1 text-xs text-gray-500">{rfc.id}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge value={rfc.status} colors={STATUS_COLORS} />
        <Badge value={rfc.priority || riskBand(rfc.risk_score)} colors={PRIORITY_COLORS} />
      </div>
      <Panel title="Requester" icon={<MessageSquare className="h-4 w-4" />}>
        <div className="space-y-2 text-sm text-gray-300">
          <p>{userLabel(rfc.requester)}</p>
          <p className="text-xs text-gray-500">{rfc.requester?.email || "No requester email recorded"}</p>
          {rfc.requester?.email && <a href={`mailto:${rfc.requester.email}?subject=${encodeURIComponent(rfc.title)}`} className="inline-flex rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-800">Email requester</a>}
        </div>
      </Panel>
      <Panel title="Readiness" icon={<ShieldCheck className="h-4 w-4" />}>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <CabSignal label="Risk" value={rfc.risk_score ?? 0} bad={(rfc.risk_score ?? 0) >= 60} />
          <CabSignal label="Conflicts" value={brief ? conflictCount : "Run brief"} bad={conflictCount > 0} />
          <CabSignal label="Approvers" value={rfc.approvers?.filter((a) => a.approved_at).length || 0} bad={(rfc.approvers?.some((a) => !a.approved_at) ?? false)} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => onBrief(rfc.id)} disabled={busy === `brief:${rfc.id}`} className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800">Refresh CAB brief</button>
          <button onClick={onChat} className="rounded-md border border-indigo-500/40 px-3 py-1.5 text-xs text-indigo-200 hover:bg-indigo-500/10">Plan in chat</button>
          {rfc.status === "pending_approval" && <>
            <button onClick={() => onApprove(rfc.id)} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500">Approve</button>
            <button onClick={() => onReject(rfc.id)} className="rounded-md border border-rose-700 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10">Reject</button>
          </>}
        </div>
      </Panel>
      <Panel title="Change Conflicts" icon={<AlertTriangle className="h-4 w-4" />}>
        {brief ? (
          <ConflictList conflicts={conflicts} />
        ) : (
          <div className="rounded-md border border-dashed border-gray-800 bg-gray-950 p-3 text-sm text-gray-500">Run CAB brief to check direct CI, dependency, and schedule conflicts.</div>
        )}
      </Panel>
      {brief && <Panel title="CAB Brief" icon={<Bot className="h-4 w-4" />}>
        <div className="space-y-2 text-sm text-gray-400">
          {brief.createdAt && <p className="text-xs text-gray-500">Snapshot: {timeLabel(brief.createdAt)}{brief.snapshotId ? ` · ${brief.snapshotId.slice(0, 8)}` : ""}</p>}
          <p>Risk: {brief.grade?.riskScore ?? "n/a"} · Priority: {brief.grade?.priority || "n/a"}</p>
          <p>Conflicts: {conflictCount}</p>
          <p>CI health: {brief.health?.healthy === false ? "Needs review" : "OK"}</p>
          <p>Impact path: {brief.criticalPath?.criticalPath?.targetName || "No downstream business service found"}</p>
        </div>
      </Panel>}
      {rfc.description && <Panel title="Description" icon={<MessageSquare className="h-4 w-4" />}><p className="text-sm text-gray-400">{rfc.description}</p></Panel>}
      {impactData && <Panel title="Impact Graph" icon={<GitBranch className="h-4 w-4" />}><ImpactGraph nodes={impactData.nodes} edges={impactData.edges} height={260} /></Panel>}
      <Panel title="Change Window" icon={<CalendarDays className="h-4 w-4" />}>
        <div className="space-y-2 text-sm text-gray-400">
          <p>Start: {timeLabel(rfc.planned_start_at || rfc.scheduled_at)}</p>
          <p>End: {timeLabel(rfc.planned_end_at)}</p>
        </div>
      </Panel>
      {rfc.comments?.length ? <Panel title="Activity" icon={<MessageSquare className="h-4 w-4" />}><div className="space-y-3">{rfc.comments.map((comment) => <div key={comment.id} className="border-l border-gray-700 pl-3"><div className="text-xs text-gray-500">{comment.author || "Unknown"} · {timeLabel(comment.created_at)}</div><div className="text-sm text-gray-300">{comment.content}</div></div>)}</div></Panel> : null}
    </div>
  );
}

function AutomationCard({ title, method, path, body }: { title: string; method: string; path: string; body: Record<string, unknown> }) {
  return <section className="rounded-lg border border-gray-800 bg-gray-900 p-4"><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><TerminalSquare className="h-4 w-4 text-indigo-300" />{title}</div><div className="mb-2 flex items-center gap-2 text-xs"><span className="rounded bg-indigo-500/10 px-2 py-1 text-indigo-200">{method}</span><code className="text-gray-400">{path}</code></div><pre className="max-h-72 overflow-auto rounded-md bg-gray-950 p-3 text-xs text-gray-300">{JSON.stringify(body, null, 2)}</pre></section>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-md border border-dashed border-gray-800 p-6 text-center text-sm text-gray-500">{text}</div>;
}
