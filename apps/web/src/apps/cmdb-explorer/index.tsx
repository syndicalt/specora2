"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ShellAPI } from "@/sdk/types";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Box,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Database,
  ExternalLink,
  Filter,
  GitBranch,
  History,
  Layers,
  Link2,
  LocateFixed,
  Network,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Star,
  TableProperties,
  UserRound,
  X,
} from "lucide-react";

type CI = {
  id: string;
  name: string;
  class: string;
  environment?: string | null;
  attributes?: Record<string, unknown>;
  dataQualityScore?: number | null;
  lastDiscoveredAt?: string | null;
  health?: {
    freshness?: number | null;
    completeness?: number | null;
    relationshipValidity?: number | null;
    overall?: number | null;
  } | null;
  relationships?: Relationship[];
};

type Relationship = {
  id?: string;
  type: string;
  target: CI;
  attributes?: Record<string, unknown>;
};

type CIClass = {
  name: string;
  displayName: string;
  attributes: Array<{
    name: string;
    displayName: string;
    isMandatory: boolean;
    isHealthRequired: boolean;
    isKeyAttribute: boolean;
  }>;
};

type AuditLogEntry = {
  id: string;
  action: string;
  actorId?: string | null;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
};

type GraphEdge = {
  id: string;
  type: string;
  sourceId: string;
  targetId: string;
};

type QueueId = "all" | "attention" | "orphaned" | "stale" | "critical";

const PAGE_SIZE = 30;
const RECENT_KEY = "specora_cmdb_recent_cis";
const STARRED_KEY = "specora_cmdb_starred_cis";
const TABLES_LAUNCH_KEY = "specora_tables_launch";

const CI_FIELDS = `
  id
  name
  class
  environment
  attributes
  dataQualityScore
  lastDiscoveredAt
  health { freshness completeness relationshipValidity overall }
`;

const SEARCH_QUERY = `
  query SearchCIs($filter: CIFilterInput, $limit: Int, $offset: Int) {
    cis(filter: $filter, limit: $limit, offset: $offset) { ${CI_FIELDS} }
    ciCount(filter: $filter)
  }
`;

const FILTER_QUERY = `
  query CMDBExplorerFilters {
    ciClasses {
      name
      displayName
      attributes { name displayName isMandatory isHealthRequired isKeyAttribute }
    }
    ciEnvironments
  }
`;

const DETAIL_QUERY = `
  query CIDetail($id: ID!) {
    ci(id: $id) {
      ${CI_FIELDS}
      relationships { id type target { ${CI_FIELDS} } attributes }
    }
    auditLogForCI(ciId: $id, limit: 8) {
      id action actorId createdAt metadata
    }
    neighbors(nodeId: $id, limit: 24) {
      nodes { ${CI_FIELDS} }
      edges { id type sourceId targetId }
    }
  }
`;

function scorePercent(value?: number | null) {
  if (value === undefined || value === null) return null;
  return Math.round(value <= 1 ? value * 100 : value);
}

function scoreColor(score: number | null) {
  if (score === null) return "text-gray-500";
  if (score >= 80) return "text-emerald-300";
  if (score >= 50) return "text-yellow-300";
  return "text-red-300";
}

function scoreBg(score: number | null) {
  if (score === null) return "bg-gray-700";
  if (score >= 80) return "bg-emerald-500";
  if (score >= 50) return "bg-yellow-500";
  return "bg-red-500";
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "-";
  if (Array.isArray(value)) {
    if (value.length === 0) return "-";
    if (value.every((item) => item === null || ["string", "number", "boolean"].includes(typeof item))) {
      return value.map((item) => String(item)).join(", ");
    }
    return `${value.length} item${value.length === 1 ? "" : "s"}`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const healthParts = [
      typeof record.running === "number" ? `${record.running} running` : null,
      typeof record.failed === "number" ? `${record.failed} failed` : null,
      typeof record.total === "number" ? `${record.total} total` : null,
    ].filter(Boolean);
    if (healthParts.length > 0) return healthParts.join(" / ");
    return Object.entries(record)
      .slice(0, 4)
      .map(([key, item]) => `${key}: ${formatValue(item)}`)
      .join(" / ");
  }
  return String(value);
}

