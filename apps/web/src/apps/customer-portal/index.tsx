"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ShellAPI } from "@/sdk/types";
import {
  ArrowRight,
  Clock,
  Headphones,
  MessageSquare,
  PhoneCall,
  RefreshCw,
  Search,
  Send,
  ShoppingCart,
  Sparkles,
} from "lucide-react";

type CatalogItem = {
  id: string;
  title: string;
  description?: string;
  category: string;
  item_type: string;
  questions: Array<{ key: string; label: string; type: string; required?: boolean; options?: string[] }>;
};

type PortalRequest = {
  id: string;
  number?: string;
  title: string;
  description?: string;
  request_type: string;
  status: string;
  priority: number;
  intent_summary?: string;
  answers?: Record<string, unknown>;
  catalog_title?: string;
  created_at: string;
  events?: Array<{ id: string; type: string; message: string; created_at: string }>;
  handoffs?: Array<{ id: string; status: string; channel_name?: string; channel_type?: string; created_at: string }>;
};

type SupportChannel = {
  id: string;
  name: string;
  channel_type: string;
  description?: string;
  target?: string;
};

type IntentCard = {
  intent: string;
  confidence: number;
  title: string;
  summary: string;
  recommendedAction: string;
  catalogItem?: CatalogItem | null;
  knowledgeCandidates: Array<{ id: string; title: string; type: string }>;
  supportChannels: SupportChannel[];
  missingFields: string[];
  priority: number;
};

type RouteDecision = {
  provider: string;
  autoRoute: boolean;
  winner: { route: string; probability: number; rationale: string };
  scores: Array<{ route: string; probability: number; rationale: string; missingFields?: string[] }>;
};

