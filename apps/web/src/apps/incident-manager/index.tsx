"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ShellAPI } from "@/sdk/types";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  MessageSquare,
  Radio,
  RefreshCw,
  ShieldCheck,
  Siren,
  Sparkles,
  TerminalSquare,
  Wrench,
} from "lucide-react";

type Incident = {
  id: string;
  number?: string | null;
  requester_id?: string | null;
  title: string;
  description?: string;
  service?: string;
  ci_id?: string;
  status: string;
  severity: string;
  priority: number;
  source: string;
  external_ref?: string;
  ai_state?: string;
  ai_confidence?: number;
  ai_summary?: string;
  ai_next_action?: string;
  ai_decision?: string;
  auto_remediation_allowed?: boolean;
  created_at: string;
  updated_at: string;
  requester?: { id: string; name?: string | null; email?: string | null } | null;
  owner?: { id: string; name?: string | null; email?: string | null } | null;
  commander?: { id: string; name?: string | null; email?: string | null } | null;
  affectedCis?: Array<{ ci_id: string; role: string; name?: string; class?: string; environment?: string }>;
  relatedChanges?: Array<{ id: string; title: string; status: string; priority?: string; planned_start_at?: string }>;
  events?: Array<{ id: string; type: string; message: string; actor?: string; created_at: string }>;
  actions?: Array<{ id: string; name: string; kind: string; status: string; risk_level: string; confidence: number; requires_approval: boolean; result?: string }>;
  postmortems?: Array<{ id: string; status: string; summary: string; created_at: string }>;
};

type View = "autopilot" | "command" | "remediation" | "integrations";

const STATUS_CLASS: Record<string, string> = {
  new: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  triaging: "border-indigo-500/30 bg-indigo-500/10 text-indigo-200",
  investigating: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  remediating: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  awaiting_human: "border-orange-500/30 bg-orange-500/10 text-orange-200",
  major: "border-rose-500/40 bg-rose-500/10 text-rose-200",
  resolved: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  closed: "border-gray-700 bg-gray-800 text-gray-400",
};

const SEVERITY_CLASS: Record<string, string> = {
  critical: "text-rose-300",
  high: "text-orange-300",
  medium: "text-amber-200",
  low: "text-emerald-300",
};

function label(value?: string) {
  return value ? value.replace(/_/g, " ") : "unknown";
}

function when(value?: string) {
  if (!value) return "Not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Invalid date" : date.toLocaleString();
}

function pct(value?: number) {
  if (value === undefined || value === null) return "0%";
  return `${Math.round(value <= 1 ? value * 100 : value)}%`;
}

function incidentNumber(incident: Incident) {
  return incident.number || "Number not assigned";
}

function userLabel(user?: { id: string; name?: string | null; email?: string | null } | null) {
  if (!user) return "Not recorded";
  return user.name || user.email || user.id;
}