function formatDate(value?: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function isStale(ci: CI) {
  if (!ci.lastDiscoveredAt) return true;
  const discovered = new Date(ci.lastDiscoveredAt).getTime();
  if (Number.isNaN(discovered)) return true;
  return Date.now() - discovered > 1000 * 60 * 60 * 24 * 30;
}

function getOwner(ci: CI) {
  const attrs = ci.attributes || {};
  return formatValue(attrs.owner || attrs.ownedBy || attrs.supportGroup || attrs.managedBy);
}

function getCriticality(ci: CI) {
  const attrs = ci.attributes || {};
  return formatValue(attrs.criticality || attrs.businessCriticality || attrs.tier || attrs.serviceTier);
}

function deriveInsights(ci: CI | null, classDef: CIClass | undefined, relationships: Relationship[]) {
  if (!ci) return [];
  const attrs = ci.attributes || {};
  const insights: Array<{ tone: "good" | "warn" | "bad"; title: string; detail: string }> = [];
  const requiredAttrs = classDef?.attributes.filter((attr) => attr.isMandatory) || [];
  const healthAttrs = classDef?.attributes.filter((attr) => attr.isHealthRequired && !attr.isMandatory) || [];
  const missingRequired = requiredAttrs.filter((attr) => {
    const value = attrs[attr.name] ?? (ci as any)[attr.name];
    return value === undefined || value === null || value === "";
  });
  const missingHealth = healthAttrs.filter((attr) => {
    const value = attrs[attr.name] ?? (ci as any)[attr.name];
    return value === undefined || value === null || value === "";
  });
  const overall = scorePercent(ci.health?.overall ?? ci.dataQualityScore);

  if (missingRequired.length > 0) {
    insights.push({
      tone: "bad",
      title: `${missingRequired.length} required fields missing`,
      detail: missingRequired.slice(0, 4).map((attr) => attr.displayName || attr.name).join(", "),
    });
  } else if (missingHealth.length > 0) {
    insights.push({
      tone: "warn",
      title: `${missingHealth.length} health fields missing`,
      detail: missingHealth.slice(0, 4).map((attr) => attr.displayName || attr.name).join(", "),
    });
  } else if (requiredAttrs.length || healthAttrs.length) {
    insights.push({ tone: "good", title: "Class data is populated", detail: `${requiredAttrs.length + healthAttrs.length} required and health fields checked.` });
  }

  if (relationships.length === 0) {
    insights.push({ tone: "bad", title: "No relationships found", detail: "This CI is isolated from the graph and may not support impact analysis." });
  } else {
    insights.push({ tone: "good", title: "Relationship context available", detail: `${relationships.length} direct relationships found.` });
  }

  if (isStale(ci)) {
    insights.push({ tone: "warn", title: "Discovery freshness needs review", detail: "This CI has no recent discovery timestamp." });
  }

  if (overall !== null && overall < 60) {
    insights.push({ tone: "bad", title: "Low health score", detail: `Overall health is ${overall}%. Prioritize remediation before relying on this CI.` });
  }

  return insights.slice(0, 5);
}

function loadStoredIds(key: string) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function saveStoredIds(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids.slice(0, 20)));
  } catch {
    /* ignore local storage failures */
  }
}

