"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ShellAPI } from "@/sdk/types";
import { AlertTriangle, Compass, Database, EyeOff, GitBranch, Radar, RefreshCw, Sparkles, TrendingUp } from "lucide-react";

type CI = { id: string; name: string; class: string; environment?: string | null; lastDiscoveredAt?: string | null; relationships?: unknown[] };
type Job = { id: string; status: string; stats?: Record<string, unknown>; createdAt: string };
type Pipeline = { id: string; name: string; status: string; updated_at?: string; updatedAt?: string };
type CoverageResult = { gaps: string[]; existing: Record<string, number>; suggestion: string };

const QUERY = `query DiscoveryInsightsData {
  cis(limit: 500) { id name class environment lastDiscoveredAt relationships { id type } }
  discoveryJobs { id status stats createdAt updatedAt }
}`;

function ageDays(iso?: string | null): number | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  return Number.isFinite(time) ? Math.floor((Date.now() - time) / 86400000) : null;
}

function pct(value: number): string {
  return `${Math.round(value)}%`;
}

export default function DiscoveryInsightsApp({ shell }: { shell: ShellAPI }) {
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const [cis, setCis] = useState<CI[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [coverage, setCoverage] = useState<CoverageResult | null>(null);
  const [environment, setEnvironment] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const api = shellRef.current;
      const [data, pipelineRes, coverageRes] = await Promise.all([
        api.query(QUERY),
        api.fetch("/discovery/pipelines"),
        api.fetch("/api/apps/discovery-insights/tools/suggest_next_scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ environment: environment || undefined }),
        }),
      ]);
      if (!pipelineRes.ok || !coverageRes.ok) throw new Error("Discovery insights request failed");
      setCis((data.cis || []) as CI[]);
      setJobs((data.discoveryJobs || []) as Job[]);
      setPipelines(await pipelineRes.json());
      setCoverage(await coverageRes.json());
    } catch {
      shellRef.current.notify("Discovery insights could not be loaded", "error");
    } finally {
      setLoading(false);
    }
  }, [environment]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const model = useMemo(() => {
    const byClass = new Map<string, CI[]>();
    const envs = new Set<string>();
    for (const ci of cis) {
      byClass.set(ci.class, [...(byClass.get(ci.class) || []), ci]);
      if (ci.environment) envs.add(ci.environment);
    }
    const stale = cis.filter((ci) => {
      const age = ageDays(ci.lastDiscoveredAt);
      return age === null || age > 30;
    });
    const isolated = cis.filter((ci) => !ci.relationships?.length);
    const failedJobs = jobs.filter((job) => ["failed", "error"].includes(job.status.toLowerCase()));
    const quality = cis.length
      ? 100 - Math.min(80, (stale.length / cis.length) * 35 + (isolated.length / cis.length) * 35 + (failedJobs.length / Math.max(jobs.length, 1)) * 30)
      : 0;
    const blindSpots = [
      ...((coverage?.gaps || []).map((gap) => ({ title: `${gap} coverage missing`, detail: "No current CIs were found for this expected CSDM class.", severity: "high" as const }))),
      ...(isolated.length ? [{ title: `${isolated.length} isolated CIs`, detail: "These records cannot support impact analysis until relationship discovery improves.", severity: "medium" as const }] : []),
      ...(stale.length ? [{ title: `${stale.length} stale or untracked CIs`, detail: "Refresh discovery or mark authoritative manual records explicitly.", severity: "medium" as const }] : []),
      ...(failedJobs.length ? [{ title: `${failedJobs.length} failed discovery runs`, detail: "Review failed runs before trusting trend or coverage numbers.", severity: "high" as const }] : []),
    ];
    return { byClass, envs: Array.from(envs), stale, isolated, failedJobs, quality, blindSpots };
  }, [cis, jobs, coverage]);

  function openDiscoveryBuilder() {
    shell.dispatch({
      type: "OPEN_APP",
      id: "discovery",
      installKey: "builtin_discovery",
      mode: "canvas",
      permissions: ["read:discovery", "write:discovery"],
    });
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-gray-950 text-gray-100">
      <header className="flex shrink-0 items-center justify-between border-b border-gray-800 px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-sky-500/40 bg-sky-500/10">
            <Radar className="h-5 w-5 text-sky-300" />
          </div>
          <div>
            <h1 className="text-base font-semibold">Discovery Insights</h1>
            <p className="text-xs text-gray-500">Find blind spots, weak coverage, stale discovery, and the next best scan.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select value={environment} onChange={(event) => setEnvironment(event.target.value)} className="rounded-md border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-200">
            <option value="">All environments</option>
            {model.envs.map((env) => <option key={env} value={env}>{env}</option>)}
          </select>
          <button onClick={refresh} className="rounded-md p-2 text-gray-400 hover:bg-gray-900 hover:text-white" title="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-5 pb-24 xl:grid-cols-[1fr_380px]">
        <section className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric icon={<TrendingUp className="h-4 w-4" />} label="Discovery Quality" value={pct(model.quality)} />
            <Metric icon={<EyeOff className="h-4 w-4" />} label="Blind Spots" value={String(model.blindSpots.length)} />
            <Metric icon={<AlertTriangle className="h-4 w-4" />} label="Stale CIs" value={String(model.stale.length)} />
            <Metric icon={<GitBranch className="h-4 w-4" />} label="Pipelines" value={String(pipelines.length)} />
          </div>

          <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Coverage by CI Class</h2>
              <span className="text-xs text-gray-500">{cis.length} sampled CIs</span>
            </div>
            <div className="space-y-3">
              {Array.from(model.byClass.entries()).sort((a, b) => b[1].length - a[1].length).map(([cls, rows]) => (
                <div key={cls}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-gray-300">{cls}</span>
                    <span className="text-gray-500">{rows.length}</span>
                  </div>
                  <div className="h-2 rounded bg-gray-800">
                    <div className="h-2 rounded bg-sky-400" style={{ width: `${Math.max(4, (rows.length / Math.max(cis.length, 1)) * 100)}%` }} />
                  </div>
                </div>
              ))}
              {!cis.length && <div className="text-sm text-gray-500">No CMDB data available for coverage analysis.</div>}
            </div>
          </div>

          <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <h2 className="mb-3 text-sm font-semibold">Blind Spot Queue</h2>
            <div className="space-y-2">
              {model.blindSpots.length ? model.blindSpots.map((spot) => (
                <div key={spot.title} className="rounded-md border border-gray-800 bg-gray-950 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium">{spot.title}</div>
                    <span className={`rounded px-2 py-1 text-xs ${spot.severity === "high" ? "bg-rose-500/10 text-rose-300" : "bg-amber-500/10 text-amber-200"}`}>{spot.severity}</span>
                  </div>
                  <p className="mt-1 text-sm text-gray-500">{spot.detail}</p>
                </div>
              )) : (
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">No major blind spots detected in the current sample.</div>
              )}
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-sky-200">
              <Compass className="h-4 w-4" />
              Next Best Discovery
            </div>
            <p className="text-sm text-sky-100/80">{coverage?.suggestion || "Analyze coverage to generate the next scan recommendation."}</p>
            <button onClick={openDiscoveryBuilder} className="mt-4 inline-flex items-center gap-2 rounded-md bg-sky-400 px-3 py-2 text-sm font-medium text-gray-950 hover:bg-sky-300">
              <GitBranch className="h-4 w-4" />
              Open Builder
            </button>
          </div>

          <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-sky-300" />
              Pipeline Recommendations
            </div>
            <div className="space-y-2 text-sm text-gray-400">
              <p>{model.isolated.length ? "Prioritize relationship linker rules for isolated CIs." : "Relationship coverage is not currently the top issue."}</p>
              <p>{model.stale.length ? "Schedule refresh runs for stale classes before relying on impact analysis." : "Freshness is healthy in the sampled data."}</p>
              <p>{pipelines.length ? "Use saved pipelines as reusable, reviewable discovery programs." : "Create a Discovery Builder pipeline for repeatable imports."}</p>
            </div>
          </div>

          <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Database className="h-4 w-4 text-sky-300" />
              Recent Runs
            </div>
            <div className="space-y-2">
              {jobs.slice(0, 6).map((job) => (
                <div key={job.id} className="flex items-center justify-between rounded-md bg-gray-950 px-3 py-2 text-sm">
                  <span className="text-gray-300">{job.status}</span>
                  <span className="text-xs text-gray-500">{new Date(job.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
              {!jobs.length && <div className="text-sm text-gray-500">No discovery runs recorded.</div>}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <div className="mb-3 flex items-center gap-2 text-xs text-gray-500">
        <span className="text-sky-300">{icon}</span>
        {label}
      </div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}
