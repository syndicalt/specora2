"use client";

import { useEffect, useMemo, useState } from "react";
import type { ShellAPI } from "@/sdk/types";
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Database,
  Gauge,
  HeartPulse,
  ListChecks,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TableProperties,
  Wrench,
} from "lucide-react";

type Health = {
  freshness?: number | null;
  completeness?: number | null;
  relationshipValidity?: number | null;
  overall?: number | null;
};

type CI = {
  id: string;
  name: string;
  class: string;
  environment?: string | null;
  dataQualityScore?: number | null;
  lastDiscoveredAt?: string | null;
  attributes?: Record<string, unknown>;
  health?: Health | null;
};

type SuggestedFix = {
  type: string;
  description: string;
  sourceId: string;
  targetId?: string;
  relType: string;
};

type RuleViolation = {
  ruleId: string;
  ruleName: string;
  severity: "critical" | "warning" | "info" | string;
  message: string;
  ciId: string;
  ciName: string;
  ciClass: string;
  suggestedFix?: SuggestedFix;
};

type RuleDefinition = {
  id: string;
  name: string;
  description: string;
  severity: "critical" | "warning" | "info" | string;
};

type GeneratedRule = {
  name: string;
  cypher: string;
  explanation: string;
};

type Finding = {
  id: string;
  ciId: string;
  ciName: string;
  ciClass: string;
  environment?: string | null;
  type: "low-health" | "freshness" | "completeness" | "relationships" | "rule";
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  score?: number | null;
  ruleId?: string;
  suggestedFix?: SuggestedFix;
};

type View = "overview" | "findings" | "rules" | "remediation";

const TABLES_LAUNCH_KEY = "specora_tables_launch";

const HEALTH_QUERY = `
  query HealthMonitorPortfolio($limit: Int) {
    cis(limit: $limit) {
      id
      name
      class
      environment
      dataQualityScore
      lastDiscoveredAt
      attributes
      health { freshness completeness relationshipValidity overall }
    }
  }
`;

function percent(value?: number | null) {
  if (value === undefined || value === null) return null;
  return Math.round(value <= 1 ? value * 100 : value);
}

function severityForScore(score: number | null): "critical" | "warning" | "info" {
  if (score === null) return "warning";
  if (score < 50) return "critical";
  if (score < 75) return "warning";
  return "info";
}

function severityClass(severity: string) {
  if (severity === "critical") return "border-red-500/30 bg-red-500/10 text-red-200";
  if (severity === "warning") return "border-yellow-500/30 bg-yellow-500/10 text-yellow-200";
  return "border-blue-500/30 bg-blue-500/10 text-blue-200";
}

function scoreClass(score: number | null) {
  if (score === null) return "text-gray-500";
  if (score >= 80) return "text-emerald-300";
  if (score >= 60) return "text-yellow-300";
  return "text-red-300";
}

function isStale(ci: CI) {
  if (!ci.lastDiscoveredAt) return true;
  const discovered = new Date(ci.lastDiscoveredAt).getTime();
  if (Number.isNaN(discovered)) return true;
  return Date.now() - discovered > 1000 * 60 * 60 * 24 * 30;
}

