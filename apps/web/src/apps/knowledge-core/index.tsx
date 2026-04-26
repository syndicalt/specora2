"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ShellAPI } from "@/sdk/types";
import {
  AlertTriangle,
  BookOpen,
  Brain,
  CheckCircle2,
  Clock,
  FileText,
  GitBranch,
  Library,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
} from "lucide-react";

type KnowledgeItem = {
  id: string;
  type: string;
  title: string;
  summary?: string;
  content: string;
  status: string;
  audience: string;
  source: string;
  source_ref?: string;
  service?: string;
  ci_id?: string;
  tags?: string[];
  trust_score?: number;
  health_score?: number;
  ai_confidence?: number;
  reuse_count?: number;
  deflection_count?: number;
  updated_at: string;
  created_at: string;
  links?: Array<{ id: string; target_type: string; target_id: string; relationship: string }>;
  feedback?: Array<{ id: string; outcome: string; helpful?: boolean; comment?: string; created_at: string }>;
  events?: Array<{ id: string; type: string; message: string; actor?: string; created_at: string }>;
};

type Gap = {
  id: string;
  query: string;
  status: string;
  demand_count: number;
  updated_at: string;
};

type Answer = {
  answer: string;
  confidence: number;
  recommendedAction: string;
  citations: Array<{ id: string; title: string; type: string; status: string; healthScore?: number; trustScore?: number }>;
};

type View = "answer" | "library" | "stewardship" | "integrations";

const STATUS_CLASS: Record<string, string> = {
  draft: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  review: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  published: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  retired: "border-gray-700 bg-gray-800 text-gray-400",
};

