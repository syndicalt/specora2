"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useEdgesState,
  useNodesState,
  type Connection,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import type { ShellAPI } from "@/sdk/types";
import { SAMPLE } from "./constants";
import { NODE_CATALOG, catalogFor, keepPositions, node, proposalToFlow, withDynamicEdgeHandles } from "./flow";
import {
  datasetWindowLabel,
  discoveryJobPreview,
  discoveryJobSource,
  discoveryJobTimestamp,
  edgeCollectorSample,
  edgeJobAge,
  entityCountsLabel,
  formatDiscoveryJobDate,
  freshnessLabel,
  lifecycleCount,
  parseCsv,
  pct,
  previewReconciliationTrace,
  previewRecordDecision,
  profileToCsv,
  relationshipStatusClass,
  relationshipStatusLabel,
  rowsToCsv,
  sourceConfigFromForm,
  sourceFields,
  sourceFormFromSource,
  stagedReconciliationTrace,
  stagedRecordDecision,
} from "./helpers";
import type {
  DiscoveryCollector,
  DiscoveryCredentialReference,
  DiscoveryDataset,
  DiscoveryFlowNodeData,
  DiscoveryJob,
  DiscoveryNodeKind,
  DiscoveryRollback,
  DiscoverySource,
  EdgeCollectorLifecycle,
  EdgeObservationProfile,
  FlowSnapshot,
  MappingProfile,
  PipelineDefinition,
  PipelinePreview,
  PipelineRecord,
  PipelineSchedule,
  SourceForm,
  StagedDiscoveryJob,
  TargetClass,
  TransformProposal,
} from "./types";
import { CLASSES_QUERY, CREATE_SOURCE, DELETE_SOURCE, DISCOVERY_QUERY, UPDATE_SOURCE } from "./queries";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  Database,
  Eye,
  FileSpreadsheet,
  GitBranch,
  Link2,
  MousePointer2,
  Play,
  Plus,
  RefreshCw,
  Route,
  Save,
  Sparkles,
  Trash2,
  Upload,
  Workflow,
  Wand2,
  XCircle,
  X,
} from "lucide-react";

function statusIcon(status: string) {
  switch (status.toLowerCase()) {
    case "completed":
    case "success":
      return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
    case "failed":
    case "error":
      return <XCircle className="h-4 w-4 text-rose-400" />;
    case "running":
    case "in_progress":
      return <Clock className="h-4 w-4 animate-pulse text-amber-300" />;
    default:
      return <AlertTriangle className="h-4 w-4 text-gray-500" />;
  }
}

const nodeTypes = { discoveryNode: DiscoveryFlowNode };

function DiscoveryFlowNode({ data, selected }: NodeProps<DiscoveryFlowNodeData>) {
  const fallback = data.label?.split("\n") || [];
  const title = data.title || fallback[0] || "Pipeline step";
  const detail = data.detail || fallback.slice(1).join(" ");
  const catalog = catalogFor(data.kind || "transform");
  const Icon = catalog.icon;
  const handleClass = "!h-2 !w-2 !border !border-gray-950 !bg-cyan-300";
  const statusClass =
    data.status === "success" ? "bg-emerald-400" :
    data.status === "warning" ? "bg-amber-300" :
    data.status === "error" ? "bg-rose-400" :
    data.status === "ready" ? "bg-cyan-300" :
    "bg-gray-600";
  return (
    <div
      className={`relative rounded-lg border bg-gray-900 px-3 py-3 text-gray-100 shadow-xl transition-shadow ${selected ? "ring-2 ring-cyan-300/70" : ""}`}
      style={{ width: 190, minHeight: 72, borderColor: data.color }}
    >
      <Handle id="top" type="target" position={Position.Top} className={handleClass} />
      <Handle id="top" type="source" position={Position.Top} className={handleClass} />
      <Handle id="right" type="target" position={Position.Right} className={handleClass} />
      <Handle id="right" type="source" position={Position.Right} className={handleClass} />
      <Handle id="bottom" type="target" position={Position.Bottom} className={handleClass} />
      <Handle id="bottom" type="source" position={Position.Bottom} className={handleClass} />
      <Handle id="left" type="target" position={Position.Left} className={handleClass} />
      <Handle id="left" type="source" position={Position.Left} className={handleClass} />
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gray-950" style={{ color: data.color }}>
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0 truncate text-sm font-semibold leading-5">{title}</div>
        </div>
        <span className={`h-2 w-2 shrink-0 rounded-full ${statusClass}`} />
      </div>
      {detail && <div className="line-clamp-2 text-xs leading-5 text-gray-400">{detail}</div>}
      {data.metric && (
        <div className="mt-2 inline-flex rounded bg-gray-950 px-2 py-0.5 text-[11px] font-medium text-cyan-200">
          {data.metric}
        </div>
      )}
    </div>
  );
}

