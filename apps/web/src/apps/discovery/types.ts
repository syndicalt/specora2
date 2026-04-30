import type { Edge, Node } from "reactflow";

export type DiscoveryJob = {
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

export type TargetClass = {
  name: string;
  displayName?: string;
  attributes?: Array<{ name: string; isMandatory?: boolean; isKeyAttribute?: boolean }>;
};

export type DiscoverySource = {
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

export type DiscoveryCredentialReference = {
  id: string;
  ref: string;
  name: string;
  provider: string;
  lastTestedAt?: string | null;
  lastStatus?: string | null;
  lastError?: string | null;
};

export type DiscoveryCollector = {
  id: string;
  name: string;
  status: string;
  site?: string;
  version?: string;
  labels?: Record<string, unknown>;
  lastHeartbeatAt?: string | null;
  lastSeenIp?: string | null;
};

export type EdgeCollectorLifecycle = {
  collectorId: string;
  summary: Record<string, number>;
  recentJobs: Array<{
    id: string;
    status: string;
    capability: string;
    priority: number;
    attempt: number;
    failureCode?: string | null;
    detail?: string | null;
    issuedAt?: string | null;
    expiresAt?: string | null;
    updatedAt?: string | null;
    createdAt?: string | null;
  }>;
  evidence: {
    documents: number;
    completeDocuments: number;
    latestUploadAt?: string | null;
    datasets: number;
    latestObservedAt?: string | null;
  };
};

export type EdgeObservationProfile = {
  entityType: string;
  recordCount: number;
  columns: string[];
  sampleRows: Record<string, unknown>[];
  fieldStats: Array<{ name: string; fillRate: number; distinctCount?: number; examples?: string[] }>;
  recentObservedAt?: string | null;
};

export type DiscoveryDataset = {
  id: string;
  collectorId: string;
  name: string;
  status: string;
  observedStartAt?: string | null;
  observedEndAt?: string | null;
  documentIds?: string[];
  runIds?: string[];
  entityCounts: Record<string, number>;
  profiles: EdgeObservationProfile[];
  createdAt?: string;
};

export type SourceForm = { name: string; type: string; sample: string; endpoint: string; credentialRef: string; collectorId: string };

export type TransformProposal = {
  title: string;
  summary: string;
  confidence: number;
  sourceProfile?: { entityProfiles?: EdgeObservationProfile[] };
  entityPlan?: Array<{ sourceEntity: string; treatment: string; target?: string; parentEntity?: string; cardinality?: string; rationale: string; confidence: number }>;
  classRoutes: Array<{ sourcePattern: string; targetClass: string; confidence: number; rationale: string }>;
  fieldMappings: Array<{ sourceField: string; targetClass: string; targetField: string; transform: string; confidence: number; rationale?: string; evidence?: string[]; alternatives?: string[] }>;
  relationshipRules: Array<{ fromClass: string; toClass: string; type: string; sourceField: string; confidence: number; rationale?: string; evidence?: string[] }>;
  reconciliationRules: Array<{ targetClass: string; matchKeys: string[]; strategy: string }>;
  assumptions: string[];
  risks: string[];
  aiGenerated: boolean;
};

export type PipelineRecord = {
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

export type PipelineSchedule = {
  pipeline_id?: string;
  enabled: boolean;
  interval: string;
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_discovery_job_id?: string | null;
  last_status?: string | null;
  last_error?: string | null;
};

export type PipelineDefinition = {
  source?: { id?: string; name?: string; type?: string; collectorId?: string; datasetId?: string; entityType?: string };
  sourceName?: string;
  sample?: { columns?: string[]; rows?: Record<string, unknown>[] };
  entityProfiles?: EdgeObservationProfile[];
  proposal?: TransformProposal | null;
  flow?: { nodes: Node[]; edges: Edge[] };
};

export type PipelinePreview = {
  summary: { rows: number; stagedRecords: number; relationshipCandidates: number; errors: number; warnings: number };
  records: Array<{ row: number; action: string; targetClass: string; name: string; environment?: string; attributes: Record<string, unknown>; matchKeys: string[]; errors: string[]; warnings: string[] }>;
  relationships: Array<{ row: number; fromClass: string; toClass: string; type: string; sourceField: string; targetHint: string; confidence: number; status?: "unchecked" | "ready" | "will_create_target" | "missing_target"; message?: string }>;
};

export type DiscoveryNodeKind = "source" | "profile" | "transform" | "router" | "validator" | "linker" | "reconcile" | "stage" | "target" | "schedule";

export type DiscoveryFlowNodeData = {
  kind: DiscoveryNodeKind;
  title: string;
  detail: string;
  color: string;
  metric?: string;
  status?: "idle" | "ready" | "warning" | "error" | "success";
  label?: string;
};

export type StagedDiscoveryJob = {
  job: DiscoveryJob;
  records: Array<{ id: string; row_number: number; action?: string; target_class: string; ci_id?: string | null; name: string; environment?: string; attributes?: Record<string, unknown>; match_keys?: string[]; status: string; errors?: string[]; warnings?: string[]; committed_ci_id?: string }>;
  relationships: Array<{ id: string; row_number: number; rel_type: string; from_class: string; to_class: string; target_hint?: string; status: string; message?: string }>;
};

export type DiscoveryRollback = {
  id: string;
  discovery_job_id: string;
  status: string;
  summary?: Record<string, any>;
  created_at?: string;
  applied_at?: string | null;
};

export type MappingProfile = {
  id: string;
  name: string;
  description?: string;
  sourceType: string;
  targetClasses: string[];
  mapping: TransformProposal;
  updatedAt?: string;
};

export type FlowSnapshot = {
  nodes: Node<DiscoveryFlowNodeData>[];
  edges: Edge[];
};

