"use client";

import { ChevronDown, ChevronRight, ClipboardCheck } from "lucide-react";
import { MiniMetric } from "./components";
import { postureClass, riskClass } from "./helpers";
import type { PolicyDriftReport } from "./types";

type RbacPolicyDriftSectionProps = {
  open: boolean;
  saving: boolean;
  policyDrift: PolicyDriftReport | null;
  onToggle: () => void;
  onBulkGrant: (role: string, targets: Array<{ resource: string; action: string }>) => void;
};

export function RbacPolicyDriftSection({
  open,
  saving,
  policyDrift,
  onToggle,
  onBulkGrant,
}: RbacPolicyDriftSectionProps) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-medium text-gray-200">
            <ClipboardCheck className="h-4 w-4 text-emerald-300" />
            Policy Drift
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Compare registered native app and automation requirements against current role grants.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {policyDrift && (
            <div className={`rounded-full px-3 py-1 text-xs font-medium ${postureClass(policyDrift.summary.posture)}`}>
              {policyDrift.summary.orphaned} orphaned / {policyDrift.summary.missingHighRisk} high-risk gaps
            </div>
          )}
          <button type="button" onClick={onToggle} className="rounded-lg border border-gray-700 p-2 text-gray-400 hover:text-gray-100">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {open && policyDrift && (
        <div className="mt-4 grid gap-4 xl:grid-cols-[0.75fr_1.25fr]">
          <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
            <div className="grid grid-cols-2 gap-2">
              <MiniMetric label="Roles" value={policyDrift.summary.roles} />
              <MiniMetric label="Targets" value={policyDrift.summary.registeredTargets} />
              <MiniMetric label="Grants" value={policyDrift.summary.grants} />
              <MiniMetric label="Orphaned" value={policyDrift.summary.orphaned} />
            </div>
            <div className="mt-4 space-y-2">
              {policyDrift.roleCoverage.map((coverage) => (
                <div key={coverage.role} className="rounded-lg border border-gray-800 bg-gray-900 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-gray-200">{coverage.role}</div>
                    <div className={coverage.score >= 90 ? "text-emerald-300" : coverage.score >= 70 ? "text-amber-200" : "text-red-200"}>{coverage.score}%</div>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded bg-gray-800">
                    <div className="h-full bg-indigo-500" style={{ width: `${coverage.score}%` }} />
                  </div>
                  <div className="mt-2 text-xs text-gray-500">{coverage.granted} of {coverage.required} registered targets covered</div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-lg border border-gray-800 bg-gray-950">
              <div className="border-b border-gray-800 px-3 py-2 text-xs uppercase tracking-wide text-gray-500">Missing High-Risk Grants</div>
              <div className="scrollbar-thin max-h-72 overflow-y-auto p-2">
                {policyDrift.roleCoverage.flatMap((coverage) => coverage.missing.filter((item) => item.risk === "critical" || item.risk === "high")).slice(0, 20).map((item) => (
                  <div key={`${item.role}:${item.resource}:${item.action}`} className="mb-2 rounded-lg border border-gray-800 bg-gray-900 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-gray-100">{item.role}</span>
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] ${riskClass(item.risk)}`}>{item.risk}</span>
                        </div>
                        <div className="mt-1 font-mono text-xs text-gray-500">{item.resource}:{item.action}</div>
                        <div className="mt-1 text-xs text-gray-600">{item.apps.map((app) => app.name).join(", ")}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onBulkGrant(item.role, [{ resource: item.resource, action: item.action }])}
                        disabled={saving}
                        className="shrink-0 rounded-md border border-indigo-500/40 px-3 py-1.5 text-xs text-indigo-200 hover:bg-indigo-500/10 disabled:opacity-50"
                      >
                        Grant
                      </button>
                    </div>
                  </div>
                ))}
                {!policyDrift.roleCoverage.some((coverage) => coverage.missing.some((item) => item.risk === "critical" || item.risk === "high")) && (
                  <div className="px-3 py-8 text-center text-sm text-gray-500">No high-risk app drift detected.</div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-gray-800 bg-gray-950">
              <div className="border-b border-gray-800 px-3 py-2 text-xs uppercase tracking-wide text-gray-500">Orphaned Grants</div>
              <div className="scrollbar-thin max-h-48 overflow-y-auto p-2">
                {policyDrift.orphaned.slice(0, 20).map((grant) => (
                  <div key={grant.id} className="mb-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm text-gray-200">{grant.role}</div>
                        <div className="truncate font-mono text-xs text-gray-500">{grant.resource}:{grant.action}</div>
                      </div>
                      <span className={`rounded border px-2 py-0.5 text-[11px] ${riskClass(grant.risk)}`}>{grant.risk}</span>
                    </div>
                  </div>
                ))}
                {!policyDrift.orphaned.length && <div className="px-3 py-8 text-center text-sm text-gray-500">No orphaned grants detected.</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