const TYPE_CLASS: Record<string, string> = {
  runbook: "text-indigo-300",
  known_error: "text-rose-300",
  service_guide: "text-cyan-300",
  policy: "text-amber-200",
  decision: "text-purple-300",
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

export default function KnowledgeCoreApp({ shell }: { shell: ShellAPI }) {
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [selected, setSelected] = useState<KnowledgeItem | null>(null);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("answer");
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
    return fetchJson(`/api/apps/knowledge-core/tools/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }, [fetchJson]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJson("/api/apps/knowledge-core/tools/list_knowledge");
      setItems(Array.isArray(data) ? data : []);
      const queue = await fetchJson("/api/apps/knowledge-core/tools/stewardship_queue");
      setGaps(queue.gaps || []);
    } catch (err: any) {
      shellRef.current.notify(err.message || "Knowledge could not be loaded", "error");
    } finally {
      setLoading(false);
    }
  }, [fetchJson]);

  const loadDetails = useCallback(async (knowledgeId: string) => {
    try {
      const data = await fetchJson(`/api/apps/knowledge-core/tools/get_knowledge_details?knowledgeId=${encodeURIComponent(knowledgeId)}`);
      setSelected(data);
      setItems((prev) => prev.some((i) => i.id === data.id) ? prev.map((i) => i.id === data.id ? { ...i, ...data } : i) : [data, ...prev]);
    } catch (err: any) {
      shellRef.current.notify(err.message || "Knowledge details could not be loaded", "error");
    }
  }, [fetchJson]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    return shellRef.current.onMessage((msg) => {
      if (msg.type === "FOCUS_KNOWLEDGE" && msg.payload?.knowledgeId) loadDetails(msg.payload.knowledgeId);
    });
  }, [loadDetails]);

  useEffect(() => {
    const events = ["knowledge.created", "knowledge.published", "knowledge.gap_detected", "knowledge.feedback_recorded"];
    const unsubs = events.map((event) => shellRef.current.eventBus.subscribe(event, (payload: any) => {
      refresh();
      if (payload?.knowledgeId && selected?.id === payload.knowledgeId) loadDetails(payload.knowledgeId);
    }));
    return () => unsubs.forEach((unsub) => unsub());
  }, [refresh, loadDetails, selected?.id]);

  const published = items.filter((item) => item.status === "published");
  const drafts = items.filter((item) => ["draft", "review"].includes(item.status));
  const unhealthy = items.filter((item) => (item.health_score || 0) < 0.65);
  const filtered = items.filter((item) => filter ? item.type === filter || item.status === filter : true);

  async function askKnowledge() {
    if (!query.trim()) return;
    setBusy("answer");
    try {
      const result = await callTool("answer", { query: query.trim() });
      setAnswer(result);
      if (result.citations?.[0]?.id) await loadDetails(result.citations[0].id);
    } catch (err: any) {
      shell.notify(err.message || "Knowledge answer failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function publish(item: KnowledgeItem) {
    setBusy(`publish:${item.id}`);
    try {
      await callTool("publish_knowledge", { knowledgeId: item.id, status: "published", note: "Published from Knowledge Core" });
      shell.notify("Knowledge published", "success");
      await refresh();
      await loadDetails(item.id);
    } catch (err: any) {
      shell.notify(err.message || "Publish failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function feedback(item: KnowledgeItem, outcome: string, helpful: boolean) {
    try {
      await callTool("record_feedback", { knowledgeId: item.id, outcome, helpful });
      shell.notify("Feedback recorded", "success");
      await loadDetails(item.id);
      await refresh();
    } catch (err: any) {
      shell.notify(err.message || "Feedback failed", "error");
    }
  }

  async function draftGap(gap: Gap) {
    setBusy(`gap:${gap.id}`);
    try {
      const item = await callTool("create_knowledge", {
        title: `Draft: ${gap.query}`,
        summary: `Demand-driven draft from ${gap.demand_count} failed search${gap.demand_count === 1 ? "" : "es"}.`,
        content: `Question\n${gap.query}\n\nEnvironment\nCapture where this applies.\n\nAnswer\nAdd a verified answer.\n\nValidation\nList how to prove the answer is safe and current.`,
        type: "article",
        status: "draft",
        source: "knowledge_gap",
        tags: ["gap", "demand"],
      });
      shell.notify("Draft created from knowledge gap", "success");
      await refresh();
      await loadDetails(item.id);
      setView("library");
    } catch (err: any) {
      shell.notify(err.message || "Draft failed", "error");
    } finally {
      setBusy(null);
    }
  }

  function orchestrateInChat(item?: KnowledgeItem) {
    const prompt = item
      ? `Review knowledge ${item.id}. Check quality, audience fit, stale risk, related operational records, and suggest improvements before publication.`
      : "Review Knowledge Core stewardship. Identify top gaps, stale knowledge, risky runbooks, and what should be drafted or published next.";
    navigator.clipboard?.writeText(prompt).catch(() => undefined);
    shell.notify("Knowledge prompt copied. Open chat with Ctrl+K and paste it.", "info");
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-gray-950 text-gray-100">
      <header className="flex shrink-0 items-center justify-between border-b border-gray-800 px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-500/40 bg-cyan-500/10">
            <Brain className="h-5 w-5 text-cyan-300" />
          </div>
          <div>
            <h1 className="text-base font-semibold">Knowledge Core</h1>
            <p className="text-xs text-gray-500">Governed answers, executable runbooks, operational learning, and knowledge health.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(["answer", "library", "stewardship", "integrations"] as const).map((tab) => (
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
            <Metric icon={<Library className="h-4 w-4" />} label="Published" value={published.length} />
            <Metric icon={<Sparkles className="h-4 w-4" />} label="Drafts" value={drafts.length} />
            <Metric icon={<AlertTriangle className="h-4 w-4" />} label="Low Health" value={unhealthy.length} />
            <Metric icon={<Search className="h-4 w-4" />} label="Open Gaps" value={gaps.length} />
          </div>

          {view === "answer" && (
            <div className="grid gap-4 xl:grid-cols-[1.05fr_.95fr]">
              <Panel title="Answer Hub" icon={<Brain className="h-4 w-4" />}>
                <div className="flex gap-2">
                  <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") askKnowledge(); }} placeholder="Ask about an outage, service, runbook, policy, or known error" className="min-w-0 flex-1 rounded-md border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan-500" />
                  <button onClick={askKnowledge} disabled={busy === "answer"} className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50">Ask</button>
                </div>
                {answer ? (
                  <div className="mt-4 rounded-lg border border-gray-800 bg-gray-900/50 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-semibold">Governed Answer</span>
                      <Pill>{pct(answer.confidence)} confidence</Pill>
                    </div>
                    <p className="text-sm leading-6 text-gray-300">{answer.answer}</p>
                    <p className="mt-3 text-xs text-gray-500">{answer.recommendedAction}</p>
                    <div className="mt-4 space-y-2">
                      {answer.citations.map((citation) => (
                        <button key={citation.id} onClick={() => loadDetails(citation.id)} className="block w-full rounded-md border border-gray-800 bg-gray-950 p-3 text-left hover:bg-gray-900">
                          <div className="text-sm font-medium">{citation.title}</div>
                          <div className="mt-1 text-xs text-gray-500">{label(citation.type)} · {label(citation.status)} · health {pct(citation.healthScore)}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : <Empty text="Ask a question to receive an answer with citations, confidence, and a reuse trail." />}
              </Panel>
              <Panel title="High-Value Knowledge" icon={<ShieldCheck className="h-4 w-4" />}>
                <KnowledgeList items={published.slice(0, 8)} selectedId={selected?.id} onSelect={loadDetails} />
              </Panel>
            </div>
          )}

          {view === "library" && (
            <Panel title="Knowledge Graph Library" icon={<GitBranch className="h-4 w-4" />}>
              <div className="mb-3 flex flex-wrap gap-2">
                {["", "article", "runbook", "known_error", "service_guide", "policy", "draft", "review", "published"].map((option) => (
                  <button key={option || "all"} onClick={() => setFilter(option)} className={`rounded-md border px-3 py-1.5 text-xs capitalize ${filter === option ? "border-gray-500 bg-gray-800 text-white" : "border-gray-800 text-gray-400 hover:bg-gray-900"}`}>
                    {option ? label(option) : "all"}
                  </button>
                ))}
              </div>
              <KnowledgeList items={filtered} selectedId={selected?.id} onSelect={loadDetails} />
            </Panel>
          )}

          {view === "stewardship" && (
            <div className="grid gap-4 xl:grid-cols-2">
              <Panel title="Stewardship Queue" icon={<Clock className="h-4 w-4" />}>
                <KnowledgeList items={[...drafts, ...unhealthy].slice(0, 12)} selectedId={selected?.id} onSelect={loadDetails} empty="No urgent stewardship items." />
              </Panel>
              <Panel title="Demand Gaps" icon={<Search className="h-4 w-4" />}>
                <div className="space-y-2">
                  {gaps.length === 0 && <Empty text="No open knowledge gaps." />}
                  {gaps.map((gap) => (
                    <div key={gap.id} className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
                      <div className="text-sm font-medium">{gap.query}</div>
                      <div className="mt-1 text-xs text-gray-500">{gap.demand_count} demand signal{gap.demand_count === 1 ? "" : "s"} · {when(gap.updated_at)}</div>
                      <button onClick={() => draftGap(gap)} disabled={busy === `gap:${gap.id}`} className="mt-3 rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-900 disabled:opacity-50">Draft Article</button>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          )}

          {view === "integrations" && (
            <div className="grid gap-4 xl:grid-cols-2">
              <Panel title="Entry Points" icon={<TerminalSquare className="h-4 w-4" />}>
                <Endpoint method="POST" path="/api/knowledge/answer" note="Governed answer API for chat, portals, service desks, CI/CD, and agent workflows." />
                <Endpoint method="POST" path="/api/knowledge/items" note="Create articles, runbooks, known errors, decisions, policies, and service guides." />
                <Endpoint method="POST" path="/api/knowledge/drafts/from-record" note="Draft reusable knowledge from incidents, changes, chat, health, discovery, or external work." />
                <Endpoint method="POST" path="/api/knowledge/items/:id/feedback" note="Capture solve, deflection, stale, unsafe, or not-helpful signals." />
              </Panel>
              <Panel title="Exit Points" icon={<MessageSquare className="h-4 w-4" />}>
                <Endpoint method="event" path="knowledge.created" note="Route new knowledge drafts into review, ownership, and notification workflows." />
                <Endpoint method="event" path="knowledge.published" note="Notify chat/search/portal consumers that governed content is available." />
                <Endpoint method="event" path="knowledge.gap_detected" note="Turn failed searches into demand-driven backlog and draft work." />
                <Endpoint method="event" path="knowledge.feedback_recorded" note="Feed reuse, deflection, and quality signals into health scoring." />
              </Panel>
            </div>
          )}
        </section>

        <aside className="min-h-0 overflow-auto border-l border-gray-800 bg-gray-950 p-5 pb-24">
          {!selected ? <Empty text="Select knowledge to inspect trust, health, graph links, feedback, and lifecycle." /> : (
            <div className="space-y-4">
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Pill className={STATUS_CLASS[selected.status]}>{label(selected.status)}</Pill>
                  <span className={`text-xs font-semibold uppercase ${TYPE_CLASS[selected.type] || "text-gray-300"}`}>{label(selected.type)}</span>
                  <span className="text-xs text-gray-500">{selected.audience}</span>
                </div>
                <h2 className="text-lg font-semibold">{selected.title}</h2>
                <p className="mt-1 text-sm text-gray-500">{selected.service || selected.ci_id || "No service mapped"} · {selected.source}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <MiniStat label="Health" value={pct(selected.health_score)} />
                <MiniStat label="Trust" value={pct(selected.trust_score)} />
                <MiniStat label="Reuse" value={String(selected.reuse_count || 0)} />
                <MiniStat label="Deflection" value={String(selected.deflection_count || 0)} />
              </div>

              <Panel title="Knowledge Body" icon={<BookOpen className="h-4 w-4" />}>
                {selected.summary && <p className="mb-3 text-sm font-medium text-gray-200">{selected.summary}</p>}
                <pre className="whitespace-pre-wrap rounded-md border border-gray-800 bg-gray-900/60 p-3 text-sm leading-6 text-gray-300">{selected.content}</pre>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(selected.tags || []).map((tag) => <Pill key={tag}>{tag}</Pill>)}
                </div>
              </Panel>

              <Panel title="Governance Actions" icon={<ShieldCheck className="h-4 w-4" />}>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => publish(selected)} disabled={busy === `publish:${selected.id}` || selected.status === "published"} className="rounded-md border border-emerald-700/60 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-950/30 disabled:opacity-50">Publish</button>
                  <button onClick={() => orchestrateInChat(selected)} className="rounded-md border border-gray-700 px-3 py-2 text-sm hover:bg-gray-900">Chat Review</button>
                  <button onClick={() => feedback(selected, "solved", true)} className="rounded-md border border-gray-700 px-3 py-2 text-sm hover:bg-gray-900">Solved</button>
                  <button onClick={() => feedback(selected, "stale", false)} className="rounded-md border border-amber-700/60 px-3 py-2 text-sm text-amber-200 hover:bg-amber-950/30">Flag Stale</button>
                </div>
              </Panel>

              <Panel title="Graph Links" icon={<GitBranch className="h-4 w-4" />}>
                <div className="space-y-2">
                  {(selected.links || []).length === 0 && <Empty text="No graph links recorded." />}
                  {(selected.links || []).map((link) => (
                    <div key={link.id} className="rounded-md border border-gray-800 bg-gray-900/40 p-3">
                      <div className="text-sm font-medium">{link.target_id}</div>
                      <div className="text-xs text-gray-500">{link.relationship} · {link.target_type}</div>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Feedback" icon={<CheckCircle2 className="h-4 w-4" />}>
                <div className="space-y-2">
                  {(selected.feedback || []).length === 0 && <Empty text="No feedback yet." />}
                  {(selected.feedback || []).map((fb) => (
                    <div key={fb.id} className="rounded-md border border-gray-800 bg-gray-900/40 p-3">
                      <div className="text-sm font-medium">{label(fb.outcome)}</div>
                      <div className="text-xs text-gray-500">{when(fb.created_at)} · {fb.helpful ? "helpful" : "needs work"}</div>
                      {fb.comment && <p className="mt-2 text-sm text-gray-400">{fb.comment}</p>}
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Lifecycle" icon={<FileText className="h-4 w-4" />}>
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

function KnowledgeList({ items, selectedId, onSelect, empty = "No knowledge found." }: {
  items: KnowledgeItem[];
  selectedId?: string;
  onSelect: (id: string) => void;
  empty?: string;
}) {
  if (items.length === 0) return <Empty text={empty} />;
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <button key={item.id} onClick={() => onSelect(item.id)} className={`block w-full rounded-lg border p-3 text-left ${selectedId === item.id ? "border-cyan-500/60 bg-cyan-500/10" : "border-gray-800 bg-gray-900/40 hover:bg-gray-900"}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-gray-100">{item.title}</div>
              <div className="mt-1 text-xs text-gray-500">{label(item.type)} · {item.service || item.ci_id || item.audience} · {when(item.updated_at)}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className={`text-xs font-semibold uppercase ${TYPE_CLASS[item.type] || "text-gray-300"}`}>{pct(item.health_score)}</span>
              <Pill className={STATUS_CLASS[item.status]}>{label(item.status)}</Pill>
            </div>
          </div>
          {item.summary && <p className="mt-2 line-clamp-2 text-xs text-gray-400">{item.summary}</p>}
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
