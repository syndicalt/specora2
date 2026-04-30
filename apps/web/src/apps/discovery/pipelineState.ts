import type { Edge, Node } from "reactflow";
import { rowsToCsv } from "./helpers";
import type {
  DiscoveryCollector,
  DiscoveryFlowNodeData,
  DiscoverySource,
  EdgeObservationProfile,
  PipelineDefinition,
  PipelineRecord,
  TransformProposal,
} from "./types";

export function buildPipelineDefinition({
  selectedSource,
  selectedCollector,
  selectedDatasetId,
  selectedEdgeProfile,
  sourceName,
  profile,
  edgeProfiles,
  proposal,
  nodes,
  edges,
}: {
  selectedSource: DiscoverySource | null;
  selectedCollector: DiscoveryCollector | null;
  selectedDatasetId: string;
  selectedEdgeProfile: EdgeObservationProfile | null;
  sourceName: string;
  profile: { columns?: string[]; rows?: Record<string, unknown>[] };
  edgeProfiles: EdgeObservationProfile[];
  proposal: TransformProposal | null;
  nodes: Node<DiscoveryFlowNodeData>[];
  edges: Edge[];
}): PipelineDefinition {
  return {
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
  };
}

export function loadedPipelineState(pipeline: PipelineRecord) {
  const saved = pipeline.definition || {};
  const savedSample = saved.sample || {};
  const columns = savedSample.columns || Object.keys(savedSample.rows?.[0] || {});
  const edgeProfiles = saved.entityProfiles || saved.proposal?.sourceProfile?.entityProfiles || [];
  return {
    id: pipeline.id,
    selectedSourceId: saved.source?.id || "",
    edgeProfiles,
    selectedDatasetId: saved.source?.datasetId || "",
    selectedEdgeEntityType: saved.source?.entityType || edgeProfiles[0]?.entityType || "",
    sourceName: saved.sourceName || pipeline.name,
    sample: rowsToCsv(columns, savedSample.rows || []),
    proposal: saved.proposal || null,
    flow: saved.flow,
  };
}

