"use client";

import { type Dispatch, type FormEvent, type SetStateAction } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, Search, ShieldCheck, XCircle } from "lucide-react";
import { FieldSelect, MiniMetric } from "./components";
import { riskClass } from "./helpers";
import type { AppAccessExplanation, RbacApp, RbacUser } from "./types";

type AppAccessProbe = {
  userId: string;
  role: string;
  appId: string;
};

type RbacAppAccessSectionProps = {
  open: boolean;
  saving: boolean;
  appAccessProbe: AppAccessProbe;
  setAppAccessProbe: Dispatch<SetStateAction<AppAccessProbe>>;
  appAccessExplanation: AppAccessExplanation | null;
  rbacUsers: RbacUser[];
  allRoles: string[];
  rbacApps: RbacApp[];
  onToggle: () => void;
  onExplain: (event: FormEvent) => void;
  onPrepareGrant: (role: string, resource: string, action: string) => void;
};

export function RbacAppAccessSection({
  open,
  saving,
  appAccessProbe,
  setAppAccessProbe,
  appAccessExplanation,
  rbacUsers,
  allRoles,
  rbacApps,
  onToggle,
  onExplain,
  onPrepareGrant,
}: RbacAppAccessSectionProps) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-medium text-gray-200">
            <ShieldCheck className="h-4 w-4 text-cyan-300" />
            Explain App Access
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Troubleshoot whether a user or role can open and operate a registered application.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {appAccessExplanation && (
            <div className={`rounded-full px-3 py-1 text-xs font-medium ${
              appAccessExplanation.allowed ? "bg-emerald-500/10 text-emerald-200" : "bg-red-500/10 text-red-200"
            }`}>
              {appAccessExplanation.allowed ? "Complete" : `${appAccessExplanation.missing.length} missing`}
            </div>
          )}
          <button type="button" onClick={onToggle} className="rounded-lg border border-gray-700 p-2 text-gray-400 hover:text-gray-100">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {open && (
        <>
          <form onSubmit={onExplain} className="mt-4 grid items-end gap-3 lg:grid-cols-[1.2fr_1fr_1.2fr_auto]">
            <FieldSelect
              label="User"
              value={appAccessProbe.userId}
              onChange={(value) => {
                const user = rbacUsers.find((candidate) => candidate.id === value);
                setAppAccessProbe((current) => ({ ...current, userId: value, role: user?.role || current.role }));
              }}
              options={[
                { value: "", label: "Explain role only" },
                ...rbacUsers.map((user) => ({ value: user.id, label: `${user.name || user.email} (${user.role})` })),
              ]}
            />
            <FieldSelect
              label="Role"
              value={appAccessProbe.role}
              onChange={(value) => setAppAccessProbe((current) => ({ ...current, role: value, userId: "" }))}
              options={allRoles.map((role) => ({ value: role, label: role }))}
            />
            <FieldSelect
              label="Application"
              value={appAccessProbe.appId}
              onChange={(value) => setAppAccessProbe((current) => ({ ...current, appId: value }))}
              options={rbacApps.map((app) => ({ value: app.id, label: `${app.name} (${app.permissions.length})` }))}
            />
            <button
              type="submit"
              disabled={saving || (!appAccessProbe.userId && !appAccessProbe.role) || !appAccessProbe.appId}
              className="flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Explain
            </button>
          </form>

          {appAccessExplanation && (
            <div className="mt-5 grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
              <div className={`rounded-lg border p-4 ${
                appAccessExplanation.allowed ? "border-emerald-500/30 bg-emerald-500/10" : "border-red-500/30 bg-red-500/10"
              }`}>
                <div className="flex items-center gap-2">
                  {appAccessExplanation.allowed ? <CheckCircle2 className="h-5 w-5 text-emerald-300" /> : <XCircle className="h-5 w-5 text-red-300" />}
                  <div className="font-medium text-gray-100">
                    {appAccessExplanation.role} {appAccessExplanation.allowed ? "has" : "does not have"} full access to {appAccessExplanation.app.name}
                  </div>
                </div>
                <div className="mt-3 text-sm leading-6 text-gray-400">{appAccessExplanation.app.description}</div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <MiniMetric label="Requirements" value={appAccessExplanation.requirements.length} />
                  <MiniMetric label="Missing" value={appAccessExplanation.missing.length} />
                  <MiniMetric label="Chat capabilities" value={appAccessExplanation.app.chatCapabilities} />
                  <MiniMetric label="Events" value={appAccessExplanation.app.events.length} />
                </div>
                {appAccessExplanation.trace.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {appAccessExplanation.trace.map((step, index) => (
                      <div key={`${step.label}-${index}`} className="rounded-md border border-gray-800 bg-gray-950 px-3 py-2">
                        <div className="flex items-center gap-2 text-xs font-medium text-gray-300">
                          <span className={`h-2 w-2 rounded-full ${
                            step.status === "allow" ? "bg-emerald-400" : step.status === "deny" ? "bg-red-400" : "bg-cyan-400"
                          }`} />
                          {step.label}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-gray-500">{step.detail}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-gray-200">Permission Requirements</div>
                  <div className="text-xs text-gray-600">{appAccessExplanation.app.permissions.join(", ")}</div>
                </div>
                <div className="space-y-2">
                  {appAccessExplanation.requirements.map((requirement) => (
                    <div key={`${requirement.resource}:${requirement.action}`} className="rounded-lg border border-gray-800 bg-gray-900 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${requirement.allowed ? "bg-emerald-400" : "bg-red-400"}`} />
                            <span className="font-mono text-xs text-gray-300">{requirement.resource}:{requirement.action}</span>
                            <span className={`rounded border px-1.5 py-0.5 text-[10px] ${riskClass(requirement.risk)}`}>{requirement.risk}</span>
                          </div>
                          <div className="mt-2 text-sm leading-5 text-gray-500">{requirement.description}</div>
                          <div className="mt-1 text-xs text-gray-600">{requirement.reason.replaceAll("_", " ")}</div>
                        </div>
                        {!requirement.allowed && (
                          <button
                            type="button"
                            onClick={() => onPrepareGrant(appAccessExplanation.role, requirement.resource, requirement.action)}
                            className="shrink-0 rounded-md border border-indigo-500/40 px-3 py-1.5 text-xs text-indigo-200 hover:bg-indigo-500/10"
                          >
                            Prepare grant
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {appAccessExplanation.remediation.length > 0 && (
                  <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                    Add the missing grants below in Grant Builder, then rerun this explanation to verify access.
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
