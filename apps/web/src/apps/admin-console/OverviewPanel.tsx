"use client";

import { Activity, AlertTriangle, ChevronRight, ClipboardCheck, Database } from "lucide-react";
import { MiniMetric } from "./components";
import { postureClass, scoreText } from "./helpers";
import type { NumberSequenceOption, OperationalIntelligence, Permission } from "./types";

type ReadinessMetric = {
  label: string;
  value: string | number;
  tone: string;
  detail: string;
};

type OverviewPanelProps = {
  operationalIntelligence: OperationalIntelligence | null;
  adminReadiness: ReadinessMetric[];
  availableSequenceOptions: NumberSequenceOption[];
  permissions: Permission[];
  onOpenNativeApp: (appId: string) => void;
  onSetActiveTab: (tab: string) => void;
};

export function OverviewPanel({
  operationalIntelligence,
  adminReadiness,
  availableSequenceOptions,
  permissions,
  onOpenNativeApp,
  onSetActiveTab,
}: OverviewPanelProps) {
  return (
    <div className="space-y-6">
      {operationalIntelligence && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
                <Activity className="h-4 w-4 text-cyan-300" />
                Operational Intelligence
              </div>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-500">
                Cross-module readiness signals that show whether Specora is operating like a connected platform instead of isolated apps.
              </p>
            </div>
            <div className={`rounded-lg border px-4 py-3 text-right ${postureClass(operationalIntelligence.overall.posture)}`}>
              <div className="text-xs uppercase tracking-wide opacity-70">Platform Score</div>
              <div className="mt-1 text-3xl font-semibold">{scoreText(operationalIntelligence.overall.score)}</div>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-gray-800 bg-gray-950 px-4 py-3 text-sm leading-6 text-gray-400">
            {operationalIntelligence.overall.summary}
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-3">
            {operationalIntelligence.domains.map((domain) => (
              <div key={domain.id} className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-gray-100">{domain.label}</div>
                    <div className="mt-1 text-xs capitalize text-gray-500">{domain.posture}</div>
                  </div>
                  <div className={`rounded-md border px-2.5 py-1 text-sm font-semibold ${postureClass(domain.posture)}`}>
                    {scoreText(domain.score)}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {domain.metrics.map((metric) => (
                    <div key={metric.label} className="rounded-md border border-gray-800 bg-gray-900 px-3 py-2">
                      <div className="text-[11px] uppercase tracking-wide text-gray-600">{metric.label}</div>
                      <div className="mt-1 text-sm font-medium text-gray-200">{metric.value ?? "-"}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-200">
                <AlertTriangle className="h-4 w-4 text-amber-300" />
                Priority Signals
              </div>
              <div className="space-y-2">
                {operationalIntelligence.signals.length ? operationalIntelligence.signals.map((signal) => (
                  <div key={`${signal.appId}-${signal.title}`} className={`rounded-lg border p-3 ${signal.severity === "critical" ? "border-red-500/30 bg-red-500/10" : "border-amber-500/30 bg-amber-500/10"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-gray-100">{signal.title}</div>
                        <div className="mt-1 text-sm leading-5 text-gray-400">{signal.detail}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenNativeApp(signal.appId)}
                        className="shrink-0 rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-800"
                      >
                        {signal.action}
                      </button>
                    </div>
                  </div>
                )) : (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-100">
                    No high-priority cross-module signals are active.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-200">
                <Database className="h-4 w-4 text-indigo-300" />
                Governance And Data Spine
              </div>
              <div className="grid grid-cols-2 gap-2">
                <MiniMetric label="Permission grants" value={operationalIntelligence.governance.permissionGrants} />
                <MiniMetric label="Active counters" value={operationalIntelligence.governance.activeSequences} />
                <MiniMetric label="Audit events 24h" value={operationalIntelligence.governance.auditEvents24h} />
                <MiniMetric label="Package jobs" value={operationalIntelligence.governance.activePackageJobs} />
                <MiniMetric label="CMDB CIs" value={operationalIntelligence.cmdb.ciCount ?? "-"} />
                <MiniMetric label="CMDB relationships" value={operationalIntelligence.cmdb.relationshipCount ?? "-"} />
              </div>
              <div className="mt-3 text-xs text-gray-600">
                Refreshed {new Date(operationalIntelligence.generatedAt).toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-4">
        {adminReadiness.map((item) => (
          <div key={item.label} className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <div className="text-xs uppercase tracking-wide text-gray-500">{item.label}</div>
            <div className={`mt-3 text-3xl font-semibold ${item.tone}`}>{item.value}</div>
            <div className="mt-1 text-sm text-gray-500">{item.detail}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
            <ClipboardCheck className="h-4 w-4 text-indigo-300" />
            Admin Operating Model
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {[
              ["Govern access first", "Use role-based grants before exposing apps, tables, or automation."],
              ["Register platform objects", "Apps, tables, record types, counters, and panels should come from registries."],
              ["Preview operational impact", "Admin changes should show what users, records, or automations they affect."],
              ["Audit every change", "RBAC, registry, automation, and system settings need traceable ownership."],
            ].map(([title, body]) => (
              <div key={title} className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                <div className="font-medium text-gray-200">{title}</div>
                <div className="mt-2 text-sm leading-6 text-gray-500">{body}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
            <Activity className="h-4 w-4 text-emerald-300" />
            Attention
          </div>
          <div className="mt-4 space-y-3">
            {availableSequenceOptions.length > 0 ? (
              <button
                type="button"
                onClick={() => onSetActiveTab("number-sequences")}
                className="flex w-full items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-left text-sm text-amber-100"
              >
                <span>{availableSequenceOptions.length} counter targets are available for registration</span>
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-100">
                Counter registry coverage is complete.
              </div>
            )}
            {!permissions.length && (
              <button
                type="button"
                onClick={() => onSetActiveTab("rbac")}
                className="flex w-full items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-3 text-left text-sm text-red-100"
              >
                <span>No RBAC grants were returned for this admin view</span>
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
            <div className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-3 text-sm leading-6 text-gray-500">
              Contextual admin actions should open as small page-aware tools; durable administration belongs in this full workspace.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