type RouteResult = {
  action: string;
  routed: boolean;
  decision: RouteDecision;
  record?: any;
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

export default function CustomerPortalApp({ shell }: { shell: ShellAPI }) {
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [requests, setRequests] = useState<PortalRequest[]>([]);
  const [channels, setChannels] = useState<SupportChannel[]>([]);
  const [selected, setSelected] = useState<PortalRequest | null>(null);
  const [intent, setIntent] = useState<IntentCard | null>(null);
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const fetchJson = useCallback(async (path: string, init?: RequestInit) => {
    const res = await shellRef.current.fetch(path, init);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `Request failed: ${res.status}`);
    return data;
  }, []);

  const callTool = useCallback((name: string, body: Record<string, unknown> = {}) => {
    return fetchJson(`/api/apps/customer-portal/tools/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }, [fetchJson]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await callTool("portal_home");
      setItems(data.featuredItems || []);
      setRequests(data.myRequests || []);
      setChannels(data.supportChannels || []);
    } catch (err: any) {
      shellRef.current.notify(err.message || "Customer Portal could not be loaded", "error");
    } finally {
      setLoading(false);
    }
  }, [callTool]);

  const loadRequest = useCallback(async (requestId: string) => {
    try {
      const data = await fetchJson(`/api/apps/customer-portal/tools/get_request_details?requestId=${encodeURIComponent(requestId)}`);
      setSelected(data);
      setRequests((prev) => prev.some((item) => item.id === data.id) ? prev.map((item) => item.id === data.id ? { ...item, ...data } : item) : [data, ...prev]);
    } catch (err: any) {
      shellRef.current.notify(err.message || "Request details could not be loaded", "error");
    }
  }, [fetchJson]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const payload = shell.launchPayload as { requestId?: string } | undefined;
    if (payload?.requestId) loadRequest(payload.requestId);
  }, [shell.launchPayload, loadRequest]);

  useEffect(() => {
    return shellRef.current.onMessage((msg) => {
      if (msg.type === "FOCUS_PORTAL_REQUEST" && msg.payload?.requestId) loadRequest(msg.payload.requestId);
    });
  }, [loadRequest]);

  useEffect(() => {
    const events = ["catalog.request.submitted", "support.handoff.requested"];
    const unsubs = events.map((event) => shellRef.current.eventBus.subscribe(event, (payload: any) => {
      refresh();
      if (payload?.requestId && selected?.id === payload.requestId) loadRequest(payload.requestId);
    }));
    return () => unsubs.forEach((unsub) => unsub());
  }, [refresh, loadRequest, selected?.id]);

  const groupedItems = useMemo(() => {
    const groups = new Map<string, CatalogItem[]>();
    for (const item of items) {
      groups.set(item.category, [...(groups.get(item.category) || []), item]);
    }
    return Array.from(groups.entries());
  }, [items]);

  async function resolveIntent() {
    if (!message.trim()) return;
    setBusy("intent");
    try {
      const result = await callTool("route_intake", { message: message.trim(), autoRoute: true });
      setRouteResult(result);
      setIntent(null);
      if (result.action === "created_catalog_request" && result.record?.id) {
        shell.notify(`Request ${result.record.number || ""} created`, "success");
        setMessage("");
        await refresh();
        await loadRequest(result.record.id);
      } else if (result.action === "created_incident") {
        shell.notify(`Incident ${result.record?.number || ""} created`, "success");
      } else if (result.action === "deflected") {
        shell.notify("Knowledge answer found", "success");
      } else if (result.action === "created_support_handoff") {
        shell.notify("Support handoff requested", "success");
      }
    } catch (err: any) {
      shell.notify(err.message || "Intelligent routing failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function submitFromIntent() {
    if (!intent) return;
    setBusy("submit");
    try {
      const request = await callTool("submit_request", {
        catalogItemId: intent.catalogItem?.id,
        title: intent.title,
        description: message,
        requestType: intent.intent,
        source: "portal_ai",
        intentSummary: intent.summary,
        answers: { message },
      });
      shell.notify(`Request ${request.number || ""} submitted`, "success");
      setIntent(null);
      setMessage("");
      await refresh();
      await loadRequest(request.id);
    } catch (err: any) {
      shell.notify(err.message || "Request submission failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function submitCatalogItem(item: CatalogItem) {
    setBusy(`item:${item.id}`);
    try {
      const request = await callTool("submit_request", {
        catalogItemId: item.id,
        title: item.title,
        description: item.description,
        requestType: item.item_type,
        source: "portal_catalog",
        intentSummary: `Submitted from ${item.title}`,
        answers: {},
      });
      shell.notify(`Request ${request.number || ""} submitted`, "success");
      await refresh();
      await loadRequest(request.id);
    } catch (err: any) {
      shell.notify(err.message || "Request submission failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function requestSupport(channel?: SupportChannel) {
    setBusy("support");
    try {
      const handoff = await callTool("request_support_handoff", {
        channelId: channel?.id,
        requestId: selected?.id,
        reason: selected ? `Support requested for ${selected.number || selected.title}` : message || "Portal support requested",
        context: {
          selectedRequest: selected ? { id: selected.id, number: selected.number, title: selected.title, status: selected.status } : null,
          intent,
          currentMessage: message,
        },
      });
      shell.notify(`Support handoff requested via ${handoff.channel?.name || "support"}`, "success");
      if (selected) await loadRequest(selected.id);
    } catch (err: any) {
      shell.notify(err.message || "Support handoff failed", "error");
    } finally {
      setBusy(null);
    }
  }

  function openPortalChat() {
    const prompt = message.trim() || "Help me solve a service need through the Customer Portal. Resolve my intent, check knowledge, submit a request only if needed, and offer support handoff if appropriate.";
    shell.dispatch({ type: "SET_RIGHT_PANEL_OPEN", open: true });
    window.dispatchEvent(new CustomEvent("specora:chat-prefill", { detail: { prompt } }));
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-gray-950 text-gray-100">
      <header className="flex shrink-0 items-center justify-between border-b border-gray-800 px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-500/40 bg-cyan-500/10">
            <MessageSquare className="h-5 w-5 text-cyan-300" />
          </div>
          <div>
            <h1 className="text-base font-semibold">Customer Portal</h1>
            <p className="text-xs text-gray-500">Ask, answer, request, route, or escalate from one AI-first front door.</p>
          </div>
        </div>
        <button onClick={refresh} className="rounded-md p-2 text-gray-400 hover:bg-gray-900 hover:text-white" title="Refresh">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[1fr_420px]">
        <section className="scrollbar-thin min-h-0 overflow-auto p-5 pb-28">
          <div className="mb-5 rounded-xl border border-cyan-500/20 bg-gray-900 p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-cyan-100">
              <Sparkles className="h-4 w-4" />
              Portal Concierge
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto_auto]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                <input
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") resolveIntent();
                  }}
                  placeholder="Tell Specora what you need..."
                  className="w-full rounded-lg border border-gray-700 bg-gray-950 py-3 pl-10 pr-3 text-sm text-gray-100 outline-none focus:border-cyan-500"
                />
              </div>
              <button onClick={resolveIntent} disabled={busy === "intent" || !message.trim()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 py-3 text-sm font-medium text-gray-950 hover:bg-cyan-400 disabled:opacity-50">
                {busy === "intent" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Resolve
              </button>
              <button onClick={openPortalChat} className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-700 px-4 py-3 text-sm text-gray-200 hover:bg-gray-800">
                <MessageSquare className="h-4 w-4" />
                Chat
              </button>
            </div>

            {intent && (
              <div className="mt-4 grid gap-4 rounded-lg border border-gray-800 bg-gray-950 p-4 lg:grid-cols-[1fr_260px]">
                <div>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Pill>{label(intent.intent)}</Pill>
                    <span className="text-xs text-gray-500">confidence {pct(intent.confidence)}</span>
                  </div>
                  <div className="text-lg font-semibold text-gray-100">{intent.title}</div>
                  <p className="mt-2 text-sm leading-6 text-gray-400">{intent.summary}</p>
                  {intent.knowledgeCandidates.length > 0 && (
                    <div className="mt-3 text-sm text-gray-500">
                      Deflection candidates: <span className="text-gray-300">{intent.knowledgeCandidates.map((item) => item.title).join(", ")}</span>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <button onClick={submitFromIntent} disabled={busy === "submit"} className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
                    <Send className="h-4 w-4" />
                    Submit Request
                  </button>
                  <button onClick={() => requestSupport(intent.supportChannels[0])} disabled={busy === "support"} className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-200 hover:bg-gray-900 disabled:opacity-50">
                    <Headphones className="h-4 w-4" />
                    Get Support
                  </button>
                </div>
              </div>
            )}

            {routeResult && (
              <div className="mt-4 rounded-lg border border-gray-800 bg-gray-950 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill>{label(routeResult.decision.winner.route)}</Pill>
                      <span className="text-xs text-gray-500">provider {routeResult.decision.provider}</span>
                      <span className="text-xs text-gray-500">confidence {pct(routeResult.decision.winner.probability)}</span>
                    </div>
                    <div className="mt-2 text-lg font-semibold text-gray-100">{label(routeResult.action)}</div>
                    <p className="mt-1 text-sm leading-6 text-gray-400">{routeResult.decision.winner.rationale}</p>
                  </div>
                  <div className={`rounded-md px-3 py-2 text-sm ${routeResult.routed ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-200"}`}>
                    {routeResult.routed ? "Auto-routed" : "Needs clarification"}
                  </div>
                </div>
                <div className="mt-4 grid gap-2 md:grid-cols-5">
                  {routeResult.decision.scores.map((score) => (
                    <div key={score.route} className="rounded-md border border-gray-800 bg-gray-900/50 p-3">
                      <div className="text-xs capitalize text-gray-500">{label(score.route)}</div>
                      <div className="mt-1 text-lg font-semibold text-gray-100">{pct(score.probability)}</div>
                    </div>
                  ))}
                </div>
                {routeResult.action === "deflected" && routeResult.record?.answer && (
                  <div className="mt-4 rounded-md border border-cyan-500/20 bg-cyan-500/10 p-3 text-sm leading-6 text-cyan-100">
                    {routeResult.record.answer}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mb-5 grid gap-3 md:grid-cols-3">
            <Metric icon={<ShoppingCart className="h-4 w-4" />} label="Catalog Items" value={items.length} />
            <Metric icon={<Clock className="h-4 w-4" />} label="My Requests" value={requests.length} />
            <Metric icon={<PhoneCall className="h-4 w-4" />} label="Support Channels" value={channels.length} />
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.05fr_.95fr]">
            <Panel title="Service Catalog" icon={<ShoppingCart className="h-4 w-4" />}>
              <div className="space-y-4">
                {groupedItems.map(([category, entries]) => (
                  <div key={category}>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{category}</div>
                    <div className="space-y-2">
                      {entries.map((item) => (
                        <button key={item.id} onClick={() => submitCatalogItem(item)} className="block w-full rounded-lg border border-gray-800 bg-gray-900/50 p-3 text-left hover:border-cyan-500/40">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-medium text-gray-100">{item.title}</div>
                              <div className="mt-1 text-sm leading-5 text-gray-500">{item.description}</div>
                            </div>
                            <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-gray-500" />
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="My Requests" icon={<Clock className="h-4 w-4" />}>
              <div className="space-y-2">
                {requests.length === 0 && <Empty text="No requests yet." />}
                {requests.map((request) => (
                  <button key={request.id} onClick={() => loadRequest(request.id)} className={`block w-full rounded-lg border p-3 text-left ${selected?.id === request.id ? "border-cyan-500/60 bg-cyan-500/10" : "border-gray-800 bg-gray-900/50 hover:border-gray-700"}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-xs text-cyan-300">{request.number || "REQ pending"}</div>
                        <div className="truncate text-sm font-medium text-gray-100">{request.title}</div>
                      </div>
                      <Pill>{label(request.status)}</Pill>
                    </div>
                    <div className="mt-1 text-xs text-gray-500">{label(request.request_type)} · {when(request.created_at)}</div>
                  </button>
                ))}
              </div>
            </Panel>
          </div>
        </section>

        <aside className="scrollbar-thin min-h-0 overflow-auto border-l border-gray-800 bg-gray-950 p-5 pb-28">
          {!selected ? (
            <div className="space-y-4">
              <Empty text="Select a request to inspect status, timeline, support handoffs, and next actions." />
              <Panel title="Support Channels" icon={<Headphones className="h-4 w-4" />}>
                <div className="space-y-2">
                  {channels.map((channel) => (
                    <button key={channel.id} onClick={() => requestSupport(channel)} className="block w-full rounded-lg border border-gray-800 bg-gray-900/40 p-3 text-left hover:border-cyan-500/40">
                      <div className="flex items-center gap-2 text-sm font-medium text-gray-100">
                        {channel.channel_type === "phone" || channel.channel_type === "callback" ? <PhoneCall className="h-4 w-4 text-cyan-300" /> : <MessageSquare className="h-4 w-4 text-cyan-300" />}
                        {channel.name}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">{channel.description}</div>
                    </button>
                  ))}
                </div>
              </Panel>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="font-mono text-xs text-cyan-300">{selected.number || "REQ pending"}</div>
                <h2 className="mt-1 text-lg font-semibold">{selected.title}</h2>
                <p className="mt-1 text-sm text-gray-500">{label(selected.request_type)} · {label(selected.status)}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <MiniStat label="Priority" value={String(selected.priority)} />
                <MiniStat label="Source" value={label(String(selected.answers?.source || "portal"))} />
              </div>

              <Panel title="Resolution Plan" icon={<Sparkles className="h-4 w-4" />}>
                <p className="text-sm leading-6 text-gray-400">{selected.intent_summary || selected.description || "No AI resolution summary recorded."}</p>
                <button onClick={() => requestSupport(channels[0])} className="mt-3 inline-flex items-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-200 hover:bg-gray-900">
                  <Headphones className="h-4 w-4" />
                  Escalate with Context
                </button>
              </Panel>

              <Panel title="Timeline" icon={<Clock className="h-4 w-4" />}>
                <div className="space-y-3">
                  {(selected.events || []).length === 0 && <Empty text="No request events yet." />}
                  {(selected.events || []).map((event) => (
                    <div key={event.id} className="border-l border-gray-800 pl-3">
                      <div className="text-xs text-gray-500">{when(event.created_at)} · {event.type}</div>
                      <div className="text-sm text-gray-300">{event.message}</div>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Support Handoffs" icon={<PhoneCall className="h-4 w-4" />}>
                <div className="space-y-2">
                  {(selected.handoffs || []).length === 0 && <Empty text="No support handoffs requested." />}
                  {(selected.handoffs || []).map((handoff) => (
                    <div key={handoff.id} className="rounded-md border border-gray-800 bg-gray-900/40 p-3">
                      <div className="text-sm font-medium">{handoff.channel_name || "Support"}</div>
                      <div className="text-xs text-gray-500">{label(handoff.channel_type)} · {label(handoff.status)} · {when(handoff.created_at)}</div>
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
