"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import type { ShellAPI } from "@/sdk/types";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  Database,
  FileCheck2,
  Eye,
  FileSpreadsheet,
  GitBranch,
  GitCommitHorizontal,
  Link2,
  Map as MapIcon,
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
  type LucideIcon,
} from "lucide-react";

type DiscoveryJob = {
  id: string;
  sourceId?: string | null;
  source_id?: string | null;
  filePath?: string | null;
  file_path?: string | null;
  status: string;
  stats?: Record<string, unknown>;
  createdAt?: string | null;
  created_at?: string | null;
  updatedAt?: string | null;
  updated_at?: string | null;
};

type TargetClass = {
  name: string;
  displayName?: string;
  attributes?: Array<{ name: string; isMandatory?: boolean; isKeyAttribute?: boolean }>;
};

type DiscoverySource = {
  id: string;
  name: string;
  type: string;
  config?: Record<string, unknown>;
  credentialRef?: string | null;
  lastTestedAt?: string | null;
  lastStatus?: string | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt?: string;
};

type DiscoveryCredentialReference = {
  id: string;
  ref: string;
  name: string;
  provider: string;
  lastTestedAt?: string | null;
  lastStatus?: string | null;
  lastError?: string | null;
};

type DiscoveryCollector = {
  id: string;
  name: string;
  status: string;
  site?: string;
  version?: string;
  labels?: Record<string, unknown>;
  lastHeartbeatAt?: string | null;
  lastSeenIp?: string | null;
};

type EdgeObservationProfile = {
  entityType: string;
  recordCount: number;
  columns: string[];
  sampleRows: Record<string, unknown>[];
  fieldStats: Array<{ name: string; fillRate: number; distinctCount?: number; examples?: string[] }>;
  recentObservedAt?: string | null;
};

type SourceForm = { name: string; type: string; sample: string; endpoint: string; credentialRef: string; collectorId: string };

type TransformProposal = {
  title: string;
  summary: string;
  confidence: number;
  classRoutes: Array<{ sourcePattern: string; targetClass: string; confidence: number; rationale: string }>;
  fieldMappings: Array<{ sourceField: string; targetClass: string; targetField: string; transform: string; confidence: number; rationale?: string; evidence?: string[]; alternatives?: string[] }>;
  relationshipRules: Array<{ fromClass: string; toClass: string; type: string; sourceField: string; confidence: number; rationale?: string; evidence?: string[] }>;
  reconciliationRules: Array<{ targetClass: string; matchKeys: string[]; strategy: string }>;
  assumptions: string[];
  risks: string[];
  aiGenerated: boolean;
};

type PipelineRecord = {
  id: string;
  name: string;
  description?: string;
  status: string;
  version?: number;
  definition: PipelineDefinition;
  published_definition?: PipelineDefinition | null;
  publishedDefinition?: PipelineDefinition | null;
  last_published_at?: string | null;
  lastPublishedAt?: string | null;
  last_run_at?: string | null;
  lastRunAt?: string | null;
  updated_at?: string;
  updatedAt?: string;
};

type PipelineSchedule = {
  pipeline_id?: string;
  enabled: boolean;
  interval: string;
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_discovery_job_id?: string | null;
  last_status?: string | null;
  last_error?: string | null;
};

type PipelineDefinition = {
  source?: { id?: string; name?: string; type?: string; collectorId?: string; entityType?: string };
  sourceName?: string;
  sample?: { columns?: string[]; rows?: Record<string, unknown>[] };
  entityProfiles?: EdgeObservationProfile[];
  proposal?: TransformProposal | null;
  flow?: { nodes: Node[]; edges: Edge[] };
};

type PipelinePreview = {
  summary: { rows: number; stagedRecords: number; relationshipCandidates: number; errors: number; warnings: number };
  records: Array<{ row: number; action: string; targetClass: string; name: string; environment?: string; attributes: Record<string, unknown>; matchKeys: string[]; errors: string[]; warnings: string[] }>;
  relationships: Array<{ row: number; fromClass: string; toClass: string; type: string; sourceField: string; targetHint: string; confidence: number; status?: "unchecked" | "ready" | "will_create_target" | "missing_target"; message?: string }>;
};

type DiscoveryNodeKind = "source" | "profile" | "transform" | "router" | "validator" | "linker" | "reconcile" | "stage" | "target" | "schedule";