export default function CMDBExplorerApp({ shell }: { shell: ShellAPI }) {
  const [cis, setCis] = useState<CI[]>([]);
  const [selectedCi, setSelectedCi] = useState<CI | null>(null);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [graphNodes, setGraphNodes] = useState<CI[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [classes, setClasses] = useState<CIClass[]>([]);
  const [environments, setEnvironments] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [envFilter, setEnvFilter] = useState("");
  const [queue, setQueue] = useState<QueueId>("all");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectionMode, setSelectionMode] = useState<{ context: string; callbackChannel: string } | null>(null);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [starredIds, setStarredIds] = useState<string[]>([]);
  const searchDebounce = useRef<ReturnType<typeof setTimeout>>();
  const lastSearchKeyRef = useRef<string | null>(null);
  const lastDetailKeyRef = useRef<string | null>(null);

  const classMap = useMemo(() => {
    const next: Record<string, CIClass> = {};
    for (const cls of classes) next[cls.name] = cls;
    return next;
  }, [classes]);

  const classDisplayNames = useMemo(() => {
    const next: Record<string, string> = {};
    for (const cls of classes) next[cls.name] = cls.displayName || cls.name;
    return next;
  }, [classes]);

  const selectedClass = selectedCi ? classMap[selectedCi.class] : undefined;
  const selectedScore = scorePercent(selectedCi?.health?.overall ?? selectedCi?.dataQualityScore);
  const insights = deriveInsights(selectedCi, selectedClass, relationships);

  const queueFilteredCis = useMemo(() => {
    return cis.filter((ci) => {
      const health = scorePercent(ci.health?.overall ?? ci.dataQualityScore);
      if (queue === "attention") return (health !== null && health < 70) || isStale(ci);
      if (queue === "orphaned") return scorePercent(ci.health?.relationshipValidity) !== null && scorePercent(ci.health?.relationshipValidity)! < 80;
      if (queue === "stale") return isStale(ci);
      if (queue === "critical") return /critical|tier 1|tier1|high/i.test(getCriticality(ci));
      return true;
    });
  }, [cis, queue]);

  const resultStats = useMemo(() => {
    const scores = cis.map((ci) => scorePercent(ci.health?.overall ?? ci.dataQualityScore)).filter((score): score is number => score !== null);
    const avg = scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null;
    const attention = cis.filter((ci) => {
      const score = scorePercent(ci.health?.overall ?? ci.dataQualityScore);
      return (score !== null && score < 70) || isStale(ci);
    }).length;
    const orphaned = cis.filter((ci) => {
      const relationshipScore = scorePercent(ci.health?.relationshipValidity);
      return relationshipScore !== null && relationshipScore < 80;
    }).length;
    const stale = cis.filter(isStale).length;
    const critical = cis.filter((ci) => /critical|tier 1|tier1|high/i.test(getCriticality(ci))).length;
    return {
      avg,
      attention,
      orphaned,
      stale,
      critical,
    };
  }, [cis]);

  const fetchFilters = useCallback(async () => {
    try {
      const data = await shell.query(FILTER_QUERY);
      setClasses((data.ciClasses || []) as CIClass[]);
      setEnvironments((data.ciEnvironments || []) as string[]);
    } catch (err: any) {
      shell.notify(err.message || "Failed to load CMDB filters", "error");
    }
  }, [shell]);

  const fetchData = useCallback(async () => {
    const requestKey = JSON.stringify({ classFilter, envFilter, offset, search: search.trim() });
    if (lastSearchKeyRef.current === requestKey) return;
    lastSearchKeyRef.current = requestKey;
    setLoading(true);
    try {
      const filter: Record<string, string> = {};
      if (classFilter) filter.class = classFilter;
      if (envFilter) filter.environment = envFilter;
      if (search.trim()) filter.name = search.trim();
      const data = await shell.query(SEARCH_QUERY, { filter, limit: PAGE_SIZE, offset });
      const nextCis = (data.cis || []) as CI[];
      setCis(nextCis);
      setTotal(data.ciCount || 0);
      setSelectedCi((current) => current || nextCis[0] || null);
    } catch (err: any) {
      shell.notify(err.message || "Failed to load configuration items", "error");
    } finally {
      setLoading(false);
    }
  }, [classFilter, envFilter, offset, search, shell]);

  const fetchDetail = useCallback(async (id: string) => {
    if (lastDetailKeyRef.current === id) return;
    lastDetailKeyRef.current = id;
    setDetailLoading(true);
    try {
      const data = await shell.query(DETAIL_QUERY, { id });
      const ci = data.ci as CI | null;
      if (!ci) return;
      setSelectedCi(ci);
      setRelationships((ci.relationships || []) as Relationship[]);
      setAuditLog((data.auditLogForCI || []) as AuditLogEntry[]);
      setGraphNodes((data.neighbors?.nodes || []) as CI[]);
      setGraphEdges((data.neighbors?.edges || []) as GraphEdge[]);
    } catch (err: any) {
      shell.notify(err.message || "Failed to load CI details", "error");
    } finally {
      setDetailLoading(false);
    }
  }, [shell]);

  useEffect(() => {
    setRecentIds(loadStoredIds(RECENT_KEY));
    setStarredIds(loadStoredIds(STARRED_KEY));
    fetchFilters();
  }, [fetchFilters]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      setOffset(0);
    }, 250);
    return () => clearTimeout(searchDebounce.current);
  }, [search]);

  useEffect(() => {
    setOffset(0);
  }, [classFilter, envFilter, queue]);

  useEffect(() => {
    if (!selectedCi?.id) return;
    fetchDetail(selectedCi.id);
    setRecentIds((prev) => {
      const next = [selectedCi.id, ...prev.filter((id) => id !== selectedCi.id)];
      saveStoredIds(RECENT_KEY, next);
      return next.slice(0, 20);
    });
  }, [selectedCi?.id, fetchDetail]);

  useEffect(() => {
    const unsubCreated = shell.eventBus.subscribe("ci.created", () => fetchData());
    const unsubUpdated = shell.eventBus.subscribe("ci.updated", () => fetchData());
    const unsubDeleted = shell.eventBus.subscribe("ci.deleted", () => fetchData());
    return () => {
      unsubCreated();
      unsubUpdated();
      unsubDeleted();
    };
  }, [shell, fetchData]);

  useEffect(() => {
    return shell.onMessage((msg) => {
      if (msg.type === "FOCUS_CI") {
        const id = msg.payload?.id;
        if (id) fetchDetail(id);
      }
      if (msg.type === "SET_CMDB_VIEW") {
        const payload = msg.payload || {};
        if (typeof payload.query === "string") setSearch(payload.query);
        if (typeof payload.classFilter === "string") setClassFilter(payload.classFilter);
        if (typeof payload.envFilter === "string") setEnvFilter(payload.envFilter);
        if (["all", "attention", "orphaned", "stale", "critical"].includes(payload.queue)) {
          setQueue(payload.queue);
        }
        if (payload.focusCiId) fetchDetail(payload.focusCiId);
      }
      if (msg.type === "START_CI_SELECTION") {
        setSelectionMode({
          context: msg.payload?.context || "default",
          callbackChannel: msg.payload?.callbackChannel || "chat",
        });
      }
    });
  }, [shell, fetchDetail]);

  function selectCI(ci: CI) {
    setSelectedCi(ci);
  }

  function handleSelectCI(ci: CI) {
    if (!selectionMode) return;
    shell.messageBus.publish({
      type: "CI_SELECTED",
      from: "cmdb-explorer",
      to: selectionMode.callbackChannel,
      payload: { ci: { id: ci.id, name: ci.name, class: ci.class }, context: selectionMode.context },
    });
    setSelectionMode(null);
  }

  function toggleStar(id: string) {
    setStarredIds((prev) => {
      const next = prev.includes(id) ? prev.filter((item) => item !== id) : [id, ...prev];
      saveStoredIds(STARRED_KEY, next);
      return next;
    });
  }

  function viewInMap(id: string) {
    shell.dispatch({ type: "OPEN_APP", id: "service-map", installKey: "service-map", mode: "canvas", permissions: ["read:cmdb", "read:relationships"] });
    setTimeout(() => {
      shell.messageBus.publish({ type: "SET_ROOT_CI", from: "cmdb-explorer", to: "service-map", payload: { rootId: id } });
    }, 300);
  }

  function openInTables(ci: CI) {
    const launchPayload = { type: "OPEN_TABLE_RECORD", tableId: `cmdb.${ci.class}`, recordId: ci.id, mode: "edit" };
    try {
      sessionStorage.setItem(TABLES_LAUNCH_KEY, JSON.stringify({ ...launchPayload, createdAt: Date.now() }));
    } catch {
      /* ignore session storage failures */
    }
    shell.dispatch({
      type: "OPEN_APP",
      id: "tables",
      installKey: "builtin_tables",
      mode: "canvas",
      permissions: ["tables:read", "tables:write"],
      launchPayload,
    });
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="flex h-full w-full overflow-hidden bg-gray-950 text-gray-100">
      <aside className="flex w-[360px] shrink-0 flex-col border-r border-gray-800 bg-gray-950">
        <div className="border-b border-gray-800 px-4 py-4">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-indigo-300" />
            <h1 className="text-base font-semibold">CMDB Explorer</h1>
            <span className="ml-auto rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-[10px] uppercase tracking-wider text-indigo-200">
              Investigate
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">Find CIs, inspect operational context, and follow the graph.</p>
        </div>

        {selectionMode && (
          <div className="border-b border-indigo-500/30 bg-indigo-950/40 px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-indigo-200">
              <LocateFixed className="h-4 w-4" />
              Select a CI for {selectionMode.context}
            </div>
            <button onClick={() => setSelectionMode(null)} className="mt-2 text-xs text-indigo-300 hover:text-indigo-100">
              Cancel selection
            </button>
          </div>
        )}

        <div className="space-y-3 border-b border-gray-800 p-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, asset, host..."
              className="w-full rounded-lg border border-gray-700 bg-gray-900 py-2.5 pl-9 pr-8 text-sm text-gray-100 outline-none transition-colors focus:border-indigo-500"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-500 hover:text-gray-200">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <select
              value={classFilter}
              onChange={(event) => setClassFilter(event.target.value)}
              className="min-w-0 rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-2 text-sm text-gray-300 outline-none focus:border-indigo-500"
            >
              <option value="">All classes</option>
              {classes.map((cls) => (
                <option key={cls.name} value={cls.name}>{cls.displayName || cls.name}</option>
              ))}
            </select>
            <select
              value={envFilter}
              onChange={(event) => setEnvFilter(event.target.value)}
              className="min-w-0 rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-2 text-sm text-gray-300 outline-none focus:border-indigo-500"
            >
              <option value="">All envs</option>
              {environments.map((env) => (
                <option key={env} value={env}>{env}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-5 gap-2">
            <QueueButton id="all" active={queue} onClick={setQueue} label="All" count={total} />
            <QueueButton id="attention" active={queue} onClick={setQueue} label="Risk" count={resultStats.attention} />
            <QueueButton id="orphaned" active={queue} onClick={setQueue} label="Orphan" count={resultStats.orphaned} />
            <QueueButton id="stale" active={queue} onClick={setQueue} label="Stale" count={resultStats.stale} />
            <QueueButton id="critical" active={queue} onClick={setQueue} label="Critical" count={resultStats.critical} />
          </div>
        </div>

        <div className="flex items-center gap-2 border-b border-gray-800 px-3 py-2 text-xs text-gray-500">
          <Filter className="h-3.5 w-3.5" />
          <span>{queueFilteredCis.length} shown on this page</span>
          <span className="ml-auto">Avg health: {resultStats.avg ?? "-"}%</span>
          <button onClick={fetchData} className="rounded p-1 text-gray-500 hover:text-white" title="Refresh">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2">
          {loading && cis.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-gray-500">Loading configuration items...</div>
          ) : queueFilteredCis.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-gray-500">No CIs match this view.</div>
          ) : (
            <div className="space-y-1.5">
              {queueFilteredCis.map((ci) => (
                <ResultCard
                  key={ci.id}
                  ci={ci}
                  selected={selectedCi?.id === ci.id}
                  classNameText={classDisplayNames[ci.class] || ci.class}
                  starred={starredIds.includes(ci.id)}
                  recent={recentIds.includes(ci.id)}
                  selectionMode={!!selectionMode}
                  onSelect={() => selectCI(ci)}
                  onChoose={() => handleSelectCI(ci)}
                  onStar={() => toggleStar(ci.id)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-gray-800 px-3 py-2 text-xs text-gray-500">
          <span>{total > 0 ? `${offset + 1}-${Math.min(offset + PAGE_SIZE, total)} of ${total}` : "0 results"}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
              disabled={offset === 0}
              className="rounded p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[54px] text-center">Page {currentPage}/{Math.max(1, totalPages)}</span>
            <button
              onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= total}
              className="rounded p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <main className="scrollbar-thin min-w-0 flex-1 overflow-y-auto">
        {selectedCi ? (
          <div className="mx-auto flex max-w-7xl flex-col gap-4 p-5 pb-28">
            <section className="rounded-lg border border-gray-800 bg-gray-900/50">
              <div className="flex items-start gap-4 border-b border-gray-800 p-5">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-200">
                  <Box className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-xl font-semibold">{selectedCi.name}</h2>
                    <button onClick={() => toggleStar(selectedCi.id)} className="rounded p-1 text-gray-500 hover:text-yellow-300">
                      <Star className={`h-4 w-4 ${starredIds.includes(selectedCi.id) ? "fill-yellow-300 text-yellow-300" : ""}`} />
                    </button>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <span className="rounded-md bg-gray-800 px-2 py-1">{classDisplayNames[selectedCi.class] || selectedCi.class}</span>
                    <span className="rounded-md bg-gray-800 px-2 py-1">{selectedCi.environment || "No environment"}</span>
                    <span className="font-mono">{selectedCi.id}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <ActionButton icon={Network} label="Service Map" onClick={() => viewInMap(selectedCi.id)} />
                  <ActionButton icon={TableProperties} label="Edit in Tables" onClick={() => openInTables(selectedCi)} />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3 p-4">
                <Metric label="Overall Health" value={selectedScore === null ? "-" : `${selectedScore}%`} tone={scoreColor(selectedScore)} icon={Activity} />
                <Metric label="Relationships" value={String(relationships.length)} tone={relationships.length > 0 ? "text-emerald-300" : "text-red-300"} icon={GitBranch} />
                <Metric label="Owner / Group" value={getOwner(selectedCi)} tone="text-gray-200" icon={UserRound} />
                <Metric label="Criticality" value={getCriticality(selectedCi)} tone="text-gray-200" icon={ShieldAlert} />
              </div>
            </section>

            <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-4">
              <section className="space-y-4">
                <Panel title="Investigation Summary" icon={Sparkles}>
                  <div className="grid gap-2">
                    {insights.length === 0 ? (
                      <div className="text-sm text-gray-500">No major findings for this CI.</div>
                    ) : insights.map((insight) => (
                      <InsightRow key={insight.title} insight={insight} />
                    ))}
                  </div>
                </Panel>

                <Panel title="Relationship Intelligence" icon={Network} loading={detailLoading}>
                  <div className="grid gap-3 lg:grid-cols-2">
                    <RelationshipList relationships={relationships} classDisplayNames={classDisplayNames} onSelect={fetchDetail} />
                    <MiniGraph rootId={selectedCi.id} nodes={graphNodes} edges={graphEdges} classDisplayNames={classDisplayNames} onSelect={fetchDetail} />
                  </div>
                </Panel>

                <Panel title="Attributes" icon={Layers}>
                  <AttributeGrid ci={selectedCi} classDef={selectedClass} />
                </Panel>
              </section>

              <aside className="space-y-4">
                <Panel title="Quality Signals" icon={CheckCircle2}>
                  <HealthBars ci={selectedCi} />
                </Panel>
                <Panel title="Activity Timeline" icon={History}>
                  <Timeline auditLog={auditLog} lastDiscoveredAt={selectedCi.lastDiscoveredAt} />
                </Panel>
                <Panel title="Quick Actions" icon={ExternalLink}>
                  <div className="grid gap-2">
                    <button onClick={() => viewInMap(selectedCi.id)} className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-300 hover:border-indigo-500/50 hover:text-white">
                      Open topology <ArrowRight className="h-4 w-4" />
                    </button>
                    <button onClick={() => openInTables(selectedCi)} className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-300 hover:border-indigo-500/50 hover:text-white">
                      Edit in Tables <ArrowRight className="h-4 w-4" />
                    </button>
                    <button onClick={() => fetchDetail(selectedCi.id)} className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-300 hover:border-indigo-500/50 hover:text-white">
                      Refresh context <RefreshCw className="h-4 w-4" />
                    </button>
                  </div>
                </Panel>
              </aside>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-gray-500">
            Select a configuration item to begin investigation.
          </div>
        )}
      </main>
    </div>
  );
}

function QueueButton({ id, active, onClick, label, count }: { id: QueueId; active: QueueId; onClick: (id: QueueId) => void; label: string; count: number }) {
  return (
    <button
      onClick={() => onClick(id)}
      className={`rounded-lg border px-2 py-2 text-left transition-colors ${
        active === id ? "border-indigo-500/50 bg-indigo-500/15 text-indigo-100" : "border-gray-800 bg-gray-900 text-gray-400 hover:text-gray-200"
      }`}
    >
      <div className="text-[10px] uppercase tracking-wider">{label}</div>
      <div className="mt-1 text-sm font-semibold">{count}</div>
    </button>
  );
}

function ResultCard({
  ci,
  selected,
  classNameText,
  starred,
  recent,
  selectionMode,
  onSelect,
  onChoose,
  onStar,
}: {
  ci: CI;
  selected: boolean;
  classNameText: string;
  starred: boolean;
  recent: boolean;
  selectionMode: boolean;
  onSelect: () => void;
  onChoose: () => void;
  onStar: () => void;
}) {
  const score = scorePercent(ci.health?.overall ?? ci.dataQualityScore);
  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${
        selected ? "border-indigo-500/60 bg-indigo-500/15" : "border-transparent bg-gray-900/50 hover:border-gray-800 hover:bg-gray-900"
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-800 text-gray-400">
          <Box className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-gray-200">{ci.name}</span>
            {recent && <Clock3 className="h-3 w-3 shrink-0 text-gray-600" />}
          </div>
          <div className="mt-1 truncate text-xs text-gray-500">{classNameText} / {ci.environment || "No environment"}</div>
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onStar();
          }}
          className="rounded p-1 text-gray-600 hover:text-yellow-300"
        >
          <Star className={`h-3.5 w-3.5 ${starred ? "fill-yellow-300 text-yellow-300" : ""}`} />
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded bg-gray-800">
          <div className={`h-full ${scoreBg(score)}`} style={{ width: `${score ?? 0}%` }} />
        </div>
        <span className={`w-9 text-right text-xs font-medium ${scoreColor(score)}`}>{score === null ? "-" : `${score}%`}</span>
        {selectionMode && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onChoose();
            }}
            className="rounded-md bg-indigo-600 px-2 py-1 text-xs text-white hover:bg-indigo-500"
          >
            Select
          </button>
        )}
      </div>
    </button>
  );
}

