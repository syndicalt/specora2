"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import ReactFlow, {
  Background,
  Controls,
  Node as FlowNode,
  Edge as FlowEdge,
  useNodesState,
  useEdgesState,
  MarkerType,
} from "reactflow";
import "reactflow/dist/style.css";
import { graphqlClient } from "@/lib/api";
import type { ShellAPI } from "@/sdk/types";
import { Search, MapPin, X, ChevronDown } from "lucide-react";
import dagre from "dagre";

type APINode = { id: string; name: string; class: string };
type APIEdge = { id: string; type: string; sourceId: string; targetId: string };

function computeLayout(nodes: APINode[], edges: APIEdge[]) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "TB",
    nodesep: 80,
    ranksep: 140,
    edgesep: 40,
    marginx: 20,
    marginy: 20,
  });
  g.setDefaultEdgeLabel(() => ({}));

  const nodeWidth = 240;
  const nodeHeight = 90;

  nodes.forEach((node) => {
    g.setNode(node.id, { label: node.name, width: nodeWidth, height: nodeHeight });
  });

  const seenEdges = new Set<string>();
  edges.forEach((ed) => {
    const key = `${ed.sourceId}->${ed.targetId}`;
    if (!seenEdges.has(key)) {
      seenEdges.add(key);
      g.setEdge(ed.sourceId, ed.targetId);
    }
  });

  dagre.layout(g);

  const flowNodes: FlowNode[] = nodes.map((node) => {
    const dagreNode = g.node(node.id);
    return {
      id: node.id,
      data: { label: `${node.name}\n(${node.class})` },
      position: {
        x: dagreNode.x - dagreNode.width / 2,
        y: dagreNode.y - dagreNode.height / 2,
      },
      style: {
        background: "#1f2937",
        color: "#f3f4f6",
        border: "1px solid #374151",
        borderRadius: "8px",
        padding: "12px",
        fontSize: "13px",
        width: nodeWidth,
        textAlign: "center",
        whiteSpace: "pre-line",
      },
    };
  });

  const flowEdges: FlowEdge[] = [];
  seenEdges.clear();
  edges.forEach((ed) => {
    const key = `${ed.sourceId}->${ed.targetId}`;
    if (!seenEdges.has(key)) {
      seenEdges.add(key);
      flowEdges.push({
        id: ed.id,
        source: ed.sourceId,
        target: ed.targetId,
        label: ed.type,
        type: "default",
        style: { stroke: "#6366f1", strokeWidth: 1.5 },
        labelStyle: { fill: "#9ca3af", fontSize: 10 },
        labelBgStyle: { fill: "#111827", fillOpacity: 0.9 },
        labelBgPadding: [4, 4],
        animated: ed.type === "DEPENDS_ON",
        markerEnd: { type: MarkerType.ArrowClosed, color: "#6366f1" },
      });
    }
  });

  return { nodes: flowNodes, edges: flowEdges };
}