type DiscoveryFlowNodeData = {
  kind: DiscoveryNodeKind;
  title: string;
  detail: string;
  color: string;
  metric?: string;
  status?: "idle" | "ready" | "warning" | "error" | "success";
  label?: string;
};

type StagedDiscoveryJob = {
  job: DiscoveryJob;
  records: Array<{ id: string; row_number: number; target_class: string; name: string; environment?: string; status: string; errors?: string[]; warnings?: string[]; committed_ci_id?: string }>;
  relationships: Array<{ id: string; row_number: number; rel_type: string; from_class: string; to_class: string; target_hint?: string; status: string; message?: string }>;
};

type DiscoveryRollback = {
  id: string;
  discovery_job_id: string;
  status: string;
  summary?: Record<string, any>;
  created_at?: string;
  applied_at?: string | null;
};

type MappingProfile = {
  id: string;
  name: string;
  description?: string;
  sourceType: string;
  targetClasses: string[];
  mapping: TransformProposal;
  updatedAt?: string;
};

type FlowSnapshot = {
  nodes: Node<DiscoveryFlowNodeData>[];
  edges: Edge[];
};

const SAMPLE = `hostname,ip_addr,os,app_name,db_host,environment,business_owner
web01,10.20.1.15,Ubuntu,Billing Portal,sql01,Production,Finance Apps
web02,10.20.1.16,Ubuntu,Billing Portal,sql01,Production,Finance Apps
api01,10.20.2.21,RHEL,Claims API,pg01,Production,Claims Platform`;

const EDGE_HOST_SAMPLE = `hostname,ip_addr,os,os_version,collector_id,status,last_seen_at,capabilities
edge-host-01,192.168.1.20,Linux,Ubuntu 24.04,edge-collector,up,2026-04-28T00:00:00Z,collector.query.osquery
edge-host-02,192.168.1.21,Linux,Ubuntu 24.04,edge-collector,up,2026-04-28T00:00:00Z,collector.query.osquery`;

const DISCOVERY_QUERY = `query DiscoveryBuilderData {
  discoverySources { id name type config credentialRef lastTestedAt lastStatus lastError createdAt updatedAt }
  discoveryJobs { id sourceId filePath status stats createdAt updatedAt }
}`;

const CLASSES_QUERY = `query DiscoveryClassData {
  ciClasses {
    name
    displayName
    attributes { name isMandatory isKeyAttribute }
  }
}`;

const CREATE_SOURCE = `mutation CreateDiscoverySource($name: String!, $type: String!, $config: JSON) {
  createDiscoverySource(name: $name, type: $type, config: $config) { id name type config credentialRef lastTestedAt lastStatus lastError createdAt updatedAt }
}`;

const UPDATE_SOURCE = `mutation UpdateDiscoverySource($id: ID!, $name: String!, $type: String!, $config: JSON) {
  updateDiscoverySource(id: $id, name: $name, type: $type, config: $config) { id name type config credentialRef lastTestedAt lastStatus lastError createdAt updatedAt }
}`;

const DELETE_SOURCE = `mutation DeleteDiscoverySource($id: ID!) {
  deleteDiscoverySource(id: $id)
}`;

function parseCsv(text: string): { columns: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const columns = (lines[0] || "").split(",").map((column) => column.trim()).filter(Boolean);
  const rows = lines.slice(1, 11).map((line) => {
    const values = line.split(",");
    return Object.fromEntries(columns.map((column, index) => [column, values[index]?.trim() || ""]));
  });
  return { columns, rows };
}

function rowsToCsv(columns: string[], rows: Record<string, unknown>[]): string {
  return [columns.join(","), ...rows.map((row) => columns.map((column) => String(row[column] ?? "")).join(","))].join("\n");
}

function edgeCollectorSample(collector: DiscoveryCollector | null): string {
  if (!collector) return EDGE_HOST_SAMPLE;
  const lastSeenAt = collector.lastHeartbeatAt || new Date().toISOString();
  const capabilities = Array.isArray(collector.labels?.capabilities)
    ? collector.labels.capabilities.join("|")
    : "collector.query.osquery";
  return rowsToCsv(
    ["hostname", "ip_addr", "os", "os_version", "collector_id", "status", "last_seen_at", "capabilities"],
    [{
      hostname: `${collector.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "edge"}-host`,
      ip_addr: collector.lastSeenIp || "",
      os: "Linux",
      os_version: collector.version || "",
      collector_id: collector.id,
      status: collector.status === "healthy" ? "up" : collector.status || "registered",
      last_seen_at: lastSeenAt,
      capabilities,
    }]
  );
}