function ActionButton({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-300 hover:border-indigo-500/50 hover:text-white">
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function Metric({ label, value, tone, icon: Icon }: { label: string; value: string; tone: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950 px-4 py-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-gray-500">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className={`mt-2 truncate text-lg font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function Panel({ title, icon: Icon, loading, children }: { title: string; icon: React.ComponentType<{ className?: string }>; loading?: boolean; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900/50">
      <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-3">
        <Icon className="h-4 w-4 text-indigo-300" />
        <h3 className="text-sm font-semibold">{title}</h3>
        {loading && <RefreshCw className="ml-auto h-3.5 w-3.5 animate-spin text-gray-500" />}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function InsightRow({ insight }: { insight: { tone: "good" | "warn" | "bad"; title: string; detail: string } }) {
  const tone = insight.tone === "good"
    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
    : insight.tone === "warn"
      ? "border-yellow-500/20 bg-yellow-500/10 text-yellow-200"
      : "border-red-500/20 bg-red-500/10 text-red-200";
  const Icon = insight.tone === "good" ? CheckCircle2 : insight.tone === "warn" ? AlertTriangle : ShieldAlert;
  return (
    <div className={`flex gap-3 rounded-lg border px-3 py-2.5 ${tone}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <div className="text-sm font-medium">{insight.title}</div>
        <div className="mt-0.5 text-xs opacity-80">{insight.detail}</div>
      </div>
    </div>
  );
}

function RelationshipList({ relationships, classDisplayNames, onSelect }: { relationships: Relationship[]; classDisplayNames: Record<string, string>; onSelect: (id: string) => void }) {
  if (relationships.length === 0) {
    return <div className="rounded-lg border border-dashed border-gray-800 px-4 py-8 text-center text-sm text-gray-500">No direct relationships found.</div>;
  }
  return (
    <div className="scrollbar-thin max-h-80 overflow-y-auto rounded-lg border border-gray-800">
      {relationships.slice(0, 14).map((rel, index) => (
        <button key={`${rel.target.id}-${rel.type}-${index}`} onClick={() => onSelect(rel.target.id)} className="flex w-full items-center gap-3 border-b border-gray-800 px-3 py-2.5 text-left last:border-b-0 hover:bg-gray-800/50">
          <Link2 className="h-4 w-4 shrink-0 text-indigo-300" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-gray-200">{rel.target.name}</div>
            <div className="mt-0.5 truncate text-xs text-gray-500">{classDisplayNames[rel.target.class] || rel.target.class}</div>
          </div>
          <span className="rounded-md bg-gray-800 px-2 py-1 text-[10px] uppercase tracking-wider text-gray-400">{rel.type}</span>
        </button>
      ))}
    </div>
  );
}

function MiniGraph({ rootId, nodes, edges, classDisplayNames, onSelect }: { rootId: string; nodes: CI[]; edges: GraphEdge[]; classDisplayNames: Record<string, string>; onSelect: (id: string) => void }) {
  const visible = nodes.slice(0, 10);
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
      <div className="mb-3 flex items-center justify-between text-xs text-gray-500">
        <span>Neighborhood</span>
        <span>{nodes.length} nodes / {edges.length} edges</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {visible.map((node) => {
          const root = node.id === rootId;
          return (
            <button
              key={node.id}
              onClick={() => onSelect(node.id)}
              className={`rounded-lg border px-3 py-2 text-left ${root ? "border-indigo-500/60 bg-indigo-500/15" : "border-gray-800 bg-gray-900 hover:border-gray-700"}`}
            >
              <div className="truncate text-sm font-medium text-gray-200">{node.name}</div>
              <div className="mt-1 truncate text-xs text-gray-500">{classDisplayNames[node.class] || node.class}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AttributeGrid({ ci, classDef }: { ci: CI; classDef?: CIClass }) {
  const attrs = ci.attributes || {};
  const classAttrs = classDef?.attributes || [];
  const classKeys = new Set(classAttrs.map((attr) => attr.name));
  const extra = Object.keys(attrs).filter((key) => !classKeys.has(key));
  const rows = [
    ...classAttrs.map((attr) => ({ key: attr.name, label: attr.displayName || attr.name, required: attr.isMandatory, health: attr.isHealthRequired && !attr.isMandatory, value: attrs[attr.name] ?? (ci as any)[attr.name] })),
    ...extra.map((key) => ({ key, label: key, required: false, health: false, value: attrs[key] })),
  ];

  if (rows.length === 0) return <div className="text-sm text-gray-500">No attributes are available for this CI.</div>;

  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {rows.map((row) => {
        const missing = (row.required || row.health) && (row.value === undefined || row.value === null || row.value === "");
        return (
          <div key={row.key} className={`rounded-lg border px-3 py-2 ${missing ? "border-red-500/20 bg-red-500/5" : "border-gray-800 bg-gray-950"}`}>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="truncate">{row.label}</span>
              {row.required && <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] uppercase">Required</span>}
              {row.health && <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] uppercase">Health</span>}
            </div>
            <div className={`mt-1 truncate text-sm ${missing ? "text-red-300" : "text-gray-200"}`}>{formatValue(row.value)}</div>
          </div>
        );
      })}
    </div>
  );
}

function HealthBars({ ci }: { ci: CI }) {
  const rows = [
    { label: "Freshness", value: scorePercent(ci.health?.freshness) },
    { label: "Completeness", value: scorePercent(ci.health?.completeness) },
    { label: "Relationships", value: scorePercent(ci.health?.relationshipValidity) },
    { label: "Overall", value: scorePercent(ci.health?.overall ?? ci.dataQualityScore) },
  ];
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-gray-500">{row.label}</span>
            <span className={scoreColor(row.value)}>{row.value === null ? "-" : `${row.value}%`}</span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-gray-800">
            <div className={`h-full ${scoreBg(row.value)}`} style={{ width: `${row.value ?? 0}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Timeline({ auditLog, lastDiscoveredAt }: { auditLog: AuditLogEntry[]; lastDiscoveredAt?: string | null }) {
  const rows = [
    ...(lastDiscoveredAt ? [{ id: "discovered", action: "Discovered", createdAt: lastDiscoveredAt }] : []),
    ...auditLog,
  ];
  if (rows.length === 0) return <div className="text-sm text-gray-500">No recent activity found.</div>;
  return (
    <div className="space-y-3">
      {rows.slice(0, 8).map((entry) => (
        <div key={entry.id} className="flex gap-3">
          <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-indigo-400" />
          <div className="min-w-0">
            <div className="truncate text-sm text-gray-200">{entry.action}</div>
            <div className="text-xs text-gray-500">{formatDate(entry.createdAt)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
