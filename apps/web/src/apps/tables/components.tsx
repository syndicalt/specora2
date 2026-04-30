import { useRef } from "react";
import type React from "react";
import { Check, Edit3, History, Plus, RefreshCw, Save, Upload, X } from "lucide-react";
import { ReferenceTypeahead, type ReferenceOption } from "@/components/ReferenceTypeahead";
import { IMPORT_LIMIT, INLINE_SELECT_CLASS, RELATIONSHIP_TYPES, SELECT_CLASS } from "./constants";
import {
  auditDiffRows,
  canReadAttr,
  canWriteAttr,
  formatDateTime,
  formatValue,
  primitiveCellValue,
  validationIssuesForForm,
} from "./helpers";
import { MetricPill } from "./MetricPill";
import type {
  AttributeDef,
  AuditEntry,
  EditorMode,
  ImportDecision,
  ImportField,
  ImportMode,
  ImportPayloadRow,
  ImportRow,
  TableDef,
  TableFilter,
  TableRecord,
  ValidationIssue,
} from "./types";

export function ImportWorkbench({
  table,
  headers,
  rows,
  fields,
  mapping,
  fileName,
  busy,
  mode,
  matchKeys,
  decisions,
  decisionCounts,
  readyCount,
  preview,
  onFile,
  onMap,
  onModeChange,
  onToggleMatchKey,
  onPreview,
  onCommit,
  onReset,
  onClose,
}: {
  table: TableDef;
  headers: string[];
  rows: ImportRow[];
  fields: ImportField[];
  mapping: Record<string, string>;
  fileName: string;
  busy: boolean;
  mode: ImportMode;
  matchKeys: string[];
  decisions: ImportDecision[];
  decisionCounts: Record<ImportDecision["action"], number>;
  readyCount: number;
  preview: ImportPayloadRow[];
  onFile: (file: File | null) => void;
  onMap: (header: string, target: string) => void;
  onModeChange: (mode: ImportMode) => void;
  onToggleMatchKey: (key: string) => void;
  onPreview: () => void;
  onCommit: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const previewIssues = preview.map((row) => validationIssuesForForm(table, {
    id: "",
    name: row.name || "",
    environment: row.environment || "",
    ...Object.fromEntries(table.attributes.map((attr) => [attr.name, primitiveCellValue(row.attributes[attr.name])])),
  }));
  return (
    <section className="shrink-0 border-b border-cyan-500/20 bg-cyan-950/10 px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-cyan-100">
            <Upload className="h-4 w-4" />
            Import Records
          </div>
          <p className="mt-1 text-xs text-gray-500">CSV, JSON, or first-sheet XLSX. Create, update, or upsert with server-side matching and generated IDs.</p>
        </div>
        <button onClick={onClose} className="rounded-lg border border-gray-700 p-2 text-gray-400 hover:text-white" title="Close import">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[340px_1fr]">
        <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-3">
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Source file</label>
          <input
            type="file"
            accept=".csv,.json,.xlsx,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => onFile(event.target.files?.[0] || null)}
            className="mt-2 block w-full cursor-pointer rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-300 file:mr-3 file:rounded-md file:border-0 file:bg-cyan-500 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gray-950 hover:border-cyan-500/50"
          />
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <MetricPill label="Rows" value={rows.length} />
            <MetricPill label="Ready" value={readyCount} tone={readyCount === rows.length && rows.length ? "good" : "warn"} />
            <MetricPill label="Limit" value={IMPORT_LIMIT} />
          </div>
          <div className="mt-3">
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Import mode</label>
            <select data-testid="tables-import-mode" value={mode} onChange={(event) => onModeChange(event.target.value as ImportMode)} className={`mt-2 w-full ${SELECT_CLASS}`}>
              <option value="create">Create only</option>
              <option value="update">Update matched records only</option>
              <option value="upsert">Upsert matched records</option>
            </select>
          </div>
          {mode !== "create" && (
            <div className="mt-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Match keys</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {fields.map((field) => (
                  <button
                    key={field.key}
                    type="button"
                    onClick={() => onToggleMatchKey(field.key)}
                    className={`rounded-full border px-2.5 py-1 text-xs ${matchKeys.includes(field.key) ? "border-cyan-400 bg-cyan-500/15 text-cyan-100" : "border-gray-700 text-gray-400 hover:text-white"}`}
                  >
                    {field.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {fileName && <div className="mt-3 truncate font-mono text-xs text-gray-500">{fileName}</div>}
          <div className="mt-3 flex gap-2">
            <button onClick={onPreview} disabled={busy || !rows.length || readyCount !== rows.length || (mode !== "create" && !matchKeys.length)} className="rounded-lg border border-cyan-500/40 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-500/10 disabled:opacity-50">
              Preview
            </button>
            <button onClick={onCommit} disabled={busy || !rows.length || readyCount !== rows.length || (mode !== "create" && (!decisions.length || !!decisionCounts.conflict))} className="flex-1 rounded-lg bg-cyan-500 px-3 py-2 text-sm font-medium text-gray-950 hover:bg-cyan-400 disabled:opacity-50">
              {busy ? "Working..." : "Commit import"}
            </button>
            <button onClick={onReset} disabled={busy || !rows.length} className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:text-white disabled:opacity-50">
              Reset
            </button>
          </div>
        </div>
        <div className="min-w-0 rounded-lg border border-gray-800 bg-gray-900/60 p-3">
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Column mapping</div>
              <div className="scrollbar-thin max-h-64 space-y-2 overflow-y-auto pr-1">
                {headers.map((header) => (
                  <div key={header} className="grid grid-cols-[minmax(0,1fr)_220px] items-center gap-2 rounded-lg border border-gray-800 bg-gray-950 px-2 py-2">
                    <div className="truncate text-sm text-gray-300" title={header}>{header}</div>
                    <select value={mapping[header] || ""} onChange={(event) => onMap(header, event.target.value)} className={SELECT_CLASS}>
                      <option value="">Do not import</option>
                      {fields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
                    </select>
                  </div>
                ))}
                {!headers.length && <div className="rounded-lg border border-dashed border-gray-800 px-3 py-8 text-center text-sm text-gray-600">Choose a file to map columns.</div>}
              </div>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Preview</div>
                {decisions.length > 0 && (
                  <div className="flex gap-1 text-[10px]">
                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-200">{decisionCounts.create || 0} create</span>
                    <span className="rounded bg-indigo-500/10 px-1.5 py-0.5 text-indigo-200">{decisionCounts.update || 0} update</span>
                    <span className="rounded bg-gray-700/40 px-1.5 py-0.5 text-gray-300">{decisionCounts.skip || 0} skip</span>
                    {!!decisionCounts.conflict && <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-red-200">{decisionCounts.conflict} conflict</span>}
                  </div>
                )}
              </div>
              <div className="scrollbar-thin max-h-64 space-y-2 overflow-y-auto pr-1">
                {preview.map((row, index) => (
                  <div key={index} className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate text-sm font-medium text-gray-200">{row.name || `Row ${index + 1}`}</div>
                      {decisions[index] ? (
                        <span className={`rounded px-2 py-0.5 text-xs ${
                          decisions[index].action === "conflict" ? "bg-red-500/10 text-red-200" :
                          decisions[index].action === "update" ? "bg-indigo-500/10 text-indigo-200" :
                          decisions[index].action === "skip" ? "bg-gray-700/40 text-gray-300" :
                          "bg-emerald-500/10 text-emerald-200"
                        }`}>
                          {decisions[index].action}
                        </span>
                      ) : previewIssues[index]?.length ? (
                        <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-200">{previewIssues[index].length} issue(s)</span>
                      ) : (
                        <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-200">ready</span>
                      )}
                    </div>
                    <div className="mt-1 truncate text-xs text-gray-500">{row.environment || "No environment"} / {Object.keys(row.attributes).filter((key) => row.attributes[key] !== "").join(", ") || "no attributes"}</div>
                    {decisions[index]?.recordName && <div className="mt-1 truncate text-xs text-indigo-300">Match: {decisions[index].recordName}</div>}
                    {decisions[index]?.reason && <div className="mt-1 truncate text-xs text-amber-300">{decisions[index].reason}</div>}
                  </div>
                ))}
                {!preview.length && <div className="rounded-lg border border-dashed border-gray-800 px-3 py-8 text-center text-sm text-gray-600">Preview appears after mapping.</div>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function FilterValueInput({ filter, attr, onChange }: { filter: TableFilter; attr?: AttributeDef; onChange: (value: string) => void }) {
  if (filter.field === "__relationshipState") {
    return (
      <select value={filter.value || "orphaned"} onChange={(event) => onChange(event.target.value)} className={SELECT_CLASS}>
        <option value="orphaned">Orphaned</option>
        <option value="connected">Connected</option>
      </select>
    );
  }
  if (filter.field === "__relationshipType") {
    return (
      <select value={filter.value} onChange={(event) => onChange(event.target.value)} className={SELECT_CLASS}>
        <option value="">Select relationship</option>
        {RELATIONSHIP_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
    );
  }
  if (attr?.attrType === "boolean") {
    return (
      <select value={filter.value || "true"} onChange={(event) => onChange(event.target.value)} className={SELECT_CLASS}>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (attr?.attrType === "enum" && attr.enumValues?.length) {
    return (
      <select value={filter.value} onChange={(event) => onChange(event.target.value)} className={SELECT_CLASS}>
        <option value="">Select value</option>
        {attr.enumValues.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
    );
  }
  return (
    <input
      value={filter.value}
      onChange={(event) => onChange(event.target.value)}
      type={attr?.attrType === "number" ? "number" : attr?.attrType === "date" ? "date" : "text"}
      placeholder="Value"
      className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500"
    />
  );
}

export function BulkValueInput({ attr, value, onChange }: { attr?: AttributeDef; value: string; onChange: (value: string) => void }) {
  if (attr?.attrType === "boolean") {
    return (
      <select value={value || "false"} onChange={(event) => onChange(event.target.value)} className={SELECT_CLASS}>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (attr?.attrType === "enum" && attr.enumValues?.length) {
    return (
      <select value={value} onChange={(event) => onChange(event.target.value)} className={SELECT_CLASS}>
        <option value="">Select value</option>
        {attr.enumValues.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    );
  }
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      type={attr?.attrType === "number" ? "number" : attr?.attrType === "date" ? "date" : "text"}
      placeholder="New value"
      className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500"
    />
  );
}

export function ValidationBadge({ issues, open, onToggle }: { issues: ValidationIssue[]; open: boolean; onToggle: () => void }) {
  if (!issues.length) return <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-200">Clean</span>;
  const hard = issues.filter((issue) => issue.severity === "error").length;
  const title = issues.map((issue) => issue.label).join(", ");
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        title={`Missing: ${title}`}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        className={`cursor-pointer rounded px-1.5 py-0.5 text-[10px] font-medium hover:ring-1 hover:ring-current ${hard ? "bg-red-500/10 text-red-200" : "bg-amber-500/10 text-amber-200"}`}
      >
        {issues.length} issue{issues.length === 1 ? "" : "s"}
      </button>
      {open && (
        <span className="absolute left-0 top-6 z-30 w-56 rounded-lg border border-gray-700 bg-gray-950 p-2 text-xs shadow-2xl">
          <span className="mb-1 block font-semibold text-gray-200">Validation issues</span>
          {issues.map((issue) => (
            <span key={`${issue.field}:${issue.severity}`} className="block rounded px-2 py-1 text-gray-300">
              <span className={issue.severity === "error" ? "text-red-300" : "text-amber-300"}>{issue.severity === "error" ? "Required" : "Health"}</span>
              <span className="text-gray-600"> / </span>
              {issue.label} is missing
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

function ValidationIssuePanel({ issues, title = "Stewardship validation" }: { issues: ValidationIssue[]; title?: string }) {
  if (!issues.length) {
    return (
      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
        {title}: required stewardship checks passed.
      </div>
    );
  }
  const required = issues.filter((issue) => issue.severity === "error").length;
  return (
    <div className={`rounded-lg border px-3 py-3 ${required ? "border-red-500/20 bg-red-500/10" : "border-amber-500/20 bg-amber-500/10"}`}>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">{title}</div>
      <div className={`text-sm font-medium ${required ? "text-red-100" : "text-amber-100"}`}>
        {issues.length} stewardship issue{issues.length === 1 ? "" : "s"} to resolve
      </div>
      <div className="mt-2 space-y-1">
        {issues.map((issue) => (
          <div key={`${issue.field}:${issue.severity}`} className="flex items-center justify-between gap-3 rounded border border-gray-800/70 bg-gray-950/60 px-2 py-1.5 text-xs">
            <span className="truncate text-gray-200">{issue.message || issue.label}</span>
            <span className={issue.severity === "error" ? "text-red-300" : "text-amber-300"}>
              {issue.severity === "error" ? "Required" : issue.reason === "missing_relationship" ? "Relationship" : "Health field"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function InlineCellEditor({
  attr,
  value,
  saving,
  onChange,
  onCommit,
  onCancel,
}: {
  attr?: AttributeDef;
  value: string;
  saving: boolean;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const className = "w-full min-w-32 rounded border border-indigo-500 bg-gray-950 px-2 py-1 text-sm text-gray-100 outline-none focus:border-cyan-400";
  const closedRef = useRef(false);
  const commitOnce = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    onCommit();
  };
  const cancelOnce = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    onCancel();
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (event.key === "Enter") commitOnce();
    if (event.key === "Escape") cancelOnce();
  };
  if (attr?.attrType === "boolean") {
    return (
      <select autoFocus disabled={saving} value={value || "false"} onBlur={commitOnce} onKeyDown={onKeyDown} onChange={(event) => onChange(event.target.value)} className={INLINE_SELECT_CLASS}>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (attr?.attrType === "enum" && attr.enumValues?.length) {
    return (
      <select autoFocus disabled={saving} value={value} onBlur={commitOnce} onKeyDown={onKeyDown} onChange={(event) => onChange(event.target.value)} className={INLINE_SELECT_CLASS}>
        <option value="">Select value</option>
        {attr.enumValues.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    );
  }
  return (
    <input
      autoFocus
      disabled={saving}
      value={value}
      onBlur={commitOnce}
      onKeyDown={onKeyDown}
      onChange={(event) => onChange(event.target.value)}
      type={attr?.attrType === "number" ? "number" : attr?.attrType === "date" ? "date" : "text"}
      className={className}
    />
  );
}

export function RecordEditor({
  table,
  editor,
  saving,
  auditEntries,
  serverValidationIssues,
  environments,
  referenceOptions,
  onChange,
  onClose,
  onSave,
}: {
  table: TableDef;
  editor: { mode: EditorMode; record?: TableRecord; form: Record<string, string> };
  saving: boolean;
  auditEntries: AuditEntry[];
  serverValidationIssues: ValidationIssue[] | null;
  environments: string[];
  referenceOptions: Record<string, ReferenceOption[]>;
  onChange: (key: string, value: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const editorIssues = validationIssuesForForm(table, editor.form);
  const environmentOptions = Array.from(new Set([editor.form.environment, ...environments].filter(Boolean)));
  return (
    <aside data-testid="tables-record-editor" className="flex w-[420px] shrink-0 flex-col border-l border-gray-800 bg-gray-950 shadow-[-12px_0_32px_rgba(0,0,0,0.35)]">
      <div className="flex items-center gap-3 border-b border-gray-800 px-4 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-300">
          {editor.mode === "create" ? <Plus className="h-4 w-4" /> : <Edit3 className="h-4 w-4" />}
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold">{editor.mode === "create" ? "New Record" : "Edit Record"}</h3>
          <p className="truncate text-xs text-gray-500">{table.label}</p>
        </div>
        <button onClick={onClose} className="ml-auto rounded p-1.5 text-gray-500 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 pb-28">
        <ValidationIssuePanel issues={editorIssues} title="Live form stewardship" />
        {editor.mode === "edit" && serverValidationIssues && (
          <ValidationIssuePanel issues={serverValidationIssues} title="Server validation snapshot" />
        )}
        {editor.mode === "create" && (
          <Field label="ID" hint="Generated automatically when the record is saved.">
            <input value="Auto-generated" readOnly disabled className="w-full cursor-not-allowed rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2 text-sm text-gray-500 outline-none" />
          </Field>
        )}
        <Field label="Name" required>
          <input value={editor.form.name || ""} onChange={(event) => onChange("name", event.target.value)} className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500" />
        </Field>
        <Field label="Environment">
          <select value={editor.form.environment || ""} onChange={(event) => onChange("environment", event.target.value)} className={`w-full ${SELECT_CLASS}`}>
            <option value="">Select environment</option>
            {environmentOptions.map((environment) => <option key={environment} value={environment}>{environment}</option>)}
          </select>
        </Field>

        <div className="border-t border-gray-800 pt-4">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Attributes</div>
          <div className="space-y-3">
            {table.attributes.map((attr) => (
              <AttributeInput
                key={attr.name}
                attr={attr}
                value={editor.form[attr.name] || ""}
                referenceOptions={referenceOptions[attr.referenceClass || ""] || []}
                onChange={(value) => onChange(attr.name, value)}
              />
            ))}
          </div>
        </div>

        {editor.mode === "edit" && (
          <div className="border-t border-gray-800 pt-4">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              <History className="h-3.5 w-3.5" />
              Audit History
            </div>
            <div className="space-y-2">
              {auditEntries.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-gray-800 bg-gray-900 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-mono text-xs text-gray-300">{entry.action}</div>
                    <div className="text-[10px] text-gray-600">{formatDateTime(entry.createdAt || entry.created_at)}</div>
                  </div>
                  <div className="mt-2 grid gap-2 text-xs text-gray-500">
                    <AuditDiff before={entry.oldValues} after={entry.newValues} />
                  </div>
                  {entry.entryHash && <div className="mt-2 truncate font-mono text-[10px] text-gray-700">hash {entry.entryHash}</div>}
                </div>
              ))}
              {!auditEntries.length && <div className="rounded-lg border border-dashed border-gray-800 px-3 py-4 text-sm text-gray-600">No audit history for this record.</div>}
            </div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t border-gray-800 px-4 py-3">
        <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
        <button onClick={onSave} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
          {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </button>
      </div>
    </aside>
  );
}

function AuditDiff({ before, after }: { before?: Record<string, unknown> | null; after?: Record<string, unknown> | null }) {
  const rows = auditDiffRows(before, after);
  if (!rows.length) {
    const snapshot = after || before;
    return (
      <div className="rounded border border-gray-800 bg-gray-950 px-2 py-2 text-gray-500">
        {snapshot ? "Snapshot captured; no field-level delta." : "No field values captured."}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {rows.slice(0, 8).map((row) => (
        <div key={row.field} className="rounded border border-gray-800 bg-gray-950 p-2">
          <div className="mb-1 font-medium text-gray-300">{row.field}</div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 font-mono text-[11px]">
            <div className="truncate rounded bg-red-950/30 px-2 py-1 text-red-200">{formatValue(row.before)}</div>
            <div className="text-gray-700">to</div>
            <div className="truncate rounded bg-emerald-950/30 px-2 py-1 text-emerald-200">{formatValue(row.after)}</div>
          </div>
        </div>
      ))}
      {rows.length > 8 && <div className="text-[11px] text-gray-600">{rows.length - 8} more changes hidden.</div>}
    </div>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center gap-2 text-sm text-gray-300">
        {label}
        {required && <span className="text-red-300">*</span>}
      </div>
      {children}
      {hint && <div className="mt-1 text-xs text-gray-600">{hint}</div>}
    </label>
  );
}

function AttributeInput({ attr, value, referenceOptions, onChange }: { attr: AttributeDef; value: string; referenceOptions: ReferenceOption[]; onChange: (value: string) => void }) {
  const label = attr.displayName || attr.name;
  if (!canReadAttr(attr)) {
    return (
      <Field label={label} required={attr.isMandatory} hint="Restricted by field-level RBAC.">
        <input value="Restricted" readOnly disabled className="w-full cursor-not-allowed rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2 text-sm text-gray-500 outline-none" />
      </Field>
    );
  }
  const disabled = !canWriteAttr(attr);
  let input: React.ReactNode;
  if (attr.attrType === "boolean") {
    input = (
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && onChange(value === "true" ? "false" : "true")}
        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${value === "true" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-gray-700 bg-gray-900 text-gray-400"}`}
      >
        <Check className="h-4 w-4" />
        {value === "true" ? "True" : "False"}
      </button>
    );
  } else if (attr.attrType === "enum" && attr.enumValues?.length) {
    input = (
      <select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} className={`w-full ${SELECT_CLASS}`}>
        <option value="">Select value</option>
        {attr.enumValues.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    );
  } else if (attr.attrType === "reference") {
    const options = referenceOptions.some((option) => option.id === value) || !value
      ? referenceOptions
      : [{ id: value, label: value }, ...referenceOptions];
    input = (
      <ReferenceTypeahead
        disabled={disabled}
        referenceClass={attr.referenceClass}
        value={value}
        options={options}
        onChange={onChange}
      />
    );
  } else if (attr.attrType === "json") {
    input = (
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        readOnly={disabled}
        disabled={disabled}
        rows={Math.min(10, Math.max(4, value.split("\n").length))}
        className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 font-mono text-xs text-gray-100 outline-none focus:border-indigo-500 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-500"
      />
    );
  } else {
    input = (
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        readOnly={disabled}
        disabled={disabled}
        type={attr.attrType === "number" ? "number" : attr.attrType === "date" ? "date" : "text"}
        className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-500"
      />
    );
  }
  return (
    <Field label={label} required={attr.isMandatory} hint={disabled ? "Read-only by field-level RBAC." : attr.isRestricted ? "Field-level RBAC managed." : undefined}>
      {input}
    </Field>
  );
}