function ageLabel(value?: string | null) {
  if (!value) return "never discovered";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "unknown";
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function deriveFindings(cis: CI[], violations: RuleViolation[]): Finding[] {
  const healthFindings = cis.flatMap((ci) => {
    const overall = percent(ci.health?.overall ?? ci.dataQualityScore);
    const freshness = percent(ci.health?.freshness);
    const completeness = percent(ci.health?.completeness);
    const relationships = percent(ci.health?.relationshipValidity);
    const rows: Finding[] = [];

    if (overall !== null && overall < 70) {
      rows.push({
        id: `low-health:${ci.id}`,
        ciId: ci.id,
        ciName: ci.name,
        ciClass: ci.class,
        environment: ci.environment,
        type: "low-health",
        severity: severityForScore(overall),
        title: "Low CI health",
        detail: `Overall health is ${overall}%.`,
        score: overall,
      });
    }
    if (isStale(ci) || (freshness !== null && freshness < 60)) {
      rows.push({
        id: `freshness:${ci.id}`,
        ciId: ci.id,
        ciName: ci.name,
        ciClass: ci.class,
        environment: ci.environment,
        type: "freshness",
        severity: freshness === null || freshness < 40 ? "critical" : "warning",
        title: "Discovery freshness risk",
        detail: `Last discovery: ${ageLabel(ci.lastDiscoveredAt)}.`,
        score: freshness,
      });
    }
    if (completeness !== null && completeness < 80) {
      rows.push({
        id: `completeness:${ci.id}`,
        ciId: ci.id,
        ciName: ci.name,
        ciClass: ci.class,
        environment: ci.environment,
        type: "completeness",
        severity: severityForScore(completeness),
        title: "Required data incomplete",
        detail: `Health-required attribute completeness is ${completeness}%.`,
        score: completeness,
      });
    }
    if (relationships !== null && relationships < 80) {
      rows.push({
        id: `relationships:${ci.id}`,
        ciId: ci.id,
        ciName: ci.name,
        ciClass: ci.class,
        environment: ci.environment,
        type: "relationships",
        severity: severityForScore(relationships),
        title: "Relationship coverage risk",
        detail: `Relationship validity is ${relationships}%.`,
        score: relationships,
      });
    }
    return rows;
  });

  const ruleFindings = violations.map((v, index): Finding => ({
    id: `rule:${v.ruleId}:${v.ciId}:${index}`,
    ciId: v.ciId,
    ciName: v.ciName,
    ciClass: v.ciClass,
    type: "rule",
    severity: v.severity === "critical" || v.severity === "warning" ? v.severity : "info",
    title: v.ruleName,
    detail: v.message,
    ruleId: v.ruleId,
    suggestedFix: v.suggestedFix,
  }));

  return [...healthFindings, ...ruleFindings].sort((a, b) => {
    const rank = { critical: 0, warning: 1, info: 2 };
    return rank[a.severity] - rank[b.severity];
  });
}

export default function HealthMonitorApp({ shell }: { shell: ShellAPI }) {
  const [view, setView] = useState<View>("overview");
  const [cis, setCis] = useState<CI[]>([]);
  const [violations, setViolations] = useState<RuleViolation[]>([]);
  const [rules, setRules] = useState<RuleDefinition[]>([]);
  const [generatedRules, setGeneratedRules] = useState<GeneratedRule[]>([]);
  const [generatedResults, setGeneratedResults] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState<"all" | "critical" | "warning" | "info">("all");

  const findings = useMemo(() => deriveFindings(cis, violations), [cis, violations]);
  const filteredFindings = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return findings.filter((finding) => {
      if (severityFilter !== "all" && finding.severity !== severityFilter) return false;
      if (!normalized) return true;
      return [finding.ciName, finding.ciId, finding.ciClass, finding.title, finding.detail, finding.ruleId || ""]
        .some((value) => value.toLowerCase().includes(normalized));
    });
  }, [findings, query, severityFilter]);

  const summary = useMemo(() => {
    const scores = cis.map((ci) => percent(ci.health?.overall ?? ci.dataQualityScore)).filter((score): score is number => score !== null);
    const avg = scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null;
    const critical = findings.filter((finding) => finding.severity === "critical").length;
    const warning = findings.filter((finding) => finding.severity === "warning").length;
    const fixable = findings.filter((finding) => finding.suggestedFix).length;
    const stale = cis.filter(isStale).length;
    const classes = new Set(cis.map((ci) => ci.class));
    return { avg, critical, warning, fixable, stale, classes: classes.size, total: cis.length };
  }, [cis, findings]);

  async function refresh() {
    setLoading(true);
    try {
      const [healthData, rulesRes, violationsRes, remediationRes] = await Promise.all([
        shell.query(HEALTH_QUERY, { limit: 500 }),
        shell.fetch("/api/health/rules/definitions"),
        shell.fetch("/api/health/rules"),
        shell.fetch("/api/apps/health-monitor/tools/get_remediation_suggestions"),
      ]);
      const ruleDefs = rulesRes.ok ? await rulesRes.json() : [];
      const violationData = violationsRes.ok ? await violationsRes.json() : { violations: [] };
      const remediationData = remediationRes.ok ? await remediationRes.json() : [];
      const fixableByKey = new Map<string, RuleViolation>();
      for (const item of Array.isArray(remediationData) ? remediationData : []) {
        fixableByKey.set(`${item.ruleId}:${item.ciId}`, item);
      }
      const mergedViolations = (violationData.violations || []).map((item: RuleViolation) => ({
        ...item,
        suggestedFix: item.suggestedFix || fixableByKey.get(`${item.ruleId}:${item.ciId}`)?.suggestedFix,
      }));
      setCis((healthData.cis || []) as CI[]);
      setRules(ruleDefs);
      setViolations(mergedViolations);
    } catch (err: any) {
      shell.notify(err.message || "Failed to load health monitor data", "error");
    } finally {
      setLoading(false);
    }
  }

  async function generateRules() {
    setAiLoading(true);
    try {
      const res = await shell.fetch("/api/health/rules/generate", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate rules");
      setGeneratedRules(data.rules || []);
      setView("rules");
    } catch (err: any) {
      shell.notify(err.message || "Failed to generate AI rules", "error");
    } finally {
      setAiLoading(false);
    }
  }

  async function executeGeneratedRule(rule: GeneratedRule) {
    setAiLoading(true);
    try {
      const res = await shell.fetch("/api/health/rules/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cypher: rule.cypher }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Rule execution failed");
      setGeneratedResults((prev) => ({ ...prev, [rule.name]: data.violations?.length || 0 }));
    } catch (err: any) {
      shell.notify(err.message || "Rule execution failed", "error");
    } finally {
      setAiLoading(false);
    }
  }

  async function applyFix(fix: SuggestedFix) {
    setLoading(true);
    try {
      const res = await shell.fetch("/api/apps/health-monitor/tools/apply_remediation/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: fix.sourceId, targetId: fix.targetId, relType: fix.relType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Fix failed");
      shell.notify(`Remediation queued: ${data.job?.id || "pending"}`, "success");
      await refresh();
    } catch (err: any) {
      shell.notify(err.message || "Queue fix failed", "error");
    } finally {
      setLoading(false);
    }
  }

  function openExplorer(finding: Finding) {
    shell.dispatch({
      type: "OPEN_APP",
      id: "cmdb-explorer",
      installKey: "builtin_cmdb-explorer",
      mode: "canvas",
      permissions: ["read:cmdb", "read:relationships"],
    });
    setTimeout(() => {
      shell.sendMessage({ type: "SET_CMDB_VIEW", to: "cmdb-explorer", payload: { focusCiId: finding.ciId, queue: "attention" } });
    }, 150);
  }

  function openTables(finding: Finding) {
    const launchPayload = { type: "OPEN_TABLE_RECORD", tableId: `cmdb.${finding.ciClass}`, recordId: finding.ciId, mode: "edit" };
    try {
      sessionStorage.setItem(TABLES_LAUNCH_KEY, JSON.stringify({ ...launchPayload, createdAt: Date.now() }));
    } catch {
      /* ignore */
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

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-gray-950 text-gray-100">
      <header className="flex shrink-0 items-center gap-4 border-b border-gray-800 px-5 py-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-300">
          <HeartPulse className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">Health Monitor</h1>
          <p className="text-xs text-gray-500">CMDB trust, structural conformance, and remediation command center</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={generateRules} disabled={aiLoading} className="inline-flex items-center gap-2 rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-2 text-sm text-purple-100 hover:bg-purple-500/20 disabled:opacity-50">
            {aiLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Draft Rules
          </button>
          <button onClick={refresh} disabled={loading} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-64 shrink-0 border-r border-gray-800 bg-gray-950 p-3">
          <NavButton view="overview" active={view} onClick={setView} icon={Gauge} label="Overview" count={summary.total} />
          <NavButton view="findings" active={view} onClick={setView} icon={AlertTriangle} label="Findings" count={findings.length} />
          <NavButton view="rules" active={view} onClick={setView} icon={ListChecks} label="Rules" count={rules.length + generatedRules.length} />
          <NavButton view="remediation" active={view} onClick={setView} icon={Wrench} label="Remediation" count={summary.fixable} />

          <div className="mt-5 rounded-lg border border-gray-800 bg-gray-900/50 p-3">
            <div className="text-xs font-semibold uppercase text-gray-500">Trust posture</div>
            <div className={`mt-2 text-3xl font-semibold ${scoreClass(summary.avg)}`}>{summary.avg ?? "-"}%</div>
            <div className="mt-1 text-xs text-gray-500">Average CI health across sampled records</div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-auto p-5 pb-28">
          {view === "overview" && (
            <Overview summary={summary} findings={findings} cis={cis} setView={setView} />
          )}

          {view === "findings" && (
            <section className="space-y-4">
              <div className="flex items-center gap-3">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search CI, rule, class, or finding"
                  className="w-96 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500"
                />
                <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as any)} className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-300 outline-none focus:border-indigo-500">
                  <option value="all">All severities</option>
                  <option value="critical">Critical</option>
                  <option value="warning">Warning</option>
                  <option value="info">Info</option>
                </select>
              </div>
              <FindingTable findings={filteredFindings} onExplorer={openExplorer} onTables={openTables} />
            </section>
          )}

          {view === "rules" && (
            <RulesPanel rules={rules} generatedRules={generatedRules} generatedResults={generatedResults} aiLoading={aiLoading} onGenerate={generateRules} onExecute={executeGeneratedRule} />
          )}

          {view === "remediation" && (
            <RemediationPanel findings={findings.filter((finding) => finding.suggestedFix)} loading={loading} onApply={applyFix} onExplorer={openExplorer} onTables={openTables} />
          )}
        </main>
      </div>
    </div>
  );
}

