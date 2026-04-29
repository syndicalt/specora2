"use client";

import { type Dispatch, type SetStateAction } from "react";
import { ChevronDown, ChevronRight, Shield } from "lucide-react";
import { FieldSelect, MiniMetric } from "./components";
import type { FieldRestrictionField, FieldRestrictionTable } from "./types";

type RbacFieldRestrictionsSectionProps = {
  open: boolean;
  saving: boolean;
  restrictedFieldCount: number;
  fieldRestrictionTables: FieldRestrictionTable[];
  selectedFieldRestrictionTable: FieldRestrictionTable | null;
  setFieldRestrictionTableId: Dispatch<SetStateAction<string>>;
  defaultGrantRole: string;
  onToggle: () => void;
  onPrepareGrant: (role: string, resource: string, action: string) => void;
  onToggleFieldRestriction: (tableId: string, field: FieldRestrictionField, restricted: boolean) => void;
};

export function RbacFieldRestrictionsSection({
  open,
  saving,
  restrictedFieldCount,
  fieldRestrictionTables,
  selectedFieldRestrictionTable,
  setFieldRestrictionTableId,
  defaultGrantRole,
  onToggle,
  onPrepareGrant,
  onToggleFieldRestriction,
}: RbacFieldRestrictionsSectionProps) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-medium text-gray-200">
            <Shield className="h-4 w-4 text-amber-300" />
            Field Restrictions
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Mark sensitive fields as explicitly restricted, then grant read/write access by role.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-full border border-gray-700 bg-gray-950 px-3 py-1 text-xs text-gray-400">
            {restrictedFieldCount} restricted
          </div>
          <button type="button" onClick={onToggle} className="rounded-lg border border-gray-700 p-2 text-gray-400 hover:text-gray-100">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-4 grid gap-4 xl:grid-cols-[320px_1fr]">
          <div className="space-y-3">
            <FieldSelect
              label="Table"
              value={selectedFieldRestrictionTable?.id || ""}
              onChange={setFieldRestrictionTableId}
              options={fieldRestrictionTables.map((table) => ({ value: table.id, label: `${table.label} (${table.provider})` }))}
            />
            {selectedFieldRestrictionTable && (
              <div className="rounded-lg border border-gray-800 bg-gray-950 p-3 text-sm text-gray-500">
                <div className="text-gray-200">{selectedFieldRestrictionTable.label}</div>
                <div className="mt-1 font-mono text-xs">{selectedFieldRestrictionTable.id}</div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <MiniMetric label="Fields" value={selectedFieldRestrictionTable.fields.length} />
                  <MiniMetric label="Restricted" value={selectedFieldRestrictionTable.fields.filter((field) => field.restricted).length} />
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-gray-800 bg-gray-950">
            <div className="border-b border-gray-800 px-3 py-2 text-xs uppercase tracking-wide text-gray-500">
              Field Policy
            </div>
            <div className="scrollbar-thin max-h-96 overflow-y-auto p-2">
              {selectedFieldRestrictionTable?.fields.map((field) => (
                <div key={field.resource} className="mb-2 rounded-lg border border-gray-800 bg-gray-900 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-gray-100">{field.label}</span>
                        <span className="font-mono text-xs text-gray-500">{field.name}</span>
                        {!field.writable && <span className="rounded border border-gray-700 px-1.5 py-0.5 text-[10px] text-gray-400">read only</span>}
                        {field.restricted && <span className="rounded border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-100">restricted</span>}
                      </div>
                      <div className="mt-1 font-mono text-xs text-gray-600">{field.resource}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onPrepareGrant(defaultGrantRole, field.resource, "read")}
                        className="rounded-md border border-indigo-500/40 px-2.5 py-1.5 text-xs text-indigo-200 hover:bg-indigo-500/10"
                      >
                        Grant read
                      </button>
                      {field.writable && (
                        <button
                          type="button"
                          onClick={() => onPrepareGrant(defaultGrantRole, field.resource, "write")}
                          className="rounded-md border border-indigo-500/40 px-2.5 py-1.5 text-xs text-indigo-200 hover:bg-indigo-500/10"
                        >
                          Grant write
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => onToggleFieldRestriction(selectedFieldRestrictionTable.id, field, !field.restricted)}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                          field.restricted ? "border border-gray-700 text-gray-300 hover:bg-gray-800" : "bg-amber-600 text-white hover:bg-amber-500"
                        }`}
                      >
                        {field.restricted ? "Unrestrict" : "Restrict"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {!selectedFieldRestrictionTable && (
                <div className="px-3 py-8 text-center text-sm text-gray-500">No registered tables were returned.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