export default function IncidentManagerApp({ shell }: { shell: ShellAPI }) {
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selected, setSelected] = useState<Incident | null>(null);
  const [view, setView] = useState<View>("autopilot");
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
    return fetchJson(`/api/apps/incident-manager/tools/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }, [fetchJson]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJson("/api/apps/incident-manager/tools/list_incidents");
      setIncidents(Array.isArray(data) ? data : []);
    } catch (err: any) {
      shellRef.current.notify(err.message || "Incidents could not be loaded", "error");
    } finally {
      setLoading(false);
    }
  }, [fetchJson]);

  const loadDetails = useCallback(async (incidentId: string) => {
    try {
      const data = await fetchJson(`/api/apps/incident-manager/tools/get_incident_details?incidentId=${encodeURIComponent(incidentId)}`);
      setSelected(data);
      setIncidents((prev) => prev.some((i) => i.id === data.id) ? prev.map((i) => i.id === data.id ? { ...i, ...data } : i) : [data, ...prev]);
    } catch (err: any) {
      shellRef.current.notify(err.message || "Incident details could not be loaded", "error");
    }
  }, [fetchJson]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    return shellRef.current.onMessage((msg) => {
      if (msg.type === "FOCUS_INCIDENT" && msg.payload?.incidentId) loadDetails(msg.payload.incidentId);
    });
  }, [loadDetails]);

  useEffect(() => {
    const events = ["incident.created", "incident.triaged", "incident.status_changed", "incident.actions_proposed", "incident.action_executed"];
    const unsubs = events.map((event) => shellRef.current.eventBus.subscribe(event, (payload: any) => {
      refresh();
      if (payload?.incidentId && selected?.id === payload.incidentId) loadDetails(payload.incidentId);
    }));
    return () => unsubs.forEach((unsub) => unsub());
  }, [refresh, loadDetails, selected?.id]);

  const active = incidents.filter((i) => !["resolved", "closed"].includes(i.status));
  const critical = active.filter((i) => i.severity === "critical" || i.status === "major");
  const awaiting = active.filter((i) => i.ai_decision === "request-approval" || i.status === "awaiting_human");
  const autopilot = active.filter((i) => ["triaged", "queued"].includes(i.ai_state || "queued"));
  const filtered = incidents.filter((i) => filter ? i.status === filter : true);

  async function runTriage(incidentId: string) {
    setBusy(`triage:${incidentId}`);
    try {
      await callTool("triage_incident", { incidentId });
      await callTool("recommend_remediation", { incidentId });
      shell.notify("AI triage and remediation recommendations updated", "success");
      await refresh();
      await loadDetails(incidentId);
    } catch (err: any) {
      shell.notify(err.message || "Triage failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function transition(incidentId: string, status: string) {
    setBusy(`transition:${incidentId}`);
    try {
      await callTool("transition_incident", { incidentId, status });
      shell.notify(`Incident moved to ${label(status)}`, "success");
      await refresh();
      await loadDetails(incidentId);
    } catch (err: any) {
      shell.notify(err.message || "Status update failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function approveAndExecute(actionId: string) {
    if (!selected) return;
    setBusy(`action:${actionId}`);
    try {
      await callTool("approve_action", { actionId });
      await callTool("execute_remediation", { actionId });
      shell.notify("Remediation action executed", "success");
      await loadDetails(selected.id);
      await refresh();
    } catch (err: any) {
      shell.notify(err.message || "Remediation failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function generatePostmortem() {
    if (!selected) return;
    setBusy(`postmortem:${selected.id}`);
    try {
      await callTool("generate_postmortem", { incidentId: selected.id });
      shell.notify("Post-incident review draft generated", "success");
      await loadDetails(selected.id);
    } catch (err: any) {
      shell.notify(err.message || "Postmortem generation failed", "error");
    } finally {
      setBusy(null);
    }
  }

  function orchestrateInChat(incident?: Incident) {
    const prompt = incident
      ? `Take command of incident ${incidentNumber(incident)}. Summarize current state, triage it, recommend safe remediation, draft a stakeholder update, and tell me the next human decision needed.`
      : "Review active incidents. Prioritize by severity, business impact, AI confidence, related changes, and remediation readiness.";
    navigator.clipboard?.writeText(prompt).catch(() => undefined);
    shell.notify("Incident prompt copied. Open chat with Ctrl+K and paste it.", "info");
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-gray-950 text-gray-100">
      <header className="flex shrink-0 items-center justify-between border-b border-gray-800 px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-rose-500/40 bg-rose-500/10">
            <Siren className="h-5 w-5 text-rose-300" />
          </div>
          <div>
            <h1 className="text-base font-semibold">Incident Command Center</h1>
            <p className="text-xs text-gray-500">AI triage, autonomous remediation oversight, major incident command, and prevention learning.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(["autopilot", "command", "remediation", "integrations"] as const).map((tab) => (
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
            <Metric icon={<Activity className="h-4 w-4" />} label="Active" value={active.length} />
            <Metric icon={<Siren className="h-4 w-4" />} label="Critical" value={critical.length} />
            <Metric icon={<ShieldCheck className="h-4 w-4" />} label="Needs Approval" value={awaiting.length} />
            <Metric icon={<Bot className="h-4 w-4" />} label="Autopilot" value={autopilot.length} />
          </div>

          {view === "autopilot" && (
            <div className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
              <Panel title="AI Operations Queue" icon={<Sparkles className="h-4 w-4" />}>
                <IncidentList incidents={active.slice(0, 12)} selectedId={selected?.id} onSelect={loadDetails} onTriage={runTriage} busy={busy} />
              </Panel>
              <Panel title="Human Decision Queue" icon={<AlertTriangle className="h-4 w-4" />}>
                <IncidentList incidents={awaiting.slice(0, 8)} selectedId={selected?.id} onSelect={loadDetails} onTriage={runTriage} busy={busy} empty="No incidents need human approval." />
              </Panel>
            </div>
          )}

          {view === "command" && (
            <div className="space-y-4">
              <Panel title="Major Incident Command" icon={<Radio className="h-4 w-4" />}>
                <IncidentList incidents={[...critical, ...active.filter((i) => i.status === "investigating")]} selectedId={selected?.id} onSelect={loadDetails} onTriage={runTriage} busy={busy} empty="No major command sessions are active." />
              </Panel>
              <Panel title="All Incidents" icon={<Clock className="h-4 w-4" />}>
                <div className="mb-3 flex flex-wrap gap-2">
                  {["", "new", "triaging", "investigating", "remediating", "awaiting_human", "major", "resolved"].map((status) => (
                    <button key={status || "all"} onClick={() => setFilter(status)} className={`rounded-md border px-3 py-1.5 text-xs capitalize ${filter === status ? "border-gray-500 bg-gray-800 text-white" : "border-gray-800 text-gray-400 hover:bg-gray-900"}`}>
                      {status ? label(status) : "all"}
                    </button>
                  ))}
                </div>
                <IncidentList incidents={filtered} selectedId={selected?.id} onSelect={loadDetails} onTriage={runTriage} busy={busy} />
              </Panel>
            </div>
          )}

          {view === "remediation" && (
            <Panel title="Remediation Workbench" icon={<Wrench className="h-4 w-4" />}>
              {!selected ? <Empty text="Select an incident to review remediation actions." /> : (
                <div className="space-y-3">
                  {(selected.actions || []).length === 0 && <Empty text="No remediation actions proposed yet. Run AI triage to generate recommendations." />}
                  {(selected.actions || []).map((action) => (
                    <div key={action.id} className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium text-gray-100">{action.name}</div>
                          <div className="mt-1 text-xs text-gray-500">{action.kind} · risk {action.risk_level} · confidence {pct(action.confidence)}</div>
                        </div>
                        <Pill>{label(action.status)}</Pill>
                      </div>
                      {action.result && <p className="mt-3 text-sm text-gray-400">{action.result}</p>}
                      <div className="mt-3 flex gap-2">
                        <button disabled={busy === `action:${action.id}` || action.status === "executed"} onClick={() => approveAndExecute(action.id)} className="rounded-md bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">
                          Approve & Execute
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          )}

          {view === "integrations" && (
            <div className="grid gap-4 xl:grid-cols-2">
              <Panel title="External Entry Points" icon={<TerminalSquare className="h-4 w-4" />}>
                <Endpoint method="POST" path="/api/incident-automation/signals" note="Alert, monitor, AIOps, CI/CD, or external ITSM signal ingestion with immediate triage." />
                <Endpoint method="POST" path="/api/incident-automation/incidents" note="Create a managed incident from an external workflow." />
                <Endpoint method="POST" path="/api/incident-automation/incidents/:id/actions" note="Recommend, approve, and execute remediation from external orchestration." />
                <Endpoint method="POST" path="/api/incident-automation/incidents/:id/resolve" note="Resolve an incident and optionally generate a post-incident review draft." />
              </Panel>
              <Panel title="Exit Points" icon={<MessageSquare className="h-4 w-4" />}>
                <Endpoint method="event" path="incident.created" note="Create downstream war rooms, notifications, or status page workflows." />
                <Endpoint method="event" path="incident.triaged" note="Consume AI confidence, decision, and next action." />
                <Endpoint method="event" path="incident.action_executed" note="Audit remediation and feed observability verification." />
                <Endpoint method="event" path="incident.postmortem_generated" note="Route prevention work to Problem, Change, Health, or backlog tools." />
              </Panel>
            </div>
          )}
        </section>

        <aside className="min-h-0 overflow-auto border-l border-gray-800 bg-gray-950 p-5 pb-24">
          {!selected ? <Empty text="Select an incident to inspect AI state, timeline, related changes, and remediation." /> : (
            <div className="space-y-4">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Pill className={STATUS_CLASS[selected.status]}>{label(selected.status)}</Pill>
                  <span className={`text-xs font-semibold uppercase ${SEVERITY_CLASS[selected.severity] || "text-gray-300"}`}>{selected.severity}</span>
                </div>
                <div className="font-mono text-xs text-gray-500">{incidentNumber(selected)}</div>
                <h2 className="mt-1 text-lg font-semibold">{selected.title}</h2>
                <p className="mt-1 text-sm text-gray-500">{selected.service || selected.ci_id || "No service mapped"} · {selected.source}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <MiniStat label="AI Confidence" value={pct(selected.ai_confidence)} />
                <MiniStat label="Decision" value={label(selected.ai_decision)} />
              </div>

              <Panel title="Requester Contact" icon={<MessageSquare className="h-4 w-4" />}>
                <div className="space-y-3">
                  <div>
                    <div className="text-sm font-medium text-gray-100">{userLabel(selected.requester)}</div>
                    <div className="mt-1 text-xs text-gray-500">{selected.requester?.email || "No requester email recorded"}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <MiniStat label="Owner" value={userLabel(selected.owner)} />
                    <MiniStat label="Commander" value={userLabel(selected.commander)} />
                  </div>
                  {selected.requester?.email && (
                    <a href={`mailto:${selected.requester.email}?subject=${encodeURIComponent(incidentNumber(selected))}`} className="inline-flex rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-200 hover:bg-gray-900">
                      Email Requester
                    </a>
                  )}
                </div>
              </Panel>

              <Panel title="AI Incident Operator" icon={<Bot className="h-4 w-4" />}>
                <p className="text-sm text-gray-300">{selected.ai_summary || "No AI triage summary yet."}</p>
                <p className="mt-3 text-sm text-gray-500">{selected.ai_next_action || "Run triage to calculate the next best action."}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button onClick={() => runTriage(selected.id)} disabled={busy === `triage:${selected.id}`} className="rounded-md bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-500 disabled:opacity-50">Run Triage</button>
                  <button onClick={() => orchestrateInChat(selected)} className="rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-200 hover:bg-gray-900">Chat Orchestrate</button>
                </div>
              </Panel>

              <Panel title="Command Actions" icon={<ShieldCheck className="h-4 w-4" />}>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => transition(selected.id, "investigating")} className="rounded-md border border-gray-700 px-3 py-2 text-sm hover:bg-gray-900">Investigate</button>
                  <button onClick={() => transition(selected.id, "major")} className="rounded-md border border-rose-700/60 px-3 py-2 text-sm text-rose-200 hover:bg-rose-950/30">Declare Major</button>
                  <button onClick={() => transition(selected.id, "awaiting_human")} className="rounded-md border border-gray-700 px-3 py-2 text-sm hover:bg-gray-900">Request Human</button>
                  <button onClick={() => transition(selected.id, "resolved")} className="rounded-md border border-emerald-700/60 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-950/30">Resolve</button>
                </div>
              </Panel>

              <Panel title="Affected CIs" icon={<Activity className="h-4 w-4" />}>
                <div className="space-y-2">
                  {(selected.affectedCis || []).length === 0 && <Empty text="No affected CIs mapped." />}
                  {(selected.affectedCis || []).map((ci) => (
                    <div key={ci.ci_id} className="rounded-md border border-gray-800 bg-gray-900/40 p-3">
                      <div className="text-sm font-medium">{ci.name || ci.ci_id}</div>
                      <div className="text-xs text-gray-500">{ci.class || "CI"} · {ci.environment || "unknown"} · {ci.role}</div>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Related Changes" icon={<AlertTriangle className="h-4 w-4" />}>
                <div className="space-y-2">
                  {(selected.relatedChanges || []).length === 0 && <Empty text="No related changes found." />}
                  {(selected.relatedChanges || []).map((change) => (
                    <div key={change.id} className="rounded-md border border-gray-800 bg-gray-900/40 p-3">
                      <div className="text-sm font-medium">{change.title}</div>
                      <div className="text-xs text-gray-500">{label(change.status)} · {when(change.planned_start_at)}</div>
                    </div>
                  ))}
                </div>
              </Panel>

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

              <Panel title="Learning Loop" icon={<CheckCircle2 className="h-4 w-4" />}>
                <button onClick={generatePostmortem} disabled={busy === `postmortem:${selected.id}`} className="mb-3 rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-950 hover:bg-white disabled:opacity-50">Generate Postmortem</button>
                {(selected.postmortems || []).map((pm) => (
                  <div key={pm.id} className="rounded-md border border-gray-800 bg-gray-900/40 p-3 text-sm text-gray-300">{pm.summary}</div>
                ))}
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

function IncidentList({ incidents, selectedId, onSelect, onTriage, busy, empty = "No incidents found." }: {
  incidents: Incident[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onTriage: (id: string) => void;
  busy: string | null;
  empty?: string;
}) {
  if (incidents.length === 0) return <Empty text={empty} />;
  return (
    <div className="space-y-2">
      {incidents.map((incident) => (
        <div key={incident.id} className={`rounded-lg border p-3 ${selectedId === incident.id ? "border-indigo-500/60 bg-indigo-500/10" : "border-gray-800 bg-gray-900/40"}`}>
          <button onClick={() => onSelect(incident.id)} className="block w-full text-left">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  {incident.number && <span className="shrink-0 font-mono text-xs text-indigo-300">{incident.number}</span>}
                  <div className="truncate text-sm font-medium text-gray-100">{incident.title}</div>
                </div>
                <div className="mt-1 text-xs text-gray-500">{incident.service || incident.ci_id || "unmapped"} · {when(incident.created_at)}</div>
                {incident.requester && <div className="mt-1 text-xs text-gray-500">Requester: {userLabel(incident.requester)}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`text-xs font-semibold uppercase ${SEVERITY_CLASS[incident.severity] || "text-gray-300"}`}>{incident.severity}</span>
                <Pill className={STATUS_CLASS[incident.status]}>{label(incident.status)}</Pill>
              </div>
            </div>
            {incident.ai_summary && <p className="mt-2 line-clamp-2 text-xs text-gray-400">{incident.ai_summary}</p>}
          </button>
          <div className="mt-3 flex gap-2">
            <button onClick={() => onTriage(incident.id)} disabled={busy === `triage:${incident.id}`} className="rounded-md border border-gray-700 px-2.5 py-1.5 text-xs text-gray-200 hover:bg-gray-900 disabled:opacity-50">
              Triage
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Pill({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`rounded-full border px-2 py-0.5 text-xs capitalize ${className || "border-gray-700 bg-gray-800 text-gray-300"}`}>{children}</span>;
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

function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-gray-800 p-4 text-center text-sm text-gray-500">{text}</div>;
}
