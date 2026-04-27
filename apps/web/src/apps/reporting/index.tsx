"use client";

import { useEffect, useMemo, useState } from "react";
import type { ShellAPI } from "@/sdk/types";
import { BarChart3, Download, FileJson, RefreshCw, Save, Table2 } from "lucide-react";

type Kpi = {
  id: string;
  label: string;
  description: string;
  domain: string;
  value: number | null;
  unit: "count" | "percent" | "ratio" | "days";
  status: "good" | "watch" | "risk" | "unknown";
  direction: string;
  details: Record<string, unknown>;
};

type DatasetColumn = {
  key: string;
  label: string;
  type: string;
  filterable: boolean;
  groupable: boolean;
};

type Dataset = {
  id: string;
  label: string;
  description: string;
  defaultGroupBy: string[];
  timeColumn: string;
  columns: DatasetColumn[];
};

type SavedReport = {
  id: string;
  datasetId: string;
  name: string;
  description: string;
  query: Record<string, unknown>;
  updatedAt?: string;
};

const INPUT = "rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan-500";
const BUTTON = "inline-flex items-center justify-center gap-2 rounded-md border border-gray-800 bg-gray-900 px-3 py-2 text-sm font-medium text-gray-200 hover:border-gray-700 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY = "inline-flex items-center justify-center gap-2 rounded-md bg-cyan-500 px-3 py-2 text-sm font-semibold text-gray-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50";

function statusClass(status: Kpi["status"]) {
  if (status === "good") return "border-emerald-900/70 bg-emerald-950/30 text-emerald-200";
  if (status === "watch") return "border-amber-900/70 bg-amber-950/30 text-amber-200";
  if (status === "risk") return "border-rose-900/70 bg-rose-950/30 text-rose-200";
  return "border-gray-800 bg-gray-900 text-gray-300";
}

function formatValue(kpi: Kpi) {
  if (kpi.value === null || kpi.value === undefined) return "n/a";
  if (kpi.unit === "percent") return `${kpi.value}%`;
  if (kpi.unit === "days") return `${kpi.value}d`;
  return new Intl.NumberFormat().format(kpi.value);
}

