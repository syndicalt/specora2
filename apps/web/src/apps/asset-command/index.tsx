"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ShellAPI } from "@/sdk/types";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ClipboardList,
  FileText,
  PackageSearch,
  RefreshCw,
  Scale,
  ScanLine,
  ShieldCheck,
  TerminalSquare,
  WalletCards,
} from "lucide-react";

type AssetRecord = {
  id: string;
  asset_tag?: string;
  serial_number?: string;
  name: string;
  category: string;
  asset_type: string;
  status: string;
  lifecycle_state: string;
  manufacturer?: string;
  model?: string;
  location?: string;
  ci_id?: string;
  cost?: number;
  confidence?: number;
  evidence_score?: number;
  updated_at: string;
  evidence?: Array<{ id: string; evidence_type: string; source: string; confidence: number; created_at: string }>;
  scans?: Array<{ id: string; scan_type: string; value: string; action: string; location?: string; created_at: string }>;
  usage?: Array<{ id: string; publisher: string; product: string; metric: string; quantity: number; last_seen_at: string }>;
  exceptions?: AssetException[];
};

type AssetException = {
  id: string;
  type: string;
  severity: string;
  status: string;
  title: string;
  detail?: string;
  financial_impact?: number;
  created_at: string;
};

type Dashboard = {
  assets?: { count: number };
  contracts?: { count: number };
  entitlements?: { count: number; quantity: number };
  usage?: { count: number; quantity: number };
  exceptions?: { count: number; impact: number };
  recentRuns?: Array<{ id: string; risk_score: number; savings_estimate: number; summary?: string; created_at: string }>;
};

type View = "command" | "hardware" | "software" | "contracts" | "integrations";

const STATUS_CLASS: Record<string, string> = {
  inbox: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  verified: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  assigned: "border-indigo-500/30 bg-indigo-500/10 text-indigo-200",
  stocked: "border-purple-500/30 bg-purple-500/10 text-purple-200",
  retired: "border-gray-700 bg-gray-800 text-gray-400",
};

function label(value?: string) {
  return value ? value.replace(/_/g, " ") : "unknown";
}

function pct(value?: number) {
  if (value === undefined || value === null) return "0%";
  return `${Math.round(value <= 1 ? value * 100 : value)}%`;
}

function money(value?: number) {
  return `$${Math.round(Number(value || 0)).toLocaleString()}`;
}

function when(value?: string) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Invalid date" : date.toLocaleString();
}

