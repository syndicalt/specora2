"use client";

import { type Dispatch, type FormEvent, type SetStateAction } from "react";
import { Activity, CheckCircle2, ChevronDown, ChevronRight, Loader2, Search, XCircle } from "lucide-react";
import { FieldSelect, MiniMetric } from "./components";
import { encodePermissionValue, riskClass } from "./helpers";
import type { RbacTool, RbacUser, ToolAccessExplanation } from "./types";

type ToolAccessProbe = {
  userId: string;
  role: string;
  tool: string;
};

type RbacToolAccessSectionProps = {
  open: boolean;
  saving: boolean;
  toolAccessProbe: ToolAccessProbe;
  setToolAccessProbe: Dispatch<SetStateAction<ToolAccessProbe>>;
  toolAccessExplanation: ToolAccessExplanation | null;
  rbacUsers: RbacUser[];
  allRoles: string[];
  rbacTools: RbacTool[];
  onToggle: () => void;
  onExplain: (event: FormEvent) => void;
  onPrepareGrant: (role: string, resource: string, action: string) => void;
};

export function RbacToolAccessSection({
  open,
  saving,
  toolAccessProbe,
  setToolAccessProbe,
  toolAccessExplanation,
  rbacUsers,
  allRoles,
  rbacTools,
  onToggle,
  onExplain,
  onPrepareGrant,
}: RbacToolAccessSectionProps) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-medium text-gray-200">
            <Activity className="h-4 w-4 text-indigo-300" />
            Explain Tool Access
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Troubleshoot chat, automation, and app-tool execution failures against the same policy used at runtime.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {toolAccessExplanation && (
            <div className={`rounded-full px-3 py-1 text-xs font-medium ${
              toolAccessExplanation.allowed ? "bg-emerald-500/10 text-emerald-200" : "bg-red-500/10 text-red-200"
            }`}>
              {toolAccessExplanation.allowed ? "Executable" : "Blocked"}
            </div>
          )}
          <button type="button" onClick={onToggle} className="rounded-lg border border-gray-700 p-2 text-gray-400 hover:text-gray-100">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {open && (
        <>
          <form onSubmit={onExplain} className="mt-4 grid items-end gap-3 lg:grid-cols-[1.2fr_1fr_1.5fr_auto]">
            <FieldSelect
              label="User"
              value={toolAccessProbe.userId}
              onChange={(value) => {
                const user = rbacUsers.find((candidate) => candidate.id === value);
                setToolAccessProbe((current) => ({ ...current, userId: value, role: user?.role || current.role }));
              }}
              options={[
                { value: "", label: "Explain role only" },
                ...rbacUsers.map((user) => ({ value: user.id, label: `${user.name || user.email} (${user.role})` })),
              ]}
            />
            <FieldSelect
              label="Role"
              value={toolAccessProbe.role}
              onChange={(value) => setToolAccessProbe((current) => ({ ...current, role: value, userId: "" }))}
              options={allRoles.map((role) => ({ value: role, label: role }))}
            />
            <FieldSelect
              label="Tool"
              value={toolAccessProbe.tool}
              onChange={(value) => setToolAccessProbe((current) => ({ ...current, tool: value }))}
              options={rbacTools.map((tool) => ({
                value: encodePermissionValue(tool.appId, tool.toolName),
                label: `${tool.fullName} -> ${tool.resource}:${tool.action}`,
              }))}
            />
            <button
              type="submit"
              disabled={saving || (!toolAccessProbe.userId && !toolAccessProbe.role) || !toolAccessProbe.tool}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Explain
            </button>
          </form>

          {toolAccessExplanation && (
            <div className="mt-5 grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
              <div className={`rounded-lg border p-4 ${
                toolAccessExplanation.allowed ? "border-emerald-500/30 bg-emerald-500/10" : "border-red-500/30 bg-red-500/10"
              }`}>
                <div className="flex items-center gap-2">
                  {toolAccessExplanation.allowed ? <CheckCircle2 className="h-5 w-5 text-emerald-300" /> : <XCircle className="h-5 w-5 text-red-300" />}
                  <div className="font-medium text-gray-100">
                    {toolAccessExplanation.role} {toolAccessExplanation.allowed ? "can execute" : "cannot execute"} {toolAccessExplanation.tool.fullName}
                  </div>
                </div>
                <div className="mt-3 text-sm leading-6 text-gray-400">{toolAccessExplanation.tool.description || "No tool description registered."}</div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <MiniMetric label="Resolved resource" value={toolAccessExplanation.tool.resource} />
                  <MiniMetric label="Required action" value={toolAccessExplanation.tool.action} />
                  <MiniMetric label="Risk" value={toolAccessExplanation.tool.risk} />
                  <MiniMetric label="Policy result" value={toolAccessExplanation.requirement.reason.replaceAll("_", " ")} />
                </div>
                {!toolAccessExplanation.allowed && (
                  <button
                    type="button"
                    onClick={() => onPrepareGrant(toolAccessExplanation.role, toolAccessExplanation.tool.resource, toolAccessExplanation.tool.action)}
                    className="mt-4 rounded-md border border-indigo-500/40 px-3 py-1.5 text-xs text-indigo-200 hover:bg-indigo-500/10"
                  >
                    Prepare missing grant
                  </button>
                )}
              </div>

              <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-gray-200">Runtime Decision Trace</div>
                  <span className={`rounded border px-2 py-0.5 text-xs ${riskClass(toolAccessExplanation.tool.risk)}`}>{toolAccessExplanation.tool.risk}</span>
                </div>
                <div className="space-y-2">
                  {toolAccessExplanation.trace.map((step, index) => (
                    <div key={`${step.label}-${index}`} className="rounded-md border border-gray-800 bg-gray-900 px-3 py-2">
                      <div className="flex items-center gap-2 text-xs font-medium text-gray-300">
                        <span className={`h-2 w-2 rounded-full ${
                          step.status === "allow" ? "bg-emerald-400" : step.status === "deny" ? "bg-red-400" : "bg-indigo-400"
                        }`} />
                        {step.label}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-gray-500">{step.detail}</div>
                    </div>
                  ))}
                </div>
                {toolAccessExplanation.remediation.length > 0 && (
                  <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                    This is the same resource/action check used by app tool REST, queued jobs, and chat tool execution.
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
