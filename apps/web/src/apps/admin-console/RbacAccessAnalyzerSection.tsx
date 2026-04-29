"use client";

import { type Dispatch, type FormEvent, type SetStateAction } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, KeyRound, Loader2, Search, XCircle } from "lucide-react";
import { FieldSelect } from "./components";
import { encodePermissionValue } from "./helpers";
import type { AccessAnalysis, RbacTarget, RbacUser } from "./types";

type AccessProbe = {
  userId: string;
  role: string;
  target: string;
};

type RbacAccessAnalyzerSectionProps = {
  open: boolean;
  saving: boolean;
  accessProbe: AccessProbe;
  setAccessProbe: Dispatch<SetStateAction<AccessProbe>>;
  accessAnalysis: AccessAnalysis | null;
  rbacUsers: RbacUser[];
  allRoles: string[];
  rbacTargets: RbacTarget[];
  onToggle: () => void;
  onAnalyze: (event: FormEvent) => void;
};

export function RbacAccessAnalyzerSection({
  open,
  saving,
  accessProbe,
  setAccessProbe,
  accessAnalysis,
  rbacUsers,
  allRoles,
  rbacTargets,
  onToggle,
  onAnalyze,
}: RbacAccessAnalyzerSectionProps) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-medium text-gray-200">
            <KeyRound className="h-4 w-4 text-indigo-300" />
            Access Analyzer
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Explain why a user or role can perform an action before changing grants.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {accessAnalysis && (
            <div className={`rounded-full px-3 py-1 text-xs font-medium ${
              accessAnalysis.allowed ? "bg-emerald-500/10 text-emerald-200" : "bg-red-500/10 text-red-200"
            }`}>
              {accessAnalysis.allowed ? "Allowed" : "Denied"}
            </div>
          )}
          <button type="button" onClick={onToggle} className="rounded-lg border border-gray-700 p-2 text-gray-400 hover:text-gray-100">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {open && (
        <>
          <form onSubmit={onAnalyze} className="mt-4 grid items-end gap-3 lg:grid-cols-[1.2fr_1fr_1.2fr_auto]">
            <FieldSelect
              label="User"
              value={accessProbe.userId}
              onChange={(value) => {
                const user = rbacUsers.find((candidate) => candidate.id === value);
                setAccessProbe((current) => ({ ...current, userId: value, role: user?.role || current.role }));
              }}
              options={[
                { value: "", label: "Analyze role only" },
                ...rbacUsers.map((user) => ({ value: user.id, label: `${user.name || user.email} (${user.role})` })),
              ]}
            />
            <FieldSelect
              label="Role"
              value={accessProbe.role}
              onChange={(value) => setAccessProbe((current) => ({ ...current, role: value, userId: "" }))}
              options={allRoles.map((role) => ({ value: role, label: role }))}
            />
            <FieldSelect
              label="Permission"
              value={accessProbe.target}
              onChange={(value) => setAccessProbe((current) => ({ ...current, target: value }))}
              options={rbacTargets.map((target) => ({
                value: encodePermissionValue(target.resource, target.action),
                label: `${target.label || target.resource} - ${target.action} (${target.risk})`,
              }))}
            />
            <button
              type="submit"
              disabled={saving || (!accessProbe.userId && !accessProbe.role) || !accessProbe.target}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Analyze
            </button>
          </form>

          {accessAnalysis && (
            <div className="mt-5 grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
              <div className={`rounded-lg border p-4 ${
                accessAnalysis.allowed ? "border-emerald-500/30 bg-emerald-500/10" : "border-red-500/30 bg-red-500/10"
              }`}>
                <div className="flex items-center gap-2">
                  {accessAnalysis.allowed ? <CheckCircle2 className="h-5 w-5 text-emerald-300" /> : <XCircle className="h-5 w-5 text-red-300" />}
                  <div className="font-medium text-gray-100">
                    {accessAnalysis.role} {accessAnalysis.allowed ? "can" : "cannot"} {accessAnalysis.action} {accessAnalysis.resource}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-gray-500">Reason</div>
                    <div className="mt-1 text-gray-300">{accessAnalysis.reason.replaceAll("_", " ")}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-gray-500">Risk</div>
                    <div className="mt-1 text-gray-300">{accessAnalysis.risk}</div>
                  </div>
                </div>
                {accessAnalysis.missing.length > 0 && (
                  <div className="mt-4 rounded-lg border border-red-500/20 bg-gray-950/60 p-3 text-sm text-red-100">
                    Missing grant: {accessAnalysis.missing.map((item) => `${item.resource}:${item.action}`).join(", ")}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-200">
                  <AlertTriangle className="h-4 w-4 text-amber-300" />
                  Decision Trace
                </div>
                <div className="space-y-2">
                  {accessAnalysis.trace.map((step, index) => (
                    <div key={`${step.label}-${index}`} className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2">
                      <div className="flex items-center gap-2 text-sm text-gray-200">
                        <span className={`h-2 w-2 rounded-full ${
                          step.status === "allow" ? "bg-emerald-400" : step.status === "deny" ? "bg-red-400" : "bg-indigo-400"
                        }`} />
                        {step.label}
                      </div>
                      <div className="mt-1 text-sm text-gray-500">{step.detail}</div>
                    </div>
                  ))}
                </div>
                {accessAnalysis.relatedApps.length > 0 && (
                  <div className="mt-4 text-sm text-gray-500">
                    Related apps: <span className="text-gray-300">{accessAnalysis.relatedApps.map((app) => app.name).join(", ")}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
