"use client";

import { useState, useEffect } from "react";
import { useShell } from "@/shell/AppContext";
import { graphqlClient } from "@/lib/api";
import { getAvailableRegistry, getRegistry, installApp, reinstallOptionalApp, uninstallApp } from "@/sdk";
import type { RegistryEntry } from "@/sdk/types";
import { Download, Trash2, CheckCircle, XCircle, Clock, Compass, Shield } from "lucide-react";
import { APP_ICONS } from "@/lib/icons";

const MARKETPLACE_APPS_QUERY = `
  query MarketplaceApps($status: String) {
    marketplaceApps(status: $status) {
      id name description url icon version permissions reactVersion author authorUrl status createdAt
    }
  }
`;

const SUBMIT_APP_MUTATION = `mutation SubmitMarketplaceApp($id: ID!, $name: String!, $description: String, $url: String!, $author: String!) { submitMarketplaceApp(id: $id, name: $name, description: $description, url: $url, author: $author) { id name status } }`;
const APPROVE_APP_MUTATION = `mutation ApproveMarketplaceApp($id: ID!) { approveMarketplaceApp(id: $id) { id name status } }`;
const REJECT_APP_MUTATION = `mutation RejectMarketplaceApp($id: ID!) { rejectMarketplaceApp(id: $id) { id name status } }`;
const ME_QUERY = `query { me { id name email role } }`;

interface MarketplaceApp {
  id: string; name: string; description: string | null; url: string; icon: string;
  version: string; permissions: string[]; reactVersion: string; author: string;
  authorUrl: string | null; status: string; createdAt: string;
}

type CombinedApp =
  | { source: "built-in"; entry: RegistryEntry }
  | { source: "marketplace"; app: MarketplaceApp };

