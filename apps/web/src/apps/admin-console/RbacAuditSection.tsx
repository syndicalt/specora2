"use client";

import { type Dispatch, type FormEvent, type SetStateAction } from "react";
import { Activity, CheckCircle2, ChevronDown, ChevronRight, Download, Loader2, Search, XCircle } from "lucide-react";
import { formatDateTime } from "./helpers";
import type { AuditEntry, AuditIntegrity } from "./types";

type RbacAuditSectionProps = {
  open: boolean;
  saving: boolean;
  auditTotal: number;
  auditIntegrity: AuditIntegrity | null;
  auditSearch: string;
  setAuditSearch: Dispatch<SetStateAction<string>>;
  auditEntries: AuditEntry[];
  onToggle: () => void;
  onVerify: () => void;
  onSearch: (event: FormEvent) => void;
  onExport: () => void;
};

export function RbacAuditSection({
  open,
  saving,
  auditTotal,
  auditIntegrity,
  auditSearch,
  setAuditSearch,
  auditEntries,
  onToggle,
  onVerify,
  onSearch,
  onExport,
}: RbacAuditSectionProps) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-medium text-gray-200">
            <Activity className="h-4 w-4 text-cyan-300" />
            Audit Search
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Search administrative evidence and export the current result set for review.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-full border border-gray-700 bg-gray-950 px-3 py-1 text-xs text-gray-400">{auditTotal} events</div>
          <button type="button" onClick={onToggle} className="rounded-lg border border-gray-700 p-2 text-gray-400 hover:text-gray-100">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-4 space-y-4">
          {auditIntegrity && (
            <div className={`rounded-lg border p-3 ${auditIntegrity.verified ? "border-emerald-500/30 bg-emerald-500/10" : "border-red-500/30 bg-red-500/10"}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-100">
                  {auditIntegrity.verified ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <XCircle className="h-4 w-4 text-red-300" />}
                  Audit chain {auditIntegrity.verified ? "verified" : "failed verification"}
                </div>
                <button type="button" onClick={onVerify} disabled={saving} className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-800 disabled:opacity-50">
                  Verify chain
                </button>
              </div>
              <div className="mt-2 grid gap-2 text-xs text-gray-500 md:grid-cols-3">
                <div>Checked <span className="text-gray-200">{auditIntegrity.checked}</span></div>
                <div>Legacy <span className="text-gray-200">{auditIntegrity.legacyRows}</span></div>
                <div>Failures <span className={auditIntegrity.failures.length ? "text-red-200" : "text-gray-200"}>{auditIntegrity.failures.length}</span></div>
                <div className="truncate md:col-span-3">Head <span className="font-mono text-gray-400">{auditIntegrity.headHash || "-"}</span></div>
              </div>
            </div>
          )}
          <form onSubmit={onSearch} className="flex flex-col gap-3 md:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-500" />
              <input
                value={auditSearch}
                onChange={(event) => setAuditSearch(event.target.value)}
                placeholder="Search action, entity, actor email..."
                className="w-full rounded-lg border border-gray-700 bg-gray-800 py-2 pl-9 pr-3 text-sm text-gray-200 outline-none focus:border-indigo-500"
              />
            </div>
            <button type="submit" disabled={saving} className="flex items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search
            </button>
            <button type="button" onClick={onExport} className="flex items-center justify-center gap-2 rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-800">
              <Download className="h-4 w-4" /> Export CSV
            </button>
          </form>
          <div className="scrollbar-thin max-h-80 overflow-y-auto rounded-lg border border-gray-800 bg-gray-950">
            {auditEntries.map((entry) => (
              <div key={entry.id} className="border-b border-gray-800 px-3 py-3 last:border-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-mono text-xs text-gray-300">{entry.action}</div>
                  <div className="text-xs text-gray-600">{formatDateTime(entry.createdAt || entry.created_at)}</div>
                </div>
                <div className="mt-1 text-sm text-gray-400">{entry.entityType} <span className="font-mono text-xs text-gray-600">{entry.entityId}</span></div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-600">
                  <span>{entry.actorEmail || entry.actorName || entry.actorId || "system"}</span>
                  {entry.entryHash && <span className="font-mono">hash {entry.entryHash.slice(0, 12)}</span>}
                </div>
              </div>
            ))}
            {!auditEntries.length && <div className="px-3 py-8 text-center text-sm text-gray-500">No audit events match this search.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
