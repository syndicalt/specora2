"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ShellAPI } from "@/sdk/types";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  GitPullRequest,
  Lightbulb,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  TerminalSquare,
  TrendingDown,
  Wrench,
} from "lucide-react";

type PreventionRecord = {
  id: string;
  title: string;
  description?: string;
  status: string;
  category: string;
  priority: number;
  service?: string;
  ci_id?: string;
  recurrence_count: number;
  impact_score: number;
  confidence: number;
  estimated_hours_saved: number;
  verified_reduction_pct?: number;
  known_error_id?: string;
  created_at: string;
  updated_at: string;
  knownError?: { id: string; title: string; status: string; health_score?: number; trust_score?: number } | null;
  evidence?: Array<{ id: string; source_type: string; source_id: string; summary?: string; weight: number }>;
  actions?: Array<{ id: string; type: string; title: string; status: string; target_app?: string; result?: string }>;
  events?: Array<{ id: string; type: string; message: string; actor?: string; created_at: string }>;
};

type View = "overview" | "workbench" | "verification" | "integrations";

const STATUS_CLASS: Record<string, string> = {
  candidate: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  investigating: "border-indigo-500/30 bg-indigo-500/10 text-indigo-200",
  known_error: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  fix_planned: "border-purple-500/30 bg-purple-500/10 text-purple-200",
  fix_in_progress: "border-orange-500/30 bg-orange-500/10 text-orange-200",
  monitoring: "border-cyan-500/30 bg-cyan-500/10 text-cyan-200",
  prevented: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  closed: "border-gray-700 bg-gray-800 text-gray-400",
};

function label(value?: string) {
  return value ? value.replace(/_/g, " ") : "unknown";
}

function pct(value?: number) {
  if (value === undefined || value === null) return "0%";
  return `${Math.round(value <= 1 ? value * 100 : value)}%`;
}

function when(value?: string) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Invalid date" : date.toLocaleString();
}