export default function ArcApp() {
  const { dispatch } = useShell();
  const [tab, setTab] = useState<"discover" | "installed" | "submit" | "review">("discover");
  const [marketplaceApps, setMarketplaceApps] = useState<MarketplaceApp[]>([]);
  const [registry, setRegistry] = useState<RegistryEntry[]>([]);
  const [availableRegistry, setAvailableRegistry] = useState<RegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const fetchMarketplace = async () => {
    setLoading(true);
    try {
      const data: any = await graphqlClient.request(MARKETPLACE_APPS_QUERY, { status: tab === "review" ? "pending" : "approved" });
      setMarketplaceApps((data.marketplaceApps || []) as MarketplaceApp[]);
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  const fetchRegistry = async () => {
    const [installed, available] = await Promise.all([getRegistry(), getAvailableRegistry()]);
    setRegistry(installed);
    setAvailableRegistry(available);
  };

  const fetchUser = async () => {
    try {
      const data: any = await graphqlClient.request(ME_QUERY);
      setIsAdmin(data?.me?.role === "admin" || data?.me?.role === "security_admin");
    } catch { /* silent */ }
  };

  useEffect(() => { fetchMarketplace(); fetchRegistry(); fetchUser(); }, [tab]);

  const handleInstall = async (app: MarketplaceApp) => {
    try {
      await installApp({ id: app.id, name: app.name, icon: app.icon, version: app.version,
        permissions: app.permissions, defaultMode: "canvas", url: app.url, reactVersion: app.reactVersion });
      dispatch({ type: "NOTIFY", notification: { id: crypto.randomUUID(), message: app.name + " installed", type: "success" } });
      fetchRegistry();
    } catch {
      dispatch({ type: "NOTIFY", notification: { id: crypto.randomUUID(), message: app.name + " could not be installed", type: "error" } });
    }
  };

  const handleInstallOptional = async (id: string, name: string) => {
    try {
      await reinstallOptionalApp(id);
      dispatch({ type: "NOTIFY", notification: { id: crypto.randomUUID(), message: name + " installed", type: "success" } });
      fetchRegistry();
    } catch {
      dispatch({ type: "NOTIFY", notification: { id: crypto.randomUUID(), message: name + " could not be installed", type: "error" } });
    }
  };

  const handleUninstall = async (id: string, name: string) => {
    try {
      await uninstallApp(id, true);
      dispatch({ type: "NOTIFY", notification: { id: crypto.randomUUID(), message: name + " uninstalled", type: "info" } });
      fetchRegistry();
    } catch {
      dispatch({ type: "NOTIFY", notification: { id: crypto.randomUUID(), message: name + " could not be uninstalled", type: "error" } });
    }
  };

  const handleApprove = async (id: string) => { await graphqlClient.request(APPROVE_APP_MUTATION, { id }); fetchMarketplace(); };
  const handleReject = async (id: string) => { await graphqlClient.request(REJECT_APP_MUTATION, { id }); fetchMarketplace(); };
  const iconFor = (name: string) => APP_ICONS[name] || Compass;

  const isInstalled = (id: string) => registry.some((r) => r.id === id && r.source === "external");

  // Discover tab: combine native + marketplace
  const discoverApps: CombinedApp[] = [
    ...availableRegistry.filter((r) => r.source === "built-in").map((entry) => ({ source: "built-in" as const, entry })),
    ...marketplaceApps.map((app) => ({ source: "marketplace" as const, app })),
  ];

  const isOptionalPackage = (app: RegistryEntry) => app.source === "built-in" && app.bundledWithPlatform === false;

  // Installed tab: split into core native, package-native, and external
  const nativeApps = registry.filter((r) => r.source === "built-in" && !isOptionalPackage(r));
  const packageApps = registry.filter(isOptionalPackage);
  const externalApps = registry.filter((r) => r.source === "external");

  return (
    <div className="h-full w-full flex flex-col bg-gray-950 text-gray-100 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <Compass className="w-4 h-4 text-indigo-400" />
          Specora Arc
        </h2>
      </div>
      <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-800 shrink-0">
        {(["discover", "installed", "submit"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${tab === t ? "bg-gray-800 text-white" : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"}`}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
        {isAdmin && (
          <button onClick={() => setTab("review")}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-1.5 ${tab === "review" ? "bg-gray-800 text-white" : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"}`}>
            Review <Clock className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto p-4 pb-24">
        {loading && tab !== "installed" ? (
          <div className="text-center text-gray-500 py-8 animate-pulse">Loading...</div>
        ) : tab === "discover" ? (
          <div className="grid grid-cols-3 gap-4">
            {discoverApps.map((item) => {
              if (item.source === "built-in") {
                const entry = item.entry;
                const Icon = iconFor(entry.icon);
                const installed = entry.installStatus === "installed" || registry.some((app) => app.id === entry.id);
                const optionalPackage = entry.bundledWithPlatform === false;
                return (
                  <div key={entry.id} data-testid={`arc-discover-card-${entry.id}`} className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-medium text-gray-200">{entry.name}</h3>
                        <p className="text-xs text-gray-500 mt-0.5">by {entry.publisher || "Specora"}</p>
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 mt-2 line-clamp-2">{entry.description || "No description"}</p>
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-xs text-gray-500">v{entry.version}</span>
                      {optionalPackage && !installed ? (
                        <button data-testid={`arc-install-${entry.id}`} onClick={() => handleInstallOptional(entry.id, entry.name)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-xs text-white transition-colors">
                          <Download className="w-3 h-3" /> Install
                        </button>
                      ) : (
                        <span className={`text-xs flex items-center gap-1 ${optionalPackage ? "text-amber-300" : "text-emerald-400"}`}>
                          <Shield className="w-3 h-3" /> {optionalPackage ? (entry.installStatus || "Package") : "Native"}
                        </span>
                      )}
                    </div>
                  </div>
                );
              }

              const app = item.app;
              const Icon = iconFor(app.icon);
              const installed = isInstalled(app.id);
              return (
                <div key={app.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-gray-200">{app.name}</h3>
                      <p className="text-xs text-gray-500 mt-0.5">by {app.author}</p>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mt-2 line-clamp-2">{app.description || "No description"}</p>
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-xs text-gray-500">v{app.version}</span>
                    {installed ? (
                      <span className="text-xs text-green-400 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Installed</span>
                    ) : (
                      <button onClick={() => handleInstall(app)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs text-white transition-colors">
                        <Download className="w-3 h-3" /> Install
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : tab === "installed" ? (
          <div className="space-y-6">
            {/* Specora Native */}
            <div>
              <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Specora Native</h3>
              {nativeApps.length === 0 ? (
                <div className="text-center text-gray-500 py-6 text-sm">No native apps</div>
              ) : (
                <div className="space-y-2">
                  {nativeApps.map((app) => {
                    const Icon = iconFor(app.icon);
                    return (
                      <div key={app.id} data-testid={`arc-installed-package-${app.id}`} className="flex items-center gap-4 px-4 py-3 rounded-xl bg-gray-900 border border-gray-800">
                        <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-medium text-gray-200">{app.name}</h3>
                          <p className="text-xs text-gray-500">v{app.version}</p>
                          {app.description && <p className="text-xs text-gray-400 mt-0.5">{app.description}</p>}
                        </div>
                        <span className="text-xs text-emerald-400 flex items-center gap-1 shrink-0">
                          <Shield className="w-3 h-3" /> Pre-installed
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Premium Packages */}
            <div>
              <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Premium Packages</h3>
              {packageApps.length === 0 ? (
                <div className="text-center text-gray-500 py-6 text-sm">No premium package apps installed</div>
              ) : (
                <div className="space-y-2">
                  {packageApps.map((app) => {
                    const Icon = iconFor(app.icon);
                    return (
                      <div key={app.id} className="flex items-center gap-4 px-4 py-3 rounded-xl bg-gray-900 border border-gray-800">
                        <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-amber-500/10 text-amber-300">
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-medium text-gray-200">{app.name}</h3>
                          <p className="text-xs text-gray-500">{app.packageName || "Premium package"} · {app.entitlementMode || "placeholder"}</p>
                          {app.description && <p className="text-xs text-gray-400 mt-0.5">{app.description}</p>}
                        </div>
                        <button data-testid={`arc-uninstall-${app.id}`} onClick={() => handleUninstall(app.id, app.name)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs transition-colors shrink-0">
                          <Trash2 className="w-3 h-3" /> Uninstall
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Arc Applications */}
            <div>
              <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Arc Applications</h3>
              {externalApps.length === 0 ? (
                <div className="text-center text-gray-500 py-6 text-sm">No Arc apps installed</div>
              ) : (
                <div className="space-y-2">
                  {externalApps.map((app) => {
                    const Icon = iconFor(app.icon);
                    return (
                      <div key={app.id} className="flex items-center gap-4 px-4 py-3 rounded-xl bg-gray-900 border border-gray-800">
                        <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-medium text-gray-200">{app.name}</h3>
                          <p className="text-xs text-gray-500">v{app.version}</p>
                          {app.description && <p className="text-xs text-gray-400 mt-0.5">{app.description}</p>}
                        </div>
                        <button onClick={() => handleUninstall(app.id, app.name)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs transition-colors shrink-0">
                          <Trash2 className="w-3 h-3" /> Uninstall
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : tab === "submit" ? (
          <div className="max-w-lg mx-auto space-y-4">
            <p className="text-sm text-gray-400">Submit your app for review.</p>
            <SubmitForm onSubmit={() => { setTab("discover"); fetchMarketplace(); }} />
          </div>
        ) : (
          <div className="space-y-2">
            {marketplaceApps.length === 0 ? (
              <div className="text-center text-gray-500 py-8">No pending apps</div>
            ) : (
              marketplaceApps.map((app) => {
                const Icon = iconFor(app.icon);
                return (
                  <div key={app.id} className="flex items-center gap-4 px-4 py-3 rounded-xl bg-gray-900 border border-gray-800">
                    <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-gray-200">{app.name}</h3>
                      <p className="text-xs text-gray-500">by {app.author}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleApprove(app.id)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 text-xs transition-colors">
                        <CheckCircle className="w-3 h-3" /> Approve
                      </button>
                      <button onClick={() => handleReject(app.id)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs transition-colors">
                        <XCircle className="w-3 h-3" /> Reject
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SubmitForm({ onSubmit }: { onSubmit: () => void }) {
  const [form, setForm] = useState({ id: "", name: "", description: "", url: "", author: "" });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await graphqlClient.request(SUBMIT_APP_MUTATION, {
        id: form.id, name: form.name, description: form.description || null,
        url: form.url, author: form.author
      });
      onSubmit();
    } catch {
      alert("Failed to submit app");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-xs text-gray-500 mb-1">App ID</label>
        <input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })}
          className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-indigo-500" placeholder="my-app" required />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Name</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-indigo-500" placeholder="My App" required />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Description</label>
        <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-indigo-500" rows={3} />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Bundle URL</label>
        <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })}
          className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-indigo-500" placeholder="https://..." required />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Author</label>
        <input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })}
          className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-indigo-500" placeholder="Your name" required />
      </div>
      <button type="submit" disabled={submitting}
        className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50">
        {submitting ? "Submitting..." : "Submit for Review"}
      </button>
    </form>
  );
}
