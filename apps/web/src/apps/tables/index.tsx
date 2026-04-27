"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { ShellAPI } from "@/sdk/types";
import {
  Check,
  Columns3,
  Database,
  Edit3,
  Filter,
  History,
  Plus,
  RefreshCw,
  Save,
  Search,
  TableProperties,
  Trash2,
  X,
} from "lucide-react";

type AttributeDef = {
  name: string;
  displayName: string;
  attrType: string;
  isMandatory: boolean;
  isKeyAttribute: boolean;
  enumValues?: string[];
  canRead?: boolean;
  canWrite?: boolean;
  isRestricted?: boolean;
};

type TableDef = {
  id: string;
  label: string;
  className: string;
  category: string;
  hasNumber?: boolean;
  attributes: AttributeDef[];
};

type TableRecord = {
  id: string;
  name: string;
  class: string;
  environment?: string | null;
  attributes?: Record<string, unknown>;
  [key: string]: unknown;
};

type ColumnDef = {
  key: string;
  label: string;
  core: boolean;
  attrType: string;
};

type FilterOperator = "contains" | "equals" | "notEquals" | "startsWith" | "endsWith" | "empty" | "notEmpty" | "gt" | "gte" | "lt" | "lte";

type TableFilter = {
  id: string;
  field: string;
  operator: FilterOperator;
  value: string;
};

type EditorMode = "create" | "edit";
type PendingTableAction = {
  tableId: string;
  recordId?: string;
  mode?: "create" | "edit";
};

type SavedTableView = {
  id: string;
  tableId: string;
  name: string;
  searchQuery: string;
  filters: Array<{ field: string; operator: FilterOperator; value?: unknown }>;
  columns: string[];
  density: "compact" | "comfortable" | "spacious";
};

type AuditEntry = {
  id: string;
  action: string;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  entryHash?: string | null;
  createdAt: string;
};

const PAGE_SIZE = 100;
const TABLES_LAUNCH_KEY = "specora_tables_launch";

const OPERATORS: Array<{ value: FilterOperator; label: string; needsValue: boolean }> = [
  { value: "contains", label: "contains", needsValue: true },
  { value: "equals", label: "equals", needsValue: true },
  { value: "notEquals", label: "not equals", needsValue: true },
  { value: "startsWith", label: "starts with", needsValue: true },
  { value: "endsWith", label: "ends with", needsValue: true },
  { value: "empty", label: "is empty", needsValue: false },
  { value: "notEmpty", label: "is not empty", needsValue: false },
  { value: "gt", label: "greater than", needsValue: true },
  { value: "gte", label: "greater/equal", needsValue: true },
  { value: "lt", label: "less than", needsValue: true },
  { value: "lte", label: "less/equal", needsValue: true },
];

function isValueOperator(operator: FilterOperator) {
  return OPERATORS.find((item) => item.value === operator)?.needsValue ?? true;
}

