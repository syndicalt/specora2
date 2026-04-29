"use client";

import { type Dispatch, type FormEvent, type SetStateAction } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Database, Loader2, Search, XCircle } from "lucide-react";
import { FieldSelect, MiniMetric } from "./components";
import type { RbacTable, RbacUser, TableAccessExplanation } from "./types";

type TableAccessProbe = {
  userId: string;
  role: string;
  tableId: string;
  fieldName: string;
  accessMode: string;
};

type RbacTableAccessSectionProps = {
  open: boolean;
  saving: boolean;
  tableAccessProbe: TableAccessProbe;
  setTableAccessProbe: Dispatch<SetStateAction<TableAccessProbe>>;
  tableAccessExplanation: TableAccessExplanation | null;
  rbacUsers: RbacUser[];
  allRoles: string[];
  rbacTables: RbacTable[];
  tableFieldOptions: Array<{ value: string; label: string }>;
  onToggle: () => void;
  onExplain: (event: FormEvent) => void;
  onPrepareGrant: (role: string, resource: string, action: string) => void;
};

export function RbacTableAccessSection({
  open,
  saving,
  tableAccessProbe,
  setTableAccessProbe,
  tableAccessExplanation,
  rbacUsers,
  allRoles,
  rbacTables,
  tableFieldOptions,
  onToggle,
  onExplain,
  onPrepareGrant,
}: RbacTableAccessSectionProps) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-medium text-gray-200">
            <Database className="h-4 w-4 text-emerald-300" />
            Explain Table & Field Access
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Verify table access and field-level restrictions using the same policy path enforced by table-backed APIs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tableAccessExplanation && (
            <div className={`rounded-full px-3 py-1 text-xs font-medium ${
              tableAccessExplanation.allowed ? "bg-emerald-500/10 text-emerald-200" : "bg-red-500/10 text-red-200"
            }`}>
              {tableAccessExplanation.allowed ? "Allowed" : `${tableAccessExplanation.missing.length} missing`}
            </div>
          )}
          <button type="button" onClick={onToggle} className="rounded-lg border border-gray-700 p-2 text-gray-400 hover:text-gray-100">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {open && (
        <>
          <form onSubmit={onExplain} className="mt-4 grid items-end gap-3 xl:grid-cols-[1.2fr_1fr_1.35fr_1fr_0.8fr_auto]">
            <FieldSelect
              label="User"
              value={tableAccessProbe.userId}
              onChange={(value) => {
                const user = rbacUsers.find((candidate) => candidate.id === value);
                setTableAccessProbe((current) => ({ ...current, userId: value, role: user?.role || current.role }));
              }}
              options={[
                { value: "", label: "Explain role only" },
                ...rbacUsers.map((user) => ({ value: user.id, label: `${user.name || user.email} (${user.role})` })),
              ]}
            />
            <FieldSelect
              label="Role"
              value={tableAccessProbe.role}
              onChange={(value) => setTableAccessProbe((current) => ({ ...current, role: value, userId: "" }))}
              options={allRoles.map((role) => ({ value: role, label: role }))}
            />
            <FieldSelect
              label="Table"
              value={tableAccessProbe.tableId}
              onChange={(value) => setTableAccessProbe((current) => ({ ...current, tableId: value, fieldName: "" }))}
              options={rbacTables.map((table) => ({ value: table.id, label: `${table.label} (${table.provider})` }))}
            />
            <FieldSelect
              label="Field"
              value={tableAccessProbe.fieldName}
              onChange={(value) => setTableAccessProbe((current) => ({ ...current, fieldName: value }))}
              options={tableFieldOptions}
            />
            <FieldSelect
              label="Mode"
              value={tableAccessProbe.accessMode}
              onChange={(value) => setTableAccessProbe((current) => ({ ...current, accessMode: value }))}
              options={[
                { value: "read", label: "Read" },
                { value: "write", label: "Write" },
              ]}
            />
            <button
              type="submit"
              disabled={saving || (!tableAccessProbe.userId && !tableAccessProbe.role) || !tableAccessProbe.tableId}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Explain
            </button>
          </form>

          {tableAccessExplanation && (
            <div className="mt-5 grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
              <div className={`rounded-lg border p-4 ${
                tableAccessExplanation.allowed ? "border-emerald-500/30 bg-emerald-500/10" : "border-red-500/30 bg-red-500/10"
              }`}>
                <div className="flex items-center gap-2">
                  {tableAccessExplanation.allowed ? <CheckCircle2 className="h-5 w-5 text-emerald-300" /> : <XCircle className="h-5 w-5 text-red-300" />}
                  <div className="font-medium text-gray-100">
                    {tableAccessExplanation.role} {tableAccessExplanation.allowed ? "can" : "cannot"} {tableAccessExplanation.accessMode} {tableAccessExplanation.table.label}
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <MiniMetric label="Table read" value={tableAccessExplanation.tableAccess.read.allowed ? "allowed" : "missing"} />
                  <MiniMetric label="Table write" value={tableAccessExplanation.tableAccess.write.allowed ? "allowed" : "missing"} />
                  <MiniMetric label="Fields checked" value={tableAccessExplanation.fields.length} />
                  <MiniMetric label="Restricted" value={tableAccessExplanation.fields.filter((field) => field.restricted).length} />
                </div>
                {tableAccessExplanation.missing.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {tableAccessExplanation.missing.map((item) => (
                      <button
                        key={`${item.resource}:${item.action}`}
                        type="button"
                        onClick={() => onPrepareGrant(tableAccessExplanation.role, item.resource, item.action)}
                        className="block w-full rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-100 hover:bg-amber-500/15"
                      >
                        Prepare {item.resource}:{item.action}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-gray-200">Field Decisions</div>
                  <span className="font-mono text-xs text-gray-600">{tableAccessExplanation.table.id}</span>
                </div>
                <div className="scrollbar-thin max-h-72 space-y-2 overflow-y-auto pr-1">
                  {tableAccessExplanation.fields.map((field) => (
                    <div key={field.field} className="rounded-lg border border-gray-800 bg-gray-900 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-gray-100">{field.label}</span>
                            <span className="font-mono text-xs text-gray-500">{field.field}</span>
                            {field.restricted && <span className="rounded border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-100">restricted</span>}
                            {!field.writable && <span className="rounded border border-gray-700 px-1.5 py-0.5 text-[10px] text-gray-400">read only</span>}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs">
                            <span className={field.read ? "text-emerald-300" : "text-red-300"}>read: {field.readReason.replaceAll("_", " ")}</span>
                            <span className={field.write || !field.writable ? "text-emerald-300" : "text-red-300"}>write: {field.writeReason.replaceAll("_", " ")}</span>
                          </div>
                        </div>
                        {field.restricted && !field.read && (
                          <button
                            type="button"
                            onClick={() => onPrepareGrant(tableAccessExplanation.role, field.resource, "read")}
                            className="shrink-0 rounded-md border border-indigo-500/40 px-2 py-1 text-xs text-indigo-200 hover:bg-indigo-500/10"
                          >
                            Grant read
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 space-y-2">
                  {tableAccessExplanation.trace.map((step, index) => (
                    <div key={`${step.label}-${index}`} className="rounded-md border border-gray-800 bg-gray-900 px-3 py-2">
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
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