export default function AssetCommandApp({ shell }: { shell: ShellAPI }) {
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [exceptions, setExceptions] = useState<AssetException[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard>({});
  const [selected, setSelected] = useState<AssetRecord | null>(null);
  const [view, setView] = useState<View>("command");
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const fetchJson = useCallback(async (path: string, init?: RequestInit) => {
    const res = await shellRef.current.fetch(path, init);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `Request failed: ${res.status}`);
    return data;
  }, []);

  const callTool = useCallback((name: string, body: Record<string, unknown> = {}) => {
    return fetchJson(`/api/apps/asset-command/tools/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }, [fetchJson]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [assetData, exceptionData, dash] = await Promise.all([
        fetchJson("/api/apps/asset-command/tools/list_assets"),
        fetchJson("/api/apps/asset-command/tools/list_exceptions"),
        fetchJson("/api/apps/asset-command/tools/dashboard"),
      ]);
      setAssets(Array.isArray(assetData) ? assetData : []);
      setExceptions(Array.isArray(exceptionData) ? exceptionData : []);
      setDashboard(dash || {});
    } catch (err: any) {
      shellRef.current.notify(err.message || "Asset data could not be loaded", "error");
    } finally {
      setLoading(false);
    }
  }, [fetchJson]);

  const loadDetails = useCallback(async (assetId: string) => {
    try {
      const data = await fetchJson(`/api/apps/asset-command/tools/get_asset_details?assetId=${encodeURIComponent(assetId)}`);
      setSelected(data);
      setAssets((prev) => prev.some((a) => a.id === data.id) ? prev.map((a) => a.id === data.id ? { ...a, ...data } : a) : [data, ...prev]);
    } catch (err: any) {
      shellRef.current.notify(err.message || "Asset details could not be loaded", "error");
    }
  }, [fetchJson]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    return shellRef.current.onMessage((msg) => {
      if (msg.type === "FOCUS_ASSET" && msg.payload?.assetId) loadDetails(msg.payload.assetId);
    });
  }, [loadDetails]);

  useEffect(() => {
    const events = ["asset.created", "asset.contract_ingested", "asset.sam_reconciled", "asset.scanned"];
    const unsubs = events.map((event) => shellRef.current.eventBus.subscribe(event, () => refresh()));
    return () => unsubs.forEach((unsub) => unsub());
  }, [refresh]);

  const inbox = assets.filter((asset) => asset.status === "inbox");
  const hardware = assets.filter((asset) => asset.category === "hardware");
  const softwareEvidence = assets.filter((asset) => asset.category === "software");
  const filtered = assets.filter((asset) => filter ? asset.category === filter || asset.status === filter : true);

  async function reconcile() {
    setBusy("reconcile");
    try {
      const result = await callTool("reconcile_sam");
      shell.notify(`SAM reconciliation found ${result.exceptions?.length || 0} exception${result.exceptions?.length === 1 ? "" : "s"}`, "success");
      await refresh();
    } catch (err: any) {
      shell.notify(err.message || "SAM reconciliation failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function demoContract() {
    setBusy("contract");
    try {
      await callTool("ingest_contract", {
        name: "Microsoft Enterprise Agreement",
        vendor: "Microsoft",
        documentName: "sample-ms-ea.txt",
        text: "Microsoft 365 E5, 250 named user licenses, annual renewal, downgrade rights included. Visio Plan 2, 25 named user licenses.",
        entitlements: [
          { publisher: "Microsoft", product: "Microsoft 365 E5", metric: "user", quantity: 250, rights: { downgrade: true }, confidence: 0.82 },
          { publisher: "Microsoft", product: "Visio Plan 2", metric: "user", quantity: 25, confidence: 0.78 },
        ],
      });
      shell.notify("Contract entitlements extracted", "success");
      await refresh();
    } catch (err: any) {
      shell.notify(err.message || "Contract extraction failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function recordScan(asset?: AssetRecord) {
    setBusy(`scan:${asset?.id || "new"}`);
    try {
      await callTool("record_scan", {
        value: asset?.asset_tag || asset?.serial_number || "MOBILE-SCAN-DEMO",
        assetId: asset?.id,
        scanType: "barcode",
        action: "verify",
        location: "HQ Stockroom",
        condition: "good",
      });
      shell.notify("Scan evidence recorded", "success");
      await refresh();
      if (asset?.id) await loadDetails(asset.id);
    } catch (err: any) {
      shell.notify(err.message || "Scan failed", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-gray-950 text-gray-100">
      <header className="flex shrink-0 items-center justify-between border-b border-gray-800 px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-violet-500/40 bg-violet-500/10">
            <PackageSearch className="h-5 w-5 text-violet-300" />
          </div>
          <div>
            <h1 className="text-base font-semibold">Asset Command Center</h1>
            <p className="text-xs text-gray-500">Evidence-backed HAM, SAM, contract extraction, mobile scans, reconciliation, and savings.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(["command", "hardware", "software", "contracts", "integrations"] as const).map((tab) => (
            <button key={tab} onClick={() => setView(tab)} className={`rounded-md px-3 py-2 text-sm capitalize ${view === tab ? "bg-gray-800 text-white" : "text-gray-400 hover:bg-gray-900 hover:text-white"}`}>
              {tab}
            </button>
          ))}
          <button onClick={refresh} className="rounded-md p-2 text-gray-400 hover:bg-gray-900 hover:text-white" title="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[1fr_430px]">
        <section className="min-h-0 overflow-auto p-5 pb-24">
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric icon={<Boxes className="h-4 w-4" />} label="Assets" value={dashboard.assets?.count || 0} />
            <Metric icon={<FileText className="h-4 w-4" />} label="Contracts" value={dashboard.contracts?.count || 0} />
            <Metric icon={<Scale className="h-4 w-4" />} label="Entitlements" value={dashboard.entitlements?.count || 0} />
            <Metric icon={<AlertTriangle className="h-4 w-4" />} label="Exceptions" value={dashboard.exceptions?.count || 0} />
          </div>

          {view === "command" && (
            <div className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
              <Panel title="Exception Command" icon={<AlertTriangle className="h-4 w-4" />}>
                <div className="mb-3 flex flex-wrap gap-2">
                  <button onClick={reconcile} disabled={busy === "reconcile"} className="rounded-md bg-violet-600 px-3 py-2 text-sm text-white hover:bg-violet-500 disabled:opacity-50">Run SAM Reconciliation</button>
                  <button onClick={demoContract} disabled={busy === "contract"} className="rounded-md border border-gray-700 px-3 py-2 text-sm hover:bg-gray-900 disabled:opacity-50">Extract Demo Contract</button>
                </div>
                <ExceptionList exceptions={exceptions.slice(0, 12)} />
              </Panel>
              <Panel title="Asset Inbox" icon={<ClipboardList className="h-4 w-4" />}>
                <AssetList assets={inbox.slice(0, 10)} selectedId={selected?.id} onSelect={loadDetails} empty="No asset candidates waiting for review." />
              </Panel>
            </div>
          )}

          {view === "hardware" && (
            <Panel title="Hardware Estate" icon={<ScanLine className="h-4 w-4" />}>
              <div className="mb-3 flex flex-wrap gap-2">
                {["", "hardware", "inbox", "verified", "assigned", "stocked", "retired"].map((option) => (
                  <button key={option || "all"} onClick={() => setFilter(option)} className={`rounded-md border px-3 py-1.5 text-xs capitalize ${filter === option ? "border-gray-500 bg-gray-800 text-white" : "border-gray-800 text-gray-400 hover:bg-gray-900"}`}>
                    {option ? label(option) : "all"}
                  </button>
                ))}
              </div>
              <AssetList assets={filter ? filtered : hardware} selectedId={selected?.id} onSelect={loadDetails} />
            </Panel>
          )}

          {view === "software" && (
            <div className="grid gap-4 xl:grid-cols-2">
              <Panel title="SAM Position" icon={<Scale className="h-4 w-4" />}>
                <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
                  <div className="text-sm text-gray-400">Open financial exposure</div>
                  <div className="mt-2 text-3xl font-semibold text-violet-200">{money(dashboard.exceptions?.impact)}</div>
                  <p className="mt-2 text-sm text-gray-500">Generated from entitlement, usage, and exception evidence.</p>
                </div>
                <div className="mt-4">
                  <ExceptionList exceptions={exceptions.filter((ex) => ["under_licensed", "over_licensed", "no_entitlement"].includes(ex.type)).slice(0, 8)} />
                </div>
              </Panel>
              <Panel title="Software Evidence" icon={<WalletCards className="h-4 w-4" />}>
                <AssetList assets={softwareEvidence} selectedId={selected?.id} onSelect={loadDetails} empty="Software assets are represented through entitlements and usage evidence." />
              </Panel>
            </div>
          )}

          {view === "contracts" && (
            <div className="grid gap-4 xl:grid-cols-2">
              <Panel title="Contract Intelligence" icon={<FileText className="h-4 w-4" />}>
                <button onClick={demoContract} disabled={busy === "contract"} className="mb-4 rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-950 hover:bg-white disabled:opacity-50">Extract Entitlements</button>
                <Endpoint method="AI" path="Drop MSLA / EA / SaaS agreement" note="Extract publisher, SKU, metric, quantity, rights, constraints, dates, confidence, and source citations." />
                <Endpoint method="Review" path="Human validates ambiguous clauses" note="Humans review exceptions and low-confidence terms instead of keying line items." />
              </Panel>
              <Panel title="Procurement Flow" icon={<ClipboardList className="h-4 w-4" />}>
                <Endpoint method="PO" path="Expected assets and entitlements" note="Purchase orders create expected asset candidates or entitlement candidates." />
                <Endpoint method="Receipt" path="Physical custody evidence" note="Receiving and mobile scans convert expected assets into verified assets." />
                <Endpoint method="Invoice" path="Financial validation" note="Invoices attach cost, legal entity, and renewal evidence." />
              </Panel>
            </div>
          )}

          {view === "integrations" && (
            <div className="grid gap-4 xl:grid-cols-2">
              <Panel title="Entry Points" icon={<TerminalSquare className="h-4 w-4" />}>
                <Endpoint method="POST" path="/api/assets/procurement/orders" note="Procurement orders, invoices, and receipts create assets or entitlement candidates." />
                <Endpoint method="POST" path="/api/assets/contracts" note="Agreement ingestion and AI entitlement extraction." />
                <Endpoint method="POST" path="/api/assets/scans" note="Mobile barcode, QR, RFID, NFC, and photo-assisted custody evidence." />
                <Endpoint method="POST" path="/api/assets/software/usage" note="Discovery, SaaS, MDM, EDR, and consumption usage evidence." />
                <Endpoint method="POST" path="/api/assets/reconcile" note="SAM reconciliation, compliance risk, and savings exceptions." />
              </Panel>
              <Panel title="Exit Points" icon={<ShieldCheck className="h-4 w-4" />}>
                <Endpoint method="event" path="asset.created" note="Drive custody, receiving, deployment, or CMDB linking workflows." />
                <Endpoint method="event" path="asset.contract_ingested" note="Start entitlement review and renewal governance." />
                <Endpoint method="event" path="asset.sam_reconciled" note="Route license risk, savings, and audit exceptions." />
                <Endpoint method="event" path="asset.scanned" note="Feed mobile asset audit and physical custody trails." />
              </Panel>
            </div>
          )}
        </section>

        <aside className="min-h-0 overflow-auto border-l border-gray-800 bg-gray-950 p-5 pb-24">
          {!selected ? <Empty text="Select an asset to inspect custody, evidence, scans, usage, and exceptions." /> : (
            <div className="space-y-4">
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Pill className={STATUS_CLASS[selected.status]}>{label(selected.status)}</Pill>
                  <span className="text-xs text-gray-500">{label(selected.category)} · {label(selected.asset_type)}</span>
                </div>
                <h2 className="text-lg font-semibold">{selected.name}</h2>
                <p className="mt-1 text-sm text-gray-500">{selected.manufacturer || "Unknown maker"} {selected.model || ""}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <MiniStat label="Confidence" value={pct(selected.confidence)} />
                <MiniStat label="Evidence" value={pct(selected.evidence_score)} />
                <MiniStat label="Cost" value={money(selected.cost)} />
                <MiniStat label="Location" value={selected.location || "unknown"} />
              </div>

              <Panel title="Asset Identity" icon={<PackageSearch className="h-4 w-4" />}>
                <Field label="Asset tag" value={selected.asset_tag} />
                <Field label="Serial number" value={selected.serial_number} />
                <Field label="CI" value={selected.ci_id} />
                <Field label="Lifecycle" value={label(selected.lifecycle_state)} />
                <button onClick={() => recordScan(selected)} disabled={busy === `scan:${selected.id}`} className="mt-3 rounded-md border border-gray-700 px-3 py-2 text-sm hover:bg-gray-900 disabled:opacity-50">Record Scan</button>
              </Panel>

              <Panel title="Open Exceptions" icon={<AlertTriangle className="h-4 w-4" />}>
                <ExceptionList exceptions={selected.exceptions || []} empty="No open exceptions for this asset." />
              </Panel>

              <Panel title="Scan Evidence" icon={<ScanLine className="h-4 w-4" />}>
                <div className="space-y-2">
                  {(selected.scans || []).length === 0 && <Empty text="No scan events recorded." />}
                  {(selected.scans || []).map((scan) => (
                    <div key={scan.id} className="rounded-md border border-gray-800 bg-gray-900/40 p-3">
                      <div className="text-sm font-medium">{scan.value}</div>
                      <div className="text-xs text-gray-500">{scan.scan_type} · {scan.action} · {scan.location || "unknown"} · {when(scan.created_at)}</div>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Software Usage" icon={<Scale className="h-4 w-4" />}>
                <div className="space-y-2">
                  {(selected.usage || []).length === 0 && <Empty text="No software usage linked." />}
                  {(selected.usage || []).map((usage) => (
                    <div key={usage.id} className="rounded-md border border-gray-800 bg-gray-900/40 p-3">
                      <div className="text-sm font-medium">{usage.publisher} {usage.product}</div>
                      <div className="text-xs text-gray-500">{usage.quantity} {usage.metric} · {when(usage.last_seen_at)}</div>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Evidence Trail" icon={<CheckCircle2 className="h-4 w-4" />}>
                <div className="space-y-2">
                  {(selected.evidence || []).length === 0 && <Empty text="No evidence recorded." />}
                  {(selected.evidence || []).map((ev) => (
                    <div key={ev.id} className="rounded-md border border-gray-800 bg-gray-900/40 p-3">
                      <div className="text-sm font-medium">{ev.evidence_type}</div>
                      <div className="text-xs text-gray-500">{ev.source} · confidence {pct(ev.confidence)} · {when(ev.created_at)}</div>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-500">{icon}{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-gray-100">{value}</div>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-800 bg-gray-950/60">
      <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-3 text-sm font-semibold text-gray-200">{icon}{title}</div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function AssetList({ assets, selectedId, onSelect, empty = "No assets found." }: {
  assets: AssetRecord[];
  selectedId?: string;
  onSelect: (id: string) => void;
  empty?: string;
}) {
  if (assets.length === 0) return <Empty text={empty} />;
  return (
    <div className="space-y-2">
      {assets.map((asset) => (
        <button key={asset.id} onClick={() => onSelect(asset.id)} className={`block w-full rounded-lg border p-3 text-left ${selectedId === asset.id ? "border-violet-500/60 bg-violet-500/10" : "border-gray-800 bg-gray-900/40 hover:bg-gray-900"}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-gray-100">{asset.name}</div>
              <div className="mt-1 text-xs text-gray-500">{asset.manufacturer || "Unknown"} {asset.model || ""} · {asset.location || "unknown"} · {when(asset.updated_at)}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-xs font-semibold text-violet-300">{pct(asset.evidence_score)}</span>
              <Pill className={STATUS_CLASS[asset.status]}>{label(asset.status)}</Pill>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

function ExceptionList({ exceptions, empty = "No open exceptions." }: { exceptions: AssetException[]; empty?: string }) {
  if (exceptions.length === 0) return <Empty text={empty} />;
  return (
    <div className="space-y-2">
      {exceptions.map((ex) => (
        <div key={ex.id} className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium">{ex.title}</div>
              <div className="mt-1 text-xs text-gray-500">{label(ex.type)} · {label(ex.severity)} · {money(ex.financial_impact)}</div>
            </div>
            <Pill>{label(ex.status)}</Pill>
          </div>
          {ex.detail && <p className="mt-2 text-xs text-gray-400">{ex.detail}</p>}
        </div>
      ))}
    </div>
  );
}

function Endpoint({ method, path, note }: { method: string; path: string; note: string }) {
  return (
    <div className="mb-3 rounded-lg border border-gray-800 bg-gray-900/40 p-3">
      <div className="flex items-center gap-2">
        <span className="rounded bg-gray-800 px-2 py-1 text-xs font-semibold uppercase text-gray-300">{method}</span>
        <code className="text-xs text-gray-200">{path}</code>
      </div>
      <p className="mt-2 text-sm text-gray-500">{note}</p>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3 border-b border-gray-900 pb-2 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="truncate text-gray-200">{value || "unknown"}</span>
    </div>
  );
}

function Pill({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`rounded-full border px-2 py-0.5 text-xs capitalize ${className || "border-gray-700 bg-gray-800 text-gray-300"}`}>{children}</span>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-gray-800 p-4 text-center text-sm text-gray-500">{text}</div>;
}