function defaultFrom() {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return date.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function toIsoStart(value: string) {
  return value ? `${value}T00:00:00.000Z` : undefined;
}

function toIsoEnd(value: string) {
  return value ? `${value}T23:59:59.999Z` : undefined;
}

function csvFilename(datasetId: string) {
  return `${datasetId || "report"}-${new Date().toISOString().slice(0, 10)}.csv`;
}

export default function ReportingApp({ shell }: { shell: ShellAPI }) {
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [groupBy, setGroupBy] = useState("");
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [grouped, setGrouped] = useState(false);
  const [contractTarget, setContractTarget] = useState("grafana");
  const [contract, setContract] = useState<Record<string, unknown> | null>(null);
  const [reportName, setReportName] = useState("Operational view");
  const [loading, setLoading] = useState(true);
  const [querying, setQuerying] = useState(false);

  const selectedDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === selectedDatasetId) || null,
    [datasets, selectedDatasetId]
  );
  const visibleColumns = useMemo(() => {
    if (rows.length) return Object.keys(rows[0]);
    return selectedDataset?.columns.slice(0, 8).map((column) => column.key) || [];
  }, [rows, selectedDataset]);

  useEffect(() => {
    loadInitial();
  }, []);

  async function loadInitial() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from: toIsoStart(from) || "", to: toIsoEnd(to) || "" });
      const [kpiRes, datasetRes, savedRes] = await Promise.all([
        shell.fetch(`/api/reports/kpis?${params.toString()}`),
        shell.fetch("/api/reports/datasets"),
        shell.fetch("/api/reports/saved"),
      ]);
      const [kpiData, datasetData, savedData] = await Promise.all([kpiRes.json(), datasetRes.json(), savedRes.json()]);
      if (!kpiRes.ok) throw new Error(kpiData.error || "Failed to load KPIs");
      if (!datasetRes.ok) throw new Error(datasetData.error || "Failed to load datasets");
      if (!savedRes.ok) throw new Error(savedData.error || "Failed to load saved reports");
      const nextDatasets = datasetData.datasets || [];
      setKpis(kpiData.kpis || []);
      setDatasets(nextDatasets);
      setSavedReports(savedData.reports || []);
      if (!selectedDatasetId && nextDatasets[0]) setGroupBy(nextDatasets[0].defaultGroupBy?.[0] || "");
      setSelectedDatasetId((current) => current || nextDatasets[0]?.id || "");
    } catch (err: any) {
      shell.notify(err.message || "Failed to load reporting", "error");
    } finally {
      setLoading(false);
    }
  }

  async function runQuery(format: "json" | "csv" = "json") {
    if (!selectedDataset) return;
    setQuerying(true);
    try {
      const params = new URLSearchParams({
        from: toIsoStart(from) || "",
        to: toIsoEnd(to) || "",
        limit: "100",
        format,
      });
      if (groupBy && format === "json") params.set("groupBy", groupBy);
      const res = await shell.fetch(`/api/reports/datasets/${encodeURIComponent(selectedDataset.id)}/query?${params.toString()}`);
      if (format === "csv") {
        const text = await res.text();
        if (!res.ok) throw new Error(text || "Failed to export CSV");
        const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = csvFilename(selectedDataset.id);
        anchor.click();
        URL.revokeObjectURL(url);
        shell.notify("CSV export ready", "success");
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to run report");
      setRows(data.rows || []);
      setGrouped(!!data.grouped);
    } catch (err: any) {
      shell.notify(err.message || "Failed to run report", "error");
    } finally {
      setQuerying(false);
    }
  }

  async function saveReport() {
    if (!selectedDataset || !reportName.trim()) return;
    try {
      const res = await shell.fetch("/api/reports/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          datasetId: selectedDataset.id,
          name: reportName.trim(),
          query: { from: toIsoStart(from), to: toIsoEnd(to), groupBy: groupBy ? [groupBy] : [] },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save report");
      setSavedReports((current) => [data.report, ...current.filter((report) => report.id !== data.report.id)]);
      shell.notify("Report saved", "success");
    } catch (err: any) {
      shell.notify(err.message || "Failed to save report", "error");
    }
  }

  async function loadContract() {
    try {
      const res = await shell.fetch(`/api/reports/contracts/${contractTarget}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load contract");
      setContract(data.contract);
    } catch (err: any) {
      shell.notify(err.message || "Failed to load contract", "error");
    }
  }

  function openSaved(report: SavedReport) {
    setSelectedDatasetId(report.datasetId);
    const query = report.query || {};
    const nextGroupBy = Array.isArray(query.groupBy) ? query.groupBy[0] : "";
    setGroupBy(typeof nextGroupBy === "string" ? nextGroupBy : "");
    setReportName(report.name);
  }

  return (
    <div className="flex h-full w-full flex-col bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-cyan-500/15 text-cyan-300">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-semibold">Reporting</h1>
              <div className="text-xs text-gray-500">{datasets.length} datasets · {kpis.length} KPIs</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input aria-label="From date" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className={INPUT} />
            <input aria-label="To date" type="date" value={to} onChange={(event) => setTo(event.target.value)} className={INPUT} />
            <button onClick={loadInitial} disabled={loading} className={BUTTON}><RefreshCw className="h-4 w-4" /> Refresh</button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-5 pb-28">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">Loading reporting...</div>
        ) : (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <main className="space-y-5">
              <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {kpis.map((kpi) => (
                  <div key={kpi.id} className={`rounded-lg border p-4 ${statusClass(kpi.status)}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-medium uppercase text-gray-500">{kpi.domain}</div>
                        <div className="mt-1 text-sm font-semibold text-gray-100">{kpi.label}</div>
                      </div>
                      <span className="rounded-md bg-gray-950/60 px-2 py-1 text-[10px] font-semibold uppercase">{kpi.status}</span>
                    </div>
                    <div className="mt-4 text-3xl font-semibold tracking-normal text-gray-50">{formatValue(kpi)}</div>
                    <div className="mt-3 truncate text-xs text-gray-400">{Object.entries(kpi.details || {}).slice(0, 2).map(([key, value]) => `${key}: ${String(value)}`).join(" · ")}</div>
                  </div>
                ))}
              </section>

              <section className="rounded-lg border border-gray-800 bg-gray-900/60">
                <div className="border-b border-gray-800 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Table2 className="h-4 w-4 text-cyan-300" />
                      <h2 className="text-sm font-semibold">Dataset Preview</h2>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={selectedDatasetId}
                        onChange={(event) => {
                          const nextId = event.target.value;
                          const nextDataset = datasets.find((dataset) => dataset.id === nextId);
                          setSelectedDatasetId(nextId);
                          setGroupBy(nextDataset?.defaultGroupBy?.[0] || "");
                        }}
                        className={INPUT}
                      >
                        {datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.label}</option>)}
                      </select>
                      <select value={groupBy} onChange={(event) => setGroupBy(event.target.value)} className={INPUT}>
                        <option value="">Rows</option>
                        {selectedDataset?.columns.filter((column) => column.groupable).map((column) => <option key={column.key} value={column.key}>By {column.label}</option>)}
                      </select>
                      <button onClick={() => runQuery("json")} disabled={querying || !selectedDataset} className={PRIMARY}><BarChart3 className="h-4 w-4" /> Run</button>
                      <button onClick={() => runQuery("csv")} disabled={querying || !selectedDataset} className={BUTTON}><Download className="h-4 w-4" /> CSV</button>
                    </div>
                  </div>
                </div>
                <div className="overflow-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-gray-950 text-xs uppercase text-gray-500">
                      <tr>
                        {visibleColumns.map((column) => <th key={column} className="whitespace-nowrap px-4 py-3 font-semibold">{column}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {rows.length === 0 ? (
                        <tr><td colSpan={Math.max(visibleColumns.length, 1)} className="px-4 py-10 text-center text-sm text-gray-500">No rows loaded.</td></tr>
                      ) : rows.map((row, index) => (
                        <tr key={index} className="hover:bg-gray-900">
                          {visibleColumns.map((column) => <td key={column} className="max-w-[260px] truncate px-4 py-3 text-gray-300">{String(row[column] ?? "")}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between border-t border-gray-800 px-4 py-3 text-xs text-gray-500">
                  <span>{grouped ? "Grouped result" : "Row result"}</span>
                  <span>{rows.length} rows</span>
                </div>
              </section>
            </main>

            <aside className="space-y-5">
              <section className="rounded-lg border border-gray-800 bg-gray-900/60 p-4">
                <div className="flex items-center gap-2">
                  <Save className="h-4 w-4 text-cyan-300" />
                  <h2 className="text-sm font-semibold">Saved Reports</h2>
                </div>
                <div className="mt-3 flex gap-2">
                  <input value={reportName} onChange={(event) => setReportName(event.target.value)} className={`${INPUT} min-w-0 flex-1`} />
                  <button onClick={saveReport} className={PRIMARY}><Save className="h-4 w-4" /></button>
                </div>
                <div className="mt-4 space-y-2">
                  {savedReports.slice(0, 8).map((report) => (
                    <button key={report.id} onClick={() => openSaved(report)} className="block w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-left hover:border-gray-700">
                      <div className="truncate text-sm font-medium text-gray-200">{report.name}</div>
                      <div className="mt-1 text-xs text-gray-500">{report.datasetId}</div>
                    </button>
                  ))}
                  {!savedReports.length && <div className="rounded-md border border-dashed border-gray-800 px-3 py-6 text-center text-sm text-gray-500">No saved reports.</div>}
                </div>
              </section>

              <section className="rounded-lg border border-gray-800 bg-gray-900/60 p-4">
                <div className="flex items-center gap-2">
                  <FileJson className="h-4 w-4 text-cyan-300" />
                  <h2 className="text-sm font-semibold">BI Contract</h2>
                </div>
                <div className="mt-3 flex gap-2">
                  <select value={contractTarget} onChange={(event) => setContractTarget(event.target.value)} className={`${INPUT} min-w-0 flex-1`}>
                    <option value="grafana">Grafana</option>
                    <option value="powerbi">PowerBI</option>
                    <option value="tableau">Tableau</option>
                    <option value="warehouse">Warehouse</option>
                  </select>
                  <button onClick={loadContract} className={BUTTON}><FileJson className="h-4 w-4" /></button>
                </div>
                <pre className="mt-4 max-h-80 overflow-auto rounded-md border border-gray-800 bg-gray-950 p-3 text-xs leading-5 text-gray-400">
                  {contract ? JSON.stringify(contract, null, 2) : "Select a target."}
                </pre>
              </section>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