function NavButton({ view, active, onClick, icon: Icon, label, count }: { view: View; active: View; onClick: (view: View) => void; icon: any; label: string; count: number }) {
  return (
    <button onClick={() => onClick(view)} className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${active === view ? "bg-indigo-600/20 text-indigo-100" : "text-gray-400 hover:bg-gray-900 hover:text-gray-100"}`}>
      <Icon className="h-4 w-4" />
      <span>{label}</span>
      <span className="ml-auto rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">{count}</span>
    </button>
  );
}

function Overview({ summary, findings, cis, setView }: { summary: any; findings: Finding[]; cis: CI[]; setView: (view: View) => void }) {
  const classRisk = useMemo(() => {
    const counts = new Map<string, { total: number; risk: number }>();
    for (const ci of cis) counts.set(ci.class, { total: (counts.get(ci.class)?.total || 0) + 1, risk: counts.get(ci.class)?.risk || 0 });
    for (const finding of findings) {
      const current = counts.get(finding.ciClass) || { total: 0, risk: 0 };
      counts.set(finding.ciClass, { ...current, risk: current.risk + 1 });
    }
    return [...counts.entries()].map(([name, value]) => ({ name, ...value })).sort((a, b) => b.risk - a.risk).slice(0, 8);
  }, [cis, findings]);

  return (
    <section className="space-y-5">
      <div className="grid grid-cols-5 gap-3">
        <Metric icon={ShieldCheck} label="Avg Health" value={`${summary.avg ?? "-"}%`} tone={summary.avg && summary.avg >= 80 ? "good" : "warn"} />
        <Metric icon={AlertTriangle} label="Critical Findings" value={summary.critical} tone="bad" />
        <Metric icon={ClipboardCheck} label="Warnings" value={summary.warning} tone="warn" />
        <Metric icon={Wrench} label="Fixable" value={summary.fixable} tone="good" />
        <Metric icon={Database} label="Stale CIs" value={summary.stale} tone="warn" />
      </div>

      <div className="grid grid-cols-[1.2fr_0.8fr] gap-4">
        <div className="rounded-lg border border-gray-800 bg-gray-900/50">
          <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Top Risk Queue</h2>
              <p className="text-xs text-gray-500">Highest-priority trust issues requiring action</p>
            </div>
            <button onClick={() => setView("findings")} className="text-xs text-indigo-300 hover:text-indigo-100">View all</button>
          </div>
          <div className="divide-y divide-gray-800">
            {findings.slice(0, 8).map((finding) => <FindingRow key={finding.id} finding={finding} compact />)}
          </div>
        </div>

        <div className="rounded-lg border border-gray-800 bg-gray-900/50">
          <div className="border-b border-gray-800 px-4 py-3">
            <h2 className="text-sm font-semibold">Risk by Class</h2>
            <p className="text-xs text-gray-500">Concentrations by CI class</p>
          </div>
          <div className="space-y-3 p-4">
            {classRisk.map((item) => (
              <div key={item.name}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-gray-300">{item.name}</span>
                  <span className="text-gray-500">{item.risk} findings</span>
                </div>
                <div className="h-2 overflow-hidden rounded bg-gray-800">
                  <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, (item.risk / Math.max(1, item.total)) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string | number; tone: "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "text-emerald-300 bg-emerald-500/10" : tone === "warn" ? "text-yellow-300 bg-yellow-500/10" : "text-red-300 bg-red-500/10";
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="text-2xl font-semibold text-gray-100">{value}</div>
      <div className="mt-1 text-xs text-gray-500">{label}</div>
    </div>
  );
}

function FindingTable({ findings, onExplorer, onTables }: { findings: Finding[]; onExplorer: (finding: Finding) => void; onTables: (finding: Finding) => void }) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900/50">
      <div className="divide-y divide-gray-800">
        {findings.map((finding) => <FindingRow key={finding.id} finding={finding} onExplorer={onExplorer} onTables={onTables} />)}
        {findings.length === 0 && <div className="p-8 text-center text-sm text-gray-500">No findings match the current filters.</div>}
      </div>
    </div>
  );
}

function FindingRow({ finding, compact, onExplorer, onTables }: { finding: Finding; compact?: boolean; onExplorer?: (finding: Finding) => void; onTables?: (finding: Finding) => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className={`rounded-md border px-2 py-1 text-[10px] font-semibold uppercase ${severityClass(finding.severity)}`}>{finding.severity}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-gray-200">{finding.title}</div>
        <div className="mt-0.5 truncate text-xs text-gray-500">{finding.ciName} / {finding.ciClass} / {finding.detail}</div>
      </div>
      {finding.score !== undefined && <div className={`w-12 text-right text-sm font-semibold ${scoreClass(finding.score ?? null)}`}>{finding.score ?? "-"}%</div>}
      {!compact && (
        <div className="flex items-center gap-1">
          <button onClick={() => onExplorer?.(finding)} className="rounded p-1.5 text-gray-500 hover:bg-gray-800 hover:text-white" title="Open in CMDB Explorer">
            <ArrowUpRight className="h-4 w-4" />
          </button>
          <button onClick={() => onTables?.(finding)} className="rounded p-1.5 text-gray-500 hover:bg-gray-800 hover:text-white" title="Edit in Tables">
            <TableProperties className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function RulesPanel({ rules, generatedRules, generatedResults, aiLoading, onGenerate, onExecute }: { rules: RuleDefinition[]; generatedRules: GeneratedRule[]; generatedResults: Record<string, number>; aiLoading: boolean; onGenerate: () => void; onExecute: (rule: GeneratedRule) => void }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Rule Studio</h2>
          <p className="text-sm text-gray-500">Review active controls and draft new health policies with AI assistance.</p>
        </div>
        <button onClick={onGenerate} disabled={aiLoading} className="inline-flex items-center gap-2 rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-2 text-sm text-purple-100 hover:bg-purple-500/20 disabled:opacity-50">
          {aiLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
          Generate Drafts
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {rules.map((rule) => (
          <div key={rule.id} className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
            <div className="flex items-center gap-2">
              <span className={`rounded-md border px-2 py-1 text-[10px] font-semibold uppercase ${severityClass(rule.severity)}`}>{rule.severity}</span>
              <span className="font-mono text-xs text-gray-600">{rule.id}</span>
            </div>
            <h3 className="mt-3 text-sm font-semibold text-gray-200">{rule.name}</h3>
            <p className="mt-1 text-sm leading-5 text-gray-500">{rule.description}</p>
          </div>
        ))}
      </div>

      {generatedRules.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-purple-200">AI Draft Rules</h3>
          {generatedRules.map((rule) => (
            <div key={rule.name} className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-4">
              <div className="flex items-start gap-3">
                <Sparkles className="mt-0.5 h-4 w-4 text-purple-300" />
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-semibold text-gray-200">{rule.name}</h4>
                  <p className="mt-1 text-sm text-gray-500">{rule.explanation}</p>
                  <pre className="mt-3 overflow-auto rounded bg-gray-950 p-3 text-xs text-gray-400"><code>{rule.cypher}</code></pre>
                </div>
                <button onClick={() => onExecute(rule)} disabled={aiLoading} className="rounded-lg bg-purple-600 px-3 py-2 text-sm text-white hover:bg-purple-500 disabled:opacity-50">
                  Test{generatedResults[rule.name] !== undefined ? ` (${generatedResults[rule.name]})` : ""}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RemediationPanel({ findings, loading, onApply, onExplorer, onTables }: { findings: Finding[]; loading: boolean; onApply: (fix: SuggestedFix) => void; onExplorer: (finding: Finding) => void; onTables: (finding: Finding) => void }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Remediation Workbench</h2>
        <p className="text-sm text-gray-500">Review deterministic fixes before applying them to the CMDB graph.</p>
      </div>
      <div className="space-y-3">
        {findings.map((finding) => (
          <div key={finding.id} className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-1 h-4 w-4 text-emerald-300" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`rounded-md border px-2 py-1 text-[10px] font-semibold uppercase ${severityClass(finding.severity)}`}>{finding.severity}</span>
                  <h3 className="truncate text-sm font-semibold text-gray-200">{finding.title}</h3>
                </div>
                <p className="mt-2 text-sm text-gray-500">{finding.ciName} needs remediation: {finding.detail}</p>
                <p className="mt-2 text-sm text-emerald-300">{finding.suggestedFix?.description}</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => onExplorer(finding)} className="rounded p-1.5 text-gray-500 hover:bg-gray-800 hover:text-white" title="Open in CMDB Explorer"><ArrowUpRight className="h-4 w-4" /></button>
                <button onClick={() => onTables(finding)} className="rounded p-1.5 text-gray-500 hover:bg-gray-800 hover:text-white" title="Edit in Tables"><TableProperties className="h-4 w-4" /></button>
                <button onClick={() => finding.suggestedFix && onApply(finding.suggestedFix)} disabled={loading} className="ml-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
                  Apply
                </button>
              </div>
            </div>
          </div>
        ))}
        {findings.length === 0 && <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-8 text-center text-sm text-gray-500">No deterministic remediation actions are available.</div>}
      </div>
    </section>
  );
}
