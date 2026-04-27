"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ShellAPI } from "@/sdk/types";
import {
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  Clock,
  Headphones,
  MessageSquare,
  RefreshCw,
  Search,
  Sparkles,
  UserRound,
} from "lucide-react";

type CatalogRequest = {
  id: string;
  number?: string;
  requester_name?: string;
  requester_email?: string;
  catalog_title?: string;
  catalog_category?: string;
  fulfillment_group?: string;
  title: string;
  description?: string;
  request_type: string;
  status: string;
  priority: number;
  source: string;
  intent_summary?: string;
  answers?: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
};

type Workbench = {
  request: CatalogRequest;
  events: Array<{ id: string; type: string; message: string; actor_name?: string; created_at: string }>;
  handoffs: Array<{ id: string; status: string; channel_name?: string; channel_type?: string; created_at: string }>;
  knowledge: Array<{ id: string; title: string; summary?: string; trust_score?: number; health_score?: number }>;
  agentLinks: Array<{ title: string; url: string; type: string; reason: string }>;
  nextBestAction: string;
};

type AgentBrief = {
  summary: string;
  nextBestAction: string;
  risks: string[];
  requesterUpdate: string;
  knowledge: Workbench["knowledge"];
  agentLinks: Workbench["agentLinks"];
};

const STATUSES = ["all", "submitted", "triaged", "in_progress", "blocked", "fulfilled", "closed"];

function label(value?: string) {
  return value ? value.replace(/_/g, " ") : "unknown";
}

function when(value?: string) {
  if (!value) return "Not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Invalid date" : date.toLocaleString();
}

function priorityLabel(value: number) {
  if (value <= 1) return "P1";
  if (value === 2) return "P2";
  if (value === 3) return "P3";
  return "P4";
}

