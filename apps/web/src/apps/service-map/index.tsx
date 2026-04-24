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
  Connection,
  ReactFlowProvider,
  useReactFlow,
} from "reactflow";
import "reactflow/dist/style.css";
import { graphqlClient } from "@/lib/api";
import type { ShellAPI } from "@/sdk/types";
import { Search, MapPin, X, ChevronDown } from "lucide-react";
import dagre from "dagre";
import { ContextMenu } from "./ContextMenu";
import { CIEditModal } from "./CIEditModal";
import { RelTypePicker } from "./RelTypePicker";
import { SidebarPanel } from "./SidebarPanel";

type APINode = { id: string; name: string; class: string; environment?: string; attributes?: Record<string, any> };
type APIEdge = { id: string; type: string; sourceId: string; targetId: string };

export const REL_COLORS: Record<string, { stroke: string; bg: string }> = {
  PART_OF:      { stroke: "#a78bfa", bg: "#7c3aed" },   // violet
  DEPENDS_ON:   { stroke: "#6366f1", bg: "#4338ca" },   // indigo (default)
  HOSTED_ON:    { stroke: "#2dd4bf", bg: "#0d9488" },   // teal
  MANAGED_BY:   { stroke: "#fbbf24", bg: "#d97706" },   // amber
  OWNED_BY:     { stroke: "#34d399", bg: "#059669" },   // emerald
  LOCATED_AT:   { stroke: "#fb7185", bg: "#e11d48" },   // rose
};

function getRelColor(type: string) {
  return REL_COLORS[type] || REL_COLORS.DEPENDS_ON;
}

function computeLayout(nodes: APINode[], edges: APIEdge[], highlightId?: string | null) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 80, ranksep: 140, edgesep: 40, marginx: 20, marginy: 20 });
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
      data: { label: `${node.name}\n(${node.class})`, ...node },
      position: { x: dagreNode.x - dagreNode.width / 2, y: dagreNode.y - dagreNode.height / 2 },
      style: {
        background: "#1f2937", color: "#f3f4f6", border: "1px solid #374151",
        borderRadius: "8px", padding: "12px", fontSize: "13px",
        width: nodeWidth, textAlign: "center", whiteSpace: "pre-line",
      },
      className: node.id === highlightId ? "node-highlight" : undefined,
    };
  });

  const flowEdges: FlowEdge[] = [];
  seenEdges.clear();
  edges.forEach((ed) => {
    const key = `${ed.sourceId}->${ed.targetId}`;
    if (!seenEdges.has(key)) {
      seenEdges.add(key);
      const color = getRelColor(ed.type);
      flowEdges.push({
        id: ed.id, source: ed.sourceId, target: ed.targetId, label: ed.type, type: "default",
        style: { stroke: color.stroke, strokeWidth: 2 },
        labelStyle: { fill: color.stroke, fontSize: 10, fontWeight: 500 },
        labelBgStyle: { fill: "#111827", fillOpacity: 0.95 },
        labelBgPadding: [4, 4], animated: ed.type === "DEPENDS_ON",
        markerEnd: { type: MarkerType.ArrowClosed, color: color.stroke },
      });
    }
  });

  return { nodes: flowNodes, edges: flowEdges };
}

