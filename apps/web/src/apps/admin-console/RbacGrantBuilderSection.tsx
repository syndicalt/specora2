"use client";

import { type Dispatch, type FormEvent, type SetStateAction } from "react";
import { CheckCircle2, ClipboardCheck, Loader2, Plus, Save, Search } from "lucide-react";
import { FieldSelect } from "./components";
import { encodePermissionValue, riskClass } from "./helpers";
import type { Permission, RbacTarget } from "./types";

type GrantTarget = {
  resource: string;
  action: string;
};

type RbacGrantBuilderSectionProps = {
  saving: boolean;
  rbacTargets: RbacTarget[];
  filteredGrantTargets: RbacTarget[];
  selectedGrantTarget: RbacTarget | null;
  selectedPermissionTarget: string;
  selectedBulkGrants: Record<string, boolean>;
  selectedBulkGrantTargets: GrantTarget[];
  setSelectedBulkGrants: Dispatch<SetStateAction<Record<string, boolean>>>;
  grantScopes: string[];
  grantScope: string;
  setGrantScope: Dispatch<SetStateAction<string>>;
  grantSearch: string;
  setGrantSearch: Dispatch<SetStateAction<string>>;
  newRole: string;
  setNewRole: Dispatch<SetStateAction<string>>;
  setNewResource: Dispatch<SetStateAction<string>>;
  setNewAction: Dispatch<SetStateAction<string>>;
  newResource: string;
  newAction: string;
  allRoles: string[];
  existingGrant: Permission | null | undefined;
  onAddPermission: (event: FormEvent) => void;
  onBulkGrant: (role: string, grants: GrantTarget[]) => void;
};