export default function DiscoveryDashboardApp({ shell }: { shell: ShellAPI }) {
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const [jobs, setJobs] = useState<DiscoveryJob[]>([]);
  const [sources, setSources] = useState<DiscoverySource[]>([]);
  const [credentialRefs, setCredentialRefs] = useState<DiscoveryCredentialReference[]>([]);
  const [collectors, setCollectors] = useState<DiscoveryCollector[]>([]);
  const [collectorLifecycles, setCollectorLifecycles] = useState<Record<string, EdgeCollectorLifecycle>>({});
  const [edgeProfiles, setEdgeProfiles] = useState<EdgeObservationProfile[]>([]);
  const [edgeDatasets, setEdgeDatasets] = useState<DiscoveryDataset[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [selectedEdgeEntityType, setSelectedEdgeEntityType] = useState("");
  const [classes, setClasses] = useState<TargetClass[]>([]);
  const [pipelines, setPipelines] = useState<PipelineRecord[]>([]);
  const [mappingProfiles, setMappingProfiles] = useState<MappingProfile[]>([]);
  const [schedule, setSchedule] = useState<PipelineSchedule>({ enabled: false, interval: "manual", next_run_at: null });
  const [sourceName, setSourceName] = useState("server-app-inventory.csv");
  const [sample, setSample] = useState(SAMPLE);
  const [proposal, setProposal] = useState<TransformProposal | null>(null);
  const [currentPipelineId, setCurrentPipelineId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PipelinePreview | null>(null);
  const [staged, setStaged] = useState<StagedDiscoveryJob | null>(null);
  const [rollbacks, setRollbacks] = useState<DiscoveryRollback[]>([]);
  const [sourceForm, setSourceForm] = useState<SourceForm>({ name: "", type: "csv", sample: SAMPLE, endpoint: "", credentialRef: "", collectorId: "" });
  const [collectorForm, setCollectorForm] = useState({ name: "", site: "", version: "" });
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [mappingProfileName, setMappingProfileName] = useState("Reusable mapping");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [detailNodeId, setDetailNodeId] = useState<string | null>(null);
  const [stepMenuOpen, setStepMenuOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"builder" | "pipelines" | "runs" | "sources">("builder");
  const loadErrorRef = useRef("");
  const classLoadErrorRef = useRef(false);

  const profile = useMemo(() => parseCsv(sample), [sample]);
  const selectedSource = useMemo(() => sources.find((source) => source.id === selectedSourceId) || null, [sources, selectedSourceId]);
  const selectedCollectorId = selectedSourceId.startsWith("collector:") ? selectedSourceId.slice("collector:".length) : "";
  const selectedCollector = useMemo(() => collectors.find((collector) => collector.id === selectedCollectorId) || null, [collectors, selectedCollectorId]);
  const selectedDataset = useMemo(() => edgeDatasets.find((dataset) => dataset.id === selectedDatasetId) || null, [edgeDatasets, selectedDatasetId]);
  const selectedEdgeProfile = useMemo(
    () => edgeProfiles.find((item) => item.entityType === selectedEdgeEntityType) || edgeProfiles[0] || null,
    [edgeProfiles, selectedEdgeEntityType]
  );
  const credentialRefOptions = useMemo(() => {
    const activeRefs = credentialRefs.map((credential) => credential.ref);
    return sourceForm.credentialRef && !activeRefs.includes(sourceForm.credentialRef)
      ? [{ id: "current", ref: sourceForm.credentialRef, name: sourceForm.credentialRef, provider: "current" }, ...credentialRefs]
      : credentialRefs;
  }, [credentialRefs, sourceForm.credentialRef]);
  const generatedFlow = useMemo(() => proposalToFlow(proposal, sourceName), [proposal, sourceName]);
  const [nodes, setNodes] = useNodesState<DiscoveryFlowNodeData>(generatedFlow.nodes as Node<DiscoveryFlowNodeData>[]);
  const [edges, setEdges] = useEdgesState(generatedFlow.edges);
  const risks = proposal?.risks || [];
  const currentPipeline = useMemo(() => pipelines.find((pipeline) => pipeline.id === currentPipelineId) || null, [pipelines, currentPipelineId]);
  const selectedNode = useMemo(() => nodes.find((item) => item.id === selectedNodeId) || null, [nodes, selectedNodeId]);
  const detailNode = useMemo(() => nodes.find((item) => item.id === detailNodeId) || null, [nodes, detailNodeId]);
  const editableSourceFields = useMemo(() => sourceFields(profile.columns, edgeProfiles), [edgeProfiles, profile.columns]);
  const orderedJobs = useMemo(
    () => [...jobs].sort((a, b) => discoveryJobTimestamp(b) - discoveryJobTimestamp(a) || b.id.localeCompare(a.id)),
    [jobs]
  );
  const isPublished = currentPipeline?.status === "published" || !!(currentPipeline?.last_published_at || currentPipeline?.lastPublishedAt);
  const readyStep = proposal ? preview ? currentPipelineId ? isPublished ? staged ? "Commit" : "Run" : "Publish" : "Preview" : "Map" : "Source";
  const undoStackRef = useRef<FlowSnapshot[]>([]);
  const skipGeneratedFlowSyncRef = useRef(false);

  const rememberFlow = useCallback(() => {
    undoStackRef.current = [...undoStackRef.current.slice(-24), { nodes, edges }];
  }, [edges, nodes]);

  function clearDerivedRunState() {
    setPreview(null);
    setStaged(null);
  }

  async function loadCollectorLifecycle(collectorId: string) {
    const res = await shellRef.current.fetch(`/discovery/collectors/${collectorId}/jobs`);
    if (!res.ok) throw new Error(`Collector lifecycle request failed: ${res.status}`);
    const data = await res.json();
    setCollectorLifecycles((current) => ({ ...current, [collectorId]: data }));
    return data as EdgeCollectorLifecycle;
  }

  async function refreshCollectorLifecycles(items: DiscoveryCollector[]) {
    const visibleCollectors = items.slice(0, 25);
    const results = await Promise.allSettled(visibleCollectors.map((collector) => loadCollectorLifecycle(collector.id)));
    if (results.some((result) => result.status === "rejected")) {
      throw new Error("Collector lifecycle could not be loaded");
    }
  }

  function undoCanvasChange() {
    const previous = undoStackRef.current.pop();
    if (!previous) {
      shell.notify("Nothing to undo", "error");
      return;
    }
    setNodes(previous.nodes);
    setEdges(withDynamicEdgeHandles(previous.edges, previous.nodes));
    setSelectedNodeId(null);
    clearDerivedRunState();
  }

  useEffect(() => {
    if (skipGeneratedFlowSyncRef.current) {
      skipGeneratedFlowSyncRef.current = false;
      return;
    }
    setNodes((current) => {
      const next = keepPositions(generatedFlow.nodes as Node<DiscoveryFlowNodeData>[], current);
      setEdges(withDynamicEdgeHandles(generatedFlow.edges, next));
      return next;
    });
  }, [generatedFlow, setEdges, setNodes]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    if (changes.some((change) => change.type === "add" || change.type === "remove")) rememberFlow();
    setNodes((current) => {
      const next = applyNodeChanges(changes, current);
      setEdges((currentEdges) => withDynamicEdgeHandles(currentEdges, next));
      return next;
    });
  }, [rememberFlow, setEdges, setNodes]);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (changes.some((change) => change.type === "add" || change.type === "remove")) rememberFlow();
    setEdges((current) => withDynamicEdgeHandles(applyEdgeChanges(changes, current), nodes));
    clearDerivedRunState();
  }, [nodes, rememberFlow, setEdges]);

  const onConnect = useCallback((connection: Connection) => {
    rememberFlow();
    setEdges((current) => withDynamicEdgeHandles(addEdge({
      ...connection,
      id: `e-${connection.source}-${connection.target}-${Date.now()}`,
      type: "smoothstep",
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: "#818cf8" },
    }, current), nodes));
    clearDerivedRunState();
  }, [nodes, rememberFlow, setEdges]);

  function addCanvasNode(kind: DiscoveryNodeKind) {
    rememberFlow();
    const catalog = catalogFor(kind);
    const id = `${kind}-${Date.now().toString(36)}`;
    const x = 160 + (nodes.length % 4) * 210;
    const y = 120 + Math.floor(nodes.length / 4) * 130;
    const next = node(id, catalog.title, catalog.detail, x, y, catalog.color, kind);
    setNodes((current) => [...current, next]);
    setSelectedNodeId(id);
    setStepMenuOpen(false);
    clearDerivedRunState();
  }

  function updateCanvasNode(id: string, patch: Partial<DiscoveryFlowNodeData>) {
    rememberFlow();
    setNodes((current) => current.map((item) => item.id === id ? { ...item, data: { ...item.data, ...patch } } : item));
    clearDerivedRunState();
  }

  function duplicateSelectedNode() {
    if (!selectedNode) return;
    rememberFlow();
    const id = `${selectedNode.data.kind}-${Date.now().toString(36)}`;
    setNodes((current) => [
      ...current,
      {
        ...selectedNode,
        id,
        selected: false,
        position: { x: selectedNode.position.x + 36, y: selectedNode.position.y + 36 },
        data: { ...selectedNode.data, title: `${selectedNode.data.title} copy` },
      },
    ]);
    setSelectedNodeId(id);
  }

  function deleteSelectedNode() {
    if (!selectedNodeId) return;
    rememberFlow();
    setNodes((current) => current.filter((item) => item.id !== selectedNodeId));
    setEdges((current) => current.filter((item) => item.source !== selectedNodeId && item.target !== selectedNodeId));
    setSelectedNodeId(null);
    clearDerivedRunState();
  }

  const definition = useCallback((): PipelineDefinition => ({
    source: selectedSource
      ? { id: selectedSource.id, name: selectedSource.name, type: selectedSource.type, collectorId: String(selectedSource.config?.collectorId || "") || undefined }
      : selectedCollector
        ? { id: `collector:${selectedCollector.id}`, collectorId: selectedCollector.id, datasetId: selectedDatasetId || undefined, name: selectedCollector.name, type: "edge", entityType: selectedEdgeProfile?.entityType }
        : { name: sourceName, type: "manual" },
    sourceName,
    sample: profile,
    entityProfiles: edgeProfiles.length ? edgeProfiles : undefined,
    proposal,
    flow: { nodes, edges },
  }), [selectedSource, selectedCollector, selectedDatasetId, selectedEdgeProfile, sourceName, profile, edgeProfiles, proposal, nodes, edges]);

  const refresh = useCallback(async () => {
    setLoading(true);
    let errorKey = "";
    try {
      const api = shellRef.current;
      try {
        const data = await api.query(DISCOVERY_QUERY);
        setSources((data.discoverySources || []) as DiscoverySource[]);
        setJobs((data.discoveryJobs || []) as DiscoveryJob[]);
      } catch {
        errorKey += "graphql";
      }

      try {
        const classData = await api.query(CLASSES_QUERY);
        setClasses((classData.ciClasses || []) as TargetClass[]);
        classLoadErrorRef.current = false;
      } catch {
        if (!classLoadErrorRef.current) {
          classLoadErrorRef.current = true;
          shellRef.current.notify("Class metadata could not be loaded; preview validation will be limited", "error");
        }
      }

      try {
        const pipelineRes = await api.fetch("/discovery/pipelines");
        if (!pipelineRes.ok) throw new Error(`Pipeline request failed: ${pipelineRes.status}`);
        setPipelines(await pipelineRes.json());
      } catch {
        errorKey += "pipelines";
      }

      try {
        const profileRes = await api.fetch("/discovery/mapping-profiles");
        if (!profileRes.ok) throw new Error(`Mapping profile request failed: ${profileRes.status}`);
        const profileData = await profileRes.json();
        setMappingProfiles(profileData.profiles || []);
      } catch {
        errorKey += "profiles";
      }

      try {
        const credentialRes = await api.fetch("/discovery/credential-references");
        if (!credentialRes.ok) throw new Error(`Credential request failed: ${credentialRes.status}`);
        const credentialData = await credentialRes.json();
        setCredentialRefs(credentialData.credentials || []);
      } catch {
        errorKey += "credentials";
      }

      try {
        const collectorRes = await api.fetch("/discovery/collectors");
        if (!collectorRes.ok) throw new Error(`Collector request failed: ${collectorRes.status}`);
        const collectorData = await collectorRes.json();
        const nextCollectors = (collectorData.collectors || []) as DiscoveryCollector[];
        setCollectors(nextCollectors);
        await refreshCollectorLifecycles(nextCollectors);
      } catch {
        errorKey += "collectors";
      }

      if (errorKey && loadErrorRef.current !== errorKey) {
        loadErrorRef.current = errorKey;
        shellRef.current.notify(
          errorKey === "graphql" ? "Discovery records could not be loaded" :
          errorKey === "pipelines" ? "Discovery pipelines could not be loaded" :
          "Some Discovery data could not be loaded",
          "error"
        );
      } else if (!errorKey) {
        loadErrorRef.current = "";
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    return shellRef.current.eventBus.subscribe("discovery.completed", () => {
      refresh();
      shellRef.current.notify("Discovery run completed", "success");
    });
  }, [refresh]);

  async function draftTransform() {
    if (!profile.columns.length) {
      shell.notify("Paste a header row before generating a transform", "error");
      return;
    }
    setLoading(true);
    try {
      const res = await shell.fetch("/discovery/ai/propose-transform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceName,
          entityType: selectedEdgeProfile?.entityType,
          recordCount: selectedEdgeProfile?.recordCount,
          fieldStats: selectedEdgeProfile?.fieldStats,
          columns: profile.columns,
          sampleRows: profile.rows,
          entityProfiles: edgeProfiles.length ? edgeProfiles : undefined,
          targetClasses: classes.slice(0, 80),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setProposal(await res.json());
      setPreview(null);
      setStaged(null);
      shell.notify("Transform draft generated", "success");
    } catch {
      shell.notify("Transform draft failed", "error");
    } finally {
      setLoading(false);
    }
  }

  async function savePipeline() {
    const body = {
      name: proposal?.title || `${sourceName} pipeline`,
      description: proposal?.summary || "Discovery builder draft",
      definition: definition(),
    };
    try {
      const res = await shell.fetch(currentPipelineId ? `/discovery/pipelines/${currentPipelineId}` : "/discovery/pipelines", {
        method: currentPipelineId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const saved = await res.json();
      setCurrentPipelineId(saved.id);
      setPipelines((current) => [saved, ...current.filter((pipeline) => pipeline.id !== saved.id)]);
      await loadSchedule(saved.id);
      shell.notify(currentPipelineId ? "Pipeline updated" : "Pipeline saved", "success");
      refresh();
    } catch {
      shell.notify("Pipeline could not be saved", "error");
    }
  }

  async function saveMappingProfile() {
    if (!proposal) {
      shell.notify("Generate or load a transform before saving a mapping profile", "error");
      return;
    }
    try {
      const targetClasses = Array.from(new Set([
        ...proposal.classRoutes.map((route) => route.targetClass),
        ...proposal.fieldMappings.map((mapping) => mapping.targetClass),
      ])).filter(Boolean);
      const res = await shell.fetch("/discovery/mapping-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: mappingProfileName.trim() || proposal.title || `${sourceName} mapping`,
          description: proposal.summary || "",
          sourceType: selectedSource?.type || "csv",
          targetClasses,
          mapping: proposal,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Mapping profile could not be saved");
      setMappingProfiles((current) => [data.profile, ...current.filter((profile) => profile.id !== data.profile.id)]);
      setMappingProfileName(data.profile.name);
      shell.notify("Mapping profile saved", "success");
    } catch (err: any) {
      shell.notify(err.message || "Mapping profile could not be saved", "error");
    }
  }

  async function applyMappingProfile(profileId: string) {
    try {
      const res = await shell.fetch(`/discovery/mapping-profiles/${profileId}/apply`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Mapping profile could not be applied");
      setProposal(data.definitionPatch?.proposal || data.profile.mapping);
      setMappingProfileName(data.profile.name);
      setPreview(null);
      setStaged(null);
      shell.notify("Mapping profile applied", "success");
    } catch (err: any) {
      shell.notify(err.message || "Mapping profile could not be applied", "error");
    }
  }

  async function deleteMappingProfile(profileId: string) {
    try {
      const res = await shell.fetch(`/discovery/mapping-profiles/${profileId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Mapping profile could not be deleted");
      setMappingProfiles((current) => current.filter((profile) => profile.id !== profileId));
      shell.notify("Mapping profile deleted", "success");
    } catch (err: any) {
      shell.notify(err.message || "Mapping profile could not be deleted", "error");
    }
  }

  function newPipeline() {
    undoStackRef.current = [];
    setCurrentPipelineId(null);
    setSchedule({ enabled: false, interval: "manual", next_run_at: null });
    setSelectedSourceId("");
    setEdgeProfiles([]);
    setSelectedEdgeEntityType("");
    setSourceName("server-app-inventory.csv");
    setSample(SAMPLE);
    setProposal(null);
      setPreview(null);
      setStaged(null);
      setView("builder");
  }

  async function loadPipeline(pipeline: PipelineRecord) {
    undoStackRef.current = [];
    const saved = pipeline.definition || {};
    const savedSample = saved.sample || {};
    const columns = savedSample.columns || Object.keys(savedSample.rows?.[0] || {});
    const savedEdgeProfiles = saved.entityProfiles || saved.proposal?.sourceProfile?.entityProfiles || [];
    setCurrentPipelineId(pipeline.id);
    setSelectedSourceId(saved.source?.id || "");
    setEdgeProfiles(savedEdgeProfiles);
    setEdgeDatasets([]);
    setSelectedDatasetId(saved.source?.datasetId || "");
    setSelectedEdgeEntityType(saved.source?.entityType || savedEdgeProfiles[0]?.entityType || "");
    setSourceName(saved.sourceName || pipeline.name);
    setSample(rowsToCsv(columns, savedSample.rows || []));
    skipGeneratedFlowSyncRef.current = true;
    setProposal(saved.proposal || null);
    if (saved.flow?.nodes?.length) {
      const savedNodes = saved.flow.nodes as Node<DiscoveryFlowNodeData>[];
      setNodes(savedNodes);
      if (saved.flow?.edges?.length) setEdges(withDynamicEdgeHandles(saved.flow.edges, savedNodes));
    } else if (saved.flow?.edges?.length) {
      setEdges(saved.flow.edges);
    }
    await loadSchedule(pipeline.id);
    setPreview(null);
    setStaged(null);
    setView("builder");
  }

  async function deletePipeline(pipeline: PipelineRecord) {
    if (!window.confirm(`Delete discovery pipeline "${pipeline.name}"? This removes the saved pipeline definition and schedule, but not raw observations or committed CMDB data.`)) return;
    try {
      const res = await shell.fetch(`/discovery/pipelines/${pipeline.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setPipelines((current) => current.filter((item) => item.id !== pipeline.id));
      if (currentPipelineId === pipeline.id) {
        newPipeline();
      }
      shell.notify(data.deleted ? "Pipeline deleted" : "Pipeline was already deleted", data.deleted ? "success" : "error");
      refresh();
    } catch {
      shell.notify("Pipeline could not be deleted", "error");
    }
  }

  function loadExample() {
    rememberFlow();
    const exampleFlow = proposalToFlow(null, "server-app-inventory.csv");
    setSelectedSourceId("");
    setEdgeProfiles([]);
    setSelectedEdgeEntityType("");
    setSourceName("server-app-inventory.csv");
    setSample(SAMPLE);
    setProposal(null);
    setCurrentPipelineId(null);
    setSchedule({ enabled: false, interval: "manual", next_run_at: null });
    setNodes(exampleFlow.nodes as Node<DiscoveryFlowNodeData>[]);
    setEdges(withDynamicEdgeHandles(exampleFlow.edges, exampleFlow.nodes as Node<DiscoveryFlowNodeData>[]));
    clearDerivedRunState();
    shell.notify("Example source sample loaded", "success");
  }

  function applySource(source: DiscoverySource) {
    setSelectedSourceId(source.id);
    setEdgeProfiles([]);
    setEdgeDatasets([]);
    setSelectedDatasetId("");
    setSelectedEdgeEntityType("");
    setSourceName(source.name);
    const config = source.config || {};
    if (typeof config.sample === "string") {
      setSample(config.sample);
    } else if (Array.isArray(config.rows)) {
      const columns = Array.isArray(config.columns) ? config.columns.map(String) : Object.keys(config.rows[0] || {});
      setSample(rowsToCsv(columns, config.rows as Record<string, unknown>[]));
    } else if (source.type === "edge") {
      setSample(edgeCollectorSample(collectors.find((collector) => collector.id === config.collectorId) || null));
    }
    setProposal(null);
    setPreview(null);
    setStaged(null);
  }

  function applyEdgeProfile(collector: DiscoveryCollector, profile: EdgeObservationProfile) {
    setSelectedEdgeEntityType(profile.entityType);
    setSourceName(`${collector.name} · ${profile.entityType}`);
    setSample(profileToCsv(profile));
    setProposal(null);
    setPreview(null);
    setStaged(null);
  }

  function applyDatasetProfile(collector: DiscoveryCollector, dataset: DiscoveryDataset, profile: EdgeObservationProfile) {
    setSelectedDatasetId(dataset.id);
    setEdgeProfiles(dataset.profiles || []);
    setSelectedEdgeEntityType(profile.entityType);
    setSourceName(`${collector.name} · ${profile.entityType}`);
    setSample(profileToCsv(profile));
    setProposal(null);
    setPreview(null);
    setStaged(null);
  }

  async function applyCollector(collector: DiscoveryCollector) {
    setSelectedSourceId(`collector:${collector.id}`);
    setSourceName(collector.name);
    setEdgeDatasets([]);
    setSelectedDatasetId("");
    setEdgeProfiles([]);
    setSelectedEdgeEntityType("");
    try {
      const datasetRes = await shell.fetch(`/discovery/collectors/${collector.id}/datasets`);
      if (!datasetRes.ok) throw new Error(`Dataset request failed: ${datasetRes.status}`);
      const datasetData = await datasetRes.json();
      const datasets = (datasetData.datasets || []) as DiscoveryDataset[];
      setEdgeDatasets(datasets);
      if (datasets.length && datasets[0].profiles?.length) {
        applyDatasetProfile(collector, datasets[0], datasets[0].profiles[0]);
        shell.notify(`Loaded dataset with ${Object.values(datasets[0].entityCounts || {}).reduce((sum, count) => sum + Number(count || 0), 0)} profiled entities`, "success");
      } else {
        const res = await shell.fetch(`/discovery/collectors/${collector.id}/profile`);
        if (!res.ok) throw new Error(`Profile request failed: ${res.status}`);
        const data = await res.json();
        const profiles = (data.profiles || []) as EdgeObservationProfile[];
        setEdgeProfiles(profiles);
        if (profiles.length) {
          applyEdgeProfile(collector, profiles[0]);
          shell.notify(`Profiled ${data.totalObservations || 0} edge observations across ${profiles.length} entity types`, "success");
        } else {
          setSample(edgeCollectorSample(collector));
          shell.notify("No edge observations staged yet; using collector schema sample", "info");
        }
      }
    } catch {
      setSample(edgeCollectorSample(collector));
      shell.notify("Edge datasets could not be loaded; using collector schema sample", "error");
    }
    setProposal(null);
    setPreview(null);
    setStaged(null);
  }

  async function selectCollectorDataset(datasetId: string) {
    if (!selectedCollector) return;
    if (!datasetId) {
      setSelectedDatasetId("");
      try {
        const res = await shell.fetch(`/discovery/collectors/${selectedCollector.id}/profile`);
        if (!res.ok) throw new Error(`Profile request failed: ${res.status}`);
        const data = await res.json();
        const profiles = (data.profiles || []) as EdgeObservationProfile[];
        setEdgeProfiles(profiles);
        if (profiles.length) applyEdgeProfile(selectedCollector, profiles[0]);
      } catch {
        shell.notify("Latest observations could not be loaded", "error");
      }
      return;
    }
    const dataset = edgeDatasets.find((item) => item.id === datasetId);
    if (!dataset?.profiles?.length) return;
    applyDatasetProfile(selectedCollector, dataset, dataset.profiles[0]);
  }

  async function materializeCollectorDataset() {
    if (!selectedCollector) return;
    try {
      const res = await shell.fetch(`/discovery/collectors/${selectedCollector.id}/datasets`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Dataset could not be created");
      const dataset = data.dataset as DiscoveryDataset;
      setEdgeDatasets((current) => [dataset, ...current.filter((item) => item.id !== dataset.id)]);
      if (dataset.profiles?.length) applyDatasetProfile(selectedCollector, dataset, dataset.profiles[0]);
      shell.notify("Discovery dataset created", "success");
    } catch (err: any) {
      shell.notify(err.message || "Discovery dataset could not be created", "error");
    }
  }

  async function loadSchedule(pipelineId: string) {
    try {
      const res = await shell.fetch(`/discovery/pipelines/${pipelineId}/schedule`);
      if (!res.ok) throw new Error(await res.text());
      setSchedule(await res.json());
    } catch {
      setSchedule({ enabled: false, interval: "manual", next_run_at: null });
    }
  }

  async function saveSchedule(pipelineId = currentPipelineId) {
    if (!pipelineId) {
      shell.notify("Save or select a pipeline before scheduling", "error");
      return;
    }
    try {
      const res = await shell.fetch(`/discovery/pipelines/${pipelineId}/schedule`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: schedule.enabled, interval: schedule.interval, nextRunAt: schedule.next_run_at || null }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSchedule(await res.json());
      shell.notify("Discovery schedule saved", "success");
    } catch {
      shell.notify("Discovery schedule could not be saved", "error");
    }
  }

  async function publishPipeline(pipelineId = currentPipelineId) {
    if (!pipelineId) {
      shell.notify("Save the pipeline before publishing", "error");
      return;
    }
    if (!preview || preview.summary.errors > 0) {
      shell.notify("Preview without blocking errors before publishing", "error");
      return;
    }
    setLoading(true);
    try {
      const res = await shell.fetch(`/discovery/pipelines/${pipelineId}/publish`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const published = await res.json();
      setPipelines((current) => [published, ...current.filter((pipeline) => pipeline.id !== published.id)]);
      shell.notify("Pipeline published", "success");
      refresh();
    } catch {
      shell.notify("Pipeline could not be published", "error");
    } finally {
      setLoading(false);
    }
  }

  async function previewPipeline() {
    if (!proposal) {
      shell.notify("Generate or load a transform before previewing", "error");
      return;
    }
    setLoading(true);
    try {
      const res = await shell.fetch("/discovery/pipelines/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition: definition(), targetClasses: classes }),
      });
      if (!res.ok) throw new Error(await res.text());
      setPreview(await res.json());
      setStaged(null);
      shell.notify("Pipeline preview generated", "success");
    } catch {
      shell.notify("Pipeline preview failed", "error");
    } finally {
      setLoading(false);
    }
  }

  async function runPipeline(pipelineId = currentPipelineId) {
    if (!pipelineId) {
      shell.notify("Save the pipeline before running it", "error");
      return;
    }
    setLoading(true);
    try {
      const res = await shell.fetch(`/discovery/pipelines/${pipelineId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetClasses: classes }),
      });
      if (!res.ok) throw new Error(await res.text());
      const run = await res.json();
      shell.notify(`Discovery staged: ${run.jobId}`, "success");
      await loadStagedJob(run.jobId);
      setView("runs");
      refresh();
    } catch {
      shell.notify("Pipeline is not ready to run", "error");
    } finally {
      setLoading(false);
    }
  }

  async function loadStagedJob(jobId: string) {
    try {
      const res = await shell.fetch(`/discovery/jobs/${jobId}/staged`);
      if (!res.ok) throw new Error(await res.text());
      setStaged(await res.json());
      await loadRollbacks(jobId);
      setView("runs");
    } catch {
      shell.notify("Staged discovery data could not be loaded", "error");
    }
  }

  async function loadRollbacks(jobId?: string) {
    try {
      const path = jobId ? `/discovery/jobs/${jobId}/rollback` : "/discovery/rollbacks";
      const res = await shell.fetch(path);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setRollbacks(data.rollbacks || []);
    } catch {
      shell.notify("Rollback history could not be loaded", "error");
    }
  }

  async function commitStagedJob(jobId: string) {
    setLoading(true);
    try {
      const res = await shell.fetch(`/discovery/jobs/${jobId}/commit`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Commit failed");
      shell.notify(`Discovery committed: ${data.created} created, ${data.updated} updated`, "success");
      await loadStagedJob(jobId);
      refresh();
    } catch (err: any) {
      shell.notify(err.message || "Discovery commit failed", "error");
    } finally {
      setLoading(false);
    }
  }

  async function discardStagedJob(jobId: string) {
    setLoading(true);
    try {
      const res = await shell.fetch(`/discovery/jobs/${jobId}/staged`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Discard failed");
      setStaged(null);
      setRollbacks([]);
      shell.notify("Staged discovery run discarded", "success");
      refresh();
    } catch (err: any) {
      shell.notify(err.message || "Staged discovery run could not be discarded", "error");
    } finally {
      setLoading(false);
    }
  }

  async function applyRollback(rollbackId: string, jobId: string) {
    setLoading(true);
    try {
      const res = await shell.fetch(`/discovery/rollbacks/${rollbackId}/apply`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Rollback failed");
      shell.notify(`Rollback applied: ${data.deleted} deleted, ${data.restored} restored`, "success");
      await loadStagedJob(jobId);
      refresh();
    } catch (err: any) {
      shell.notify(err.message || "Discovery rollback failed", "error");
    } finally {
      setLoading(false);
    }
  }

  async function approveAllSafe(jobId: string) {
    try {
      const res = await shell.fetch(`/discovery/jobs/${jobId}/staged/approve-safe`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      await loadStagedJob(jobId);
      shell.notify("Safe staged records approved", "success");
    } catch {
      shell.notify("Staged records could not be approved", "error");
    }
  }

  async function skipStagedRecord(jobId: string, recordId: string) {
    try {
      const res = await shell.fetch(`/discovery/jobs/${jobId}/staged/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordIds: [recordId], status: "skipped" }),
      });
      if (!res.ok) throw new Error(await res.text());
      await loadStagedJob(jobId);
    } catch {
      shell.notify("Staged record could not be skipped", "error");
    }
  }

  async function createSource() {
    const config = sourceConfigFromForm(sourceForm);
    try {
      const created = await shell.mutate(CREATE_SOURCE, { name: sourceForm.name || "Untitled source", type: sourceForm.type, config });
      setSourceForm({ name: "", type: "csv", sample: SAMPLE, endpoint: "", credentialRef: "", collectorId: "" });
      setEditingSourceId(null);
      if (created?.createDiscoverySource) applySource(created.createDiscoverySource);
      shell.notify("Discovery source created", "success");
      refresh();
    } catch {
      shell.notify("Discovery source could not be created", "error");
    }
  }

  async function updateSource() {
    if (!editingSourceId) return;
    const config = sourceConfigFromForm(sourceForm);
    try {
      const updated = await shell.mutate(UPDATE_SOURCE, { id: editingSourceId, name: sourceForm.name || "Untitled source", type: sourceForm.type, config });
      setSourceForm({ name: "", type: "csv", sample: SAMPLE, endpoint: "", credentialRef: "", collectorId: "" });
      setEditingSourceId(null);
      if (updated?.updateDiscoverySource) applySource(updated.updateDiscoverySource);
      shell.notify("Discovery source updated", "success");
      refresh();
    } catch {
      shell.notify("Discovery source could not be updated", "error");
    }
  }

  function editSource(source: DiscoverySource) {
    setEditingSourceId(source.id);
    setSourceForm(sourceFormFromSource(source));
  }

  function cancelSourceEdit() {
    setEditingSourceId(null);
    setSourceForm({ name: "", type: "csv", sample: SAMPLE, endpoint: "", credentialRef: "", collectorId: "" });
  }

  async function registerCollector() {
    if (!collectorForm.name.trim()) {
      shell.notify("Collector name is required", "error");
      return;
    }
    try {
      const res = await shell.fetch("/discovery/collectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collectorForm),
      });
      if (!res.ok) throw new Error(await res.text());
      setCollectorForm({ name: "", site: "", version: "" });
      shell.notify("Collector registered", "success");
      refresh();
    } catch {
      shell.notify("Collector could not be registered", "error");
    }
  }

  async function deleteSource(id: string) {
    try {
      await shell.mutate(DELETE_SOURCE, { id });
      if (editingSourceId === id) cancelSourceEdit();
      shell.notify("Discovery source deleted", "success");
      refresh();
    } catch {
      shell.notify("Discovery source could not be deleted", "error");
    }
  }

  async function queueHostInventory(collector: DiscoveryCollector) {
    try {
      setLoading(true);
      const res = await shell.fetch(`/discovery/collectors/${collector.id}/jobs/host-inventory`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      shell.notify(`Queued ${data.jobs?.length || 0} host inventory jobs for ${collector.name}`, "success");
      await loadCollectorLifecycle(collector.id);
    } catch (err: any) {
      shell.notify(`Failed to queue host inventory: ${err.message}`, "error");
    } finally {
      setLoading(false);
    }
  }

  async function testSource(source: DiscoverySource) {
    try {
      const res = await shell.fetch(`/discovery/sources/${source.id}/test`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      shell.notify(data.ok ? "Discovery source test passed" : "Discovery source needs configuration", data.ok ? "success" : "error");
      refresh();
    } catch {
      shell.notify("Discovery source test failed", "error");
    }
  }

  function updateMapping(index: number, patch: Partial<TransformProposal["fieldMappings"][number]>) {
    if (!proposal) return;
    const fieldMappings = proposal.fieldMappings.map((mapping, i) => i === index ? { ...mapping, ...patch } : mapping);
    setProposal({ ...proposal, fieldMappings });
    setPreview(null);
  }

  function addClassRoute() {
    if (!proposal) return;
    const targetClass = classes[0]?.name || "ConfigurationItem";
    setProposal({
      ...proposal,
      classRoutes: [
        ...proposal.classRoutes,
        { sourcePattern: "manual route", targetClass, confidence: 0.5, rationale: "Added by discovery admin." },
      ],
    });
    setPreview(null);
  }

  function updateClassRoute(index: number, patch: Partial<TransformProposal["classRoutes"][number]>) {
    if (!proposal) return;
    setProposal({ ...proposal, classRoutes: proposal.classRoutes.map((route, i) => i === index ? { ...route, ...patch } : route) });
    setPreview(null);
  }

  function deleteClassRoute(index: number) {
    if (!proposal) return;
    setProposal({ ...proposal, classRoutes: proposal.classRoutes.filter((_, i) => i !== index) });
    setPreview(null);
  }

  function addMapping() {
    if (!proposal) return;
    setProposal({
      ...proposal,
      fieldMappings: [
        ...proposal.fieldMappings,
        {
          sourceField: editableSourceFields[0] || "name",
          targetClass: proposal.classRoutes[0]?.targetClass || classes[0]?.name || "ConfigurationItem",
          targetField: "name",
          transform: "trim",
          confidence: 0.5,
          rationale: "Added by discovery admin.",
        },
      ],
    });
    setPreview(null);
  }

  function deleteMapping(index: number) {
    if (!proposal) return;
    setProposal({ ...proposal, fieldMappings: proposal.fieldMappings.filter((_, i) => i !== index) });
    setPreview(null);
  }

  function addRelationshipRule() {
    if (!proposal) return;
    const firstClass = proposal.classRoutes[0]?.targetClass || "ConfigurationItem";
    setProposal({
      ...proposal,
      relationshipRules: [
        ...proposal.relationshipRules,
        { fromClass: firstClass, toClass: "ConfigurationItem", type: "DEPENDS_ON", sourceField: profile.columns[0] || "name", confidence: 0.5 },
      ],
    });
    setPreview(null);
  }

  function updateRelationship(index: number, patch: Partial<TransformProposal["relationshipRules"][number]>) {
    if (!proposal) return;
    const relationshipRules = proposal.relationshipRules.map((rule, i) => i === index ? { ...rule, ...patch } : rule);
    setProposal({ ...proposal, relationshipRules });
    setPreview(null);
  }

  function deleteRelationship(index: number) {
    if (!proposal) return;
    setProposal({ ...proposal, relationshipRules: proposal.relationshipRules.filter((_, i) => i !== index) });
    setPreview(null);
  }

  function addReconciliationRule() {
    if (!proposal) return;
    setProposal({
      ...proposal,
      reconciliationRules: [
        ...proposal.reconciliationRules,
        { targetClass: proposal.classRoutes[0]?.targetClass || classes[0]?.name || "ConfigurationItem", matchKeys: ["name"], strategy: "create_or_update" },
      ],
    });
    setPreview(null);
  }

  function updateReconciliation(index: number, patch: Partial<TransformProposal["reconciliationRules"][number]>) {
    if (!proposal) return;
    setProposal({ ...proposal, reconciliationRules: proposal.reconciliationRules.map((rule, i) => i === index ? { ...rule, ...patch } : rule) });
    setPreview(null);
  }

  function deleteReconciliation(index: number) {
    if (!proposal) return;
    setProposal({ ...proposal, reconciliationRules: proposal.reconciliationRules.filter((_, i) => i !== index) });
    setPreview(null);
  }

  async function runNodeAction(kind: DiscoveryNodeKind) {
    switch (kind) {
      case "source":
      case "profile":
        if (!profile.columns.length) shell.notify("Paste or select a source with a header row first", "error");
        else shell.notify(`Profiled ${profile.columns.length} columns across ${profile.rows.length} sample rows`, "success");
        return;
      case "transform":
      case "router":
        await draftTransform();
        return;
      case "validator":
      case "stage":
        await previewPipeline();
        return;
      case "schedule":
        await saveSchedule();
        return;
      case "target":
        await runPipeline();
        return;
      default:
        shell.notify("Select a downstream action from the inspector", "success");
    }
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-gray-950 text-gray-100">
      <header className="flex shrink-0 items-center justify-between border-b border-gray-800 px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-500/40 bg-cyan-500/10">
            <GitBranch className="h-5 w-5 text-cyan-300" />
          </div>
          <div>
            <h1 className="text-base font-semibold">Discovery Builder</h1>
            <p className="text-xs text-gray-500">{currentPipelineId ? "Editing saved pipeline" : "Profile sources, draft transforms, link relationships, and stage CMDB changes."}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={newPipeline} className="rounded-md px-3 py-2 text-sm text-gray-400 hover:bg-gray-900 hover:text-white">
            New
          </button>
          <button onClick={() => setView("builder")} className={`rounded-md px-3 py-2 text-sm ${view === "builder" ? "bg-gray-800 text-white" : "text-gray-400 hover:bg-gray-900"}`}>
            Builder
          </button>
          <button onClick={() => setView("pipelines")} className={`rounded-md px-3 py-2 text-sm ${view === "pipelines" ? "bg-gray-800 text-white" : "text-gray-400 hover:bg-gray-900"}`}>
            Pipelines
          </button>
          <button onClick={() => setView("sources")} className={`rounded-md px-3 py-2 text-sm ${view === "sources" ? "bg-gray-800 text-white" : "text-gray-400 hover:bg-gray-900"}`}>
            Sources
          </button>
          <button onClick={() => setView("runs")} className={`rounded-md px-3 py-2 text-sm ${view === "runs" ? "bg-gray-800 text-white" : "text-gray-400 hover:bg-gray-900"}`}>
            Runs
          </button>
          <button onClick={refresh} className="rounded-md p-2 text-gray-400 hover:bg-gray-900 hover:text-white" title="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <div className="shrink-0 border-b border-gray-800 bg-gray-950 px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {["Source", "Map", "Preview", "Publish", "Run", "Commit"].map((step) => {
            const active = readyStep === step;
            const done =
              (step === "Source" && profile.columns.length > 0) ||
              (step === "Map" && !!proposal) ||
              (step === "Preview" && !!preview) ||
              (step === "Publish" && isPublished) ||
              (step === "Run" && !!staged) ||
              (step === "Commit" && staged?.job?.status === "completed");
            return (
              <div
                key={step}
                className={`rounded-md border px-2.5 py-1 text-xs ${
                  active ? "border-cyan-400 bg-cyan-500/10 text-cyan-100" :
                  done ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" :
                  "border-gray-800 bg-gray-900 text-gray-500"
                }`}
              >
                {step}
              </div>
            );
          })}
          {currentPipeline && (
            <div className="ml-auto text-xs text-gray-500">
              {currentPipeline.status} · v{currentPipeline.version || 1}
              {(currentPipeline.last_published_at || currentPipeline.lastPublishedAt) ? ` · published ${new Date((currentPipeline.last_published_at || currentPipeline.lastPublishedAt)!).toLocaleString()}` : ""}
            </div>
          )}
        </div>
      </div>

      {view === "pipelines" ? (
        <main className="grid flex-1 grid-cols-1 gap-4 overflow-auto p-5 pb-24 xl:grid-cols-[1fr_380px]">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Saved Pipelines</h2>
              <button onClick={newPipeline} className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-gray-950 hover:bg-cyan-400">New pipeline</button>
            </div>
            {pipelines.length ? pipelines.map((pipeline) => (
              <div key={pipeline.id} className="rounded-lg border border-gray-800 bg-gray-900 p-4">
                <div className="flex items-start justify-between gap-4">
                  <button onClick={() => loadPipeline(pipeline)} className="min-w-0 text-left">
                    <div className="truncate text-sm font-semibold">{pipeline.name}</div>
                    <div className="mt-1 text-xs text-gray-500">{pipeline.status} · {new Date(pipeline.updated_at || pipeline.updatedAt || Date.now()).toLocaleString()}</div>
                    {pipeline.description && <p className="mt-2 line-clamp-2 text-sm text-gray-400">{pipeline.description}</p>}
                  </button>
                  <div className="flex shrink-0 gap-2">
                    <button onClick={() => loadPipeline(pipeline)} className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800">Open</button>
                    <button onClick={() => publishPipeline(pipeline.id)} className="rounded-md border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/10">Publish</button>
                    <button onClick={() => runPipeline(pipeline.id)} className="rounded-md border border-cyan-500/40 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/10">Run</button>
                    <button onClick={() => deletePipeline(pipeline)} className="rounded-md border border-rose-500/40 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-500/10">Delete</button>
                  </div>
                </div>
              </div>
            )) : (
              <div className="rounded-lg border border-dashed border-gray-800 p-8 text-center text-sm text-gray-500">No saved pipelines. Create one from Builder.</div>
            )}
          </section>
          <aside className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <h2 className="text-sm font-semibold">Schedule</h2>
            <p className="mt-1 text-xs text-gray-500">{currentPipelineId ? "Schedule the currently selected pipeline." : "Open or save a pipeline to schedule it."}</p>
            <div className="mt-4 space-y-3">
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" checked={schedule.enabled} onChange={(event) => setSchedule({ ...schedule, enabled: event.target.checked })} />
                Enabled
              </label>
              <label className="block text-xs text-gray-500">Frequency</label>
              <select value={schedule.interval} onChange={(event) => setSchedule({ ...schedule, interval: event.target.value })} className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm">
                <option value="manual">Manual</option>
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
              <label className="block text-xs text-gray-500">Next run</label>
              <input type="datetime-local" value={schedule.next_run_at ? schedule.next_run_at.slice(0, 16) : ""} onChange={(event) => setSchedule({ ...schedule, next_run_at: event.target.value ? new Date(event.target.value).toISOString() : null })} className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm" />
              <button onClick={() => saveSchedule()} disabled={!currentPipelineId} className="w-full rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-gray-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50">Save schedule</button>
              {schedule.last_run_at && <div className="text-xs text-gray-500">Last run {new Date(schedule.last_run_at).toLocaleString()}</div>}
              {schedule.last_status && <div className="text-xs text-gray-500">Last status {schedule.last_status}{schedule.last_discovery_job_id ? ` · ${schedule.last_discovery_job_id.slice(0, 8)}` : ""}</div>}
              {schedule.last_error && <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-200">{schedule.last_error}</div>}
            </div>
          </aside>
        </main>
      ) : view === "sources" ? (
        <main className="grid flex-1 grid-cols-1 gap-4 overflow-auto p-5 pb-24 xl:grid-cols-[420px_1fr]">
          <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">{editingSourceId ? "Edit Discovery Source" : "Add Discovery Source"}</h2>
                <p className="mt-1 text-xs text-gray-500">Define reusable source metadata for imports and future connector-backed pipelines.</p>
              </div>
              {editingSourceId && (
                <button onClick={cancelSourceEdit} className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800">Cancel</button>
              )}
            </div>
            <div className="mt-4 space-y-3">
              <label className="block text-xs text-gray-500">Name</label>
              <input value={sourceForm.name} onChange={(event) => setSourceForm({ ...sourceForm, name: event.target.value })} className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-cyan-500" placeholder="Production server inventory" />
              <label className="block text-xs text-gray-500">Type</label>
              <select value={sourceForm.type} onChange={(event) => setSourceForm({ ...sourceForm, type: event.target.value })} className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm">
                <option value="csv">CSV / file</option>
                <option value="api">REST API</option>
                <option value="database">Database</option>
                <option value="cloud">Cloud inventory</option>
                <option value="edge">Edge collector</option>
                <option value="manual">Manual table</option>
              </select>
              {(sourceForm.type === "csv" || sourceForm.type === "manual") ? (
                <>
                  <label className="block text-xs text-gray-500">Representative sample</label>
                  <textarea value={sourceForm.sample} onChange={(event) => setSourceForm({ ...sourceForm, sample: event.target.value })} spellCheck={false} className="h-40 w-full resize-none rounded-md border border-gray-800 bg-gray-950 p-3 font-mono text-xs outline-none focus:border-cyan-500" />
                </>
              ) : (
                <>
                  {sourceForm.type === "edge" && (
                    <>
                      <label className="block text-xs text-gray-500">Collector</label>
                      <select
                        value={sourceForm.collectorId}
                        onChange={(event) => setSourceForm({ ...sourceForm, collectorId: event.target.value })}
                        className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-cyan-500"
                      >
                        <option value="">Select an edge collector</option>
                        {collectors.map((collector) => (
                          <option key={collector.id} value={collector.id}>
                            {collector.name} · {collector.status}{collector.site ? ` · ${collector.site}` : ""}
                          </option>
                        ))}
                      </select>
                      {!collectors.length && <div className="text-xs leading-5 text-gray-500">Register a collector below before binding edge sources.</div>}
                      <div className="rounded-md border border-cyan-500/20 bg-cyan-500/10 p-3 text-xs leading-5 text-cyan-100">
                        Endpoint and credential settings are handled by the enrolled Edge collector. This source only binds Discovery to the registered collector and its uploaded observations.
                      </div>
                    </>
                  )}
                  {sourceForm.type !== "edge" && (
                    <>
                      <label className="block text-xs text-gray-500">Endpoint or connection placeholder</label>
                      <input value={sourceForm.endpoint} onChange={(event) => setSourceForm({ ...sourceForm, endpoint: event.target.value })} className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-cyan-500" placeholder="https://inventory.example/api/assets" />
                      <label className="block text-xs text-gray-500">Credential reference</label>
                      <select
                        value={sourceForm.credentialRef}
                        onChange={(event) => setSourceForm({ ...sourceForm, credentialRef: event.target.value })}
                        className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-cyan-500"
                      >
                        <option value="">Select a Discovery credential</option>
                        {credentialRefOptions.map((credential) => (
                          <option key={credential.ref} value={credential.ref}>
                            {credential.name} · {credential.provider} · {credential.ref}
                          </option>
                        ))}
                      </select>
                      {!credentialRefOptions.length && (
                        <div className="text-xs leading-5 text-gray-500">Create an active Discovery-scoped credential in Admin before testing external sources.</div>
                      )}
                    </>
                  )}
                </>
              )}
              <button onClick={editingSourceId ? updateSource : createSource} className="w-full rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-gray-950 hover:bg-cyan-400">
                {editingSourceId ? "Save source" : "Create source"}
              </button>
            </div>
          </section>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Edge Collectors</h2>
            <div className="space-y-2 rounded-lg border border-gray-800 bg-gray-900 p-4">
              <input value={collectorForm.name} onChange={(event) => setCollectorForm({ ...collectorForm, name: event.target.value })} className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-cyan-500" placeholder="Austin edge collector" />
              <div className="grid grid-cols-2 gap-2">
                <input value={collectorForm.site} onChange={(event) => setCollectorForm({ ...collectorForm, site: event.target.value })} className="rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-cyan-500" placeholder="Site" />
                <input value={collectorForm.version} onChange={(event) => setCollectorForm({ ...collectorForm, version: event.target.value })} className="rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-cyan-500" placeholder="Version" />
              </div>
              <button onClick={registerCollector} className="w-full rounded-md border border-cyan-500/40 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-500/10">Register collector</button>
            </div>
            {collectors.length ? collectors.map((collector) => {
              const lifecycle = collectorLifecycles[collector.id];
              const latestJob = lifecycle?.recentJobs?.[0];
              return (
                <div key={collector.id} className="rounded-lg border border-gray-800 bg-gray-900 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-gray-100">{collector.name}</div>
                      <div className="mt-1 text-xs text-gray-500">{collector.site || "No site"}{collector.version ? ` · v${collector.version}` : ""}</div>
                    </div>
                    <span className={`rounded px-2 py-0.5 text-xs ${collector.status === "healthy" ? "bg-emerald-500/10 text-emerald-300" : collector.status === "degraded" ? "bg-amber-500/10 text-amber-200" : "bg-gray-800 text-gray-400"}`}>{collector.status}</span>
                  </div>
                  <div className="mt-2 text-xs text-gray-500">
                    {collector.lastHeartbeatAt ? `Last heartbeat ${new Date(collector.lastHeartbeatAt).toLocaleString()}` : "No heartbeat received"}
                  </div>
                  <div className="mt-3 rounded-md border border-gray-800 bg-gray-950 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Runtime lifecycle</div>
                      <button onClick={() => loadCollectorLifecycle(collector.id)} className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800">
                        Refresh
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
                      <div className="rounded bg-gray-900 p-2">
                        <div className="text-gray-500">Queued</div>
                        <div className="mt-1 text-base font-semibold text-cyan-200">{lifecycleCount(lifecycle, "queued")}</div>
                      </div>
                      <div className="rounded bg-gray-900 p-2">
                        <div className="text-gray-500">Claimed</div>
                        <div className="mt-1 text-base font-semibold text-amber-200">{lifecycleCount(lifecycle, "claimed")}</div>
                      </div>
                      <div className="rounded bg-gray-900 p-2">
                        <div className="text-gray-500">Done</div>
                        <div className="mt-1 text-base font-semibold text-emerald-200">{lifecycleCount(lifecycle, "succeeded")}</div>
                      </div>
                      <div className="rounded bg-gray-900 p-2">
                        <div className="text-gray-500">Failed</div>
                        <div className="mt-1 text-base font-semibold text-rose-200">{lifecycleCount(lifecycle, "failed") + lifecycleCount(lifecycle, "timed_out") + lifecycleCount(lifecycle, "executor_failed") + lifecycleCount(lifecycle, "invalid_evidence")}</div>
                      </div>
                    </div>
                    <div className="mt-3 text-xs leading-5 text-gray-500">
                      {lifecycle ? (
                        <>
                          <div>{lifecycle.evidence.completeDocuments} complete evidence docs · {lifecycle.evidence.datasets} datasets</div>
                          <div>Latest evidence {freshnessLabel(lifecycle.evidence.latestObservedAt || lifecycle.evidence.latestUploadAt)}</div>
                          {latestJob && <div>Latest job {latestJob.capability} · {latestJob.status} · {edgeJobAge(latestJob)}</div>}
                        </>
                      ) : "Lifecycle has not been loaded yet."}
                    </div>
                  </div>
                  <button
                    onClick={() => queueHostInventory(collector)}
                    disabled={loading}
                    className="mt-3 rounded-md border border-cyan-500/40 px-3 py-1.5 text-xs text-cyan-100 hover:bg-cyan-500/10 disabled:opacity-50"
                  >
                    Queue host inventory
                  </button>
                </div>
              );
            }) : (
              <div className="rounded-lg border border-dashed border-gray-800 p-5 text-center text-sm text-gray-500">No edge collectors registered.</div>
            )}
          </section>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Configured Sources</h2>
            {sources.length ? sources.map((source) => (
              <div key={source.id} className="rounded-lg border border-gray-800 bg-gray-900 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium">{source.name}</div>
                    <div className="mt-1 text-xs text-gray-500">{source.type} · {new Date(source.createdAt).toLocaleDateString()}</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className={`rounded px-2 py-0.5 ${source.lastStatus === "ok" ? "bg-emerald-500/10 text-emerald-300" : source.lastStatus ? "bg-amber-500/10 text-amber-200" : "bg-gray-800 text-gray-400"}`}>
                        {source.lastStatus || "untested"}
                      </span>
                      {source.lastTestedAt && <span className="rounded bg-gray-800 px-2 py-0.5 text-gray-400">tested {new Date(source.lastTestedAt).toLocaleString()}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button onClick={() => applySource(source)} className="rounded-md border border-cyan-500/40 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/10">Use</button>
                    <button onClick={() => editSource(source)} className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800">Edit</button>
                    <button onClick={() => testSource(source)} className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800">Test</button>
                    <button onClick={() => deleteSource(source.id)} className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800">Delete</button>
                  </div>
                </div>
                {source.lastError && <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-100">{source.lastError}</div>}
                {source.config && Object.keys(source.config).length > 0 && (
                  <pre className="mt-3 max-h-36 overflow-auto rounded-md bg-gray-950 p-3 text-xs text-gray-400">{JSON.stringify(source.config, null, 2)}</pre>
                )}
              </div>
            )) : (
              <div className="rounded-lg border border-dashed border-gray-800 p-8 text-center text-sm text-gray-500">No discovery sources configured.</div>
            )}
          </section>
        </main>
      ) : view === "runs" ? (
        <main className="grid flex-1 grid-cols-1 gap-4 overflow-auto p-5 pb-24 lg:grid-cols-[1fr_360px]">
          <section className="space-y-3">
            {orderedJobs.length ? orderedJobs.map((job) => {
              const jobPreview = discoveryJobPreview(job);
              return (
                <div key={job.id} className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-3">
                  <div className="flex items-start gap-4">
                    {statusIcon(job.status)}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{job.status} <span className="text-gray-500">#{job.id.slice(0, 8)}</span></div>
                      <div className="truncate text-xs text-gray-500">{discoveryJobSource(job)}</div>
                      {jobPreview.pipelineName && (
                        <div className="mt-1 truncate text-xs text-cyan-100/70">
                          {jobPreview.pipelineName}{jobPreview.pipelineVersion ? ` · v${jobPreview.pipelineVersion}` : ""}
                        </div>
                      )}
                    </div>
                    <div className="text-right text-xs text-gray-500">{formatDiscoveryJobDate(job)}</div>
                    <button onClick={() => loadStagedJob(job.id)} className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800">Stage</button>
                  </div>
                  {(jobPreview.rows || jobPreview.stagedRecords || jobPreview.relationships || jobPreview.errors || jobPreview.warnings) ? (
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-400">
                      <span className="rounded bg-gray-950 px-2 py-1">{jobPreview.rows} rows</span>
                      <span className="rounded bg-gray-950 px-2 py-1">{jobPreview.stagedRecords} records</span>
                      <span className="rounded bg-gray-950 px-2 py-1">{jobPreview.relationships} links</span>
                      <span className={`rounded px-2 py-1 ${jobPreview.errors ? "bg-rose-500/15 text-rose-200" : "bg-gray-950"}`}>{jobPreview.errors} errors</span>
                      <span className={`rounded px-2 py-1 ${jobPreview.warnings ? "bg-amber-500/15 text-amber-200" : "bg-gray-950"}`}>{jobPreview.warnings} warnings</span>
                    </div>
                  ) : null}
                </div>
              );
            }) : (
              <div className="rounded-lg border border-dashed border-gray-800 p-8 text-center text-sm text-gray-500">No discovery runs yet.</div>
            )}
            {staged && (
              <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-cyan-100">Staged Commit #{staged.job.id.slice(0, 8)}</h2>
                    <p className="mt-1 text-xs text-cyan-100/70">{staged.records.length} records and {staged.relationships.length} relationships staged.</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => discardStagedJob(staged.job.id)} disabled={loading || staged.job.status === "completed"} className="rounded-md border border-rose-500/40 px-3 py-2 text-sm font-medium text-rose-100 hover:bg-rose-500/10 disabled:opacity-50">
                      Discard
                    </button>
                    <button onClick={() => approveAllSafe(staged.job.id)} disabled={loading} className="rounded-md border border-cyan-300/50 px-3 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-500/10 disabled:opacity-50">
                      Approve Safe
                    </button>
                    <button onClick={() => commitStagedJob(staged.job.id)} disabled={loading || staged.records.some((record) => record.status === "blocked") || staged.relationships.some((relationship) => relationship.status === "blocked")} className="rounded-md bg-cyan-400 px-3 py-2 text-sm font-medium text-gray-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50">
                      Commit
                    </button>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                  <div className="rounded-md bg-gray-950/80 p-2">
                    <div className="text-gray-500">Safe records</div>
                    <div className="mt-1 text-lg font-semibold text-emerald-200">{staged.records.filter((record) => !["blocked", "skipped"].includes(record.status)).length}</div>
                  </div>
                  <div className="rounded-md bg-gray-950/80 p-2">
                    <div className="text-gray-500">Blocked records</div>
                    <div className="mt-1 text-lg font-semibold text-amber-200">{staged.records.filter((record) => record.status === "blocked").length}</div>
                  </div>
                  <div className="rounded-md bg-gray-950/80 p-2">
                    <div className="text-gray-500">Safe links</div>
                    <div className="mt-1 text-lg font-semibold text-emerald-200">{staged.relationships.filter((relationship) => relationship.status !== "blocked").length}</div>
                  </div>
                  <div className="rounded-md bg-gray-950/80 p-2">
                    <div className="text-gray-500">Blocked links</div>
                    <div className="mt-1 text-lg font-semibold text-amber-200">{staged.relationships.filter((relationship) => relationship.status === "blocked").length}</div>
                  </div>
                </div>
                <div className="mt-4 max-h-72 space-y-2 overflow-auto">
                  {staged.records.slice(0, 20).map((record) => {
                    const trace = stagedReconciliationTrace(record);
                    return (
                      <div key={record.id} className="rounded-md border border-cyan-500/20 bg-gray-950/80 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-sm text-gray-100">{record.target_class}: {record.name}</span>
                          <span className={`rounded px-2 py-0.5 text-xs ${record.status === "blocked" ? "bg-rose-500/15 text-rose-300" : record.status === "committed" ? "bg-emerald-500/15 text-emerald-300" : "bg-cyan-500/15 text-cyan-200"}`}>{record.status}</span>
                        </div>
                        <div className="mt-1 text-xs text-gray-500">row {record.row_number}{record.environment ? ` · ${record.environment}` : ""}{record.ci_id ? ` · ${record.ci_id}` : ""}{record.committed_ci_id ? ` · ${record.committed_ci_id}` : ""}</div>
                        <div className="mt-1 text-xs text-gray-400">{stagedRecordDecision(record)}</div>
                        <div className="mt-2 rounded border border-gray-800 bg-gray-900/80 p-2">
                          <div className="text-xs font-medium text-cyan-100">Reconciliation</div>
                          <div className="mt-1 text-xs text-gray-400">{trace.reason}</div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {trace.keyChecks.length ? trace.keyChecks.map((item) => (
                              <span key={item.key} className={`rounded px-2 py-1 text-[11px] ${item.present ? "bg-emerald-500/10 text-emerald-200" : "bg-amber-500/10 text-amber-200"}`}>
                                {item.key}: {item.present ? item.value : "empty"}
                              </span>
                            )) : <span className="rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">No reconciliation keys</span>}
                          </div>
                        </div>
                        {[...(record.errors || []), ...(record.warnings || [])].map((issue) => (
                          <div key={issue} className="mt-1 text-xs text-amber-200">{issue}</div>
                        ))}
                        {["staged", "approved"].includes(record.status) && (
                          <button onClick={() => skipStagedRecord(staged.job.id, record.id)} className="mt-2 rounded border border-gray-700 px-2 py-1 text-xs text-gray-400 hover:bg-gray-900">
                            Skip
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {staged.relationships.slice(0, 12).map((relationship) => (
                    <div key={relationship.id} className={`rounded-md border p-3 ${relationship.status === "blocked" ? "border-amber-500/30 bg-amber-500/10" : "border-emerald-500/20 bg-emerald-500/10"}`}>
                      <div className="flex items-center justify-between gap-3">
                        <span className={`truncate text-sm ${relationship.status === "blocked" ? "text-amber-100" : "text-emerald-100"}`}>{relationship.rel_type}: {relationship.target_hint || "missing target"}</span>
                        <span className={`rounded px-2 py-0.5 text-xs ${relationship.status === "blocked" ? "bg-amber-500/15 text-amber-200" : "bg-emerald-500/15 text-emerald-200"}`}>{relationship.status}</span>
                      </div>
                      <div className={`mt-1 text-xs ${relationship.status === "blocked" ? "text-amber-100/70" : "text-emerald-100/70"}`}>row {relationship.row_number} · {relationship.from_class} to {relationship.to_class}</div>
                      {relationship.message && <div className={`mt-1 text-xs ${relationship.status === "blocked" ? "text-amber-100/80" : "text-emerald-100/80"}`}>{relationship.message}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {staged && (
              <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-100">Rollback</h2>
                    <p className="mt-1 text-xs text-gray-500">Restore or remove CMDB changes created by this committed discovery run.</p>
                  </div>
                  <button onClick={() => loadRollbacks(staged.job.id)} className="rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800">
                    Refresh
                  </button>
                </div>
                <div className="mt-4 space-y-2">
                  {rollbacks.length ? rollbacks.map((rollback) => {
                    const rollbackStats = rollback.summary?.rollback;
                    return (
                      <div key={rollback.id} className="rounded-md border border-gray-800 bg-gray-950 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm text-gray-200">Rollback #{rollback.id.slice(0, 8)}</div>
                            <div className="mt-1 text-xs text-gray-500">
                              {rollback.status}
                              {rollback.summary?.created !== undefined ? ` · ${rollback.summary.created} created` : ""}
                              {rollback.summary?.updated !== undefined ? ` · ${rollback.summary.updated} updated` : ""}
                              {rollbackStats ? ` · ${rollbackStats.deleted || 0} deleted · ${rollbackStats.restored || 0} restored` : ""}
                            </div>
                          </div>
                          <button
                            onClick={() => applyRollback(rollback.id, staged.job.id)}
                            disabled={loading || rollback.status === "applied"}
                            className="rounded-md border border-rose-500/50 px-3 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Apply
                          </button>
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="rounded-md border border-dashed border-gray-800 p-5 text-center text-sm text-gray-500">No rollback snapshot for this run.</div>
                  )}
                </div>
              </div>
            )}
          </section>
          <aside className="space-y-3">
            <h2 className="text-sm font-semibold">Saved Pipelines</h2>
            {pipelines.length ? pipelines.map((pipeline) => (
              <div key={pipeline.id} className="rounded-lg border border-gray-800 bg-gray-900 p-3">
                <button onClick={() => loadPipeline(pipeline)} className="block w-full text-left">
                  <div className="text-sm font-medium">{pipeline.name}</div>
                  <div className="mt-1 text-xs text-gray-500">{pipeline.status} · {new Date(pipeline.updated_at || pipeline.updatedAt || Date.now()).toLocaleDateString()}</div>
                </button>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => loadPipeline(pipeline)} className="flex-1 rounded-md border border-gray-700 px-2 py-1.5 text-xs text-gray-300 hover:bg-gray-800">Open</button>
                  <button onClick={() => deletePipeline(pipeline)} className="rounded-md border border-rose-500/40 px-2 py-1.5 text-xs text-rose-200 hover:bg-rose-500/10">Delete</button>
                </div>
              </div>
            )) : (
              <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 text-sm text-gray-500">No saved pipelines.</div>
            )}
          </aside>
        </main>
      ) : (
        <main className="grid min-h-0 flex-1 grid-cols-1 overflow-auto xl:grid-cols-[320px_1fr_360px] xl:overflow-hidden">
          <aside className="flex min-h-0 flex-col border-b border-gray-800 bg-gray-950 xl:border-b-0 xl:border-r">
            <div className="border-b border-gray-800 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <FileSpreadsheet className="h-4 w-4 text-cyan-300" />
                Source Sample
              </div>
              <label className="mb-1 block text-xs text-gray-500">Source name</label>
              <input
                value={sourceName}
                onChange={(event) => setSourceName(event.target.value)}
                className="mb-3 w-full rounded-md border border-gray-800 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-cyan-500"
              />
              <label className="mb-1 block text-xs text-gray-500">Configured source</label>
              <select
                value={selectedSourceId}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value.startsWith("collector:")) {
                    const collector = collectors.find((item) => item.id === value.slice("collector:".length));
                    if (collector) applyCollector(collector);
                    return;
                  }
                  const source = sources.find((item) => item.id === value);
                  if (source) applySource(source);
                  else {
                    setSelectedSourceId("");
                    setSourceName("server-app-inventory.csv");
                    setSample(SAMPLE);
                  }
                }}
                className="mb-3 w-full rounded-md border border-gray-800 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-cyan-500"
              >
                <option value="">Manual sample</option>
                {collectors.length > 0 && (
                  <optgroup label="Registered edge collectors">
                    {collectors.map((collector) => (
                      <option key={collector.id} value={`collector:${collector.id}`}>
                        {collector.name} · {collector.status}
                      </option>
                    ))}
                  </optgroup>
                )}
                {sources.length > 0 && (
                  <optgroup label="Configured sources">
                    {sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
                  </optgroup>
                )}
              </select>
              <textarea
                value={sample}
                onChange={(event) => setSample(event.target.value)}
                spellCheck={false}
                className="h-48 w-full resize-none rounded-md border border-gray-800 bg-gray-900 p-3 font-mono text-xs leading-5 text-gray-200 outline-none focus:border-cyan-500"
              />
              {selectedCollector && (
                <div className="mt-3 rounded-md border border-gray-800 bg-gray-950 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-medium uppercase tracking-wide text-gray-500">Discovery dataset</label>
                    <button
                      onClick={materializeCollectorDataset}
                      className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:border-cyan-500/50 hover:text-cyan-100"
                    >
                      Snapshot latest
                    </button>
                  </div>
                  <select
                    value={selectedDatasetId}
                    onChange={(event) => selectCollectorDataset(event.target.value)}
                    className="mt-2 w-full rounded-md border border-gray-800 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-cyan-500"
                  >
                    <option value="">Latest observations</option>
                    {edgeDatasets.map((dataset) => (
                      <option key={dataset.id} value={dataset.id}>
                        {new Date(dataset.createdAt || dataset.observedEndAt || Date.now()).toLocaleString()} · {entityCountsLabel(dataset.entityCounts)}
                      </option>
                    ))}
                  </select>
                  {selectedDataset && (
                    <div className="mt-2 space-y-1 text-xs text-gray-500">
                      <div>Pinned dataset {selectedDataset.id.slice(0, 8)} · {selectedDataset.status} · {freshnessLabel(selectedDataset.observedEndAt)}</div>
                      <div>Observed {datasetWindowLabel(selectedDataset)}</div>
                      <div>{selectedDataset.documentIds?.length || 0} evidence docs · {selectedDataset.runIds?.length || 0} edge runs · {entityCountsLabel(selectedDataset.entityCounts)}</div>
                    </div>
                  )}
                  {!selectedDataset && (
                    <div className="mt-2 text-xs text-gray-500">
                      Latest observations float with collector uploads. Snapshot a dataset to pin a repeatable test run.
                    </div>
                  )}
                </div>
              )}
              {selectedCollector && edgeProfiles.length > 0 && (
                <div className="mt-3 rounded-md border border-gray-800 bg-gray-950 p-3">
                  <label className="text-xs font-medium uppercase tracking-wide text-gray-500">Edge entity profile</label>
                  <select
                    value={selectedEdgeProfile?.entityType || ""}
                    onChange={(event) => {
                      const next = edgeProfiles.find((item) => item.entityType === event.target.value);
                      if (next) applyEdgeProfile(selectedCollector, next);
                    }}
                    className="mt-2 w-full rounded-md border border-gray-800 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-cyan-500"
                  >
                    {edgeProfiles.map((item) => (
                      <option key={item.entityType} value={item.entityType}>
                        {item.entityType} · {item.recordCount} observations
                      </option>
                    ))}
                  </select>
                  {selectedEdgeProfile && (
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md bg-gray-900 p-2">
                        <span className="text-gray-500">Entity rows</span>
                        <div className="text-lg font-semibold">{selectedEdgeProfile.recordCount}</div>
                      </div>
                      <div className="rounded-md bg-gray-900 p-2">
                        <span className="text-gray-500">Profile fields</span>
                        <div className="text-lg font-semibold">{selectedEdgeProfile.columns.length}</div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md bg-gray-900 p-2"><span className="text-gray-500">Columns</span><div className="text-lg font-semibold">{profile.columns.length}</div></div>
                <div className="rounded-md bg-gray-900 p-2"><span className="text-gray-500">Sample rows</span><div className="text-lg font-semibold">{profile.rows.length}</div></div>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4 pb-24">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Detected Columns</div>
              <div className="flex flex-wrap gap-2">
                {profile.columns.map((column) => (
                  <span key={column} className="rounded-md border border-gray-800 bg-gray-900 px-2 py-1 text-xs text-gray-300">{column}</span>
                ))}
              </div>
              {selectedEdgeProfile && (
                <div className="mt-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Field Quality</div>
                  <div className="space-y-2">
                    {selectedEdgeProfile.fieldStats.slice(0, 10).map((field) => (
                      <div key={field.name} className="rounded-md border border-gray-800 bg-gray-900 p-2">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate font-medium text-gray-300">{field.name}</span>
                          <span className="text-gray-500">{Math.round(field.fillRate * 100)}%</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded bg-gray-800">
                          <div className="h-full rounded bg-cyan-400" style={{ width: `${Math.round(field.fillRate * 100)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <button onClick={loadExample} className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border border-gray-800 px-3 py-2 text-sm text-gray-300 hover:bg-gray-900">
                <Upload className="h-4 w-4" />
                Load Example
              </button>
            </div>
          </aside>

          <section className="relative min-h-[460px] bg-gray-950 xl:min-h-0">
            <div className="absolute left-4 top-4 z-10 flex flex-wrap gap-2">
              <button onClick={draftTransform} disabled={loading} className="flex items-center gap-2 rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-gray-950 hover:bg-cyan-400 disabled:opacity-60">
                <Wand2 className="h-4 w-4" />
                {loading ? "Drafting..." : "AI Draft Transform"}
              </button>
              <div className="relative">
                <button
                  onClick={() => setStepMenuOpen((open) => !open)}
                  className="flex items-center gap-2 rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200 hover:bg-gray-800"
                  aria-expanded={stepMenuOpen}
                >
                  <Plus className="h-4 w-4" />
                  Add Pipeline Step
                </button>
                {stepMenuOpen && (
                  <div className="absolute left-0 top-full mt-2 w-80 rounded-lg border border-gray-800 bg-gray-900 p-2 shadow-2xl">
                    <div className="mb-2 flex items-center gap-2 px-2 py-1 text-xs font-medium uppercase tracking-wide text-gray-500">
                      <Workflow className="h-3.5 w-3.5 text-cyan-300" />
                      Builder steps
                    </div>
                    <div className="max-h-80 overflow-auto pr-1">
                      {NODE_CATALOG.map((item) => {
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.kind}
                            onClick={() => addCanvasNode(item.kind)}
                            className="flex w-full items-start gap-3 rounded-md px-2 py-2 text-left hover:bg-gray-800"
                          >
                            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-950" style={{ color: item.color }}>
                              <Icon className="h-4 w-4" />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-gray-200">{item.title}</span>
                              <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-gray-500">{item.detail}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              <button onClick={undoCanvasChange} className="flex items-center gap-2 rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200 hover:bg-gray-800">
                Undo
              </button>
              <button onClick={previewPipeline} disabled={!proposal || loading} className="flex items-center gap-2 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-50">
                <Eye className="h-4 w-4" />
                Preview
              </button>
              <button onClick={savePipeline} disabled={!proposal} className="flex items-center gap-2 rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200 hover:bg-gray-800 disabled:opacity-50">
                <Save className="h-4 w-4" />
                {currentPipelineId ? "Update" : "Save"}
              </button>
              <button onClick={() => publishPipeline()} disabled={!currentPipelineId || !preview || loading} className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-50">
                <CheckCircle2 className="h-4 w-4" />
                Publish
              </button>
              <button onClick={() => runPipeline()} disabled={!currentPipelineId || !proposal || loading} className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-50">
                <Play className="h-4 w-4" />
                Run
              </button>
            </div>
            <div className="pointer-events-none absolute bottom-4 left-4 z-10 max-w-xs rounded-lg border border-gray-800 bg-gray-900/80 p-3 text-xs text-gray-400 opacity-80 shadow-2xl backdrop-blur">
              <div className="mb-1 flex items-center gap-2 font-medium text-gray-200">
                <MousePointer2 className="h-3.5 w-3.5 text-cyan-300" />
                Canvas is the builder
              </div>
              Drag nodes, connect handles, select a step to configure it, and run node-scoped previews.
            </div>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={handleEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, clickedNode) => setSelectedNodeId(clickedNode.id)}
              onNodeContextMenu={(event, clickedNode) => {
                event.preventDefault();
                setSelectedNodeId(clickedNode.id);
                setDetailNodeId(clickedNode.id);
              }}
              onPaneClick={() => setSelectedNodeId(null)}
              nodesDraggable
              nodesConnectable
              edgesUpdatable
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#374151" gap={18} />
              <Controls position="bottom-right" showInteractive={false} />
            </ReactFlow>
            {detailNode && (
              <PipelineNodeWindow
                node={detailNode}
                proposal={proposal}
                classes={classes}
                sourceFields={editableSourceFields}
                edgeProfiles={edgeProfiles}
                onClose={() => setDetailNodeId(null)}
                onUpdateNode={(patch) => updateCanvasNode(detailNode.id, patch)}
                onAddClassRoute={addClassRoute}
                onUpdateClassRoute={updateClassRoute}
                onDeleteClassRoute={deleteClassRoute}
                onAddMapping={addMapping}
                onUpdateMapping={updateMapping}
                onDeleteMapping={deleteMapping}
                onAddRelationship={addRelationshipRule}
                onUpdateRelationship={updateRelationship}
                onDeleteRelationship={deleteRelationship}
                onAddReconciliation={addReconciliationRule}
                onUpdateReconciliation={updateReconciliation}
                onDeleteReconciliation={deleteReconciliation}
              />
            )}
          </section>

          <aside className="min-h-0 overflow-auto border-t border-gray-800 bg-gray-950 p-4 pb-24 xl:border-l xl:border-t-0">
            <NodeInspector
              selectedNode={selectedNode}
              onChange={(patch) => selectedNode && updateCanvasNode(selectedNode.id, patch)}
              onRun={(kind) => runNodeAction(kind)}
              onDuplicate={duplicateSelectedNode}
              onDelete={deleteSelectedNode}
              edgeCount={selectedNode ? edges.filter((item) => item.source === selectedNode.id || item.target === selectedNode.id).length : 0}
              currentPipelineId={currentPipelineId}
              schedule={schedule}
              onScheduleChange={setSchedule}
              onSaveSchedule={() => saveSchedule()}
              saving={loading}
            />

            <section className="mb-4 rounded-lg border border-gray-800 bg-gray-900 p-3">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-200">
                <Route className="h-4 w-4 text-cyan-300" />
                Mapping Profiles
              </div>
              <div className="flex gap-2">
                <input
                  value={mappingProfileName}
                  onChange={(event) => setMappingProfileName(event.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-cyan-500"
                />
                <button onClick={saveMappingProfile} disabled={!proposal} className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-gray-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50">
                  Save
                </button>
              </div>
              <div className="mt-3 max-h-48 space-y-2 overflow-auto">
                {mappingProfiles.length ? mappingProfiles.map((profile) => (
                  <div key={profile.id} className="rounded-md border border-gray-800 bg-gray-950 p-2">
                    <div className="flex items-start justify-between gap-2">
                      <button onClick={() => applyMappingProfile(profile.id)} className="min-w-0 flex-1 text-left">
                        <div className="truncate text-sm text-gray-200">{profile.name}</div>
                        <div className="mt-1 truncate text-xs text-gray-500">{profile.sourceType} · {profile.targetClasses.join(", ") || "generic"}</div>
                      </button>
                      <button onClick={() => deleteMappingProfile(profile.id)} className="rounded border border-gray-800 p-1.5 text-gray-500 hover:border-rose-500/50 hover:text-rose-300" aria-label={`Delete ${profile.name}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )) : (
                  <div className="rounded-md border border-dashed border-gray-800 p-4 text-center text-sm text-gray-500">No saved mapping profiles.</div>
                )}
              </div>
            </section>

            <div className="mb-4 flex items-center gap-2">
              <Bot className="h-5 w-5 text-cyan-300" />
              <div>
                <h2 className="text-sm font-semibold">Transform Review</h2>
                <p className="text-xs text-gray-500">AI drafts, Specora validates, users approve.</p>
              </div>
            </div>

            {proposal ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-gray-800 bg-gray-900 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{proposal.title}</span>
                    <span className="rounded bg-cyan-500/10 px-2 py-1 text-xs text-cyan-300">{pct(proposal.confidence)}</span>
                  </div>
                  <p className="mt-2 text-sm text-gray-400">{proposal.summary}</p>
                  <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
                    <Sparkles className="h-3.5 w-3.5" />
                    {proposal.aiGenerated ? "Model-generated draft" : "Heuristic draft; configure AI for model routing"}
                  </div>
                </div>

                <ReviewBlock icon={<Database className="h-4 w-4" />} title="Class Routes">
                  {proposal.classRoutes.map((route) => (
                    <ReviewRow key={route.targetClass} primary={route.targetClass} secondary={route.rationale} metric={pct(route.confidence)} />
                  ))}
                  <button onClick={() => setDetailNodeId("classify")} className="mt-2 w-full rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800">
                    Edit class routes
                  </button>
                </ReviewBlock>

                <ReviewBlock icon={<Play className="h-4 w-4" />} title="Field Mappings">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <PreviewMetric label="Rules" value={proposal.fieldMappings.length} />
                    <PreviewMetric label="Classes" value={new Set(proposal.fieldMappings.map((mapping) => mapping.targetClass)).size} />
                  </div>
                  <button onClick={() => setDetailNodeId("map")} className="mt-2 w-full rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800">
                    Edit field mappings
                  </button>
                </ReviewBlock>

                <ReviewBlock icon={<Link2 className="h-4 w-4" />} title="Relationship Rules">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <PreviewMetric label="Rules" value={proposal.relationshipRules.length} />
                    <PreviewMetric label="Targets" value={new Set(proposal.relationshipRules.map((rule) => rule.toClass)).size} />
                  </div>
                  <button onClick={() => setDetailNodeId("link")} className="mt-2 w-full rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800">
                    Edit relationship rules
                  </button>
                </ReviewBlock>

                <ReviewBlock icon={<GitBranch className="h-4 w-4" />} title="Reconciliation Rules">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <PreviewMetric label="Rules" value={proposal.reconciliationRules.length} />
                    <PreviewMetric label="Keys" value={new Set(proposal.reconciliationRules.flatMap((rule) => rule.matchKeys)).size} />
                  </div>
                  <button onClick={() => setDetailNodeId("reconcile")} className="mt-2 w-full rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800">
                    Edit reconciliation
                  </button>
                </ReviewBlock>

                {preview && (
                  <ReviewBlock icon={<Eye className="h-4 w-4" />} title="Preview">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <PreviewMetric label="Rows" value={preview.summary.rows} />
                      <PreviewMetric label="Records" value={preview.summary.stagedRecords} />
                      <PreviewMetric label="Links" value={preview.summary.relationshipCandidates} />
                      <PreviewMetric label="Issues" value={preview.summary.errors + preview.summary.warnings} />
                    </div>
                    <div className="mt-3 max-h-64 space-y-2 overflow-auto">
                      {preview.records.slice(0, 8).map((record) => {
                        const trace = previewReconciliationTrace(record);
                        return (
                          <div key={`${record.row}-${record.targetClass}-${record.name}`} className="rounded-md bg-gray-950 p-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm text-gray-200">{record.targetClass}: {record.name}</span>
                              <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${record.errors.length ? "bg-rose-500/10 text-rose-300" : "bg-emerald-500/10 text-emerald-300"}`}>{record.action}</span>
                            </div>
                            <div className="mt-1 text-xs text-gray-500">row {record.row} · keys {record.matchKeys.join(", ") || "none"}</div>
                            <div className="mt-1 text-xs text-gray-400">{previewRecordDecision(record)}</div>
                            <div className="mt-2 rounded border border-gray-800 bg-gray-900/80 p-2">
                              <div className="text-xs font-medium text-cyan-100">Reconciliation</div>
                              <div className="mt-1 text-xs text-gray-400">{trace.reason}</div>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {trace.keyChecks.length ? trace.keyChecks.map((item) => (
                                  <span key={item.key} className={`rounded px-2 py-1 text-[11px] ${item.present ? "bg-emerald-500/10 text-emerald-200" : "bg-amber-500/10 text-amber-200"}`}>
                                    {item.key}: {item.present ? item.value : "empty"}
                                  </span>
                                )) : <span className="rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">No reconciliation keys</span>}
                              </div>
                            </div>
                            {[...record.errors, ...record.warnings].map((issue) => <div key={issue} className="mt-1 text-xs text-amber-200">{issue}</div>)}
                          </div>
                        );
                      })}
                      {preview.relationships.slice(0, 8).map((relationship, index) => (
                        <div key={`${relationship.row}-${relationship.type}-${relationship.targetHint}-${index}`} className={`rounded-md border p-2 ${relationshipStatusClass(relationship.status)}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm">{relationship.type}: {relationship.targetHint || "missing target"}</span>
                            <span className="shrink-0 rounded bg-gray-950/70 px-2 py-0.5 text-xs">{relationshipStatusLabel(relationship.status)}</span>
                          </div>
                          <div className="mt-1 text-xs opacity-70">
                            row {relationship.row} · {relationship.fromClass} to {relationship.toClass}
                          </div>
                          {relationship.message && <div className="mt-1 text-xs opacity-90">{relationship.message}</div>}
                        </div>
                      ))}
                    </div>
                  </ReviewBlock>
                )}

                {risks.length > 0 && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-200">
                      <AlertTriangle className="h-4 w-4" />
                      Review Before Commit
                    </div>
                    {risks.map((risk) => <p key={risk} className="text-sm text-amber-100/80">{risk}</p>)}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-gray-800 p-5 text-sm text-gray-500">
                Paste a representative source sample, then generate an AI transform. The draft will appear here with mappings, class routes, relationship rules, and confidence.
              </div>
            )}
          </aside>
        </main>
      )}
    </div>
  );
}

function ReviewBlock({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-3">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-200">
        <span className="text-cyan-300">{icon}</span>
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function NodeInspector({
  selectedNode,
  onChange,
  onRun,
  onDuplicate,
  onDelete,
  edgeCount,
  currentPipelineId,
  schedule,
  onScheduleChange,
  onSaveSchedule,
  saving,
}: {
  selectedNode: Node<DiscoveryFlowNodeData> | null;
  onChange: (patch: Partial<DiscoveryFlowNodeData>) => void;
  onRun: (kind: DiscoveryNodeKind) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  edgeCount: number;
  currentPipelineId: string | null;
  schedule: PipelineSchedule;
  onScheduleChange: (schedule: PipelineSchedule) => void;
  onSaveSchedule: () => void;
  saving: boolean;
}) {
  if (!selectedNode) {
    return (
      <section className="mb-4 rounded-lg border border-dashed border-gray-800 bg-gray-900/60 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-200">
          <MousePointer2 className="h-4 w-4 text-cyan-300" />
          Select a canvas step
        </div>
        <p className="mt-2 text-sm text-gray-500">Click a node to configure its role, run its local action, duplicate it, or remove it from the pipeline definition.</p>
      </section>
    );
  }

  const catalog = catalogFor(selectedNode.data.kind);
  const Icon = catalog.icon;
  const titleId = `discovery-node-title-${selectedNode.id}`;
  const detailId = `discovery-node-detail-${selectedNode.id}`;
  const kindId = `discovery-node-kind-${selectedNode.id}`;
  const actionLabel =
    selectedNode.data.kind === "transform" || selectedNode.data.kind === "router" ? "AI draft from here" :
    selectedNode.data.kind === "validator" || selectedNode.data.kind === "stage" ? "Preview through here" :
    selectedNode.data.kind === "target" ? "Run published target" :
    selectedNode.data.kind === "schedule" ? "Save schedule" :
    "Run step check";

  return (
    <section className="mb-4 rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-950" style={{ color: selectedNode.data.color }}>
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-cyan-50">Canvas Inspector</h2>
            <p className="text-xs text-cyan-100/60">{edgeCount} connected edge{edgeCount === 1 ? "" : "s"}</p>
          </div>
        </div>
        <button onClick={onDelete} className="rounded-md p-2 text-cyan-100/70 hover:bg-rose-500/20 hover:text-rose-200" title="Delete node">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3">
        <label htmlFor={kindId} className="block text-xs text-cyan-100/60">Step type</label>
        <select
          id={kindId}
          value={selectedNode.data.kind}
          onChange={(event) => {
            const kind = event.target.value as DiscoveryNodeKind;
            const next = catalogFor(kind);
            onChange({ kind, title: next.title, detail: next.detail, color: next.color });
          }}
          className="w-full rounded-md border border-cyan-500/20 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan-400"
        >
          {NODE_CATALOG.map((item) => <option key={item.kind} value={item.kind}>{item.title}</option>)}
        </select>

        <label htmlFor={titleId} className="block text-xs text-cyan-100/60">Title</label>
        <input
          id={titleId}
          value={selectedNode.data.title}
          onChange={(event) => onChange({ title: event.target.value })}
          className="w-full rounded-md border border-cyan-500/20 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan-400"
        />

        <label htmlFor={detailId} className="block text-xs text-cyan-100/60">Behavior note</label>
        <textarea
          id={detailId}
          value={selectedNode.data.detail}
          onChange={(event) => onChange({ detail: event.target.value })}
          className="h-20 w-full resize-none rounded-md border border-cyan-500/20 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan-400"
        />

        {selectedNode.data.kind === "schedule" && (
          <div className="rounded-lg border border-cyan-500/20 bg-gray-950 p-3">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-cyan-50">Pipeline trigger</div>
                <div className="mt-1 text-xs leading-5 text-cyan-100/60">
                  {currentPipelineId ? "Configure when this saved pipeline should run." : "Save the pipeline before enabling a recurring trigger."}
                </div>
              </div>
              <label className="flex shrink-0 items-center gap-2 text-xs text-cyan-100/80">
                <input
                  type="checkbox"
                  checked={schedule.enabled}
                  onChange={(event) => onScheduleChange({ ...schedule, enabled: event.target.checked })}
                  disabled={!currentPipelineId}
                />
                Enabled
              </label>
            </div>

            <label className="block text-xs text-cyan-100/60">Frequency</label>
            <select
              value={schedule.interval}
              onChange={(event) => onScheduleChange({ ...schedule, interval: event.target.value })}
              disabled={!currentPipelineId}
              className="mt-1 w-full rounded-md border border-cyan-500/20 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan-400 disabled:opacity-50"
            >
              <option value="manual">Manual only</option>
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>

            <label className="mt-3 block text-xs text-cyan-100/60">Next run</label>
            <input
              type="datetime-local"
              value={schedule.next_run_at ? schedule.next_run_at.slice(0, 16) : ""}
              onChange={(event) => onScheduleChange({ ...schedule, next_run_at: event.target.value ? new Date(event.target.value).toISOString() : null })}
              disabled={!currentPipelineId || schedule.interval === "manual"}
              className="mt-1 w-full rounded-md border border-cyan-500/20 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan-400 disabled:opacity-50"
            />

            <button
              onClick={onSaveSchedule}
              disabled={!currentPipelineId || saving}
              className="mt-3 w-full rounded-md bg-cyan-400 px-3 py-2 text-sm font-medium text-gray-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Save trigger
            </button>

            <div className="mt-3 space-y-1 text-xs text-cyan-100/60">
              {schedule.last_run_at && <div>Last run {new Date(schedule.last_run_at).toLocaleString()}</div>}
              {schedule.last_status && <div>Last status {schedule.last_status}{schedule.last_discovery_job_id ? ` · ${schedule.last_discovery_job_id.slice(0, 8)}` : ""}</div>}
              {schedule.last_error && <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-rose-200">{schedule.last_error}</div>}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => onRun(selectedNode.data.kind)} className="flex items-center justify-center gap-2 rounded-md bg-cyan-400 px-3 py-2 text-sm font-medium text-gray-950 hover:bg-cyan-300">
            <Play className="h-4 w-4" />
            {actionLabel}
          </button>
          <button onClick={onDuplicate} className="flex items-center justify-center gap-2 rounded-md border border-cyan-500/30 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-500/10">
            <Plus className="h-4 w-4" />
            Duplicate
          </button>
        </div>
      </div>
    </section>
  );
}

function ReviewRow({ primary, secondary, metric }: { primary: string; secondary: string; metric: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-gray-950 px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm text-gray-200">{primary}</div>
        <div className="truncate text-xs text-gray-500">{secondary}</div>
      </div>
      <span className="shrink-0 text-xs text-gray-400">{metric}</span>
    </div>
  );
}

function MappingEditor({
  mapping,
  classes,
  columns,
  onChange,
  onDelete,
}: {
  mapping: TransformProposal["fieldMappings"][number];
  classes: TargetClass[];
  columns: string[];
  onChange: (patch: Partial<TransformProposal["fieldMappings"][number]>) => void;
  onDelete?: () => void;
}) {
  return (
    <div className="rounded-md bg-gray-950 p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-400">{mapping.sourceField} to {mapping.targetClass}.{mapping.targetField}</span>
        {onDelete && (
          <button onClick={onDelete} className="rounded p-1 text-gray-500 hover:bg-rose-500/10 hover:text-rose-300" aria-label="Delete field mapping">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select value={mapping.sourceField} onChange={(event) => onChange({ sourceField: event.target.value })} className="min-w-0 rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs">
          {Array.from(new Set([...columns, mapping.sourceField])).map((column) => <option key={column} value={column}>{column}</option>)}
        </select>
        <select value={mapping.targetClass} onChange={(event) => onChange({ targetClass: event.target.value })} className="rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs">
          {classes.map((cls) => <option key={cls.name} value={cls.name}>{cls.displayName || cls.name}</option>)}
          {!classes.some((cls) => cls.name === mapping.targetClass) && <option value={mapping.targetClass}>{mapping.targetClass}</option>}
        </select>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <input value={mapping.targetField} onChange={(event) => onChange({ targetField: event.target.value })} className="rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs outline-none focus:border-cyan-500" />
        <select value={mapping.transform} onChange={(event) => onChange({ transform: event.target.value })} className="rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs">
          {["trim", "trim_lowercase", "normalize_environment"].map((transform) => <option key={transform} value={transform}>{transform}</option>)}
        </select>
      </div>
      <RationalePanel
        confidence={mapping.confidence}
        rationale={mapping.rationale}
        evidence={mapping.evidence}
        alternatives={mapping.alternatives}
      />
    </div>
  );
}

function RelationshipEditor({
  rule,
  classes,
  columns,
  onChange,
  onDelete,
}: {
  rule: TransformProposal["relationshipRules"][number];
  classes: TargetClass[];
  columns: string[];
  onChange: (patch: Partial<TransformProposal["relationshipRules"][number]>) => void;
  onDelete?: () => void;
}) {
  const classNames = classes.map((cls) => cls.name);
  return (
    <div className="rounded-md bg-gray-950 p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-400">{rule.fromClass} {rule.type} {rule.toClass}</span>
        {onDelete && (
          <button onClick={onDelete} className="rounded p-1 text-gray-500 hover:bg-rose-500/10 hover:text-rose-300" aria-label="Delete relationship rule">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <select value={rule.fromClass} onChange={(event) => onChange({ fromClass: event.target.value })} className="rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs">
          {Array.from(new Set([...classNames, rule.fromClass])).map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select value={rule.type} onChange={(event) => onChange({ type: event.target.value })} className="rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs">
          {["DEPENDS_ON", "HOSTED_ON", "OWNED_BY", "MANAGED_BY", "PART_OF", "LOCATED_AT"].map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <select value={rule.toClass} onChange={(event) => onChange({ toClass: event.target.value })} className="rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs">
          {Array.from(new Set([...classNames, rule.toClass])).map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </div>
      <select value={rule.sourceField} onChange={(event) => onChange({ sourceField: event.target.value })} className="mt-2 w-full rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs">
        {Array.from(new Set([...columns, rule.sourceField])).map((column) => <option key={column} value={column}>{column}</option>)}
      </select>
      <RationalePanel confidence={rule.confidence} rationale={rule.rationale} evidence={rule.evidence} />
    </div>
  );
}

function ClassRouteEditor({
  route,
  classes,
  onChange,
  onDelete,
}: {
  route: TransformProposal["classRoutes"][number];
  classes: TargetClass[];
  onChange: (patch: Partial<TransformProposal["classRoutes"][number]>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-md bg-gray-950 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-400">{route.sourcePattern || "route"} to {route.targetClass}</span>
        <button onClick={onDelete} className="rounded p-1 text-gray-500 hover:bg-rose-500/10 hover:text-rose-300" aria-label="Delete class route">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input value={route.sourcePattern} onChange={(event) => onChange({ sourcePattern: event.target.value })} className="rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs outline-none focus:border-cyan-500" />
        <select value={route.targetClass} onChange={(event) => onChange({ targetClass: event.target.value })} className="rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs">
          {Array.from(new Set([...classes.map((cls) => cls.name), route.targetClass])).map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </div>
      <textarea value={route.rationale} onChange={(event) => onChange({ rationale: event.target.value })} className="mt-2 h-16 w-full resize-none rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs outline-none focus:border-cyan-500" />
      <label className="mt-2 block text-[11px] text-gray-500">Confidence {pct(route.confidence)}</label>
      <input type="range" min="0" max="1" step="0.01" value={route.confidence} onChange={(event) => onChange({ confidence: Number(event.target.value) })} className="w-full" />
    </div>
  );
}

function ReconciliationEditor({
  rule,
  classes,
  onChange,
  onDelete,
}: {
  rule: TransformProposal["reconciliationRules"][number];
  classes: TargetClass[];
  onChange: (patch: Partial<TransformProposal["reconciliationRules"][number]>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-md bg-gray-950 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-400">{rule.targetClass} by {rule.matchKeys.join(", ") || "no keys"}</span>
        <button onClick={onDelete} className="rounded p-1 text-gray-500 hover:bg-rose-500/10 hover:text-rose-300" aria-label="Delete reconciliation rule">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select value={rule.targetClass} onChange={(event) => onChange({ targetClass: event.target.value })} className="rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs">
          {Array.from(new Set([...classes.map((cls) => cls.name), rule.targetClass])).map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select value={rule.strategy} onChange={(event) => onChange({ strategy: event.target.value })} className="rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs">
          {["create_or_update", "update", "review"].map((strategy) => <option key={strategy} value={strategy}>{strategy}</option>)}
        </select>
      </div>
      <input
        value={rule.matchKeys.join(", ")}
        onChange={(event) => onChange({ matchKeys: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })}
        className="mt-2 w-full rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs outline-none focus:border-cyan-500"
        placeholder="name, ipAddress"
      />
    </div>
  );
}

function PipelineNodeWindow({
  node,
  proposal,
  classes,
  sourceFields,
  edgeProfiles,
  onClose,
  onUpdateNode,
  onAddClassRoute,
  onUpdateClassRoute,
  onDeleteClassRoute,
  onAddMapping,
  onUpdateMapping,
  onDeleteMapping,
  onAddRelationship,
  onUpdateRelationship,
  onDeleteRelationship,
  onAddReconciliation,
  onUpdateReconciliation,
  onDeleteReconciliation,
}: {
  node: Node<DiscoveryFlowNodeData>;
  proposal: TransformProposal | null;
  classes: TargetClass[];
  sourceFields: string[];
  edgeProfiles: EdgeObservationProfile[];
  onClose: () => void;
  onUpdateNode: (patch: Partial<DiscoveryFlowNodeData>) => void;
  onAddClassRoute: () => void;
  onUpdateClassRoute: (index: number, patch: Partial<TransformProposal["classRoutes"][number]>) => void;
  onDeleteClassRoute: (index: number) => void;
  onAddMapping: () => void;
  onUpdateMapping: (index: number, patch: Partial<TransformProposal["fieldMappings"][number]>) => void;
  onDeleteMapping: (index: number) => void;
  onAddRelationship: () => void;
  onUpdateRelationship: (index: number, patch: Partial<TransformProposal["relationshipRules"][number]>) => void;
  onDeleteRelationship: (index: number) => void;
  onAddReconciliation: () => void;
  onUpdateReconciliation: (index: number, patch: Partial<TransformProposal["reconciliationRules"][number]>) => void;
  onDeleteReconciliation: (index: number) => void;
}) {
  const catalog = catalogFor(node.data.kind);
  const Icon = catalog.icon;
  return (
    <div className="absolute inset-4 z-30 overflow-hidden rounded-lg border border-gray-700 bg-gray-950 shadow-2xl">
      <div className="flex items-center justify-between border-b border-gray-800 bg-gray-900 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gray-950" style={{ color: node.data.color }}>
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-gray-100">{node.data.title}</div>
            <div className="truncate text-xs text-gray-500">Right-click node detail · {node.data.kind}</div>
          </div>
        </div>
        <button onClick={onClose} className="rounded-md p-2 text-gray-400 hover:bg-gray-800 hover:text-gray-100" aria-label="Close node details">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid h-[calc(100%-58px)] min-h-0 grid-cols-1 xl:grid-cols-[320px_1fr]">
        <div className="border-b border-gray-800 p-4 xl:border-b-0 xl:border-r">
          <label className="block text-xs text-gray-500">Title</label>
          <input value={node.data.title} onChange={(event) => onUpdateNode({ title: event.target.value })} className="mt-1 w-full rounded-md border border-gray-800 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-cyan-500" />
          <label className="mt-3 block text-xs text-gray-500">Behavior note</label>
          <textarea value={node.data.detail} onChange={(event) => onUpdateNode({ detail: event.target.value })} className="mt-1 h-28 w-full resize-none rounded-md border border-gray-800 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-cyan-500" />
          <div className="mt-4 rounded-md border border-gray-800 bg-gray-900 p-3 text-xs leading-5 text-gray-400">
            Use this window for full pipeline editing. The sidebar remains a preview/status surface.
          </div>
        </div>

        <div className="min-h-0 overflow-auto p-4">
          {!proposal ? (
            <div className="rounded-lg border border-dashed border-gray-800 p-8 text-center text-sm text-gray-500">Draft a transform before editing routes, mappings, relationships, or reconciliation.</div>
          ) : node.data.kind === "profile" ? (
            <div className="space-y-3">
              {(proposal.entityPlan || []).map((entity, index) => (
                <div key={`${entity.sourceEntity}-${index}`} className="rounded-md border border-gray-800 bg-gray-900 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-gray-100">{entity.sourceEntity}</span>
                    <span className="rounded bg-cyan-500/10 px-2 py-1 text-xs text-cyan-300">{entity.treatment}</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">{entity.target || "no target"}{entity.cardinality ? ` · ${entity.cardinality}` : ""}</div>
                  <p className="mt-2 text-sm leading-5 text-gray-400">{entity.rationale}</p>
                </div>
              ))}
              {edgeProfiles.map((profile) => (
                <div key={profile.entityType} className="rounded-md border border-gray-800 bg-gray-900 p-3">
                  <div className="text-sm font-medium text-gray-100">{profile.entityType}</div>
                  <div className="mt-1 text-xs text-gray-500">{profile.recordCount} records · {profile.columns.length} fields</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {profile.columns.slice(0, 24).map((column) => <span key={column} className="rounded bg-gray-950 px-2 py-1 text-[11px] text-gray-400">{column}</span>)}
                  </div>
                </div>
              ))}
            </div>
          ) : node.data.kind === "router" ? (
            <EditorSection title="Class Routes" onAdd={onAddClassRoute} addLabel="Add class route">
              {proposal.classRoutes.map((route, index) => (
                <ClassRouteEditor key={`${route.targetClass}-${index}`} route={route} classes={classes} onChange={(patch) => onUpdateClassRoute(index, patch)} onDelete={() => onDeleteClassRoute(index)} />
              ))}
            </EditorSection>
          ) : node.data.kind === "transform" ? (
            <EditorSection title="Field Mappings" onAdd={onAddMapping} addLabel="Add field mapping">
              {proposal.fieldMappings.map((mapping, index) => (
                <MappingEditor key={`${mapping.sourceField}-${index}`} mapping={mapping} classes={classes} columns={sourceFields} onChange={(patch) => onUpdateMapping(index, patch)} onDelete={() => onDeleteMapping(index)} />
              ))}
            </EditorSection>
          ) : node.data.kind === "linker" ? (
            <EditorSection title="Relationship Rules" onAdd={onAddRelationship} addLabel="Add relationship rule">
              {proposal.relationshipRules.map((rule, index) => (
                <RelationshipEditor key={`${rule.fromClass}-${rule.type}-${rule.toClass}-${index}`} rule={rule} classes={classes} columns={sourceFields} onChange={(patch) => onUpdateRelationship(index, patch)} onDelete={() => onDeleteRelationship(index)} />
              ))}
            </EditorSection>
          ) : node.data.kind === "reconcile" ? (
            <EditorSection title="Reconciliation Rules" onAdd={onAddReconciliation} addLabel="Add reconciliation rule">
              {proposal.reconciliationRules.map((rule, index) => (
                <ReconciliationEditor key={`${rule.targetClass}-${index}`} rule={rule} classes={classes} onChange={(patch) => onUpdateReconciliation(index, patch)} onDelete={() => onDeleteReconciliation(index)} />
              ))}
            </EditorSection>
          ) : (
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 text-sm leading-6 text-gray-400">
              This node does not have a specialized pipeline editor yet. Use the left panel for node metadata and the sidebar for preview/run controls.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EditorSection({ title, children, onAdd, addLabel }: { title: string; children: ReactNode; onAdd: () => void; addLabel: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-100">{title}</h3>
        <button onClick={onAdd} className="flex items-center gap-2 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-500/20">
          <Plus className="h-4 w-4" />
          {addLabel}
        </button>
      </div>
      {children}
    </div>
  );
}

function RationalePanel({ confidence, rationale, evidence, alternatives }: { confidence: number; rationale?: string; evidence?: string[]; alternatives?: string[] }) {
  const cleanEvidence = (evidence || []).filter(Boolean).slice(0, 3);
  const cleanAlternatives = (alternatives || []).filter(Boolean).slice(0, 3);
  return (
    <div className="mt-2 rounded border border-gray-800 bg-gray-900/70 px-2 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-gray-600">Rationale</span>
        <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[11px] text-cyan-300">{pct(confidence)}</span>
      </div>
      <p className="mt-1 text-xs leading-5 text-gray-400">{rationale || "No detailed rationale was supplied for this saved mapping."}</p>
      {cleanEvidence.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {cleanEvidence.map((item, index) => (
            <span key={`${item}-${index}`} className="max-w-full truncate rounded bg-gray-950 px-2 py-1 font-mono text-[11px] text-gray-500">
              {item}
            </span>
          ))}
        </div>
      )}
      {cleanAlternatives.length > 0 && (
        <div className="mt-2 text-[11px] text-gray-600">
          Alternatives: <span className="text-gray-500">{cleanAlternatives.join(", ")}</span>
        </div>
      )}
    </div>
  );
}

function PreviewMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-gray-950 p-2">
      <div className="text-gray-500">{label}</div>
      <div className="text-lg font-semibold text-gray-100">{value}</div>
    </div>
  );
}
