"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { graphqlClient } from "@/lib/api";
import type { ShellAPI } from "@/sdk/types";
import { Search, ChevronLeft, ChevronRight, RefreshCw, CheckCircle } from "lucide-react";
import { DetailPanel } from "./DetailPanel";

interface CI {
  id: string;
  name: string;
  class: string;
  environment?: string;
  attributes?: Record<string, any>;
  dataQualityScore?: number;
  health?: {
    overall?: number;
  };
}

const PAGE_SIZE = 25;

export default function CMDBExplorerApp({ shell }: { shell: ShellAPI }) {
  const [cis, setCis] = useState<CI[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [envFilter, setEnvFilter] = useState("");
  const [classes, setClasses] = useState<string[]>([]);
  const [environments, setEnvironments] = useState<string[]>([]);
  const [selectedCi, setSelectedCi] = useState<CI | null>(null);
  const [selectionMode, setSelectionMode] = useState<{ context: string; callbackChannel: string } | null>(null);
  const searchDebounce = useRef<ReturnType<typeof setTimeout>>();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const filter: any = {};
      if (classFilter) filter.class = classFilter;
      if (envFilter) filter.environment = envFilter;
      if (search.trim()) filter.name = search.trim();

      const [cisData, countData] = await Promise.all([
        graphqlClient.request(
          `query GetCIs($filter: CIFilterInput, $limit: Int, $offset: Int) {
            cis(filter: $filter, limit: $limit, offset: $offset) {
              id name class environment attributes dataQualityScore health { overall }
            }
          }`,
          { filter, limit: PAGE_SIZE, offset }
        ),
        graphqlClient.request(
          `query GetCICount($filter: CIFilterInput) {
            ciCount(filter: $filter)
          }`,
          { filter }
        ),
      ]);

      setCis(((cisData as any).cis || []) as CI[]);
      setTotal((countData as any).ciCount || 0);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [search, classFilter, envFilter, offset]);

  const fetchFilters = useCallback(async () => {
    try {
      const [classesData, envsData] = await Promise.all([
        graphqlClient.request(`query { ciClasses }`),
        graphqlClient.request(`query { ciEnvironments }`),
      ]);
      setClasses(((classesData as any).ciClasses || []) as string[]);
      setEnvironments(((envsData as any).ciEnvironments || []) as string[]);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchFilters();
  }, [fetchFilters]);

  // Debounced search
  useEffect(() => {
    clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      setOffset(0);
      fetchData();
    }, 300);
    return () => clearTimeout(searchDebounce.current);
  }, [search]);

  // Reset offset when filters change
  useEffect(() => {
    setOffset(0);
  }, [classFilter, envFilter]);

  // Subscribe to real-time CI events
  useEffect(() => {
    const unsubCreated = shell.eventBus.subscribe("ci.created", () => fetchData());
    const unsubUpdated = shell.eventBus.subscribe("ci.updated", () => fetchData());
    const unsubDeleted = shell.eventBus.subscribe("ci.deleted", () => fetchData());
    return () => {
      unsubCreated();
      unsubUpdated();
      unsubDeleted();
    };
  }, [shell, fetchData]);

  // Subscribe to FOCUS_CI from chat action cards
  useEffect(() => {
    const unsubscribe = shell.onMessage((msg) => {
      if (msg.type === "FOCUS_CI") {
        const id = msg.payload?.id;
        if (id) {
          // Find and select the CI
          const found = cis.find((c) => c.id === id);
          if (found) {
            setSelectedCi(found);
          } else {
            // Fetch it directly
            graphqlClient
              .request(
                `query GetCI($id: ID!) { ci(id: $id) { id name class environment attributes dataQualityScore health { overall } } }`,
                { id }
              )
              .then((data) => {
                const ci = (data as any).ci;
                if (ci) setSelectedCi(ci);
              });
          }
        }
      } else if (msg.type === "START_CI_SELECTION") {
        setSelectionMode({
          context: msg.payload?.context || "default",
          callbackChannel: msg.payload?.callbackChannel || "chat",
        });
      }
    });
    return unsubscribe;
  }, [shell, cis]);

  const handleSelectCI = (ci: CI) => {
    if (!selectionMode) return;
    shell.messageBus.publish({
      type: "CI_SELECTED",
      from: "cmdb-explorer",
      to: selectionMode.callbackChannel,
      payload: { ci: { id: ci.id, name: ci.name, class: ci.class }, context: selectionMode.context },
    });
    // Close the window after selection
    setSelectionMode(null);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const startItem = offset + 1;
  const endItem = Math.min(offset + PAGE_SIZE, total);

  const handleViewInMap = (id: string) => {
    shell.dispatch({ type: "OPEN_APP", id: "service-map", installKey: "service-map", mode: "canvas", permissions: ["read:cmdb", "read:relationships"] });
    setTimeout(() => {
      shell.messageBus.publish({ type: "SET_ROOT_CI", from: "cmdb-explorer", to: "service-map", payload: { rootId: id } });
    }, 500);
  };

  return (
    <div className="h-full w-full flex flex-col bg-gray-950 text-gray-100 relative overflow-hidden">
      {/* Selection mode banner */}
      {selectionMode && (
        <div className="flex items-center justify-between px-4 py-2 bg-indigo-900/30 border-b border-indigo-500/30 shrink-0">
          <span className="text-sm text-indigo-300">
            Selection mode: Click <strong>Select</strong> on a CI to choose it for {selectionMode.context}
          </span>
          <button
            onClick={() => setSelectionMode(null)}
            className="text-xs text-indigo-400 hover:text-indigo-200 underline"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 shrink-0">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-gray-900 border border-gray-700 focus:outline-none focus:border-indigo-500 text-sm transition-colors"
          />
        </div>

        {/* Class filter */}
        <select
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-sm text-gray-300 focus:outline-none focus:border-indigo-500"
        >
          <option value="">All Classes</option>
          {classes.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        {/* Environment filter */}
        <select
          value={envFilter}
          onChange={(e) => setEnvFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-sm text-gray-300 focus:outline-none focus:border-indigo-500"
        >
          <option value="">All Environments</option>
          {environments.map((e) => (
            <option key={e} value={e}>{e}</option>
          ))}
        </select>

        <div className="flex-1" />

        {/* Refresh */}
        <button
          onClick={fetchData}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Results table */}
      <div className="flex-1 overflow-auto pb-24">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 sticky top-0 z-10">
            <tr className="border-b border-gray-800">
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">ID</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Class</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Environment</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Health</th>
            </tr>
          </thead>
          <tbody>
            {loading && cis.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  <div className="animate-pulse">Loading...</div>
                </td>
              </tr>
            ) : cis.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  No configuration items found
                </td>
              </tr>
            ) : (
              cis.map((ci) => (
                <tr
                  key={ci.id}
                  onClick={() => setSelectedCi(ci)}
                  className={`border-b border-gray-800/50 cursor-pointer transition-colors ${
                    selectedCi?.id === ci.id
                      ? "bg-indigo-900/20"
                      : "hover:bg-gray-800/40"
                  }`}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      {selectionMode && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectCI(ci);
                          }}
                          className="flex items-center gap-1 px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs transition-colors"
                        >
                          <CheckCircle className="w-3 h-3" />
                          Select
                        </button>
                      )}
                      <span className="text-gray-200 font-medium">{ci.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 font-mono text-xs">{ci.id}</td>
                  <td className="px-4 py-2.5">
                    <span className="px-2 py-0.5 rounded-md bg-gray-800 text-gray-400 text-xs">{ci.class}</span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-400">{ci.environment || "—"}</td>
                  <td className="px-4 py-2.5">
                    {ci.dataQualityScore !== undefined ? (
                      <span
                        className={`text-xs font-medium ${
                          ci.dataQualityScore >= 80
                            ? "text-green-400"
                            : ci.dataQualityScore >= 50
                            ? "text-yellow-400"
                            : "text-red-400"
                        }`}
                      >
                        {ci.dataQualityScore}%
                      </span>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-800 shrink-0 text-sm">
        <span className="text-gray-500">
          {total > 0 ? `${startItem}-${endItem} of ${total}` : "0 results"}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
            disabled={offset === 0}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-gray-500 min-w-[60px] text-center">
            Page {currentPage} of {Math.max(1, totalPages)}
          </span>
          <button
            onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Detail panel */}
      {selectedCi && (
        <DetailPanel
          ci={selectedCi}
          onClose={() => setSelectedCi(null)}
          onViewInMap={handleViewInMap}
        />
      )}
    </div>
  );
}
