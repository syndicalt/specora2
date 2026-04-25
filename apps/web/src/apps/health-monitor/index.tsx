import { useState, useEffect } from "react";
import type { ShellAPI } from "@/sdk/types";
import { getToken } from "@/lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace("/graphql", "") || "http://localhost:4000";

interface AnomalyResult {
  id: string;
  name: string;
  class: string;
  environment?: string;
}

interface HealthScore {
  ciId: string;
  name: string;
  class: string;
  scores: {
    completeness: number;
    relationshipValidity: number;
    freshness: number;
    overall: number;
  };
  relationshipCount: number;
}

interface SuggestedFix {
  type: string;
  description: string;
  sourceId: string;
  targetId?: string;
  relType: string;
}

interface RuleViolation {
  ruleId: string;
  ruleName: string;
  severity: string;
  message: string;
  ciId: string;
  ciName: string;
  ciClass: string;
  suggestedFix?: SuggestedFix;
}

interface GeneratedRule {
  name: string;
  cypher: string;
  explanation: string;
}

export default function HealthMonitorApp({ shell }: { shell: ShellAPI }) {
  const [activeTab, setActiveTab] = useState<"orphaned" | "stale" | "cycles" | "score" | "completeness" | "remediate" | "ai">("orphaned");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<AnomalyResult[]>([]);
  const [scoreResult, setScoreResult] = useState<HealthScore | null>(null);
  const [scoreCiId, setScoreCiId] = useState("");
  const [days, setDays] = useState(30);
  const [violations, setViolations] = useState<RuleViolation[]>([]);
  const [generatedRules, setGeneratedRules] = useState<GeneratedRule[]>([]);
  const [selectedRule, setSelectedRule] = useState<GeneratedRule | null>(null);
  const [ruleResults, setRuleResults] = useState<AnomalyResult[]>([]);

  // Subscribe to real-time events
  useEffect(() => {
    const unsubCi = shell.eventBus.subscribe("ci.created", () => {
      if (["orphaned", "stale", "cycles", "completeness", "remediate"].includes(activeTab)) {
        runCheck();
      }
    });
    const unsubUpdated = shell.eventBus.subscribe("ci.updated", () => {
      if (["orphaned", "stale", "cycles", "completeness", "remediate"].includes(activeTab)) {
        runCheck();
      }
    });
    const unsubDeleted = shell.eventBus.subscribe("ci.deleted", () => {
      if (["orphaned", "stale", "cycles", "completeness", "remediate"].includes(activeTab)) {
        runCheck();
      }
    });
    const unsubDiscovery = shell.eventBus.subscribe("discovery.completed", () => {
      shell.notify("Discovery completed. Health data may have changed.", "info");
      if (["orphaned", "stale", "cycles", "completeness", "remediate"].includes(activeTab)) {
        runCheck();
      }
    });
    const unsubRelCreated = shell.eventBus.subscribe("relationship.created", () => {
      if (["completeness", "remediate"].includes(activeTab)) {
        runCheck();
      }
    });
    return () => {
      unsubCi();
      unsubUpdated();
      unsubDeleted();
      unsubDiscovery();
      unsubRelCreated();
    };
  }, [shell, activeTab]);

  async function runCheck() {
    setLoading(true);
    setResults([]);
    setScoreResult(null);
    setViolations([]);
    try {
      if (activeTab === "score") {
        if (!scoreCiId) {
          shell.notify("Please enter a CI ID", "error");
          setLoading(false);
          return;
        }
        const res = await fetch(`${API_URL}/api/apps/health-monitor/tools/score_ci`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() || ""}` },
          body: JSON.stringify({ ciId: scoreCiId }),
        });
        const data = await res.json();
        if (data.error) {
          shell.notify(data.error, "error");
        } else {
          setScoreResult(data);
        }
      } else if (activeTab === "completeness" || activeTab === "remediate") {
        const endpoint = activeTab === "remediate"
          ? `${API_URL}/api/apps/health-monitor/tools/get_remediation_suggestions`
          : `${API_URL}/api/health/rules`;
        const res = await fetch(endpoint, {
          headers: { Authorization: `Bearer ${getToken() || ""}` },
        });
        const data = await res.json();
        if (activeTab === "remediate") {
          setViolations(data || []);
        } else {
          setViolations(data.violations || []);
        }
      } else if (activeTab === "ai") {
        const res = await fetch(`${API_URL}/api/health/rules/generate`, {
          method: "POST",
          headers: { Authorization: `Bearer ${getToken() || ""}` },
        });
        const data = await res.json();
        setGeneratedRules(data.rules || []);
      } else {
        const toolName =
          activeTab === "orphaned"
            ? "find_orphaned"
            : activeTab === "stale"
            ? "find_stale"
            : "find_cycles";
        const body = activeTab === "stale" ? { days } : {};
        const res = await fetch(`${API_URL}/api/apps/health-monitor/tools/${toolName}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() || ""}` },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (Array.isArray(data)) {
          setResults(data);
        } else if (activeTab === "cycles" && Array.isArray(data)) {
          const nodes: AnomalyResult[] = [];
          for (const cycle of data) {
            for (const node of cycle.nodes) {
              if (!nodes.find((n) => n.id === node.id)) {
                nodes.push(node);
              }
            }
          }
          setResults(nodes);
        }
      }
    } catch (err) {
      console.error("Health check failed:", err);
      shell.notify("Health check failed", "error");
    } finally {
      setLoading(false);
    }
  }

  async function applyFix(fix: SuggestedFix) {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/apps/health-monitor/tools/apply_remediation`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() || ""}` },
        body: JSON.stringify({
          sourceId: fix.sourceId,
          targetId: fix.targetId,
          relType: fix.relType,
        }),
      });
      const data = await res.json();
      if (data.success) {
        shell.notify(data.message, "success");
        // Refresh the list
        runCheck();
      } else {
        shell.notify(data.message || "Fix failed", "error");
      }
    } catch (err) {
      console.error("Apply fix failed:", err);
      shell.notify("Apply fix failed", "error");
    } finally {
      setLoading(false);
    }
  }

  async function executeRule(rule: GeneratedRule) {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/health/rules/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() || ""}` },
        body: JSON.stringify({ cypher: rule.cypher }),
      });
      const data = await res.json();
      setRuleResults((data.violations || []).map((v: any) => ({
        id: v.ciId,
        name: v.ciName,
        class: v.ciClass,
      })));
      setSelectedRule(rule);
    } catch (err) {
      console.error("Rule execution failed:", err);
      shell.notify("Rule execution failed", "error");
    } finally {
      setLoading(false);
    }
  }

  const tabs = [
    { key: "orphaned" as const, label: "Orphaned CIs" },
    { key: "stale" as const, label: "Stale CIs" },
    { key: "cycles" as const, label: "Circular Dependencies" },
    { key: "score" as const, label: "CI Health Score" },
    { key: "completeness" as const, label: "Synthetic Completeness" },
    { key: "remediate" as const, label: "Remediate" },
    { key: "ai" as const, label: "AI Rule Generator" },
  ];

  const severityColors: Record<string, string> = {
    critical: "bg-red-900/50 text-red-300",
    warning: "bg-yellow-900/50 text-yellow-300",
    info: "bg-blue-900/50 text-blue-300",
  };

  return (
    <div className="h-full w-full bg-gray-950 text-gray-100 flex flex-col">
      <header className="px-6 py-4 border-b border-gray-800">
        <h1 className="text-xl font-semibold">Health Monitor</h1>
        <p className="text-sm text-gray-500 mt-1">Detect anomalies, validate structure, and generate AI rules.</p>
      </header>

      <div className="px-6 py-3 border-b border-gray-800 flex gap-2 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === tab.key ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-6 space-y-4 overflow-auto flex-1 pb-24">
        {activeTab === "stale" && (
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-400">Days since discovery:</label>
            <input
              type="number"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="w-20 px-2 py-1 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        )}

        {activeTab === "score" && (
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={scoreCiId}
              onChange={(e) => setScoreCiId(e.target.value)}
              placeholder="Enter CI ID"
              className="flex-1 px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        )}

        {activeTab !== "ai" && activeTab !== "completeness" && activeTab !== "remediate" && (
          <button
            onClick={runCheck}
            disabled={loading}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors"
          >
            {loading ? "Running..." : "Run Check"}
          </button>
        )}

        {(activeTab === "completeness" || activeTab === "remediate") && (
          <button
            onClick={runCheck}
            disabled={loading}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors"
          >
            {loading ? "Checking..." : activeTab === "remediate" ? "Find Fixable Violations" : "Run Synthetic Completeness Rules"}
          </button>
        )}

        {activeTab === "ai" && (
          <button
            onClick={runCheck}
            disabled={loading}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors"
          >
            {loading ? "Generating..." : "Generate AI Rules"}
          </button>
        )}

        {/* Results for orphaned/stale/cycles */}
        {results.length > 0 && activeTab !== "completeness" && activeTab !== "ai" && activeTab !== "score" && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-300">
              {results.length} {activeTab === "cycles" ? "CIs in cycles" : "CIs found"}
            </h3>
            <div className="space-y-2">
              {results.map((ci) => (
                <div
                  key={ci.id}
                  className="p-3 bg-gray-900 rounded-lg border border-gray-800 flex items-center justify-between"
                >
                  <div>
                    <div className="font-medium text-sm text-gray-200">{ci.name}</div>
                    <div className="text-xs text-gray-500">
                      {ci.class} {ci.environment ? `(${ci.environment})` : ""} {ci.id}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setScoreCiId(ci.id);
                      setActiveTab("score");
                    }}
                    className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 rounded-md text-xs text-gray-300 transition-colors"
                  >
                    Score
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Score result */}
        {scoreResult && activeTab === "score" && (
          <div className="p-4 bg-gray-900 rounded-xl border border-gray-800 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-gray-200">{scoreResult.name}</h3>
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                  scoreResult.scores.overall >= 80
                    ? "bg-green-900/50 text-green-300"
                    : scoreResult.scores.overall >= 50
                    ? "bg-yellow-900/50 text-yellow-300"
                    : "bg-red-900/50 text-red-300"
                }`}
              >
                Overall: {scoreResult.scores.overall}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Completeness", value: scoreResult.scores.completeness },
                { label: "Relationships", value: scoreResult.scores.relationshipValidity },
                { label: "Freshness", value: scoreResult.scores.freshness },
              ].map((s) => (
                <div key={s.label} className="p-3 bg-gray-800/50 rounded-lg text-center">
                  <div className="text-lg font-semibold text-gray-200">{s.value}</div>
                  <div className="text-xs text-gray-500">{s.label}</div>
                </div>
              ))}
            </div>
            <div className="text-xs text-gray-500">Relationships: {scoreResult.relationshipCount}</div>
          </div>
        )}

        {/* Synthetic completeness violations + Remediate tab */}
        {violations.length > 0 && (activeTab === "completeness" || activeTab === "remediate") && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-300">
              {activeTab === "remediate"
                ? `${violations.length} fixable violations`
                : `${violations.length} structural violations found`}
            </h3>
            <div className="space-y-2">
              {violations.map((v, idx) => (
                <div
                  key={`${v.ruleId}-${v.ciId}-${idx}`}
                  className="p-3 bg-gray-900 rounded-lg border border-gray-800"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        severityColors[v.severity] || "bg-gray-800 text-gray-400"
                      }`}
                    >
                      {v.severity}
                    </span>
                    <span className="text-sm font-medium text-gray-200">{v.ruleName}</span>
                  </div>
                  <p className="text-xs text-gray-400">{v.message}</p>
                  <div className="mt-2 text-xs text-gray-500 flex items-center justify-between">
                    <span>
                      CI: <span className="text-gray-300">{v.ciName}</span> ({v.ciClass}) {v.ciId}
                    </span>
                    {v.suggestedFix && activeTab === "remediate" && (
                      <button
                        onClick={() => applyFix(v.suggestedFix!)}
                        disabled={loading}
                        className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-md text-xs text-white transition-colors"
                      >
                        {loading ? "Applying..." : "Apply Fix"}
                      </button>
                    )}
                  </div>
                  {v.suggestedFix && (
                    <div className="mt-1.5 text-[11px] text-emerald-400">
                      Suggested: {v.suggestedFix.description}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {violations.length === 0 && !loading && (activeTab === "completeness" || activeTab === "remediate") && (
          <div className="p-4 bg-green-900/20 border border-green-800/50 rounded-xl">
            <p className="text-sm text-green-300">
              {activeTab === "remediate"
                ? "No fixable violations found. Great job!"
                : "All synthetic completeness rules passed. No structural violations found."}
            </p>
          </div>
        )}

        {/* AI Generated Rules */}
        {generatedRules.length > 0 && activeTab === "ai" && (
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-gray-300">
              {generatedRules.length} AI-suggested rules
            </h3>
            <div className="space-y-3">
              {generatedRules.map((rule, idx) => (
                <div
                  key={idx}
                  className="p-4 bg-gray-900 rounded-xl border border-gray-800 space-y-2"
                >
                  <h4 className="font-medium text-sm text-gray-200">{rule.name}</h4>
                  <p className="text-xs text-gray-400">{rule.explanation}</p>
                  <pre className="p-2 bg-gray-950 rounded-lg text-xs text-gray-400 overflow-x-auto">
                    <code>{rule.cypher}</code>
                  </pre>
                  <button
                    onClick={() => executeRule(rule)}
                    disabled={loading}
                    className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-lg text-xs font-medium text-white transition-colors"
                  >
                    {loading && selectedRule?.name === rule.name ? "Running..." : "Execute Rule"}
                  </button>

                  {selectedRule?.name === rule.name && ruleResults.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-gray-400">{ruleResults.length} violations found:</p>
                      {ruleResults.map((r) => (
                        <div key={r.id} className="p-2 bg-gray-800/50 rounded-lg text-xs text-gray-300">
                          {r.name} ({r.class}) {r.id}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && results.length === 0 && !scoreResult && activeTab !== "completeness" && activeTab !== "ai" && activeTab !== "score" && (
          <div className="text-sm text-gray-500">No anomalies found.</div>
        )}
      </div>
    </div>
  );
}