export default function EngageAgentWorkspaceApp({ shell }: { shell: ShellAPI }) {
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const [requests, setRequests] = useState<CatalogRequest[]>([]);
  const [queues, setQueues] = useState<Array<{ status: string; count: number }>>([]);
  const [selected, setSelected] = useState<Workbench | null>(null);
  const [brief, setBrief] = useState<AgentBrief | null>(null);
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [assignmentGroup, setAssignmentGroup] = useState("");
  const [workNote, setWorkNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const fetchJson = useCallback(async (path: string, init?: RequestInit) => {
    const res = await shellRef.current.fetch(path, init);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `Request failed: ${res.status}`);
    return data;
  }, []);

  const callTool = useCallback((name: string, body: Record<string, unknown> = {}) => {
    return fetchJson(`/api/apps/engage-agent-workspace/tools/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }, [fetchJson]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await callTool("workspace_home", { status, search });
      setRequests(data.requests || []);
      setQueues(data.queues || []);
    } catch (err: any) {
      shellRef.current.notify(err.message || "Engage Agent Workspace could not be loaded", "error");
    } finally {
      setLoading(false);
    }
  }, [callTool, search, status]);

  const loadWorkbench = useCallback(async (requestId: string) => {
    try {
      const data = await fetchJson(`/api/apps/engage-agent-workspace/tools/get_request_workbench?requestId=${encodeURIComponent(requestId)}`);
      setSelected(data);
      setBrief(null);
      setAssignmentGroup(String(data.request?.answers?.assignmentGroup || data.request?.fulfillment_group || ""));
      setWorkNote("");
    } catch (err: any) {
      shellRef.current.notify(err.message || "Request workbench could not be loaded", "error");
    }
  }, [fetchJson]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    return shellRef.current.onMessage((msg) => {
      if (msg.type === "FOCUS_ENGAGE_REQUEST" && msg.payload?.requestId) loadWorkbench(msg.payload.requestId);
    });
  }, [loadWorkbench]);

  useEffect(() => {
    const events = ["catalog.request.submitted", "catalog.request.updated", "support.handoff.requested"];
    const unsubs = events.map((event) => shellRef.current.eventBus.subscribe(event, (payload: any) => {
      refresh();
      if (payload?.requestId && selected?.request.id === payload.requestId) loadWorkbench(payload.requestId);
    }));
    return () => unsubs.forEach((unsub) => unsub());
  }, [loadWorkbench, refresh, selected?.request.id]);

  const queueCount = useMemo(() => queues.reduce((sum, item) => sum + Number(item.count || 0), 0), [queues]);
  const blocked = queues.find((item) => item.status === "blocked")?.count || 0;
  const active = requests.filter((request) => !["fulfilled", "closed"].includes(request.status)).length;
  const highPriority = requests.filter((request) => request.priority <= 2).length;

  async function updateRequest(nextStatus?: string) {
    if (!selected) return;
    setBusy("update");
    try {
      const updated = await callTool("update_request", {
        requestId: selected.request.id,
        status: nextStatus,
        assignmentGroup: assignmentGroup || undefined,
        workNote: workNote || undefined,
      });
      shell.notify(`Request ${updated.number || ""} updated`, "success");
      await refresh();
      await loadWorkbench(selected.request.id);
    } catch (err: any) {
      shell.notify(err.message || "Request update failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function draftBrief() {
    if (!selected) return;
    setBusy("brief");
    try {
      const data = await callTool("draft_agent_brief", { requestId: selected.request.id });
      setBrief(data);
    } catch (err: any) {
      shell.notify(err.message || "Agent brief could not be drafted", "error");
    } finally {
      setBusy(null);
    }
  }

  function openChat() {
    const prompt = selected
      ? `Help me work catalog request ${selected.request.number || selected.request.id}. Summarize the request, explain next best action, draft a requester update, and recommend useful KBs or references.`
      : "Review the Engage Agent Workspace queue. Prioritize catalog requests by age, priority, blocked state, and fulfillment readiness.";
    shell.dispatch({ type: "SET_RIGHT_PANEL_OPEN", open: true });
    window.dispatchEvent(new CustomEvent("specora:chat-prefill", { detail: { prompt } }));
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-gray-950 text-gray-100">
      <header className="flex shrink-0 items-center justify-between border-b border-gray-800 px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-500/40 bg-emerald-500/10">
            <ClipboardList className="h-5 w-5 text-emerald-300" />
          </div>
          <div>
            <h1 className="text-base font-semibold">Engage Agent Workspace</h1>
            <p className="text-xs text-gray-500">Work catalog requests with AI briefings, knowledge, references, handoffs, and requester context.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={openChat} className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-200 hover:bg-gray-900">
            <MessageSquare className="h-4 w-4" />
            Chat
          </button>
          <button onClick={refresh} className="rounded-md p-2 text-gray-400 hover:bg-gray-900 hover:text-white" title="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_460px]">
        <section className="scrollbar-thin min-h-0 overflow-auto p-5 pb-28">
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric icon={<ClipboardList className="h-4 w-4" />} label="Total Queue" value={queueCount} />
            <Metric icon={<Clock className="h-4 w-4" />} label="Active" value={active} />
            <Metric icon={<Sparkles className="h-4 w-4" />} label="High Priority" value={highPriority} />
            <Metric icon={<Headphones className="h-4 w-4" />} label="Blocked" value={Number(blocked)} />
          </div>

          <div className="mb-4 rounded-lg border border-gray-800 bg-gray-900/50 p-3">
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") refresh();
                  }}
                  placeholder="Search requests, numbers, requesters, or descriptions..."
                  className="w-full rounded-md border border-gray-700 bg-gray-950 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-emerald-500"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {STATUSES.map((item) => (
                  <button key={item} onClick={() => setStatus(item)} className={`rounded-md px-3 py-2 text-sm capitalize ${status === item ? "bg-emerald-500 text-gray-950" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}>
                    {label(item)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {requests.length === 0 && <Empty text="No catalog requests match this queue." />}
            {requests.map((request) => (
              <button
                key={request.id}
                onClick={() => loadWorkbench(request.id)}
                className={`block w-full rounded-lg border p-4 text-left transition-colors ${selected?.request.id === request.id ? "border-emerald-500/60 bg-emerald-500/10" : "border-gray-800 bg-gray-900/40 hover:border-gray-700"}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-emerald-300">{request.number || "REQ pending"}</span>
                      <Pill>{label(request.status)}</Pill>
                      <Pill>{priorityLabel(request.priority)}</Pill>
                    </div>
                    <div className="mt-2 truncate text-base font-semibold text-gray-100">{request.title}</div>
                    <div className="mt-1 text-sm text-gray-500">{request.catalog_title || label(request.request_type)} · {request.requester_name || request.requester_email || "Unknown requester"}</div>
                  </div>
                  <div className="text-right text-xs text-gray-500">
                    <div>{when(request.created_at)}</div>
                    <div className="mt-1">{request.fulfillment_group || String(request.answers?.assignmentGroup || "Unassigned")}</div>
                  </div>
                </div>
                {request.intent_summary && <p className="mt-3 line-clamp-2 text-sm leading-5 text-gray-400">{request.intent_summary}</p>}
              </button>
            ))}
          </div>
        </section>

        <aside className="scrollbar-thin min-h-0 overflow-auto border-l border-gray-800 bg-gray-950 p-5 pb-28">
          {!selected ? (
            <div className="space-y-4">
              <Empty text="Select a request to open the agent workbench." />
              <Panel title="Workspace Model" icon={<Sparkles className="h-4 w-4" />}>
                <p className="text-sm leading-6 text-gray-400">Customer-facing portals create and track requests. Agents fulfill them here with queue intelligence, AI context, knowledge, links, and handoffs.</p>
              </Panel>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="font-mono text-xs text-emerald-300">{selected.request.number || "REQ pending"}</div>
                <h2 className="mt-1 text-lg font-semibold">{selected.request.title}</h2>
                <p className="mt-1 text-sm text-gray-500">{label(selected.request.request_type)} · {label(selected.request.status)}</p>
              </div>

              <Panel title="Next Best Action" icon={<Sparkles className="h-4 w-4" />}>
                <p className="text-sm leading-6 text-gray-300">{selected.nextBestAction}</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button onClick={draftBrief} disabled={busy === "brief"} className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-500 px-3 py-2 text-sm font-medium text-gray-950 hover:bg-emerald-400 disabled:opacity-50">
                    {busy === "brief" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Draft Brief
                  </button>
                  <button onClick={openChat} className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-200 hover:bg-gray-900">
                    <MessageSquare className="h-4 w-4" />
                    Chat
                  </button>
                </div>
              </Panel>

              {brief && (
                <Panel title="AI Agent Brief" icon={<Sparkles className="h-4 w-4" />}>
                  <div className="space-y-3 text-sm text-gray-300">
                    <p className="leading-6">{brief.summary}</p>
                    <div className="rounded-md border border-gray-800 bg-gray-900/50 p-3">
                      <div className="text-xs uppercase tracking-wide text-gray-500">Requester Update</div>
                      <p className="mt-1 leading-5">{brief.requesterUpdate}</p>
                    </div>
                    <ul className="space-y-1 text-gray-400">
                      {brief.risks.map((risk) => <li key={risk}>- {risk}</li>)}
                    </ul>
                  </div>
                </Panel>
              )}

              <Panel title="Requester" icon={<UserRound className="h-4 w-4" />}>
                <div className="text-sm text-gray-300">{selected.request.requester_name || "Unknown requester"}</div>
                <div className="mt-1 text-xs text-gray-500">{selected.request.requester_email || "No email recorded"}</div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <MiniStat label="Priority" value={priorityLabel(selected.request.priority)} />
                  <MiniStat label="Source" value={label(selected.request.source)} />
                </div>
              </Panel>

              <Panel title="Fulfillment" icon={<CheckCircle2 className="h-4 w-4" />}>
                <div className="space-y-3">
                  <label className="block text-xs text-gray-500">
                    Assignment Group
                    <input value={assignmentGroup} onChange={(event) => setAssignmentGroup(event.target.value)} className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-emerald-500" />
                  </label>
                  <label className="block text-xs text-gray-500">
                    Work Note
                    <textarea value={workNote} onChange={(event) => setWorkNote(event.target.value)} rows={3} className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-emerald-500" />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {["triaged", "in_progress", "blocked", "fulfilled"].map((next) => (
                      <button key={next} onClick={() => updateRequest(next)} disabled={busy === "update"} className="rounded-md border border-gray-700 px-3 py-2 text-sm capitalize text-gray-200 hover:bg-gray-900 disabled:opacity-50">
                        {label(next)}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => updateRequest()} disabled={busy === "update"} className="w-full rounded-md bg-gray-800 px-3 py-2 text-sm text-gray-100 hover:bg-gray-700 disabled:opacity-50">Save Note / Assignment</button>
                </div>
              </Panel>

              <Panel title="Knowledge" icon={<BookOpen className="h-4 w-4" />}>
                <div className="space-y-2">
                  {selected.knowledge.length === 0 && <Empty text="No related knowledge found yet." />}
                  {selected.knowledge.map((item) => (
                    <div key={item.id} className="rounded-md border border-gray-800 bg-gray-900/40 p-3">
                      <div className="text-sm font-medium text-gray-100">{item.title}</div>
                      <div className="mt-1 line-clamp-2 text-xs text-gray-500">{item.summary || "Published knowledge article"}</div>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Agent References" icon={<ArrowUpRight className="h-4 w-4" />}>
                <div className="space-y-2">
                  {selected.agentLinks.map((link) => (
                    <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="block rounded-md border border-gray-800 bg-gray-900/40 p-3 hover:border-emerald-500/40">
                      <div className="flex items-center justify-between gap-2 text-sm font-medium text-gray-100">
                        {link.title}
                        <ArrowUpRight className="h-3.5 w-3.5 text-gray-500" />
                      </div>
                      <div className="mt-1 text-xs text-gray-500">{link.reason}</div>
                    </a>
                  ))}
                </div>
              </Panel>

              <Panel title="Timeline" icon={<Clock className="h-4 w-4" />}>
                <div className="space-y-3">
                  {selected.events.length === 0 && <Empty text="No request events yet." />}
                  {selected.events.map((event) => (
                    <div key={event.id} className="border-l border-gray-800 pl-3">
                      <div className="text-xs text-gray-500">{when(event.created_at)} · {event.actor_name || event.type}</div>
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

function Pill({ children }: { children: ReactNode }) {
  return <span className="rounded-full border border-gray-700 bg-gray-800 px-2 py-0.5 text-xs capitalize text-gray-300">{children}</span>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-gray-800 p-4 text-center text-sm text-gray-500">{text}</div>;
}