export function RbacGrantBuilderSection({
  saving,
  rbacTargets,
  filteredGrantTargets,
  selectedGrantTarget,
  selectedPermissionTarget,
  selectedBulkGrants,
  selectedBulkGrantTargets,
  setSelectedBulkGrants,
  grantScopes,
  grantScope,
  setGrantScope,
  grantSearch,
  setGrantSearch,
  newRole,
  setNewRole,
  setNewResource,
  setNewAction,
  newResource,
  newAction,
  allRoles,
  existingGrant,
  onAddPermission,
  onBulkGrant,
}: RbacGrantBuilderSectionProps) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-medium text-gray-200">
            <Plus className="h-4 w-4 text-indigo-300" /> Grant Builder
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Search the registered permission catalog, preview impact, then grant the exact role/resource/action.
          </p>
        </div>
        <div className="rounded-full border border-gray-700 bg-gray-950 px-3 py-1 text-xs text-gray-400">
          {rbacTargets.length} registered targets
        </div>
      </div>

      <form onSubmit={onAddPermission} className="mt-4 grid gap-4 xl:grid-cols-[300px_1fr_360px]">
        <div className="space-y-3">
          <FieldSelect
            label="Role"
            value={newRole}
            onChange={setNewRole}
            options={[{ value: "", label: "Select role" }, ...allRoles.map((role) => ({ value: role, label: role }))]}
          />
          <div>
            <label className="mb-1 block text-xs text-gray-500">Scope</label>
            <div className="scrollbar-thin flex max-h-44 flex-wrap gap-2 overflow-y-auto rounded-lg border border-gray-800 bg-gray-950 p-2">
              {grantScopes.map((scope) => (
                <button
                  key={scope}
                  type="button"
                  onClick={() => setGrantScope(scope)}
                  className={`rounded-md px-2.5 py-1.5 text-xs ${grantScope === scope ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:text-gray-100"}`}
                >
                  {scope}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <input
                value={grantSearch}
                onChange={(event) => setGrantSearch(event.target.value)}
                placeholder="Find app, table, field, action..."
                className="w-full rounded-lg border border-gray-700 bg-gray-800 py-2 pl-9 pr-3 text-sm text-gray-200 outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        </div>

        <div className="min-h-[320px] rounded-lg border border-gray-800 bg-gray-950">
          <div className="border-b border-gray-800 px-3 py-2 text-xs uppercase tracking-wide text-gray-500">
            <div className="flex items-center justify-between gap-3">
              <span>Permission Catalog</span>
              <span>{selectedBulkGrantTargets.length} selected</span>
            </div>
          </div>
          <div className="scrollbar-thin max-h-[430px] overflow-y-auto p-2">
            {filteredGrantTargets.map((target) => {
              const selected = selectedPermissionTarget === encodePermissionValue(target.resource, target.action);
              const bulkKey = encodePermissionValue(target.resource, target.action);
              const bulkSelected = Boolean(selectedBulkGrants[bulkKey]);
              return (
                <div
                  key={`${target.resource}:${target.action}`}
                  className={`mb-2 w-full rounded-lg border px-3 py-3 text-left transition-colors ${
                    selected ? "border-indigo-400 bg-indigo-500/15" : "border-gray-800 bg-gray-900 hover:border-gray-700"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedBulkGrants((current) => ({ ...current, [bulkKey]: !current[bulkKey] }))}
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${bulkSelected ? "border-indigo-400 bg-indigo-500 text-white" : "border-gray-700 text-transparent"}`}
                      title={bulkSelected ? "Remove from bulk grant" : "Select for bulk grant"}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setNewResource(target.resource);
                        setNewAction(target.action);
                      }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="truncate text-sm font-medium text-gray-100">{target.label || target.resource}</div>
                      <div className="mt-1 truncate font-mono text-xs text-gray-500">{target.resource}:{target.action}</div>
                    </button>
                    <span className={`shrink-0 rounded border px-2 py-0.5 text-[11px] ${riskClass(target.risk)}`}>{target.risk}</span>
                  </div>
                  <div className="mt-2 text-sm leading-5 text-gray-500">{target.description}</div>
                  <div className="mt-2 text-xs text-gray-600">{target.source || target.category}</div>
                </div>
              );
            })}
            {!filteredGrantTargets.length && (
              <div className="px-3 py-10 text-center text-sm text-gray-500">No permissions match this filter.</div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Grant Preview</div>
          {selectedGrantTarget ? (
            <div className="mt-4 space-y-4">
              <div>
                <div className="text-sm font-medium text-gray-100">{selectedGrantTarget.label || selectedGrantTarget.resource}</div>
                <div className="mt-1 font-mono text-xs text-gray-500">{selectedGrantTarget.resource}:{selectedGrantTarget.action}</div>
              </div>
              <div className="rounded-lg border border-gray-800 bg-gray-900 p-3 text-sm leading-6 text-gray-400">
                {selectedGrantTarget.description}
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs uppercase tracking-wide text-gray-600">Scope</div>
                  <div className="mt-1 text-gray-300">{selectedGrantTarget.category || "Application"}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-gray-600">Risk</div>
                  <div className={`mt-1 inline-flex rounded border px-2 py-0.5 text-xs ${riskClass(selectedGrantTarget.risk)}`}>{selectedGrantTarget.risk}</div>
                </div>
              </div>
              <div className="rounded-lg border border-gray-800 bg-gray-900 p-3 text-sm text-gray-500">
                {newRole ? (
                  existingGrant ? (
                    <span className="text-amber-200">Role {newRole} already has this grant.</span>
                  ) : (
                    <span>Role <span className="text-gray-200">{newRole}</span> will receive this exact permission.</span>
                  )
                ) : "Select a role to preview who receives this grant."}
              </div>
              <button
                type="button"
                disabled={saving || !newRole || !selectedBulkGrantTargets.length}
                onClick={() => onBulkGrant(newRole, selectedBulkGrantTargets)}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-500/40 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-500/10 disabled:opacity-50"
              >
                <ClipboardCheck className="h-4 w-4" /> Bulk Grant Selected ({selectedBulkGrantTargets.length})
              </button>
              <button
                type="submit"
                disabled={saving || !newRole || !newResource || !newAction || Boolean(existingGrant)}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Grant Permission
              </button>
            </div>
          ) : (
            <div className="mt-10 text-center text-sm leading-6 text-gray-500">
              Select a permission target to see description, risk, and grant impact.
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
