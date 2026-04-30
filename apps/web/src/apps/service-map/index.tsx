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
import { Link2, Search, MapPin, X, ChevronDown } from "lucide-react";
import { ContextMenu } from "./ContextMenu";
import { CIEditModal } from "./CIEditModal";
import { RelTypePicker } from "./RelTypePicker";
import { SidebarPanel } from "./SidebarPanel";
import { ServiceMapNode, NodeData } from "./ServiceMapNode";
import { computeLayout, getRelColor, placeExpandedNodes, relLabel, REL_TYPES, type APIEdge, type APINode, type RelationshipTypeOption } from "./layout";
export { REL_COLORS } from "./layout";

const nodeTypes = { serviceMapNode: ServiceMapNode };

function ServiceMapInner({ shell }: { shell: ShellAPI }) {
  const { setCenter } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading] = useState(true);
  const [rootId, setRootId] = useState<string>(() => {
    if (typeof window !== "undefined") return sessionStorage.getItem("specora:lastServiceMapRoot") || "";
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

  // Filter state
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [classFilters, setClassFilters] = useState<string[]>([]);
  const [environmentFilters, setEnvironmentFilters] = useState<string[]>([]);
  const [relationshipFilters, setRelationshipFilters] = useState<string[]>([]);
  const [relationshipTypes, setRelationshipTypes] = useState<RelationshipTypeOption[]>([]);
  const [availableClasses, setAvailableClasses] = useState<string[]>([]);
  const [classDisplayNames, setClassDisplayNames] = useState<Record<string, string>>({});
  const [availableEnvironments, setAvailableEnvironments] = useState<string[]>([]);

  // Path tracing state
  const [pathTraceMode, setPathTraceMode] = useState(false);
  const [pathTraceFrom, setPathTraceFrom] = useState<string | null>(null);
  const [pathTraceResult, setPathTraceResult] = useState<{ nodes: APINode[]; edges: APIEdge[] } | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [linkSource, setLinkSource] = useState<string | null>(null);

  // Expand/collapse state (visual tracking for future use)
  const [, setExpandedNodes] = useState<Set<string>>(new Set());

  // Saved views state
  const [savedViews, setSavedViews] = useState<Array<{ id: string; name: string; rootId: string; classFilter: string[]; environmentFilter: string[]; relationshipFilter: string[]; cameraX?: number; cameraY?: number; cameraZoom?: number }>>([]);
  const [saveViewModalOpen, setSaveViewModalOpen] = useState(false);
  const [saveViewName, setSaveViewName] = useState("");
  const [loadViewOpen, setLoadViewOpen] = useState(false);

  // Add Existing CI modal state
  const [addCiModalOpen, setAddCiModalOpen] = useState(false);
  const [addCiQuery, setAddCiQuery] = useState("");
  const [addCiResults, setAddCiResults] = useState<APINode[]>([]);
  const addCiRef = useRef<HTMLDivElement>(null);

  // New CI modal state
  const [newCiModalOpen, setNewCiModalOpen] = useState(false);
  const [newCiName, setNewCiName] = useState("");
  const [newCiClass, setNewCiClass] = useState("");
  const [newCiEnvironment, setNewCiEnvironment] = useState("Production");
  const [newCiMandatoryAttrs, setNewCiMandatoryAttrs] = useState<Record<string, string>>({});
  const [newCiClassDef, setNewCiClassDef] = useState<{ name: string; attrType: string; displayName?: string }[]>([]);
  const newCiRef = useRef<HTMLDivElement>(null);

  // Change relationship type modal state
  const [changeRelModalOpen, setChangeRelModalOpen] = useState(false);
  const [changeRelEdge, setChangeRelEdge] = useState<{ source: string; target: string; currentType: string } | null>(null);
  const [changeRelNewType, setChangeRelNewType] = useState("");
  const changeRelRef = useRef<HTMLDivElement>(null);

  // CRUD state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: any[] } | null>(null);
  const [editCi, setEditCi] = useState<APINode | null>(null);
  const [relPicker, setRelPicker] = useState<{ sourceId: string; targetId: string; sourceName: string; targetName: string } | null>(null);
  const [sidebarCi, setSidebarCi] = useState<APINode & { relationships?: any[] } | null>(null);
  const [toast, setToast] = useState<string>("");
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  const relationshipColor = useCallback((type: string) => {
    const registered = relationshipTypes.find((item) => item.name === type)?.color;
    return getRelColor(type, registered ? { [type]: registered } : {});
  }, [relationshipTypes]);
  const relationshipOptions = relationshipTypes.length
    ? relationshipTypes
    : REL_TYPES.map((name) => ({ id: name, name, displayName: relLabel(name), color: getRelColor(name).stroke, active: true, isSystem: true }));

  // Plugin decorator state — apps can register to add badges to nodes
  const [nodeDecorators, setNodeDecorators] = useState<Record<string, NodeData["decorators"]>>({});
  const lastFetchKeyRef = useRef<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }, []);

  const fetchData = useCallback(async (targetRootId: string, highlightId?: string | null, options?: { force?: boolean }) => {
    const requestKey = JSON.stringify({
      targetRootId,
      highlightId: highlightId || null,
      classFilters,
      environmentFilters,
      relationshipFilters,
      relationshipTypes: relationshipTypes.map((type) => `${type.name}:${type.color}`),
    });
    if (!options?.force && lastFetchKeyRef.current === requestKey) {
      setLoading(false);
      return;
    }
    lastFetchKeyRef.current = requestKey;
    try {
      const data = await graphqlClient.request(
        `query GetServiceMap($rootId: ID!, $classFilter: [String], $environmentFilter: [String], $relationshipFilter: [String]) {
          serviceMap(rootId: $rootId, classFilter: $classFilter, environmentFilter: $environmentFilter, relationshipFilter: $relationshipFilter) {
            nodes { id name class environment attributes health { overall freshness completeness relationshipValidity } }
            edges { id type sourceId targetId }
          }
        }`,
        {
          rootId: targetRootId,
          classFilter: classFilters.length ? classFilters : null,
          environmentFilter: environmentFilters.length ? environmentFilters : null,
          relationshipFilter: relationshipFilters.length ? relationshipFilters : null,
        }
      );
      const map = (data as any).serviceMap;
      const nodesWithClassNames = map.nodes.map((node: APINode) => ({
        ...node,
        classDisplayName: classDisplayNames[node.class] || node.class,
      }));
      const relColors = Object.fromEntries(relationshipTypes.map((type) => [type.name, type.color]));
      const layout = computeLayout(nodesWithClassNames, map.edges, classDisplayNames, highlightId, relColors);
      // Merge plugin decorators into node data
      const nodesWithDecorators = layout.nodes.map((n) => ({
        ...n,
        data: {
          ...n.data,
          decorators: nodeDecorators[n.id],
        },
      }));
      setNodes(nodesWithDecorators);
      setEdges(layout.edges);
      const rootNode = nodesWithClassNames.find((n: APINode) => n.id === targetRootId);
      setRootName(rootNode?.name || targetRootId);
    } catch (err) {
      console.error("fetchData error:", err);
    } finally {
      setLoading(false);
    }
  }, [setNodes, setEdges, classFilters, environmentFilters, relationshipFilters, nodeDecorators, classDisplayNames, relationshipTypes]);

  useEffect(() => { fetchData(rootId, highlightedNodeId); }, [rootId, fetchData, highlightedNodeId]);

  // Re-merge decorators into existing nodes when decorators change (without refetching)
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => ({
        ...n,
        data: {
          ...n.data,
          decorators: nodeDecorators[n.id],
        },
      }))
    );
  }, [nodeDecorators, setNodes]);

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

  // Subscribe to real-time graph events
  useEffect(() => {
    const unsubCreated = shell.eventBus.subscribe("ci.created", () => fetchData(rootId));
    const unsubUpdated = shell.eventBus.subscribe("ci.updated", () => fetchData(rootId));
    const unsubDeleted = shell.eventBus.subscribe("ci.deleted", () => fetchData(rootId));
    const unsubRelCreated = shell.eventBus.subscribe("relationship.created", () => fetchData(rootId));
    const unsubRelUpdated = shell.eventBus.subscribe("relationship.updated", () => fetchData(rootId));
    const unsubRelDeleted = shell.eventBus.subscribe("relationship.deleted", () => fetchData(rootId));
    return () => {
      unsubCreated();
      unsubUpdated();
      unsubDeleted();
      unsubRelCreated();
      unsubRelUpdated();
      unsubRelDeleted();
    };
  }, [shell, rootId, fetchData]);

  // Plugin decorator system — allows other apps to register node badges
  useEffect(() => {
    // Announce that Service Map is ready to accept decorators
    shell.sendMessage({ type: "SERVICE_MAP_READY", to: "*", payload: { appId: "service-map" } });

    const unsub = shell.messageBus.subscribe((msg) => {
      if (msg.type === "REGISTER_NODE_DECORATOR") {
        // An app is registering interest in decorating nodes
        const { appId, decoratorType, label } = msg.payload || {};
        if (appId && decoratorType) {
          showToast(`${label || decoratorType} decorations registered`);
        }
      }
      if (msg.type === "NODE_DECORATOR_UPDATE") {
        // Batch update of decorators for specific nodes
        const { decorators } = msg.payload || {};
        if (decorators && typeof decorators === "object") {
          setNodeDecorators((prev) => ({ ...prev, ...decorators }));
        }
      }
      if (msg.type === "CLEAR_NODE_DECORATORS") {
        const { appId } = msg.payload || {};
        if (appId) {
          setNodeDecorators((prev) => {
            const next: Record<string, NodeData["decorators"]> = {};
            Object.entries(prev).forEach(([nodeId, decs]) => {
              const filtered = decs?.filter((d) => d.id !== appId);
              if (filtered && filtered.length > 0) {
                next[nodeId] = filtered;
              }
            });
            return next;
          });
        }
      }
    });

    return unsub;
  }, [shell, showToast]);

  useEffect(() => {
    let cancelled = false;
    async function loadRoots() {
      try {
        let data = await graphqlClient.request(`query { cis(filter: { class: "BusinessService" }) { id name class health { overall } } }`);
        let results: APINode[] = ((data as any).cis || []);
        if (results.length === 0) {
          data = await graphqlClient.request(`query { cis { id name class } }`);
          results = ((data as any).cis || []);
        }
        if (cancelled) return;
        setRoots(results);
        const saved = typeof window !== "undefined" ? sessionStorage.getItem("specora:lastServiceMapRoot") : null;
        if (saved && results.some((r) => r.id === saved)) {
          setRootId(saved);
        } else if (results.length > 0) {
          const first = results[0].id;
          setRootId(first);
          sessionStorage.setItem("specora:lastServiceMapRoot", first);
        }
      } catch {
        // silently fail
      }
    }
    async function loadFilterOptions() {
      try {
        const [classesData, envsData, relsData] = await Promise.all([
          graphqlClient.request(`query { ciClasses { name displayName } }`),
          graphqlClient.request(`query { ciEnvironments }`),
          graphqlClient.request(`query { relationshipTypes { id name displayName color active isSystem } }`),
        ]);
        if (!cancelled) {
          const classes = (classesData as any).ciClasses || [];
          setAvailableClasses(classes.map((c: any) => c.name));
          const dnMap: Record<string, string> = {};
          for (const c of classes) {
            dnMap[c.name] = c.displayName || c.name;
          }
          setClassDisplayNames(dnMap);
          setAvailableEnvironments((envsData as any).ciEnvironments || []);
          setRelationshipTypes((relsData as any).relationshipTypes || []);
        }
      } catch {
        // silently fail
      }
    }
    loadRoots();
    loadFilterOptions();
    return () => { cancelled = true; };
  }, []);

  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) { setSearchResults([]); setShowResults(false); return; }
    try {
      const data = await graphqlClient.request(
        `query SearchCIs($name: String) { cis(filter: { name: $name }) { id name class health { overall } } }`,
        { name: query }
      );
      setSearchResults(((data as any).cis || []).slice(0, 8));
      setShowResults(true);
    } catch { setSearchResults([]); }
  }, []);

  const handleAddCiSearch = useCallback(async (query: string) => {
    setAddCiQuery(query);
    if (!query.trim()) { setAddCiResults([]); return; }
    try {
      const data = await graphqlClient.request(
        `query SearchCIs($name: String) { cis(filter: { name: $name }) { id name class environment attributes health { overall freshness completeness relationshipValidity } } }`,
        { name: query }
      );
      setAddCiResults(((data as any).cis || []).slice(0, 8));
    } catch { setAddCiResults([]); }
  }, []);

  const addExistingCi = (ci: APINode) => {
    setAddCiModalOpen(false);
    setAddCiQuery("");
    setAddCiResults([]);
    // Add node to current graph without re-running layout
    setNodes((prev) => {
      if (prev.some((n) => n.id === ci.id)) {
        showToast(`${ci.name} is already on the map`);
        return prev;
      }
      const newNode: FlowNode = {
        id: ci.id,
        data: {
          id: ci.id,
          name: ci.name,
          class: ci.class,
          classDisplayName: classDisplayNames[ci.class] || ci.class,
          environment: ci.environment,
          health: (ci as any).health,
          relationshipCount: 0,
        } as NodeData,
        position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 },
        style: {
          width: 260,
          height: 100,
          background: "transparent",
          border: "none",
          borderRadius: "8px",
          padding: 0,
        },
      };
      showToast(`${ci.name} added to map`);
      return [...prev, newNode];
    });
  };

  const tracePath = useCallback(async (fromId: string, toId: string) => {
    try {
      const data = await graphqlClient.request(
        `query TracePath($fromId: ID!, $toId: ID!) {
          dependencyPath(fromId: $fromId, toId: $toId, maxHops: 10) {
            nodes { id name class environment attributes }
            edges { id type sourceId targetId }
          }
        }`,
        { fromId, toId }
      );
      const result = (data as any).dependencyPath;
      if (!result) {
        showToast("No path found");
        setPathTraceMode(false);
        setPathTraceFrom(null);
        return;
      }
      setPathTraceResult(result);
      showToast("Path traced");
    } catch (err) {
      console.error("tracePath error:", err);
      showToast("Failed to trace path");
      setPathTraceMode(false);
      setPathTraceFrom(null);
    }
  }, [showToast]);

  const clearPathTrace = useCallback(() => {
    setPathTraceMode(false);
    setPathTraceFrom(null);
    setPathTraceResult(null);
  }, []);

  const clearLinkMode = useCallback(() => {
    setLinkMode(false);
    setLinkSource(null);
  }, []);

  const openRelationshipPicker = useCallback((sourceId: string, targetId: string) => {
    if (sourceId === targetId) {
      showToast("Source and target must be different");
      return;
    }
    const exists = edges.some((edge) => edge.source === sourceId && edge.target === targetId);
    if (exists) {
      showToast("A relationship already exists between these nodes");
      return;
    }
    const sourceNode = nodes.find((node) => node.id === sourceId);
    const targetNode = nodes.find((node) => node.id === targetId);
    if (!sourceNode || !targetNode) return;
    setRelPicker({
      sourceId,
      targetId,
      sourceName: sourceNode.data.name as string,
      targetName: targetNode.data.name as string,
    });
  }, [edges, nodes, showToast]);

  const beginLinkFrom = useCallback((nodeId: string) => {
    setContextMenu(null);
    setPathTraceMode(false);
    setPathTraceFrom(null);
    setPathTraceResult(null);
    setLinkMode(true);
    setLinkSource(nodeId);
    const node = nodes.find((item) => item.id === nodeId);
    showToast(`Link mode: choose target for ${node?.data.name || "this CI"}`);
  }, [nodes, showToast]);

  const handleLinkNodeClick = useCallback((node: FlowNode) => {
    if (!linkSource) {
      setLinkSource(node.id);
      showToast(`Selected ${node.data.name} as source - click target`);
      return;
    }
    openRelationshipPicker(linkSource, node.id);
  }, [linkSource, openRelationshipPicker, showToast]);

  const fetchSavedViews = useCallback(async () => {
    try {
      const data = await graphqlClient.request(`query { savedViews { id name rootId classFilter environmentFilter relationshipFilter cameraX cameraY cameraZoom } }`);
      setSavedViews((data as any).savedViews || []);
    } catch (err) {
      console.error("fetchSavedViews error:", err);
    }
  }, []);

  const saveCurrentView = useCallback(async (name: string) => {
    try {
      await graphqlClient.request(
        `mutation CreateSavedView($name: String!, $rootId: String!, $classFilter: [String!], $environmentFilter: [String!], $relationshipFilter: [String!]) {
          createSavedView(name: $name, rootId: $rootId, classFilter: $classFilter, environmentFilter: $environmentFilter, relationshipFilter: $relationshipFilter) { id name }
        }`,
        { name, rootId, classFilter: classFilters, environmentFilter: environmentFilters, relationshipFilter: relationshipFilters }
      );
      showToast("View saved");
      fetchSavedViews();
    } catch (err) {
      console.error("saveCurrentView error:", err);
      showToast("Failed to save view");
    }
  }, [rootId, classFilters, environmentFilters, relationshipFilters, fetchSavedViews, showToast]);

  const loadSavedView = useCallback((view: typeof savedViews[0]) => {
    setRootId(view.rootId);
    setClassFilters(view.classFilter || []);
    setEnvironmentFilters(view.environmentFilter || []);
    setRelationshipFilters(view.relationshipFilter || []);
    setLoadViewOpen(false);
    showToast(`Loaded "${view.name}"`);
  }, [showToast]);

  const deleteSavedView = useCallback(async (id: string) => {
    try {
      await graphqlClient.request(`mutation DeleteSavedView($id: ID!) { deleteSavedView(id: $id) }`, { id });
      setSavedViews((prev) => prev.filter((v) => v.id !== id));
      showToast("View deleted");
    } catch {
      showToast("Failed to delete view");
    }
  }, [showToast]);

  useEffect(() => {
    fetchSavedViews();
  }, [fetchSavedViews]);

  const expandNode = useCallback(async (nodeId: string) => {
    try {
      const data = await graphqlClient.request(
        `query GetNeighbors($nodeId: ID!) {
          neighbors(nodeId: $nodeId, limit: 20) {
            nodes { id name class environment attributes health { overall freshness completeness relationshipValidity } }
            edges { id type sourceId targetId }
          }
        }`,
        { nodeId }
      );
      const result = (data as any).neighbors;
      if (!result) return;

      setExpandedNodes((prev) => new Set(prev).add(nodeId));

      // Merge new nodes
      setNodes((prev) => {
        const existingIds = new Set(prev.map((n) => n.id));
        const newItems = result.nodes.filter((n: APINode) => !existingIds.has(n.id));
        const placedNodes = placeExpandedNodes(prev, nodeId, newItems);
        const newNodes = placedNodes.map(({ item, position }) => ({
            id: item.id,
            data: {
              id: item.id,
              name: item.name,
              class: item.class,
              classDisplayName: classDisplayNames[item.class] || item.class,
              environment: item.environment,
              health: item.health,
              relationshipCount: 0,
            } as NodeData,
            position,
            style: {
              width: 260,
              height: 100,
              background: "transparent",
              border: "none",
              borderRadius: "8px",
              padding: 0,
            },
          }));
        return [...prev, ...newNodes];
      });

      // Merge new edges
      setEdges((prev) => {
        const existingIds = new Set(prev.map((e) => e.id));
        const newEdges = result.edges
          .filter((e: APIEdge) => !existingIds.has(e.id))
          .map((e: APIEdge) => {
            const color = relationshipColor(e.type);
            return {
              id: e.id, source: e.sourceId, target: e.targetId, label: relLabel(e.type), type: "default",
              data: { relationshipType: e.type },
              style: { stroke: color.stroke, strokeWidth: 2 },
              labelStyle: { fill: color.stroke, fontSize: 10, fontWeight: 500 },
              labelBgStyle: { fill: "#111827", fillOpacity: 0.95 },
              labelBgPadding: [4, 4], animated: e.type === "DEPENDS_ON",
              markerEnd: { type: MarkerType.ArrowClosed, color: color.stroke },
            };
          });
        return [...prev, ...newEdges];
      });

      showToast("Neighbors loaded");
    } catch {
      showToast("Failed to load neighbors");
    }
  }, [showToast, classDisplayNames, relationshipColor]);

  const selectRoot = (id: string) => {
    setRootId(id); setPickerOpen(false);
    sessionStorage.setItem("specora:lastServiceMapRoot", id);
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
      await fetchData(rootId, highlightedNodeId, { force: true });
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
      await fetchData(rootId, highlightedNodeId, { force: true });
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
      await fetchData(rootId, highlightedNodeId, { force: true });
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
      const data = await graphqlClient.request(
        `mutation CreateCI($input: CreateCIInput!) {
          createCI(input: $input) { id name class }
        }`,
        { input }
      );
      const newCi = (data as any).createCI;
      if (newCi) {
        // Add the new CI directly to the graph so it appears immediately.
        // Do not call fetchData here because a disconnected CI won't be
        // returned by the serviceMap query and would disappear.
        setNodes((prev) => {
          if (prev.some((n) => n.id === newCi.id)) return prev;
          return [
            ...prev,
            {
              id: newCi.id,
              data: {
                id: newCi.id,
                name: newCi.name,
                class: newCi.class,
                classDisplayName: classDisplayNames[newCi.class] || newCi.class,
                environment: newCi.environment,
                health: null,
                relationshipCount: 0,
              } as NodeData,
              position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 },
              style: {
                width: 260,
                height: 100,
                background: "transparent",
                border: "none",
                borderRadius: "8px",
                padding: 0,
              },
            },
          ];
        });
      }
      showToast("CI created");
    } catch (err: any) {
      showToast(err.response?.errors?.[0]?.message || "Failed to create CI");
    }
  };

  const fetchCIDetails = async (id: string) => {
    try {
      const data = await graphqlClient.request(
        `query GetCI($id: ID!) {
          ci(id: $id) { id name class environment attributes health { overall freshness completeness relationshipValidity }
            relationships { id type target { id name class } }
          }
        }`,
        { id }
      );
      const ci = (data as any).ci;
      setSidebarCi(ci ? {
        ...ci,
        classDisplayName: classDisplayNames[ci.class] || ci.class,
        relationships: (ci.relationships || []).map((rel: any) => ({
          ...rel,
          target: {
            ...rel.target,
            classDisplayName: classDisplayNames[rel.target.class] || rel.target.class,
          },
        })),
      } : null);
    } catch {
      showToast("Failed to load CI details");
    }
  };

  // React Flow event handlers
  const onConnect = useCallback(async (connection: Connection) => {
    if (!connection.source || !connection.target) return;
    openRelationshipPicker(connection.source, connection.target);
  }, [openRelationshipPicker]);

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: FlowNode) => {
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { label: "View Details", onClick: () => fetchCIDetails(node.id) },
        { label: "Edit CI", onClick: () => setEditCi(node.data as APINode) },
        { label: "Expand", onClick: () => expandNode(node.id) },
        { label: "Create Relationship From This", onClick: () => beginLinkFrom(node.id) },
        ...(pathTraceMode ? [{ label: pathTraceFrom ? "Select as target" : "Select as source", onClick: () => {
          if (!pathTraceFrom) {
            setPathTraceFrom(node.id);
            showToast(`Selected ${node.data.name} as source`);
          } else if (pathTraceFrom === node.id) {
            showToast("Source and target must be different");
          } else {
            tracePath(pathTraceFrom, node.id);
            setPathTraceFrom(null);
          }
        }}] : []),
        { label: "Delete CI", danger: true, onClick: () => {
          if (confirm(`Delete ${node.data.name}? This will remove all relationships.`)) {
            deleteCI(node.id);
          }
        }},
      ],
    });
  }, [fetchCIDetails, expandNode, beginLinkFrom, pathTraceMode, pathTraceFrom, tracePath]);

  const onEdgeContextMenu = useCallback((event: React.MouseEvent, edge: FlowEdge) => {
    event.preventDefault();
    const relationshipType = (edge.data as any)?.relationshipType || edge.label as string;
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { label: "Change Type", onClick: () => {
          setChangeRelEdge({ source: edge.source, target: edge.target, currentType: relationshipType });
          setChangeRelNewType(relationshipType);
          setChangeRelModalOpen(true);
        }},
        { label: "Delete Relationship", danger: true, onClick: () => {
          if (confirm("Delete this relationship?")) {
            deleteRelationship(edge.source, edge.target, relationshipType);
          }
        }},
      ],
    });
  }, [deleteRelationship]);

  const onPaneContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { label: "New CI", onClick: () => {
          setNewCiName("");
          setNewCiClass("");
          setNewCiEnvironment("Production");
          setNewCiMandatoryAttrs({});
          setNewCiClassDef([]);
          setNewCiModalOpen(true);
        }},
        { label: "Add Existing CI", onClick: () => setAddCiModalOpen(true) },
      ],
    });
  }, []);

  // Close context menu on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowResults(false);
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
      if (addCiRef.current && !addCiRef.current.contains(e.target as Node)) setAddCiModalOpen(false);
      if (newCiRef.current && !newCiRef.current.contains(e.target as Node)) setNewCiModalOpen(false);
      if (changeRelRef.current && !changeRelRef.current.contains(e.target as Node)) setChangeRelModalOpen(false);
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
        <div className="absolute left-1/2 top-4 z-[60] flex min-w-72 max-w-md -translate-x-1/2 items-start gap-3 rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm text-gray-200 shadow-xl">
          <span className="min-w-0 flex-1 leading-5">{toast}</span>
          <button
            type="button"
            onClick={() => setToast("")}
            className="ml-auto shrink-0 pt-0.5 text-gray-500 transition-colors hover:text-white"
            aria-label="Dismiss notification"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="absolute top-6 left-0 right-0 z-20 flex justify-center gap-2">
        {/* Filter toggle */}
        <button
          onClick={() => setFilterPanelOpen((prev) => !prev)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-full border shadow-xl text-sm transition-colors ${
            filterPanelOpen || classFilters.length || environmentFilters.length || relationshipFilters.length
              ? "bg-indigo-600 border-indigo-500 text-white"
              : "bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800"
          }`}
        >
          <span>Filter</span>
          {(classFilters.length + environmentFilters.length + relationshipFilters.length) > 0 && (
            <span className="text-xs bg-white/20 px-1.5 py-0.5 rounded-full">
              {classFilters.length + environmentFilters.length + relationshipFilters.length}
            </span>
          )}
        </button>

        {/* Path trace toggle */}
        <button
          onClick={() => {
            if (pathTraceMode) clearPathTrace();
            else {
              clearLinkMode();
              setPathTraceMode(true);
              showToast("Click source node, then target node");
            }
          }}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-full border shadow-xl text-sm transition-colors ${
            pathTraceMode
              ? "bg-amber-600 border-amber-500 text-white"
              : "bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800"
          }`}
        >
          {pathTraceMode ? "Cancel Trace" : "Trace Path"}
        </button>

        <button
          onClick={() => {
            if (linkMode) clearLinkMode();
            else {
              clearPathTrace();
              setLinkMode(true);
              setLinkSource(null);
              showToast("Link mode: click source CI, then target CI");
            }
          }}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-full border shadow-xl text-sm transition-colors ${
            linkMode
              ? "bg-cyan-600 border-cyan-500 text-white"
              : "bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800"
          }`}
        >
          <Link2 className="h-4 w-4" />
          {linkMode ? "Cancel Link" : "Link"}
        </button>

        {/* Clear path trace result */}
        {pathTraceResult && (
          <button
            onClick={clearPathTrace}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-gray-900 border border-gray-700 text-gray-300 hover:bg-gray-800 shadow-xl text-sm transition-colors"
          >
            Clear Path
          </button>
        )}

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
                    <span className="text-xs text-gray-500 ml-auto px-1.5 py-0.5 bg-gray-800 rounded-md">{classDisplayNames[ci.class] || ci.class}</span>
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
                  <span className="text-xs text-gray-500 ml-auto px-1.5 py-0.5 bg-gray-800 rounded-md">{classDisplayNames[ci.class] || ci.class}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Save view */}
        <button
          onClick={() => setSaveViewModalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-gray-900 border border-gray-700 text-gray-300 hover:bg-gray-800 shadow-xl text-sm transition-colors"
        >
          Save View
        </button>

        {/* Load view */}
        <div className="relative">
          <button
            onClick={() => setLoadViewOpen((prev) => !prev)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-gray-900 border border-gray-700 text-gray-300 hover:bg-gray-800 shadow-xl text-sm transition-colors"
          >
            Load View
            {savedViews.length > 0 && (
              <span className="text-xs bg-white/20 px-1.5 py-0.5 rounded-full">{savedViews.length}</span>
            )}
          </button>
          {loadViewOpen && (
            <div className="absolute top-full right-0 mt-2 w-64 bg-gray-900 border border-gray-700 rounded-xl shadow-xl overflow-hidden z-30">
              {savedViews.length === 0 ? (
                <div className="px-3 py-2.5 text-sm text-gray-500">No saved views</div>
              ) : (
                savedViews.map((view) => (
                  <div key={view.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-800">
                    <button
                      onClick={() => loadSavedView(view)}
                      className="flex-1 text-left text-sm text-gray-200"
                    >
                      {view.name}
                    </button>
                    <button
                      onClick={() => deleteSavedView(view.id)}
                      className="text-xs text-red-400 hover:text-red-300 px-1.5 py-0.5"
                    >
                      Delete
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Filter Panel */}
      {filterPanelOpen && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 w-full max-w-lg bg-gray-900 border border-gray-700 rounded-xl shadow-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-200">Filter Graph</h3>
            <button onClick={() => { setClassFilters([]); setEnvironmentFilters([]); setRelationshipFilters([]); }}
              className="text-xs text-gray-400 hover:text-gray-200 transition-colors">Reset all</button>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <h4 className="text-xs text-gray-500 mb-2">Class</h4>
              <div className="space-y-1.5 max-h-32 overflow-y-auto scrollbar-thin">
                {availableClasses.map((cls) => (
                  <label key={cls} className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer hover:text-gray-100 select-none">
                    <div className="relative flex items-center">
                      <input type="checkbox" checked={classFilters.includes(cls)}
                        onChange={(e) => setClassFilters((prev) => e.target.checked ? [...prev, cls] : prev.filter((c) => c !== cls))}
                        className="peer sr-only" />
                      <div className="w-3.5 h-3.5 rounded border border-gray-600 bg-gray-800 peer-checked:bg-indigo-500 peer-checked:border-indigo-500 transition-colors" />
                      <svg className="absolute left-0.5 top-0.5 w-2.5 h-2.5 text-white opacity-0 peer-checked:opacity-100 pointer-events-none" viewBox="0 0 14 14" fill="none">
                        <path d="M3 7L6 10L11 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    {classDisplayNames[cls] || cls}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-xs text-gray-500 mb-2">Environment</h4>
              <div className="space-y-1.5 max-h-32 overflow-y-auto scrollbar-thin">
                {availableEnvironments.map((env) => (
                  <label key={env} className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer hover:text-gray-100 select-none">
                    <div className="relative flex items-center">
                      <input type="checkbox" checked={environmentFilters.includes(env)}
                        onChange={(e) => setEnvironmentFilters((prev) => e.target.checked ? [...prev, env] : prev.filter((e) => e !== env))}
                        className="peer sr-only" />
                      <div className="w-3.5 h-3.5 rounded border border-gray-600 bg-gray-800 peer-checked:bg-indigo-500 peer-checked:border-indigo-500 transition-colors" />
                      <svg className="absolute left-0.5 top-0.5 w-2.5 h-2.5 text-white opacity-0 peer-checked:opacity-100 pointer-events-none" viewBox="0 0 14 14" fill="none">
                        <path d="M3 7L6 10L11 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    {env}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-xs text-gray-500 mb-2">Relationship</h4>
              <div className="space-y-1.5 max-h-32 overflow-y-auto scrollbar-thin">
                {relationshipOptions.map((rel) => (
                  <label key={rel.name} className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer hover:text-gray-100 select-none">
                    <div className="relative flex items-center">
                      <input type="checkbox" checked={relationshipFilters.includes(rel.name)}
                        onChange={(e) => setRelationshipFilters((prev) => e.target.checked ? [...prev, rel.name] : prev.filter((r) => r !== rel.name))}
                        className="peer sr-only" />
                      <div className="w-3.5 h-3.5 rounded border border-gray-600 bg-gray-800 peer-checked:bg-indigo-500 peer-checked:border-indigo-500 transition-colors" />
                      <svg className="absolute left-0.5 top-0.5 w-2.5 h-2.5 text-white opacity-0 peer-checked:opacity-100 pointer-events-none" viewBox="0 0 14 14" fill="none">
                        <path d="M3 7L6 10L11 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: rel.color || relationshipColor(rel.name).stroke }} />
                    {rel.displayName || relLabel(rel.name)}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {linkMode && (
        <div className="absolute left-1/2 top-20 z-20 -translate-x-1/2 rounded-full border border-cyan-500/40 bg-cyan-950/90 px-4 py-2 text-sm text-cyan-100 shadow-xl">
          {linkSource
            ? "Choose the target CI for the relationship."
            : "Choose the source CI for the relationship."}
        </div>
      )}

      {/* Sidebar Panel */}
      {sidebarCi && (
        <SidebarPanel
          ci={sidebarCi}
          classDisplayNames={classDisplayNames}
          onClose={() => setSidebarCi(null)}
          onEdit={(ci) => setEditCi(ci)}
          onSetRoot={(id) => {
            selectRoot(id);
            setSidebarCi(null);
          }}
          onExpand={expandNode}
          onOpenRelated={fetchCIDetails}
        />
      )}

      {/* Graph canvas */}
      <div className="h-full w-full">
        <ReactFlow
          nodes={nodes.map((n) => ({
            ...n,
            type: "serviceMapNode",
            style: {
              ...n.style,
              opacity: pathTraceResult && !pathTraceResult.nodes.some((pn) => pn.id === n.id) ? 0.3 : 1,
              borderColor: pathTraceResult && pathTraceResult.nodes.some((pn) => pn.id === n.id) ? "#fbbf24" : (n.style as any)?.borderColor,
            },
          }))}
          edges={edges.map((e) => ({
            ...e,
            style: {
              ...e.style,
              strokeWidth: hoveredEdgeId === e.id ? 4 : 2,
              filter: hoveredEdgeId === e.id ? "drop-shadow(0 0 4px currentColor)" : undefined,
              opacity: pathTraceResult && !pathTraceResult.edges.some((pe) => pe.id === e.id) ? 0.3 : 1,
              stroke: pathTraceResult && pathTraceResult.edges.some((pe) => pe.id === e.id) ? "#fbbf24" : (e.style as any)?.stroke,
            },
            markerEnd: e.markerEnd ? {
              type: (e.markerEnd as any).type,
              color: pathTraceResult && pathTraceResult.edges.some((pe) => pe.id === e.id) ? "#fbbf24" : (e.markerEnd as any).color,
            } : undefined,
          }))}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeContextMenu={onNodeContextMenu}
          onEdgeContextMenu={onEdgeContextMenu}
          onPaneContextMenu={onPaneContextMenu}
          onPaneClick={() => { setContextMenu(null); if (pathTraceMode) clearPathTrace(); }}
          onNodeClick={(_event, node) => {
            setContextMenu(null);
            if (linkMode) {
              handleLinkNodeClick(node);
            } else if (pathTraceMode) {
              if (!pathTraceFrom) {
                setPathTraceFrom(node.id);
                showToast(`Selected ${node.data.name} as source — click target`);
              } else if (pathTraceFrom === node.id) {
                showToast("Source and target must be different");
                setPathTraceFrom(null);
              } else {
                tracePath(pathTraceFrom, node.id);
              }
            }
          }}
          onEdgeClick={() => setContextMenu(null)}
          onEdgeMouseEnter={(_event, edge) => setHoveredEdgeId(edge.id)}
          onEdgeMouseLeave={() => setHoveredEdgeId(null)}
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
          relationshipTypes={relationshipOptions}
          onConfirm={(type) => {
            createRelationship(relPicker.sourceId, relPicker.targetId, type);
            setRelPicker(null);
            clearLinkMode();
          }}
          onCancel={() => {
            setRelPicker(null);
            clearLinkMode();
          }}
        />
      )}

      {/* Add Existing CI Modal */}
      {addCiModalOpen && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setAddCiModalOpen(false)}>
          <div ref={addCiRef} className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-100 mb-4">Add Existing CI</h3>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                value={addCiQuery}
                onChange={(e) => handleAddCiSearch(e.target.value)}
                placeholder="Search CI by name..."
                autoFocus
                className="w-full pl-9 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {addCiResults.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">{addCiQuery ? "No results" : "Type to search..."}</p>
              ) : (
                addCiResults.map((ci) => (
                  <button
                    key={ci.id}
                    onClick={() => addExistingCi(ci)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm hover:bg-gray-800 transition-colors"
                  >
                    <span className="text-gray-200">{ci.name}</span>
                    <span className="text-xs text-gray-500 ml-auto px-1.5 py-0.5 bg-gray-800 rounded-md">{classDisplayNames[ci.class] || ci.class}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* New CI Modal */}
      {newCiModalOpen && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setNewCiModalOpen(false)}>
          <div ref={newCiRef} className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-100 mb-4">Create New CI</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Name</label>
                <input
                  type="text"
                  value={newCiName}
                  onChange={(e) => setNewCiName(e.target.value)}
                  placeholder="Enter CI name..."
                  autoFocus
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Class</label>
                <select
                  value={newCiClass}
                  onChange={async (e) => {
                    const cls = e.target.value;
                    setNewCiClass(cls);
                    setNewCiMandatoryAttrs({});
                    if (cls) {
                      try {
                        const data = await graphqlClient.request(
                          `query($name: String!) { ciClass(name: $name) { attributes { name displayName attrType isMandatory defaultValue } } }`,
                          { name: cls }
                        );
                        const attrs = ((data as any).ciClass?.attributes || []).filter((a: any) => a.isMandatory);
                        setNewCiClassDef(attrs);
                        const defaults: Record<string, string> = {};
                        for (const a of attrs) {
                          if (a.defaultValue != null) defaults[a.name] = String(a.defaultValue);
                        }
                        setNewCiMandatoryAttrs(defaults);
                      } catch {
                        setNewCiClassDef([]);
                      }
                    } else {
                      setNewCiClassDef([]);
                    }
                  }}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">Select a class...</option>
                  {availableClasses.map((cls) => (
                    <option key={cls} value={cls}>{classDisplayNames[cls] || cls}</option>
                  ))}
                </select>
              </div>
              {newCiClassDef.map((attr) => (
                <div key={attr.name}>
                  <label className="block text-sm text-gray-400 mb-1">
                    {attr.displayName || attr.name} <span className="text-red-400">*</span>
                  </label>
                  <input
                    type={attr.attrType === "number" ? "number" : "text"}
                    value={newCiMandatoryAttrs[attr.name] || ""}
                    onChange={(e) => setNewCiMandatoryAttrs((prev) => ({ ...prev, [attr.name]: e.target.value }))}
                    placeholder={`Enter ${attr.displayName || attr.name}...`}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              ))}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Environment</label>
                <select
                  value={newCiEnvironment}
                  onChange={(e) => setNewCiEnvironment(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
                >
                  {availableEnvironments.map((env) => (
                    <option key={env} value={env}>{env}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-6">
              <button
                onClick={() => setNewCiModalOpen(false)}
                className="flex-1 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (newCiName.trim() && newCiClass) {
                    const attrs: Record<string, any> = {};
                    for (const [k, v] of Object.entries(newCiMandatoryAttrs)) {
                      const def = newCiClassDef.find((a) => a.name === k);
                      attrs[k] = def?.attrType === "number" ? Number(v) : v;
                    }
                    createCI({ name: newCiName.trim(), class: newCiClass, environment: newCiEnvironment, attributes: attrs });
                    setNewCiModalOpen(false);
                    setNewCiName("");
                    setNewCiClass("");
                    setNewCiMandatoryAttrs({});
                    setNewCiClassDef([]);
                  }
                }}
                disabled={!newCiName.trim() || !newCiClass || newCiClassDef.some((a) => !newCiMandatoryAttrs[a.name])}
                className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 text-sm text-white transition-colors"
              >
                Create CI
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Relationship Type Modal */}
      {changeRelModalOpen && changeRelEdge && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setChangeRelModalOpen(false)}>
          <div ref={changeRelRef} className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-100 mb-4">Change Relationship Type</h3>
            <p className="text-sm text-gray-400 mb-4">
              Current type: <span className="text-gray-200 font-medium">{changeRelEdge.currentType}</span>
            </p>
            <div>
              <label className="block text-sm text-gray-400 mb-1">New Type</label>
              <select
                value={changeRelNewType}
                onChange={(e) => setChangeRelNewType(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
              >
                {relationshipOptions.map((type) => (
                  <option key={type.name} value={type.name}>{type.displayName || relLabel(type.name)}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 mt-6">
              <button
                onClick={() => setChangeRelModalOpen(false)}
                className="flex-1 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (changeRelNewType && changeRelNewType !== changeRelEdge.currentType) {
                    updateRelationshipType(changeRelEdge.source, changeRelEdge.target, changeRelEdge.currentType, changeRelNewType);
                  }
                  setChangeRelModalOpen(false);
                }}
                disabled={!changeRelNewType || changeRelNewType === changeRelEdge.currentType}
                className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 text-sm text-white transition-colors"
              >
                Change Type
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save View Modal */}
      {saveViewModalOpen && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setSaveViewModalOpen(false)}>
          <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-100 mb-4">Save View</h3>
            <input
              type="text"
              value={saveViewName}
              onChange={(e) => setSaveViewName(e.target.value)}
              placeholder="View name..."
              autoFocus
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 mb-4"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setSaveViewModalOpen(false); setSaveViewName(""); }}
                className="flex-1 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (saveViewName.trim()) {
                    saveCurrentView(saveViewName.trim());
                    setSaveViewModalOpen(false);
                    setSaveViewName("");
                  }
                }}
                className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm text-white transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
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