function ServiceMapInner({ shell }: { shell: ShellAPI }) {
  const { setCenter } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading] = useState(true);
  const [rootId, setRootId] = useState<string>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("specora:lastServiceMapRoot") || "";
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

  // CRUD state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: any[] } | null>(null);
  const [editCi, setEditCi] = useState<APINode | null>(null);
  const [relPicker, setRelPicker] = useState<{ sourceId: string; targetId: string; sourceName: string; targetName: string } | null>(null);
  const [sidebarCi, setSidebarCi] = useState<APINode & { relationships?: any[] } | null>(null);
  const [toast, setToast] = useState<string>("");
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }, []);

  const fetchData = useCallback(async (targetRootId: string, highlightId?: string | null) => {
    try {
      const data = await graphqlClient.request(
        `query GetServiceMap($rootId: ID!) {
          serviceMap(rootId: $rootId) {
            nodes { id name class environment attributes }
            edges { id type sourceId targetId }
          }
        }`,
        { rootId: targetRootId }
      );
      const map = (data as any).serviceMap;
      const layout = computeLayout(map.nodes, map.edges, highlightId);
      setNodes(layout.nodes);
      setEdges(layout.edges);
      const rootNode = map.nodes.find((n: APINode) => n.id === targetRootId);
      setRootName(rootNode?.name || targetRootId);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [setNodes, setEdges]);

  useEffect(() => { fetchData(rootId, highlightedNodeId); }, [rootId, fetchData, highlightedNodeId]);

  useEffect(() => {
    shell.sendMessage({ type: "SET_ROOT_CI", to: "*", payload: { rootId } });
  }, [rootId, shell]);

  // Center view on highlighted node and clear after 3 seconds
  useEffect(() => {
    if (!highlightedNodeId) return;
    const node = nodes.find((n) => n.id === highlightedNodeId);
    if (node) {
      setTimeout(() => {
        setCenter(node.position.x + 120, node.position.y + 45, { zoom: 1.2 });
      }, 100);
    }
    const timer = setTimeout(() => {
      setHighlightedNodeId(null);
      setNodes((prev) => prev.map((n) => ({ ...n, className: undefined })));
    }, 3000);
    return () => clearTimeout(timer);
  }, [highlightedNodeId, nodes, setCenter]);

  useEffect(() => {
    const unsubscribe = shell.onMessage((msg) => {
      if (msg.type === "navigate-to-ci") {
        const id = msg.payload?.ciId;
        if (id) selectRoot(id);
      } else if (msg.type === "SET_ROOT_CI") {
        const id = msg.payload?.rootId;
        if (id) {
          setHighlightedNodeId(id);
          if (id === rootId) {
            // Same root — just re-apply highlight to existing nodes
            setNodes((prev) => prev.map((n) =>
              n.id === id ? { ...n, className: "node-highlight" } : { ...n, className: undefined }
            ));
          } else {
            selectRoot(id);
          }
        }
      }
    });
    return unsubscribe;
  }, [shell, rootId]);

  useEffect(() => {
    let cancelled = false;
    async function loadRoots() {
      try {
        let data = await graphqlClient.request(`query { cis(filter: { class: "BusinessService" }) { id name class } }`);
        let results: APINode[] = ((data as any).cis || []);
        if (results.length === 0) {
          data = await graphqlClient.request(`query { cis { id name class } }`);
          results = ((data as any).cis || []);
        }
        if (cancelled) return;
        setRoots(results);
        const saved = typeof window !== "undefined" ? localStorage.getItem("specora:lastServiceMapRoot") : null;
        if (saved && results.some((r) => r.id === saved)) {
          setRootId(saved);
        } else if (results.length > 0) {
          const first = results[0].id;
          setRootId(first);
          localStorage.setItem("specora:lastServiceMapRoot", first);
        }
      } catch {
        // silently fail
      }
    }
    loadRoots();
    return () => { cancelled = true; };
  }, []);

  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) { setSearchResults([]); setShowResults(false); return; }
    try {
      const data = await graphqlClient.request(
        `query SearchCIs($name: String) { cis(filter: { name: $name }) { id name class } }`,
        { name: query }
      );
      setSearchResults(((data as any).cis || []).slice(0, 8));
      setShowResults(true);
    } catch { setSearchResults([]); }
  }, []);

  const selectRoot = (id: string) => {
    setRootId(id); setPickerOpen(false);
    localStorage.setItem("specora:lastServiceMapRoot", id);
  };

  const selectResult = (id: string, name: string) => {
    setSearchQuery(name); setShowResults(false); selectRoot(id);
  };

  // GraphQL mutations
  const createRelationship = async (sourceId: string, targetId: string, type: string) => {
    try {
      await graphqlClient.request(
        `mutation CreateRel($input: CreateRelationshipInput!) {
          createRelationship(input: $input) { id type }
        }`,
        { input: { sourceId, targetId, type } }
      );
      await fetchData(rootId);
      showToast("Relationship created");
    } catch (err: any) {
      showToast(err.response?.errors?.[0]?.message || "Failed to create relationship");
    }
  };

  const deleteRelationship = async (sourceId: string, targetId: string, type: string) => {
    try {
      await graphqlClient.request(
        `mutation DeleteRel($sourceId: ID!, $targetId: ID!, $type: String!) {
          deleteRelationship(sourceId: $sourceId, targetId: $targetId, type: $type)
        }`,
        { sourceId, targetId, type }
      );
      setEdges((prev) => prev.filter((e) => !(e.source === sourceId && e.target === targetId)));
      showToast("Relationship deleted");
    } catch (err: any) {
      showToast(err.response?.errors?.[0]?.message || "Failed to delete relationship");
    }
  };

  const updateRelationshipType = async (sourceId: string, targetId: string, type: string, newType: string) => {
    try {
      await graphqlClient.request(
        `mutation UpdateRel($sourceId: ID!, $targetId: ID!, $type: String!, $newType: String) {
          updateRelationship(sourceId: $sourceId, targetId: $targetId, type: $type, newType: $newType) { id type }
        }`,
        { sourceId, targetId, type, newType }
      );
      await fetchData(rootId);
      showToast("Relationship updated");
    } catch (err: any) {
      showToast(err.response?.errors?.[0]?.message || "Failed to update relationship");
    }
  };

  const updateCI = async (id: string, input: { name: string; environment?: string; attributes?: Record<string, any> }) => {
    try {
      await graphqlClient.request(
        `mutation UpdateCI($id: ID!, $input: UpdateCIInput!) {
          updateCI(id: $id, input: $input) { id name class environment attributes }
        }`,
        { id, input }
      );
      await fetchData(rootId);
      showToast("CI updated");
    } catch (err: any) {
      showToast(err.response?.errors?.[0]?.message || "Failed to update CI");
    }
  };

  const deleteCI = async (id: string) => {
    try {
      await graphqlClient.request(
        `mutation DeleteCI($id: ID!) { deleteCI(id: $id) }`,
        { id }
      );
      setNodes((prev) => prev.filter((n) => n.id !== id));
      setEdges((prev) => prev.filter((e) => e.source !== id && e.target !== id));
      showToast("CI deleted");
    } catch (err: any) {
      showToast(err.response?.errors?.[0]?.message || "Failed to delete CI");
    }
  };

  const createCI = async (input: { name: string; class: string; environment?: string; attributes?: Record<string, any> }) => {
    try {
      await graphqlClient.request(
        `mutation CreateCI($input: CreateCIInput!) {
          createCI(input: $input) { id name class }
        }`,
        { input }
      );
      await fetchData(rootId);
      showToast("CI created");
    } catch (err: any) {
      showToast(err.response?.errors?.[0]?.message || "Failed to create CI");
    }
  };

  const fetchCIDetails = async (id: string) => {
    try {
      const data = await graphqlClient.request(
        `query GetCI($id: ID!) {
          ci(id: $id) { id name class environment attributes
            relationships { id type target { id name class } }
          }
        }`,
        { id }
      );
      setSidebarCi((data as any).ci);
    } catch {
      showToast("Failed to load CI details");
    }
  };

  // React Flow event handlers
  const onConnect = useCallback(async (connection: Connection) => {
    if (!connection.source || !connection.target) return;

    // Check for duplicates
    const exists = edges.some((e) => e.source === connection.source && e.target === connection.target);
    if (exists) {
      showToast("A relationship already exists between these nodes");
      return;
    }

    const sourceNode = nodes.find((n) => n.id === connection.source);
    const targetNode = nodes.find((n) => n.id === connection.target);
    if (!sourceNode || !targetNode) return;

    setRelPicker({
      sourceId: connection.source,
      targetId: connection.target,
      sourceName: sourceNode.data.name as string,
      targetName: targetNode.data.name as string,
    });
  }, [nodes, edges, showToast]);

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: FlowNode) => {
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { label: "View Details", onClick: () => fetchCIDetails(node.id) },
        { label: "Edit CI", onClick: () => setEditCi(node.data as APINode) },
        { label: "Delete CI", danger: true, onClick: () => {
          if (confirm(`Delete ${node.data.name}? This will remove all relationships.`)) {
            deleteCI(node.id);
          }
        }},
      ],
    });
  }, [fetchCIDetails]);

  const onEdgeContextMenu = useCallback((event: React.MouseEvent, edge: FlowEdge) => {
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { label: "Change Type", onClick: () => {
          const newType = prompt("Enter new relationship type (PART_OF, DEPENDS_ON, HOSTED_ON, MANAGED_BY, OWNED_BY, LOCATED_AT):");
          if (newType && ["PART_OF", "DEPENDS_ON", "HOSTED_ON", "MANAGED_BY", "OWNED_BY", "LOCATED_AT"].includes(newType)) {
            updateRelationshipType(edge.source, edge.target, edge.label as string, newType);
          }
        }},
        { label: "Delete Relationship", danger: true, onClick: () => {
          if (confirm("Delete this relationship?")) {
            deleteRelationship(edge.source, edge.target, edge.label as string);
          }
        }},
      ],
    });
  }, [updateRelationshipType, deleteRelationship]);

  const onPaneContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { label: "New CI", onClick: () => {
          const name = prompt("CI Name:");
          if (!name) return;
          const cls = prompt("Class (BusinessService, Server, Database, etc.):");
          if (!cls) return;
          createCI({ name, class: cls, environment: "Production" });
        }},
      ],
    });
  }, [createCI]);

  // Close context menu on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowResults(false);
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (loading && roots.length === 0) {
    return <div className="h-full w-full flex items-center justify-center text-gray-400">Loading service map...</div>;
  }

  if (roots.length === 0) {
    return <div className="h-full w-full flex items-center justify-center text-gray-400">No Configuration Items found.</div>;
  }

  return (
    <div className="h-full w-full relative" onContextMenu={(e) => e.preventDefault()}>
      {/* Toast */}
      {toast && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg shadow-xl text-sm text-gray-200">
          {toast}
        </div>
      )}

      {/* Centered floating search bar */}
      <div className="absolute top-6 left-0 right-0 z-20 flex justify-center">
        <div ref={searchRef} className="relative flex items-center gap-2 px-2 py-2 bg-gray-900 border border-gray-700 rounded-full shadow-xl">
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
            {pickerOpen && (
              <div className="absolute top-full left-0 mt-2 w-64 bg-gray-900 border border-gray-700 rounded-xl shadow-xl overflow-hidden max-h-72 overflow-y-auto">
                {roots.map((ci) => (
                  <button
                    key={ci.id}
                    onClick={() => selectRoot(ci.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-gray-800 transition-colors ${ci.id === rootId ? "bg-gray-800/60" : ""}`}
                  >
                    <span className="text-gray-200">{ci.name}</span>
                    <span className="text-xs text-gray-500 ml-auto px-1.5 py-0.5 bg-gray-800 rounded-md">{ci.class}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="w-px h-5 bg-gray-700" />
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
              <button onClick={() => { setSearchQuery(""); setSearchResults([]); setShowResults(false); }} className="text-gray-500 hover:text-gray-300 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {showResults && searchResults.length > 0 && (
            <div className="absolute top-full left-4 right-4 mt-2 bg-gray-900 border border-gray-700 rounded-xl shadow-xl overflow-hidden">
              {searchResults.map((ci) => (
                <button key={ci.id} onClick={() => selectResult(ci.id, ci.name)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-gray-800 transition-colors">
                  <span className="text-gray-200">{ci.name}</span>
                  <span className="text-xs text-gray-500 ml-auto px-1.5 py-0.5 bg-gray-800 rounded-md">{ci.class}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Sidebar Panel */}
      {sidebarCi && <SidebarPanel ci={sidebarCi} onClose={() => setSidebarCi(null)} />}

      {/* Graph canvas */}
      <div className="h-full w-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeContextMenu={onNodeContextMenu}
          onEdgeContextMenu={onEdgeContextMenu}
          onPaneContextMenu={onPaneContextMenu}
          onPaneClick={() => setContextMenu(null)}
          onNodeClick={() => setContextMenu(null)}
          onEdgeClick={() => setContextMenu(null)}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={2}
        >
          <Background color="#374151" gap={16} />
          <Controls position="bottom-right" className="!bg-transparent !border-none !shadow-none" showInteractive={false} />
        </ReactFlow>
      </div>

      {/* Context Menu */}
      {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={() => setContextMenu(null)} />}

      {/* Modals */}
      {editCi && <CIEditModal ci={editCi} onSave={updateCI} onClose={() => setEditCi(null)} />}
      {relPicker && (
        <RelTypePicker
          sourceName={relPicker.sourceName}
          targetName={relPicker.targetName}
          onConfirm={(type) => {
            createRelationship(relPicker.sourceId, relPicker.targetId, type);
            setRelPicker(null);
          }}
          onCancel={() => setRelPicker(null)}
        />
      )}
    </div>
  );
}

export default function ServiceMapApp({ shell }: { shell: ShellAPI }) {
  return (
    <ReactFlowProvider>
      <ServiceMapInner shell={shell} />
    </ReactFlowProvider>
  );
}