export default function PreventionCenterApp({ shell }: { shell: ShellAPI }) {
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const [records, setRecords] = useState<PreventionRecord[]>([]);
  const [selected, setSelected] = useState<PreventionRecord | null>(null);
  const [view, setView] = useState<View>("overview");
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const fetchJson = useCallback(async (path: string, init?: RequestInit) => {
    const res = await shellRef.current.fetch(path, init);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `Request failed: ${res.status}`);
    return data;
  }, []);

  const callTool = useCallback((name: string, body: Record<string, unknown> = {}) => {
    return fetchJson(`/api/apps/prevention-center/tools/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }, [fetchJson]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJson("/api/apps/prevention-center/tools/list_candidates");
      setRecords(Array.isArray(data) ? data : []);
    } catch (err: any) {
      shellRef.current.notify(err.message || "Prevention records could not be loaded", "error");
    } finally {
      setLoading(false);
    }
  }, [fetchJson]);

  const loadDetails = useCallback(async (preventionId: string) => {
    try {
      const data = await fetchJson(`/api/apps/prevention-center/tools/get_candidate_details?preventionId=${encodeURIComponent(preventionId)}`);
      setSelected(data);
      setRecords((prev) => prev.some((r) => r.id === data.id) ? prev.map((r) => r.id === data.id ? { ...r, ...data } : r) : [data, ...prev]);
    } catch (err: any) {
      shellRef.current.notify(err.message || "Prevention details could not be loaded", "error");
    }
  }, [fetchJson]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    return shellRef.current.onMessage((msg) => {
      if (msg.type === "FOCUS_PREVENTION" && msg.payload?.preventionId) loadDetails(msg.payload.preventionId);
    });
  }, [loadDetails]);

  useEffect(() => {
    const events = ["prevention.created", "prevention.candidates_detected", "prevention.status_changed", "prevention.actions_proposed", "prevention.known_error_created"];
    const unsubs = events.map((event) => shellRef.current.eventBus.subscribe(event, (payload: any) => {
      refresh();
      if (payload?.preventionId && selected?.id === payload.preventionId) loadDetails(payload.preventionId);
    }));
    return () => unsubs.forEach((unsub) => unsub());
  }, [refresh, loadDetails, selected?.id]);

  const active = records.filter((record) => !["prevented", "closed"].includes(record.status));
  const highImpact = active.filter((record) => record.priority <= 2 || Number(record.impact_score) >= 50);
  const monitoring = records.filter((record) => record.status === "monitoring");
  const prevented = records.filter((record) => record.status === "prevented");
  const filtered = records.filter((record) => filter ? record.status === filter || record.category === filter : true);

  async function detect() {
    setBusy("detect");
    try {
      const result = await callTool("detect_candidates", { windowDays: 30, minRecurrence: 2 });
      shell.notify(`Detected ${result.count || 0} prevention candidate${result.count === 1 ? "" : "s"}`, "success");
      await refresh();
    } catch (err: any) {
      shell.notify(err.message || "Detection failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function propose(preventionId: string) {
    setBusy(`propose:${preventionId}`);
    try {
      await callTool("propose_actions", { preventionId });
      shell.notify("Corrective actions proposed", "success");
      await loadDetails(preventionId);
    } catch (err: any) {
      shell.notify(err.message || "Action proposal failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function knownError(preventionId: string) {
    setBusy(`ke:${preventionId}`);
    try {
      await callTool("create_known_error", { preventionId });
      shell.notify("Known error draft created in Knowledge Core", "success");
      await loadDetails(preventionId);
    } catch (err: any) {
      shell.notify(err.message || "Known error creation failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function transition(preventionId: string, status: string, verifiedReductionPct?: number) {
    setBusy(`transition:${preventionId}`);
    try {
      await callTool("transition_candidate", { preventionId, status, verifiedReductionPct });
      shell.notify(`Prevention moved to ${label(status)}`, "success");
      await refresh();
      await loadDetails(preventionId);
    } catch (err: any) {
      shell.notify(err.message || "Transition failed", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-gray-950 text-gray-100">
      <header className="flex shrink-0 items-center justify-between border-b border-gray-800 px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-500/40 bg-emerald-500/10">
            <ShieldCheck className="h-5 w-5 text-emerald-300" />
          </div>
          <div>
            <h1 className="text-base font-semibold">Prevention Center</h1>
            <p className="text-xs text-gray-500">Recurring incident intelligence, known errors, corrective actions, and measured reliability improvement.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(["overview", "workbench", "verification", "integrations"] as const).map((tab) => (
            <button key={tab} onClick={() => setView(tab)} className={`rounded-md px-3 py-2 text-sm capitalize ${view === tab ? "bg-gray-800 text-white" : "text-gray-400 hover:bg-gray-900 hover:text-white"}`}>
              {tab}
            </button>
          ))}
          <button onClick={refresh} className="rounded-md p-2 text-gray-400 hover:bg-gray-900 hover:text-white" title="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[1fr_430px]">
        <section className="min-h-0 overflow-auto p-5 pb-24">
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric icon={<Target className="h-4 w-4" />} label="Active" value={active.length} />
            <Metric icon={<AlertTriangle className="h-4 w-4" />} label="High Impact" value={highImpact.length} />
            <Metric icon={<Clock className="h-4 w-4" />} label="Monitoring" value={monitoring.length} />
            <Metric icon={<TrendingDown className="h-4 w-4" />} label="Prevented" value={prevented.length} />
          </div>

          {view === "overview" && (
            <div className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
              <Panel title="Prevention Opportunities" icon={<Lightbulb className="h-4 w-4" />}>
                <div className="mb-3">
                  <button onClick={detect} disabled={busy === "detect"} className="rounded-md bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-500 disabled:opacity-50">
                    Detect Candidates
                  </button>
                </div>
                <RecordList records={highImpact.concat(active.filter((r) => !highImpact.includes(r))).slice(0, 12)} selectedId={selected?.id} onSelect={loadDetails} />
              </Panel>
              <Panel title="Reliability Payoff" icon={<TrendingDown className="h-4 w-4" />}>
                <div className="space-y-3">
                  {records.slice(0, 6).map((record) => (
                    <div key={record.id} className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
                      <div className="text-sm font-medium">{record.title}</div>
                      <div className="mt-1 text-xs text-gray-500">{record.recurrence_count} repeats · impact {Math.round(Number(record.impact_score || 0))} · {Number(record.estimated_hours_saved || 0).toFixed(1)}h saved est.</div>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          )}

          {view === "workbench" && (
            <Panel title="Reliability Workbench" icon={<Wrench className="h-4 w-4" />}>
              <div className="mb-3 flex flex-wrap gap-2">
                {["", "candidate", "investigating", "known_error", "fix_planned", "fix_in_progress", "monitoring", "prevented"].map((option) => (
                  <button key={option || "all"} onClick={() => setFilter(option)} className={`rounded-md border px-3 py-1.5 text-xs capitalize ${filter === option ? "border-gray-500 bg-gray-800 text-white" : "border-gray-800 text-gray-400 hover:bg-gray-900"}`}>
                    {option ? label(option) : "all"}
                  </button>
                ))}
              </div>
              <RecordList records={filtered} selectedId={selected?.id} onSelect={loadDetails} />
            </Panel>
          )}

          {view === "verification" && (
            <div className="grid gap-4 xl:grid-cols-2">
              <Panel title="Monitoring Fixes" icon={<Clock className="h-4 w-4" />}>
                <RecordList records={monitoring} selectedId={selected?.id} onSelect={loadDetails} empty="No prevention work is in monitoring." />
              </Panel>
              <Panel title="Verified Prevention" icon={<CheckCircle2 className="h-4 w-4" />}>
                <RecordList records={prevented} selectedId={selected?.id} onSelect={loadDetails} empty="No prevention work has been verified yet." />
              </Panel>
            </div>
          )}

          {view === "integrations" && (
            <div className="grid gap-4 xl:grid-cols-2">
              <Panel title="Entry Points" icon={<TerminalSquare className="h-4 w-4" />}>
                <Endpoint method="POST" path="/api/prevention/detect" note="Detect recurring incident clusters and reliability prevention candidates." />
                <Endpoint method="POST" path="/api/prevention/candidates" note="Create prevention candidates from observability, postmortems, incidents, or external reliability workflows." />
                <Endpoint method="POST" path="/api/prevention/candidates/:id/actions" note="Propose corrective actions or create a linked known error." />
                <Endpoint method="POST" path="/api/prevention/candidates/:id/transition" note="Move prevention work through investigation, fix, monitoring, and prevented states." />
              </Panel>
              <Panel title="Exit Points" icon={<GitPullRequest className="h-4 w-4" />}>
                <Endpoint method="event" path="prevention.created" note="Route prevention candidates into ownership and planning workflows." />
                <Endpoint method="event" path="prevention.actions_proposed" note="Create knowledge, change, health, discovery, and automation follow-up work." />
                <Endpoint method="event" path="prevention.known_error_created" note="Expose recurring issue context through Knowledge Core." />
                <Endpoint method="event" path="prevention.status_changed" note="Drive reporting on measured incident reduction." />
              </Panel>
            </div>
          )}
        </section>

        <aside className="min-h-0 overflow-auto border-l border-gray-800 bg-gray-950 p-5 pb-24">
          {!selected ? <Empty text="Select a prevention record to inspect evidence, actions, known errors, and measured outcomes." /> : (
            <div className="space-y-4">
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Pill className={STATUS_CLASS[selected.status]}>{label(selected.status)}</Pill>
                  <span className="text-xs text-gray-500">{label(selected.category)} · priority {selected.priority}</span>
                </div>
                <h2 className="text-lg font-semibold">{selected.title}</h2>
                <p className="mt-1 text-sm text-gray-500">{selected.service || selected.ci_id || "Unmapped"} · {selected.recurrence_count} recurrence signals</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <MiniStat label="Impact" value={String(Math.round(Number(selected.impact_score || 0)))} />
                <MiniStat label="Confidence" value={pct(selected.confidence)} />
                <MiniStat label="Hours Saved" value={Number(selected.estimated_hours_saved || 0).toFixed(1)} />
                <MiniStat label="Reduction" value={selected.verified_reduction_pct === null || selected.verified_reduction_pct === undefined ? "pending" : pct(selected.verified_reduction_pct)} />
              </div>

              <Panel title="Prevention Brief" icon={<FileText className="h-4 w-4" />}>
                <p className="text-sm leading-6 text-gray-300">{selected.description || "No description captured."}</p>
              </Panel>

              <Panel title="Corrective Actions" icon={<Wrench className="h-4 w-4" />}>
                <div className="mb-3 flex flex-wrap gap-2">
                  <button onClick={() => propose(selected.id)} disabled={busy === `propose:${selected.id}`} className="rounded-md border border-gray-700 px-3 py-2 text-sm hover:bg-gray-900 disabled:opacity-50">Propose Actions</button>
                  <button onClick={() => knownError(selected.id)} disabled={busy === `ke:${selected.id}`} className="rounded-md border border-amber-700/60 px-3 py-2 text-sm text-amber-200 hover:bg-amber-950/30 disabled:opacity-50">Create Known Error</button>
                </div>
                <div className="space-y-2">
                  {(selected.actions || []).length === 0 && <Empty text="No corrective actions proposed yet." />}
                  {(selected.actions || []).map((action) => (
                    <div key={action.id} className="rounded-md border border-gray-800 bg-gray-900/40 p-3">
                      <div className="text-sm font-medium">{action.title}</div>
                      <div className="text-xs text-gray-500">{label(action.type)} · {label(action.status)} · {action.target_app || "unrouted"}</div>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Workflow" icon={<Sparkles className="h-4 w-4" />}>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => transition(selected.id, "investigating")} className="rounded-md border border-gray-700 px-3 py-2 text-sm hover:bg-gray-900">Investigate</button>
                  <button onClick={() => transition(selected.id, "fix_planned")} className="rounded-md border border-gray-700 px-3 py-2 text-sm hover:bg-gray-900">Plan Fix</button>
                  <button onClick={() => transition(selected.id, "monitoring")} className="rounded-md border border-cyan-700/60 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-950/30">Monitor</button>
                  <button onClick={() => transition(selected.id, "prevented", 0.8)} className="rounded-md border border-emerald-700/60 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-950/30">Verify Prevented</button>
                </div>
              </Panel>

              <Panel title="Evidence" icon={<Target className="h-4 w-4" />}>
                <div className="space-y-2">
                  {(selected.evidence || []).length === 0 && <Empty text="No evidence linked yet." />}
                  {(selected.evidence || []).map((ev) => (
                    <div key={ev.id} className="rounded-md border border-gray-800 bg-gray-900/40 p-3">
                      <div className="text-sm font-medium">{ev.source_id}</div>
                      <div className="text-xs text-gray-500">{ev.source_type} · weight {ev.weight}</div>
                      {ev.summary && <p className="mt-2 text-sm text-gray-400">{ev.summary}</p>}
                    </div>
                  ))}
                </div>
              </Panel>

              {selected.knownError && (
                <Panel title="Known Error" icon={<Lightbulb className="h-4 w-4" />}>
                  <div className="rounded-md border border-gray-800 bg-gray-900/40 p-3">
                    <div className="text-sm font-medium">{selected.knownError.title}</div>
                    <div className="text-xs text-gray-500">{label(selected.knownError.status)} · trust {pct(selected.knownError.trust_score)}</div>
                  </div>
                </Panel>
              )}

              <Panel title="Timeline" icon={<Clock className="h-4 w-4" />}>
                <div className="space-y-3">
                  {(selected.events || []).map((event) => (
                    <div key={event.id} className="border-l border-gray-800 pl-3">
                      <div className="text-xs text-gray-500">{when(event.created_at)} · {event.type}</div>
                      <div className="text-sm text-gray-300">{event.message}</div>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-500">{icon}{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-gray-100">{value}</div>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-800 bg-gray-950/60">
      <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-3 text-sm font-semibold text-gray-200">{icon}{title}</div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function RecordList({ records, selectedId, onSelect, empty = "No prevention records found." }: {
  records: PreventionRecord[];
  selectedId?: string;
  onSelect: (id: string) => void;
  empty?: string;
}) {
  if (records.length === 0) return <Empty text={empty} />;
  return (
    <div className="space-y-2">
      {records.map((record) => (
        <button key={record.id} onClick={() => onSelect(record.id)} className={`block w-full rounded-lg border p-3 text-left ${selectedId === record.id ? "border-emerald-500/60 bg-emerald-500/10" : "border-gray-800 bg-gray-900/40 hover:bg-gray-900"}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-gray-100">{record.title}</div>
              <div className="mt-1 text-xs text-gray-500">{record.service || record.ci_id || "unmapped"} · {record.recurrence_count} repeats · {when(record.updated_at)}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-xs font-semibold text-emerald-300">{Math.round(Number(record.impact_score || 0))}</span>
              <Pill className={STATUS_CLASS[record.status]}>{label(record.status)}</Pill>
            </div>
          </div>
          {record.description && <p className="mt-2 line-clamp-2 text-xs text-gray-400">{record.description}</p>}
        </button>
      ))}
    </div>
  );
}

function Endpoint({ method, path, note }: { method: string; path: string; note: string }) {
  return (
    <div className="mb-3 rounded-lg border border-gray-800 bg-gray-900/40 p-3">
      <div className="flex items-center gap-2">
        <span className="rounded bg-gray-800 px-2 py-1 text-xs font-semibold uppercase text-gray-300">{method}</span>
        <code className="text-xs text-gray-200">{path}</code>
      </div>
      <p className="mt-2 text-sm text-gray-500">{note}</p>
    </div>
  );
}

function Pill({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`rounded-full border px-2 py-0.5 text-xs capitalize ${className || "border-gray-700 bg-gray-800 text-gray-300"}`}>{children}</span>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-gray-800 p-4 text-center text-sm text-gray-500">{text}</div>;
}