function formatValue(value: unknown) {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function canReadAttr(attr?: AttributeDef) {
  return attr?.canRead !== false;
}

function canWriteAttr(attr?: AttributeDef) {
  return attr?.canWrite !== false;
}

function coerceValue(raw: string, attr?: AttributeDef): unknown {
  if (!attr) return raw;
  if (attr.attrType === "number") {
    const value = Number(raw);
    return Number.isFinite(value) ? value : raw;
  }
  if (attr.attrType === "boolean") return raw === "true";
  return raw;
}

function initialForm(table: TableDef, record?: TableRecord): Record<string, string> {
  const next: Record<string, string> = {
    id: record?.id || "",
    name: record?.name || "",
    environment: record?.environment || "",
  };
  for (const attr of table.attributes) {
    const value = (record?.attributes || {})[attr.name] ?? record?.[attr.name] ?? "";
    next[attr.name] = value === undefined || value === null ? "" : String(value);
  }
  return next;
}

export default function TablesApp({ shell }: { shell: ShellAPI }) {
  const [tables, setTables] = useState<TableDef[]>([]);
  const [selected, setSelected] = useState<TableDef | null>(null);
  const [records, setRecords] = useState<TableRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<TableFilter[]>([]);
  const [loading, setLoading] = useState(true);
  const [recordLoading, setRecordLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [selectedColumns, setSelectedColumns] = useState<Record<string, string[]>>({});
  const [savedViews, setSavedViews] = useState<SavedTableView[]>([]);
  const [density, setDensity] = useState<"compact" | "comfortable" | "spacious">("comfortable");
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [pendingTableAction, setPendingTableAction] = useState<PendingTableAction | null>(null);
  const [editor, setEditor] = useState<{ mode: EditorMode; record?: TableRecord; form: Record<string, string> } | null>(null);
  const [saving, setSaving] = useState(false);
  const handledLaunchRef = useRef<string | null>(null);

  const availableColumns = useMemo<ColumnDef[]>(() => {
    const attrs = selected?.attributes || [];
    return [
      { key: "name", label: "Name", core: true, attrType: "string" },
      ...(selected?.hasNumber ? [{ key: "number", label: "Number", core: true, attrType: "string" }] : []),
      { key: "id", label: "ID", core: true, attrType: "string" },
      { key: "environment", label: "Environment", core: true, attrType: "string" },
      ...attrs.map((attr) => ({ key: attr.name, label: attr.displayName || attr.name, core: false, attrType: attr.attrType })),
    ];
  }, [selected]);

  const visibleColumns = useMemo(() => {
    if (!selected) return [];
    const explicit = selectedColumns[selected.id];
    if (explicit) return availableColumns.filter((column) => explicit.includes(column.key));
    const attrs = selected.attributes || [];
    const keyAttrs = attrs.filter((attr) => attr.isMandatory || attr.isKeyAttribute);
    const defaultAttrKeys = (keyAttrs.length > 0 ? keyAttrs.slice(0, 5) : attrs.slice(0, 5)).map((attr) => attr.name);
    return availableColumns.filter((column) => column.core || defaultAttrKeys.includes(column.key));
  }, [availableColumns, selected, selectedColumns]);

  const filterPayload = useMemo(() => {
    return filters
      .filter((item) => item.field && item.operator && (!isValueOperator(item.operator) || item.value.trim() !== ""))
      .map((item) => ({ field: item.field, operator: item.operator, value: item.value }));
  }, [filters]);

  function tableAttr(key: string) {
    return selected?.attributes.find((attr) => attr.name === key);
  }

  function canReadColumn(key: string) {
    const attr = tableAttr(key);
    return attr ? canReadAttr(attr) : true;
  }

  function selectTable(table: TableDef) {
    setSelected(table);
    setQuery("");
    setFilters([]);
    setAuditEntries([]);
    setPickerOpen(false);
    setEditor(null);
  }

  function toggleColumn(key: string) {
    if (!selected) return;
    setSelectedColumns((prev) => {
      const current = prev[selected.id] || visibleColumns.map((column) => column.key);
      const next = current.includes(key) ? current.filter((column) => column !== key) : [...current, key];
      return { ...prev, [selected.id]: next.length > 0 ? next : current };
    });
  }

  async function loadTables() {
    setLoading(true);
    try {
      const res = await shell.fetch("/api/tables");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to fetch tables");
      }
      const data = await res.json();
      const nextTables = data.tables || [];
      setTables(nextTables);
    } catch (err: any) {
      shell.notify(err.message || "Failed to fetch tables", "error");
    } finally {
      setLoading(false);
    }
  }

  async function loadRecords(table = selected) {
    if (!table) return;
    setRecordLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (query.trim()) params.set("q", query.trim());
      if (filterPayload.length > 0) params.set("filters", JSON.stringify(filterPayload));
      const res = await shell.fetch(`/api/tables/${encodeURIComponent(table.id)}/records?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to fetch records");
      }
      const data = await res.json();
      setRecords(data.records || []);
      setTotal(data.total || 0);
    } catch (err: any) {
      shell.notify(err.message || "Failed to fetch table records", "error");
    } finally {
      setRecordLoading(false);
    }
  }

  async function loadSavedViews(table = selected) {
    if (!table) return;
    try {
      const res = await shell.fetch(`/api/tables/views?tableId=${encodeURIComponent(table.id)}`);
      if (!res.ok) return;
      const data = await res.json();
      setSavedViews(data.views || []);
    } catch {
      setSavedViews([]);
    }
  }

  async function saveCurrentView() {
    if (!selected) return;
    const name = window.prompt("View name", `${selected.label} view`);
    if (!name?.trim()) return;
    try {
      const columns = (selectedColumns[selected.id] || visibleColumns.map((column) => column.key)).filter(Boolean);
      const res = await shell.fetch("/api/tables/views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableId: selected.id,
          name: name.trim(),
          searchQuery: query,
          filters: filterPayload,
          columns,
          density,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to save view");
      }
      shell.notify("View saved", "success");
      await loadSavedViews(selected);
    } catch (err: any) {
      shell.notify(err.message || "Failed to save view", "error");
    }
  }

  function applySavedView(view: SavedTableView) {
    if (!selected) return;
    setQuery(view.searchQuery || "");
    setFilters((view.filters || []).map((filter) => ({
      id: crypto.randomUUID(),
      field: filter.field,
      operator: filter.operator,
      value: filter.value === undefined || filter.value === null ? "" : String(filter.value),
    })));
    setSelectedColumns((current) => ({ ...current, [selected.id]: view.columns || [] }));
    setDensity(view.density || "comfortable");
  }

  async function deleteSavedView(view: SavedTableView) {
    try {
      const res = await shell.fetch(`/api/tables/views/${encodeURIComponent(view.id)}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to delete view");
      }
      setSavedViews((current) => current.filter((item) => item.id !== view.id));
      shell.notify("View deleted", "success");
    } catch (err: any) {
      shell.notify(err.message || "Failed to delete view", "error");
    }
  }

  async function loadAudit(table: TableDef, recordId: string) {
    try {
      const res = await shell.fetch(`/api/tables/${encodeURIComponent(table.id)}/records/${encodeURIComponent(recordId)}/audit`);
      if (!res.ok) {
        setAuditEntries([]);
        return;
      }
      const data = await res.json();
      setAuditEntries(data.entries || []);
    } catch {
      setAuditEntries([]);
    }
  }

  function cellValue(record: TableRecord, key: string) {
    if (key === "name") return record.name;
    if (key === "number") return record.number || "-";
    if (key === "id") return record.id;
    if (key === "environment") return record.environment || "-";
    const attr = tableAttr(key);
    if (attr && !canReadAttr(attr)) return "Restricted";
    return formatValue((record.attributes || {})[key] ?? record[key]);
  }

  function addFilter() {
    setFilters((prev) => [...prev, { id: crypto.randomUUID(), field: "name", operator: "contains", value: "" }]);
    setFiltersOpen(true);
  }

  function updateFilter(id: string, patch: Partial<TableFilter>) {
    setFilters((prev) => prev.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function removeFilter(id: string) {
    setFilters((prev) => prev.filter((item) => item.id !== id));
  }

  function openCreate() {
    if (!selected) return;
    setEditor({ mode: "create", form: initialForm(selected) });
  }

  function openEdit(record: TableRecord) {
    if (!selected) return;
    setEditor({ mode: "edit", record, form: initialForm(selected, record) });
    loadAudit(selected, record.id);
  }

  async function openRecordEditor(table: TableDef, recordId: string) {
    setRecordLoading(true);
    try {
      const res = await shell.fetch(`/api/tables/${encodeURIComponent(table.id)}/records/${encodeURIComponent(recordId)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to fetch record");
      }
      const data = await res.json();
      const record = data.record as TableRecord;
      setSelected(table);
      setEditor({ mode: "edit", record, form: initialForm(table, record) });
      await loadAudit(table, record.id);
    } catch (err: any) {
      shell.notify(err.message || "Failed to open record editor", "error");
    } finally {
      setRecordLoading(false);
    }
  }

  function handleTableAction(action: { type?: string; tableId?: string; recordId?: string; mode?: "create" | "edit" }) {
    if (action.type !== "SELECT_TABLE" && action.type !== "OPEN_TABLE_RECORD") return;
    const tableId = action.tableId;
    const recordId = action.recordId;
    const table = tables.find((item) => item.id === tableId || item.className === tableId);
    if (!table) {
      setPendingTableAction(tableId ? { tableId, recordId, mode: action.mode } : null);
      return;
    }
    setPendingTableAction(null);
    if (action.mode === "create") {
      selectTable(table);
      setEditor({ mode: "create", form: initialForm(table) });
    } else if (action.type === "OPEN_TABLE_RECORD" && recordId) {
      openRecordEditor(table, recordId);
    } else {
      selectTable(table);
    }
  }

  function updateForm(key: string, value: string) {
    setEditor((current) => current ? { ...current, form: { ...current.form, [key]: value } } : current);
  }

  async function saveRecord() {
    if (!selected || !editor) return;
    if (!editor.form.name.trim()) {
      shell.notify("Name is required", "error");
      return;
    }
    setSaving(true);
    try {
      const attributes: Record<string, unknown> = {};
      for (const attr of selected.attributes) {
        if (!canWriteAttr(attr)) continue;
        attributes[attr.name] = coerceValue(editor.form[attr.name] || "", attr);
      }
      const payload = {
        name: editor.form.name.trim(),
        environment: editor.form.environment.trim() || undefined,
        attributes,
      };
      const path = editor.mode === "create"
        ? `/api/tables/${encodeURIComponent(selected.id)}/records`
        : `/api/tables/${encodeURIComponent(selected.id)}/records/${encodeURIComponent(editor.record!.id)}`;
      const res = await shell.fetch(path, {
        method: editor.mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to save record");
      }
      shell.notify(editor.mode === "create" ? "Record created" : "Record updated", "success");
      setEditor(null);
      await loadRecords();
    } catch (err: any) {
      shell.notify(err.message || "Failed to save record", "error");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecord(record: TableRecord) {
    if (!selected) return;
    if (!confirm(`Delete ${record.name}? This will detach relationships and cannot be undone.`)) return;
    try {
      const res = await shell.fetch(`/api/tables/${encodeURIComponent(selected.id)}/records/${encodeURIComponent(record.id)}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to delete record");
      }
      shell.notify("Record deleted", "success");
      await loadRecords();
    } catch (err: any) {
      shell.notify(err.message || "Failed to delete record", "error");
    }
  }

  useEffect(() => {
    loadTables();
  }, []);

  useEffect(() => {
    if (selected) {
      loadRecords(selected);
      loadSavedViews(selected);
    }
  }, [selected?.id]);

  useEffect(() => {
    return shell.onMessage((message) => {
      handleTableAction({ type: message.type, ...message.payload });
    });
  }, [shell, tables]);

  useEffect(() => {
    const payload = shell.launchPayload as { type?: string; tableId?: string; recordId?: string; mode?: "create" | "edit" } | undefined;
    if (!payload) return;
    if (payload.type !== "SELECT_TABLE" && payload.type !== "OPEN_TABLE_RECORD") return;
    const key = JSON.stringify(payload);
    if (handledLaunchRef.current === key) return;
    handledLaunchRef.current = key;
    handleTableAction(payload);
  }, [shell.launchPayload, tables]);

  useEffect(() => {
    let payload: { type?: string; tableId?: string; recordId?: string; mode?: "create" | "edit"; createdAt?: number } | null = null;
    try {
      const raw = sessionStorage.getItem(TABLES_LAUNCH_KEY);
      payload = raw ? JSON.parse(raw) : null;
      if (raw) sessionStorage.removeItem(TABLES_LAUNCH_KEY);
    } catch {
      payload = null;
    }
    if (!payload) return;
    if (payload.createdAt && Date.now() - payload.createdAt > 60_000) return;
    if (payload.type !== "SELECT_TABLE" && payload.type !== "OPEN_TABLE_RECORD") return;
    const key = JSON.stringify(payload);
    if (handledLaunchRef.current === key) return;
    handledLaunchRef.current = key;
    handleTableAction(payload);
  }, [tables]);

  useEffect(() => {
    if (!pendingTableAction || tables.length === 0) return;
    const table = tables.find((item) => item.id === pendingTableAction.tableId || item.className === pendingTableAction.tableId);
    if (!table) return;
    if (pendingTableAction.mode === "create") {
      selectTable(table);
      setEditor({ mode: "create", form: initialForm(table) });
    } else if (pendingTableAction.recordId) {
      openRecordEditor(table, pendingTableAction.recordId);
    } else {
      selectTable(table);
    }
    setPendingTableAction(null);
  }, [pendingTableAction, tables]);

  return (
    <div className="flex h-full w-full bg-gray-950 text-gray-100">
      <aside className="flex w-72 shrink-0 flex-col border-r border-gray-800 bg-gray-950">
        <div className="border-b border-gray-800 px-4 py-4">
          <div className="flex items-center gap-2">
            <TableProperties className="h-5 w-5 text-indigo-400" />
            <h1 className="text-base font-semibold">Tables</h1>
          </div>
          <p className="mt-1 text-xs text-gray-500">RBAC-aware platform data access</p>
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="px-3 py-4 text-sm text-gray-500">Loading tables...</div>
          ) : tables.map((table) => (
            <button
              key={table.id}
              data-testid={`tables-table-${table.id}`}
              onClick={() => selectTable(table)}
              className={`w-full rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                selected?.id === table.id ? "bg-indigo-600/20 text-indigo-200" : "text-gray-300 hover:bg-gray-900"
              }`}
            >
              <div className="truncate font-medium">{table.label}</div>
              <div className="mt-0.5 truncate font-mono text-[10px] text-gray-500">{table.id}</div>
            </button>
          ))}
        </div>
        {selected && (
          <div className="border-t border-gray-800 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-600">Views</div>
              <button onClick={saveCurrentView} className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-900 hover:text-white">
                Save
              </button>
            </div>
            <div className="scrollbar-thin max-h-44 space-y-1 overflow-y-auto">
              {savedViews.map((view) => (
                <div key={view.id} className="group flex items-center gap-1 rounded-lg border border-gray-900 bg-gray-950 px-2 py-1.5 hover:border-gray-800">
                  <button onClick={() => applySavedView(view)} className="min-w-0 flex-1 text-left">
                    <div className="truncate text-xs font-medium text-gray-300">{view.name}</div>
                    <div className="truncate text-[10px] text-gray-600">{view.columns.length || "default"} columns / {view.filters.length} filters</div>
                  </button>
                  <button onClick={() => deleteSavedView(view)} className="rounded p-1 text-gray-600 opacity-0 hover:text-red-300 group-hover:opacity-100" title="Delete view">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {!savedViews.length && <div className="rounded-lg border border-dashed border-gray-800 px-2 py-3 text-xs text-gray-600">No saved views.</div>}
            </div>
          </div>
        )}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-gray-800 px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-300">
            <Database className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{selected?.label || "Select a table"}</h2>
            <p className="font-mono text-xs text-gray-500">{selected ? `${selected.id} / ${total} records` : "No table selected"}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={openCreate} disabled={!selected} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40">
              <Plus className="h-4 w-4" />
              New
            </button>
            <button onClick={() => setFiltersOpen((open) => !open)} className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-300 hover:text-white">
              <Filter className="h-4 w-4" />
              Filters
              {filterPayload.length > 0 && <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-xs text-indigo-200">{filterPayload.length}</span>}
            </button>
            <button onClick={() => loadRecords()} className="rounded-lg border border-gray-700 bg-gray-900 p-2 text-gray-300 hover:text-white" title="Refresh">
              <RefreshCw className={`h-4 w-4 ${recordLoading ? "animate-spin" : ""}`} />
            </button>
            <select value={density} onChange={(event) => setDensity(event.target.value as typeof density)} className="rounded-lg border border-gray-700 bg-gray-900 px-2 py-2 text-sm text-gray-300 outline-none focus:border-indigo-500" title="Density">
              <option value="compact">Compact</option>
              <option value="comfortable">Comfortable</option>
              <option value="spacious">Spacious</option>
            </select>
            <div className="relative">
              <button onClick={() => setPickerOpen((open) => !open)} className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-300 hover:text-white">
                <Columns3 className="h-4 w-4" />
                Columns
              </button>
              {pickerOpen && (
                <div className="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-gray-700 bg-gray-900 p-2 shadow-2xl">
                  <div className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Visible Columns</div>
                  <div className="scrollbar-thin max-h-72 space-y-1 overflow-y-auto">
                    {availableColumns.map((column) => (
                      <label key={column.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-300 hover:bg-gray-800">
                        <input
                          type="checkbox"
                          checked={visibleColumns.some((item) => item.key === column.key)}
                          onChange={() => toggleColumn(column.key)}
                          className="rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500"
                        />
                        <span className="truncate">{column.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <section className="border-b border-gray-800 bg-gray-950 px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="relative w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") loadRecords();
                }}
                placeholder="Search name, ID, or environment"
                className="w-full rounded-lg border border-gray-700 bg-gray-900 py-2 pl-9 pr-3 text-sm text-gray-100 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <button onClick={() => loadRecords()} className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-300 hover:text-white">
              Apply
            </button>
            {filters.length > 0 && (
              <button onClick={() => setFilters([])} className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:text-gray-200">
                Clear filters
              </button>
            )}
          </div>

          {filtersOpen && (
            <div className="mt-3 space-y-2">
              {filters.map((filter) => (
                <div key={filter.id} className="grid grid-cols-[220px_160px_1fr_36px] gap-2">
                  <select value={filter.field} onChange={(event) => updateFilter(filter.id, { field: event.target.value })} className="rounded-lg border border-gray-700 bg-gray-900 px-2 py-2 text-sm text-gray-300 outline-none focus:border-indigo-500">
                  {availableColumns.filter((column) => canReadColumn(column.key)).map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}
                  </select>
                  <select value={filter.operator} onChange={(event) => updateFilter(filter.id, { operator: event.target.value as FilterOperator })} className="rounded-lg border border-gray-700 bg-gray-900 px-2 py-2 text-sm text-gray-300 outline-none focus:border-indigo-500">
                    {OPERATORS.map((operator) => <option key={operator.value} value={operator.value}>{operator.label}</option>)}
                  </select>
                  {isValueOperator(filter.operator) ? (
                    <FilterValueInput filter={filter} attr={tableAttr(filter.field)} onChange={(value) => updateFilter(filter.id, { value })} />
                  ) : (
                    <div className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-600">No value required</div>
                  )}
                  <button onClick={() => removeFilter(filter.id)} className="rounded-lg border border-gray-700 bg-gray-900 p-2 text-gray-500 hover:text-red-300">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button onClick={addFilter} className="inline-flex items-center gap-2 rounded-lg border border-dashed border-gray-700 px-3 py-2 text-sm text-gray-400 hover:border-indigo-500/50 hover:text-white">
                <Plus className="h-4 w-4" />
                Add filter
              </button>
            </div>
          )}
        </section>

        <div className="scrollbar-thin flex-1 overflow-auto pb-32">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-gray-950">
              <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wider text-gray-500">
                {visibleColumns.map((column) => <th key={column.key} className="whitespace-nowrap px-4 py-3">{column.label}</th>)}
                <th className="w-24 px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id} data-testid={`tables-record-${record.id}`} className="border-b border-gray-900 hover:bg-gray-900/60">
                  {visibleColumns.map((column) => (
                    <td key={column.key} className={`max-w-[260px] truncate px-4 ${density === "compact" ? "py-2" : density === "spacious" ? "py-4" : "py-3"} ${column.key === "id" ? "font-mono text-xs text-gray-500" : column.key === "name" ? "font-medium text-gray-200" : "text-gray-300"}`}>
                      {String(cellValue(record, column.key))}
                    </td>
                  ))}
                  <td className={`px-4 ${density === "compact" ? "py-2" : density === "spacious" ? "py-4" : "py-3"}`}>
                    <div className="flex justify-end gap-1">
                      <button onClick={() => openEdit(record)} className="rounded p-1.5 text-gray-500 hover:bg-gray-800 hover:text-white" title="Edit" aria-label={`Edit ${record.name}`}>
                        <Edit3 className="h-4 w-4" />
                      </button>
                      <button onClick={() => deleteRecord(record)} className="rounded p-1.5 text-gray-500 hover:bg-red-950/60 hover:text-red-300" title="Delete" aria-label={`Delete ${record.name}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {recordLoading && (
                <tr>
                  <td colSpan={Math.max(visibleColumns.length + 1, 1)} className="px-4 py-12 text-center text-gray-500">
                    Loading records...
                  </td>
                </tr>
              )}
              {!recordLoading && records.length === 0 && (
                <tr>
                  <td colSpan={Math.max(visibleColumns.length + 1, 1)} className="px-4 py-12 text-center text-gray-500">
                    No records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>

      {selected && editor && (
        <RecordEditor
          table={selected}
          editor={editor}
          saving={saving}
          auditEntries={auditEntries}
          onChange={updateForm}
          onClose={() => setEditor(null)}
          onSave={saveRecord}
        />
      )}
    </div>
  );
}

function FilterValueInput({ filter, attr, onChange }: { filter: TableFilter; attr?: AttributeDef; onChange: (value: string) => void }) {
  if (attr?.attrType === "boolean") {
    return (
      <select value={filter.value || "true"} onChange={(event) => onChange(event.target.value)} className="rounded-lg border border-gray-700 bg-gray-900 px-2 py-2 text-sm text-gray-300 outline-none focus:border-indigo-500">
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (attr?.attrType === "enum" && attr.enumValues?.length) {
    return (
      <select value={filter.value} onChange={(event) => onChange(event.target.value)} className="rounded-lg border border-gray-700 bg-gray-900 px-2 py-2 text-sm text-gray-300 outline-none focus:border-indigo-500">
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

function RecordEditor({
  table,
  editor,
  saving,
  auditEntries,
  onChange,
  onClose,
  onSave,
}: {
  table: TableDef;
  editor: { mode: EditorMode; record?: TableRecord; form: Record<string, string> };
  saving: boolean;
  auditEntries: AuditEntry[];
  onChange: (key: string, value: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
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
        {editor.mode === "create" && (
          <Field label="ID" hint="Generated automatically when the record is saved.">
            <input value="Auto-generated" readOnly disabled className="w-full cursor-not-allowed rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2 text-sm text-gray-500 outline-none" />
          </Field>
        )}
        <Field label="Name" required>
          <input value={editor.form.name || ""} onChange={(event) => onChange("name", event.target.value)} className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500" />
        </Field>
        <Field label="Environment">
          <input value={editor.form.environment || ""} onChange={(event) => onChange("environment", event.target.value)} className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500" />
        </Field>

        <div className="border-t border-gray-800 pt-4">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Attributes</div>
          <div className="space-y-3">
            {table.attributes.map((attr) => (
              <AttributeInput key={attr.name} attr={attr} value={editor.form[attr.name] || ""} onChange={(value) => onChange(attr.name, value)} />
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
                    <div className="text-[10px] text-gray-600">{new Date(entry.createdAt).toLocaleString()}</div>
                  </div>
                  <div className="mt-2 grid gap-2 text-xs text-gray-500">
                    <DiffSummary label="Before" value={entry.oldValues} />
                    <DiffSummary label="After" value={entry.newValues} />
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

function DiffSummary({ label, value }: { label: string; value?: Record<string, unknown> | null }) {
  const text = value ? JSON.stringify(value) : "-";
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-gray-600">{label}</div>
      <div className="max-h-20 overflow-hidden rounded border border-gray-800 bg-gray-950 px-2 py-1 font-mono text-[11px] leading-5 text-gray-400">
        {text}
      </div>
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

function AttributeInput({ attr, value, onChange }: { attr: AttributeDef; value: string; onChange: (value: string) => void }) {
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
      <select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-500">
        <option value="">Select value</option>
        {attr.enumValues.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
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