export default function ServiceMapApp({ shell }: { shell: ShellAPI }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading] = useState(true);
  const [rootId, setRootId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("specora:lastServiceMapRoot") || "";
    }
    return "";
  });
  const [rootName, setRootName] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<APINode[]>([]);
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const [roots, setRoots] = useState<APINode[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async (targetRootId: string) => {
    try {
      const data = await graphqlClient.request(
        `
        query GetServiceMap($rootId: ID!) {
          serviceMap(rootId: $rootId) {
            nodes { id name class }
            edges { id type sourceId targetId }
          }
        }
      `,
        { rootId: targetRootId }
      );
      const map = (data as any).serviceMap;
      const layout = computeLayout(map.nodes, map.edges);
      setNodes(layout.nodes);
      setEdges(layout.edges);
      const rootNode = map.nodes.find((n: APINode) => n.id === targetRootId);
      setRootName(rootNode?.name || targetRootId);
    } catch {
      // silently fail — UI shows empty state
    } finally {
      setLoading(false);
    }
  }, [setNodes, setEdges]);

  useEffect(() => {
    fetchData(rootId);
  }, [rootId, fetchData]);

  // Broadcast context changes to global chat
  useEffect(() => {
    shell.sendMessage({ type: "SET_ROOT_CI", to: "*", payload: { rootId } });
  }, [rootId, shell]);

  // Listen for cross-app messages
  useEffect(() => {
    const unsubscribe = shell.onMessage((msg) => {
      if (msg.type === "navigate-to-ci") {
        const id = msg.payload?.ciId;
        if (id) selectRoot(id);
      }
    });
    return unsubscribe;
  }, [shell]);

  // Fetch candidate roots on mount
  useEffect(() => {
    let cancelled = false;
    async function loadRoots() {
      try {
        // Try BusinessServices first
        let data = await graphqlClient.request(`
          query {
            cis(filter: { class: "BusinessService" }) { id name class }
          }
        `);
        let results: APINode[] = ((data as any).cis || []);

        // Fallback to all top-level CIs
        if (results.length === 0) {
          data = await graphqlClient.request(`
            query {
              cis { id name class }
            }
          `);
          results = ((data as any).cis || []);
        }

        if (cancelled) return;
        setRoots(results);

        // Resolve initial rootId
        const saved = typeof window !== "undefined"
          ? localStorage.getItem("specora:lastServiceMapRoot")
          : null;

        if (saved && results.some((r) => r.id === saved)) {
          setRootId(saved);
        } else if (results.length > 0) {
          const first = results[0].id;
          setRootId(first);
          if (typeof window !== "undefined") {
            localStorage.setItem("specora:lastServiceMapRoot", first);
          }
        }
      } catch {
        // silently fail — roots stay empty
      }
    }
    loadRoots();
    return () => { cancelled = true; };
  }, []);

  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }
    try {
      const data = await graphqlClient.request(
        `
        query SearchCIs($name: String) {
          cis(filter: { name: $name }) { id name class }
        }
      `,
        { name: query }
      );
      const results = ((data as any).cis || []).slice(0, 8);
      setSearchResults(results);
      setShowResults(true);
    } catch {
      setSearchResults([]);
    }
  }, []);

  const selectRoot = (id: string) => {
    setRootId(id);
    setPickerOpen(false);
    if (typeof window !== "undefined") {
      localStorage.setItem("specora:lastServiceMapRoot", id);
    }
  };

  const selectResult = (id: string, name: string) => {
    setSearchQuery(name);
    setShowResults(false);
    selectRoot(id);
  };

  // Close search results on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (loading && roots.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center text-gray-400">
        Loading service map...
      </div>
    );
  }

  if (roots.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center text-gray-400">
        No Configuration Items found.
      </div>
    );
  }

  return (
    <div className="h-full w-full relative">
      {/* Centered floating search bar */}
      <div className="absolute top-6 left-0 right-0 z-[100] flex justify-center">
        <div ref={searchRef} className="relative flex items-center gap-2 px-2 py-2 bg-gray-900 border border-gray-700 rounded-full shadow-xl">
          {/* CI name / root picker (left side) */}
          <div ref={pickerRef} className="relative">
            <button
              onClick={() => setPickerOpen((prev) => !prev)}
              className="flex items-center gap-2 pl-3 pr-2 hover:bg-gray-800/50 rounded-full transition-colors"
            >
              <div className="w-6 h-6 rounded-full bg-indigo-500/20 flex items-center justify-center">
                <MapPin className="w-3 h-3 text-indigo-400" />
              </div>
              <span className="text-sm font-medium text-gray-100">{rootName || rootId}</span>
              <span className="text-xs text-gray-500 font-mono hidden sm:inline">{rootId}</span>
              <ChevronDown className={`w-3 h-3 text-gray-500 transition-transform ${pickerOpen ? "rotate-180" : ""}`} />
            </button>

            {/* Root picker dropdown */}
            {pickerOpen && (
              <div className="absolute top-full left-0 mt-2 w-64 bg-gray-900 border border-gray-700 rounded-xl shadow-xl overflow-hidden max-h-72 overflow-y-auto">
                {roots.map((ci) => (
                  <button
                    key={ci.id}
                    onClick={() => selectRoot(ci.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-gray-800 transition-colors ${
                      ci.id === rootId ? "bg-gray-800/60" : ""
                    }`}
                  >
                    <span className="text-gray-200">{ci.name}</span>
                    <span className="text-xs text-gray-500 ml-auto px-1.5 py-0.5 bg-gray-800 rounded-md">{ci.class}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="w-px h-5 bg-gray-700" />

          {/* Search input (right side) */}
          <div className="flex items-center gap-2 px-2">
            <Search className="w-4 h-4 text-gray-500 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              onFocus={() => searchResults.length > 0 && setShowResults(true)}
              placeholder="Search CI..."
              className="w-40 sm:w-56 bg-gray-900 text-sm text-gray-100 placeholder-gray-500 focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(""); setSearchResults([]); setShowResults(false); }}
                className="text-gray-500 hover:text-gray-300 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Search results dropdown */}
          {showResults && searchResults.length > 0 && (
            <div className="absolute top-full left-4 right-4 mt-2 bg-gray-900 border border-gray-700 rounded-xl shadow-xl overflow-hidden">
              {searchResults.map((ci) => (
                <button
                  key={ci.id}
                  onClick={() => selectResult(ci.id, ci.name)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-gray-800 transition-colors"
                >
                  <span className="text-gray-200">{ci.name}</span>
                  <span className="text-xs text-gray-500 ml-auto px-1.5 py-0.5 bg-gray-800 rounded-md">{ci.class}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Graph canvas */}
      <div className="h-full w-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={2}
        >
          <Background color="#374151" gap={16} />
          <Controls
            position="bottom-right"
            className="!bg-transparent !border-none !shadow-none"
            showInteractive={false}
          />
        </ReactFlow>
      </div>
    </div>
  );
}
