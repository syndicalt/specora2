"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import ReactFlow, {
  Background,
  Controls,
  Node as FlowNode,
  Edge as FlowEdge,
  useNodesState,
  useEdgesState,
} from "reactflow";
import "reactflow/dist/style.css";
import { graphqlClient } from "@/lib/api";
import type { ShellAPI } from "@/sdk/types";
import { Search, MapPin, X } from "lucide-react";

type APINode = { id: string; name: string; class: string };
type APIEdge = { id: string; type: string; sourceId: string; targetId: string };

function computeLayout(nodes: APINode[], edges: APIEdge[]) {
  const childrenMap = new Map<string, string[]>();
  const parentMap = new Map<string, string>();

  edges.forEach((e) => {
    if (!childrenMap.has(e.sourceId)) childrenMap.set(e.sourceId, []);
    childrenMap.get(e.sourceId)!.push(e.targetId);
    parentMap.set(e.targetId, e.sourceId);
  });

  const rootId = nodes.find((n) => !parentMap.has(n.id))?.id || nodes[0]?.id;

  const levels = new Map<string, number>();
  const queue: string[] = [rootId];
  levels.set(rootId, 0);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLevel = levels.get(current)!;
    const children = childrenMap.get(current) || [];
    children.forEach((childId) => {
      if (!levels.has(childId)) {
        levels.set(childId, currentLevel + 1);
        queue.push(childId);
      }
    });
  }

  const levelGroups = new Map<number, string[]>();
  levels.forEach((level, id) => {
    if (!levelGroups.has(level)) levelGroups.set(level, []);
    levelGroups.get(level)!.push(id);
  });

  const nodeWidth = 220;
  const nodeHeight = 80;
  const levelGap = 180;
  const nodeGap = 40;

  const positions = new Map<string, { x: number; y: number }>();

  levelGroups.forEach((nodeIds, level) => {
    const totalWidth = nodeIds.length * nodeWidth + (nodeIds.length - 1) * nodeGap;
    const startX = -totalWidth / 2 + nodeWidth / 2;

    nodeIds.forEach((id, index) => {
      positions.set(id, {
        x: startX + index * (nodeWidth + nodeGap),
        y: level * levelGap,
      });
    });
  });

  let orphanIndex = 0;
  nodes.forEach((node) => {
    if (!positions.has(node.id)) {
      positions.set(node.id, {
        x: (orphanIndex % 3) * (nodeWidth + nodeGap) - 300,
        y: Math.floor(orphanIndex / 3) * (nodeHeight + nodeGap) - 200,
      });
      orphanIndex++;
    }
  });

  const flowNodes: FlowNode[] = nodes.map((node) => ({
    id: node.id,
    data: { label: `${node.name}\n(${node.class})` },
    position: positions.get(node.id) || { x: 0, y: 0 },
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
  }));

  const seenEdges = new Set<string>();
  const flowEdges: FlowEdge[] = [];

  edges.forEach((ed) => {
    const key = `${ed.sourceId}->${ed.targetId}`;
    if (!seenEdges.has(key)) {
      seenEdges.add(key);
      flowEdges.push({
        id: ed.id,
        source: ed.sourceId,
        target: ed.targetId,
        label: ed.type,
        type: "smoothstep",
        style: { stroke: "#6366f1", strokeWidth: 2 },
        labelStyle: { fill: "#9ca3af", fontSize: 11 },
        labelBgStyle: { fill: "#111827", fillOpacity: 0.9 },
        labelBgPadding: [4, 4],
        animated: ed.type === "DEPENDS_ON",
      });
    }
  });

  return { nodes: flowNodes, edges: flowEdges };
}

export default function ServiceMapApp({ shell }: { shell: ShellAPI }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading] = useState(true);
  const [rootId, setRootId] = useState<string>("bs-1");
  const [rootName, setRootName] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<APINode[]>([]);
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async (targetRootId: string) => {
    try {
      const data = await graphqlClient.request(`
        query {
          serviceMap(rootId: "${targetRootId}") {
            nodes { id name class }
            edges { id type sourceId targetId }
          }
        }
      `);
      const map = (data as any).serviceMap;
      const layout = computeLayout(map.nodes, map.edges);
      setNodes(layout.nodes);
      setEdges(layout.edges);
      const rootNode = map.nodes.find((n: APINode) => n.id === targetRootId);
      setRootName(rootNode?.name || targetRootId);
    } catch (err) {
      console.error("Failed to load graph", err);
    } finally {
      setLoading(false);
    }
  }, [setNodes, setEdges]);

  useEffect(() => {
    fetchData(rootId);
  }, [rootId, fetchData]);

  // Listen for cross-app messages
  useEffect(() => {
    const unsubscribe = shell.onMessage((msg) => {
      if (msg.type === "navigate-to-ci") {
        setRootId(msg.payload?.ciId || "bs-1");
      }
    });
    return unsubscribe;
  }, [shell]);

  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }
    try {
      const data = await graphqlClient.request(`
        query {
          cis(filter: { name: "${query}" }) { id name class }
        }
      `);
      const results = ((data as any).cis || []).slice(0, 8);
      setSearchResults(results);
      setShowResults(true);
    } catch {
      setSearchResults([]);
    }
  }, []);

  const selectResult = (id: string, name: string) => {
    setSearchQuery(name);
    setShowResults(false);
    setRootId(id);
  };

  // Close search results on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center text-gray-400">
        Loading service map...
      </div>
    );
  }

  return (
    <div className="h-full w-full relative">
      {/* Floating header */}
      <div className="absolute top-4 left-4 right-4 z-10 flex items-center gap-3">
        {/* Breadcrumb pill */}
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-900/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-lg shadow-black/20">
          <div className="w-7 h-7 rounded-lg bg-indigo-500/20 flex items-center justify-center">
            <MapPin className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-medium text-gray-200">{rootName || rootId}</span>
            <span className="text-xs text-gray-600 font-mono">{rootId}</span>
          </div>
        </div>

        {/* Search pill */}
        <div ref={searchRef} className="relative flex-1 max-w-md">
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-900/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-lg shadow-black/20 focus-within:border-indigo-500/50 focus-within:shadow-indigo-500/10 transition-all">
            <Search className="w-4 h-4 text-gray-500 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              onFocus={() => searchResults.length > 0 && setShowResults(true)}
              placeholder="Search for a CI..."
              className="flex-1 bg-transparent text-sm text-gray-200 placeholder-gray-600 focus:outline-none"
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
          {showResults && searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden">
              {searchResults.map((ci) => (
                <button
                  key={ci.id}
                  onClick={() => selectResult(ci.id, ci.name)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-white/5 transition-colors"
                >
                  <span className="text-gray-300">{ci.name}</span>
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
            position="top-right"
            className="!bg-transparent !border-none !shadow-none"
            showInteractive={false}
          />
        </ReactFlow>
      </div>
    </div>
  );
}