function profileToCsv(profile: EdgeObservationProfile): string {
  const columns = profile.columns.length ? profile.columns : Array.from(new Set(profile.sampleRows.flatMap((row) => Object.keys(row))));
  return rowsToCsv(columns, profile.sampleRows);
}

function sourceConfigFromForm(form: SourceForm) {
  if (form.type === "csv" || form.type === "manual") {
    const parsed = parseCsv(form.sample);
    return { sample: form.sample, columns: parsed.columns, rows: parsed.rows };
  }
  if (form.type === "edge") {
    return {
      collectorId: form.collectorId || null,
      placeholder: true,
    };
  }
  return {
    endpoint: form.endpoint,
    credentialRef: form.credentialRef || null,
    collectorId: form.collectorId || null,
    placeholder: true,
  };
}

function normalizeSourceConfig(config?: Record<string, unknown> | string | null): Record<string, any> {
  if (!config) return {};
  if (typeof config === "string") {
    try {
      return JSON.parse(config);
    } catch {
      return {};
    }
  }
  return config as Record<string, any>;
}

function sourceFormFromSource(source: DiscoverySource): SourceForm {
  const config = normalizeSourceConfig(source.config);
  const rows = Array.isArray(config.rows) ? config.rows : [];
  const columns = Array.isArray(config.columns) ? config.columns : [];
  return {
    name: source.name,
    type: source.type,
    sample: String(config.sample || (columns.length && rows.length ? rowsToCsv(columns, rows) : SAMPLE)),
    endpoint: String(config.endpoint || ""),
    credentialRef: String(config.credentialRef || source.credentialRef || ""),
    collectorId: String(config.collectorId || ""),
  };
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

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

function discoveryJobSource(job: DiscoveryJob): string {
  return job.filePath || job.file_path || "No source file recorded";
}

function discoveryJobTimestamp(job: DiscoveryJob): number {
  const raw = job.createdAt || job.created_at || job.updatedAt || job.updated_at;
  if (!raw) return 0;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatDiscoveryJobDate(job: DiscoveryJob): string {
  const timestamp = discoveryJobTimestamp(job);
  return timestamp ? new Date(timestamp).toLocaleString() : "No timestamp";
}

const NODE_CATALOG: Array<{
  kind: DiscoveryNodeKind;
  title: string;
  detail: string;
  color: string;
  icon: LucideIcon;
}> = [
  { kind: "schedule", title: "Trigger / Schedule", detail: "Run manually, interval-based, or integration-triggered", color: "#94a3b8", icon: Clock },
  { kind: "source", title: "Source", detail: "Read rows from CSV, API, DB, or cloud inventory", color: "#38bdf8", icon: FileSpreadsheet },
  { kind: "profile", title: "Profile", detail: "Infer schema, keys, cardinality, and data quality", color: "#a78bfa", icon: FileCheck2 },
  { kind: "transform", title: "Transform", detail: "Normalize fields, map attributes, and enrich rows", color: "#6366f1", icon: MapIcon },
  { kind: "router", title: "Class Router", detail: "Route records to CI classes with rules or AI rationale", color: "#f59e0b", icon: Route },
  { kind: "validator", title: "Validate", detail: "Block bad rows before they reach staging", color: "#fb7185", icon: AlertTriangle },
  { kind: "linker", title: "Linker", detail: "Create CSDM relationships and dependency edges", color: "#14b8a6", icon: Link2 },
  { kind: "reconcile", title: "Reconcile", detail: "Match existing CIs and decide create/update strategy", color: "#eab308", icon: GitCommitHorizontal },
  { kind: "stage", title: "Stage", detail: "Preview safe changes before commit", color: "#22c55e", icon: Eye },
  { kind: "target", title: "Target", detail: "Commit into CMDB classes and relationship types", color: "#10b981", icon: Database },
];

function catalogFor(kind: DiscoveryNodeKind) {
  return NODE_CATALOG.find((item) => item.kind === kind) || NODE_CATALOG[0];
}

function node(
  id: string,
  label: string,
  detail: string,
  x: number,
  y: number,
  color = "#6366f1",
  kind: DiscoveryNodeKind = "transform",
  metric?: string
): Node<DiscoveryFlowNodeData> {
  return {
    id,
    type: "discoveryNode",
    position: { x, y },
    data: { kind, title: label, detail, color, metric, status: metric ? "ready" : "idle" },
    style: {
      width: 190,
      minHeight: 72,
      borderRadius: 8,
      border: `1px solid ${color}`,
      background: "#111827",
      color: "#f3f4f6",
      fontSize: 12,
      whiteSpace: "pre-line",
      boxShadow: "0 12px 36px rgba(0,0,0,.22)",
    },
  };
}

function edge(id: string, source: string, target: string): Edge {
  return {
    id,
    source,
    target,
    animated: true,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: "#818cf8" },
  };
}

function sideBetween(source: Node, target: Node): "top" | "right" | "bottom" | "left" {
  const dx = target.position.x - source.position.x;
  const dy = target.position.y - source.position.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

function oppositeSide(side: "top" | "right" | "bottom" | "left") {
  if (side === "top") return "bottom";
  if (side === "bottom") return "top";
  if (side === "left") return "right";
  return "left";
}

function withDynamicEdgeHandles(edges: Edge[], nodes: Node[]): Edge[] {
  const byId = new Map(nodes.map((item) => [item.id, item]));
  return edges.map((item) => {
    const source = byId.get(item.source);
    const target = byId.get(item.target);
    if (!source || !target) return item;
    const sourceHandle = sideBetween(source, target);
    return {
      ...item,
      sourceHandle,
      targetHandle: oppositeSide(sourceHandle),
    };
  });
}

function proposalToFlow(proposal: TransformProposal | null, sourceName: string): { nodes: Node[]; edges: Edge[] } {
  if (!proposal) {
    return {
      nodes: [
        node("source", "1. Source", sourceName || "Paste or upload sample data", 20, 120, "#38bdf8"),
        node("profile", "2. Profile", "Detect columns, quality, keys", 260, 120, "#a78bfa", "profile"),
        node("ai", "3. AI Draft", "Generate mappings and routes", 500, 120, "#f59e0b", "transform"),
        node("stage", "4. Stage", "Preview create/update/link", 740, 120, "#22c55e", "stage"),
      ],
      edges: [edge("e1", "source", "profile"), edge("e2", "profile", "ai"), edge("e3", "ai", "stage")],
    };
  }

  const nodes: Node[] = [
    node("source", "Source", sourceName, 20, 140, "#38bdf8", "source", `${proposal.classRoutes.length} routes`),
    node("profile", "Profile", `${proposal.fieldMappings.length} mapped fields`, 250, 140, "#a78bfa", "profile", `${proposal.fieldMappings.length} fields`),
    node("classify", "Class Router", proposal.classRoutes.map((r) => r.targetClass).join(", "), 480, 60, "#f59e0b", "router", pct(Math.max(...proposal.classRoutes.map((r) => r.confidence), proposal.confidence))),
    node("map", "Transform", `${proposal.fieldMappings.length} field rules`, 480, 220, "#6366f1", "transform", `${proposal.fieldMappings.length} rules`),
    node("link", "Linker", `${proposal.relationshipRules.length} relationship rules`, 710, 60, "#14b8a6", "linker", `${proposal.relationshipRules.length} links`),
    node("reconcile", "Reconcile", proposal.reconciliationRules.map((r) => r.matchKeys.join("+")).join(", "), 710, 220, "#eab308", "reconcile", `${proposal.reconciliationRules.length} keys`),
    node("stage", "Stage", `Confidence ${pct(proposal.confidence)}`, 940, 140, "#22c55e", "stage", pct(proposal.confidence)),
  ];

  return {
    nodes,
    edges: [
      edge("e-source-profile", "source", "profile"),
      edge("e-profile-classify", "profile", "classify"),
      edge("e-profile-map", "profile", "map"),
      edge("e-classify-link", "classify", "link"),
      edge("e-map-reconcile", "map", "reconcile"),
      edge("e-link-stage", "link", "stage"),
      edge("e-reconcile-stage", "reconcile", "stage"),
    ],
  };
}

function keepPositions(nextNodes: Node[], currentNodes: Node[]) {
  const positions = new Map(currentNodes.map((item) => [item.id, item.position]));
  return nextNodes.map((item) => positions.has(item.id) ? { ...item, position: positions.get(item.id)! } : item);
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
  const [edgeProfiles, setEdgeProfiles] = useState<EdgeObservationProfile[]>([]);
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
  const [stepMenuOpen, setStepMenuOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"builder" | "pipelines" | "runs" | "sources">("builder");
  const loadErrorRef = useRef("");
  const classLoadErrorRef = useRef(false);

  const profile = useMemo(() => parseCsv(sample), [sample]);
  const selectedSource = useMemo(() => sources.find((source) => source.id === selectedSourceId) || null, [sources, selectedSourceId]);
  const selectedCollectorId = selectedSourceId.startsWith("collector:") ? selectedSourceId.slice("collector:".length) : "";
  const selectedCollector = useMemo(() => collectors.find((collector) => collector.id === selectedCollectorId) || null, [collectors, selectedCollectorId]);
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
        ? { id: `collector:${selectedCollector.id}`, collectorId: selectedCollector.id, name: selectedCollector.name, type: "edge", entityType: selectedEdgeProfile?.entityType }
        : { name: sourceName, type: "manual" },
    sourceName,
    sample: profile,
    entityProfiles: selectedCollector ? edgeProfiles : undefined,
    proposal,
    flow: { nodes, edges },
  }), [selectedSource, selectedCollector, selectedEdgeProfile, sourceName, profile, edgeProfiles, proposal, nodes, edges]);

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
        setCollectors(collectorData.collectors || []);
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
          entityProfiles: selectedCollector ? edgeProfiles : undefined,
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
    setCurrentPipelineId(pipeline.id);
    setSelectedSourceId(saved.source?.id || "");
    setEdgeProfiles([]);
    setSelectedEdgeEntityType("");
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

  async function applyCollector(collector: DiscoveryCollector) {
    setSelectedSourceId(`collector:${collector.id}`);
    setSourceName(collector.name);
    setEdgeProfiles([]);
    setSelectedEdgeEntityType("");
    try {
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
    } catch {
      setSample(edgeCollectorSample(collector));
      shell.notify("Edge observations could not be loaded; using collector schema sample", "error");
    }
    setProposal(null);
    setPreview(null);
    setStaged(null);
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
            {collectors.length ? collectors.map((collector) => (
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
                <button
                  onClick={() => queueHostInventory(collector)}
                  disabled={loading}
                  className="mt-3 rounded-md border border-cyan-500/40 px-3 py-1.5 text-xs text-cyan-100 hover:bg-cyan-500/10 disabled:opacity-50"
                >
                  Queue host inventory
                </button>
              </div>
            )) : (
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
            {orderedJobs.length ? orderedJobs.map((job) => (
              <div key={job.id} className="flex items-center gap-4 rounded-lg border border-gray-800 bg-gray-900 px-4 py-3">
                {statusIcon(job.status)}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{job.status} <span className="text-gray-500">#{job.id.slice(0, 8)}</span></div>
                  <div className="truncate text-xs text-gray-500">{discoveryJobSource(job)}</div>
                </div>
                <div className="text-right text-xs text-gray-500">{formatDiscoveryJobDate(job)}</div>
                <button onClick={() => loadStagedJob(job.id)} className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800">Stage</button>
              </div>
            )) : (
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
                    <button onClick={() => approveAllSafe(staged.job.id)} disabled={loading} className="rounded-md border border-cyan-300/50 px-3 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-500/10 disabled:opacity-50">
                      Approve Safe
                    </button>
                    <button onClick={() => commitStagedJob(staged.job.id)} disabled={loading || staged.records.some((record) => record.status === "blocked") || staged.relationships.some((relationship) => relationship.status === "blocked")} className="rounded-md bg-cyan-400 px-3 py-2 text-sm font-medium text-gray-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50">
                      Commit
                    </button>
                  </div>
                </div>
                <div className="mt-4 max-h-72 space-y-2 overflow-auto">
                  {staged.records.slice(0, 20).map((record) => (
                    <div key={record.id} className="rounded-md border border-cyan-500/20 bg-gray-950/80 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm text-gray-100">{record.target_class}: {record.name}</span>
                        <span className={`rounded px-2 py-0.5 text-xs ${record.status === "blocked" ? "bg-rose-500/15 text-rose-300" : record.status === "committed" ? "bg-emerald-500/15 text-emerald-300" : "bg-cyan-500/15 text-cyan-200"}`}>{record.status}</span>
                      </div>
                      <div className="mt-1 text-xs text-gray-500">row {record.row_number}{record.environment ? ` · ${record.environment}` : ""}{record.committed_ci_id ? ` · ${record.committed_ci_id}` : ""}</div>
                      {["staged", "approved"].includes(record.status) && (
                        <button onClick={() => skipStagedRecord(staged.job.id, record.id)} className="mt-2 rounded border border-gray-700 px-2 py-1 text-xs text-gray-400 hover:bg-gray-900">
                          Skip
                        </button>
                      )}
                    </div>
                  ))}
                  {staged.relationships.filter((relationship) => relationship.status === "blocked").slice(0, 8).map((relationship) => (
                    <div key={relationship.id} className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm text-amber-100">{relationship.rel_type}: {relationship.target_hint || "missing target"}</span>
                        <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-200">blocked</span>
                      </div>
                      <div className="mt-1 text-xs text-amber-100/70">row {relationship.row_number} · {relationship.from_class} to {relationship.to_class}</div>
                      {relationship.message && <div className="mt-1 text-xs text-amber-100/80">{relationship.message}</div>}
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
              <button key={pipeline.id} onClick={() => loadPipeline(pipeline)} className="block w-full rounded-lg border border-gray-800 bg-gray-900 p-3 text-left hover:border-cyan-500/50">
                <div className="text-sm font-medium">{pipeline.name}</div>
                <div className="mt-1 text-xs text-gray-500">{pipeline.status} · {new Date(pipeline.updated_at || pipeline.updatedAt || Date.now()).toLocaleDateString()}</div>
              </button>
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
                </ReviewBlock>

                <ReviewBlock icon={<Play className="h-4 w-4" />} title="Field Mappings">
                  {proposal.fieldMappings.map((mapping, index) => (
                    <MappingEditor
                      key={`${mapping.sourceField}-${index}`}
                      mapping={mapping}
                      classes={classes}
                      columns={profile.columns}
                      onChange={(patch) => updateMapping(index, patch)}
                    />
                  ))}
                </ReviewBlock>

                <ReviewBlock icon={<Link2 className="h-4 w-4" />} title="Relationship Rules">
                  {proposal.relationshipRules.length ? proposal.relationshipRules.map((rule, index) => (
                    <RelationshipEditor
                      key={`${rule.fromClass}-${rule.type}-${rule.toClass}-${index}`}
                      rule={rule}
                      classes={classes}
                      columns={profile.columns}
                      onChange={(patch) => updateRelationship(index, patch)}
                    />
                  )) : <p className="text-sm text-gray-500">No relationships proposed yet.</p>}
                  <button onClick={addRelationshipRule} className="mt-2 w-full rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800">
                    Add relationship rule
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
                      {preview.records.slice(0, 8).map((record) => (
                        <div key={`${record.row}-${record.targetClass}-${record.name}`} className="rounded-md bg-gray-950 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm text-gray-200">{record.targetClass}: {record.name}</span>
                            <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${record.errors.length ? "bg-rose-500/10 text-rose-300" : "bg-emerald-500/10 text-emerald-300"}`}>{record.action}</span>
                          </div>
                          <div className="mt-1 text-xs text-gray-500">row {record.row} · keys {record.matchKeys.join(", ")}</div>
                          {[...record.errors, ...record.warnings].map((issue) => <div key={issue} className="mt-1 text-xs text-amber-200">{issue}</div>)}
                        </div>
                      ))}
                      {preview.relationships.filter((relationship) => relationship.status === "missing_target").slice(0, 6).map((relationship, index) => (
                        <div key={`${relationship.row}-${relationship.type}-${relationship.targetHint}-${index}`} className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm text-amber-100">{relationship.type}: {relationship.targetHint || "missing target"}</span>
                            <span className="shrink-0 rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-200">missing target</span>
                          </div>
                          <div className="mt-1 text-xs text-amber-100/70">
                            row {relationship.row} · {relationship.fromClass} to {relationship.toClass}
                          </div>
                          {relationship.message && <div className="mt-1 text-xs text-amber-100/80">{relationship.message}</div>}
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
}: {
  mapping: TransformProposal["fieldMappings"][number];
  classes: TargetClass[];
  columns: string[];
  onChange: (patch: Partial<TransformProposal["fieldMappings"][number]>) => void;
}) {
  return (
    <div className="rounded-md bg-gray-950 p-2">
      <div className="grid grid-cols-2 gap-2">
        <select value={mapping.sourceField} onChange={(event) => onChange({ sourceField: event.target.value })} className="rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs">
          {columns.map((column) => <option key={column} value={column}>{column}</option>)}
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
}: {
  rule: TransformProposal["relationshipRules"][number];
  classes: TargetClass[];
  columns: string[];
  onChange: (patch: Partial<TransformProposal["relationshipRules"][number]>) => void;
}) {
  const classNames = classes.map((cls) => cls.name);
  return (
    <div className="rounded-md bg-gray-950 p-2">
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
