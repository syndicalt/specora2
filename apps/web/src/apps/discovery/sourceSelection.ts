import { SAMPLE } from "./constants";
import { edgeCollectorSample, normalizeSourceConfig, profileToCsv, rowsToCsv } from "./helpers";
import type { DiscoveryCollector, DiscoveryDataset, DiscoverySource, EdgeObservationProfile } from "./types";

export type SourceSelectionPatch = {
  selectedSourceId?: string;
  selectedDatasetId?: string;
  selectedEdgeEntityType?: string;
  sourceName: string;
  sample: string;
  edgeProfiles?: EdgeObservationProfile[];
  edgeDatasets?: DiscoveryDataset[];
};

export function sourceSelectionPatch(source: DiscoverySource, collectors: DiscoveryCollector[]): SourceSelectionPatch {
  const config = normalizeSourceConfig(source.config);
  let sample = SAMPLE;
  if (typeof config.sample === "string") {
    sample = config.sample;
  } else if (Array.isArray(config.rows)) {
    const columns = Array.isArray(config.columns) ? config.columns.map(String) : Object.keys(config.rows[0] || {});
    sample = rowsToCsv(columns, config.rows as Record<string, unknown>[]);
  } else if (source.type === "edge") {
    sample = edgeCollectorSample(collectors.find((collector) => collector.id === config.collectorId) || null);
  }
  return {
    selectedSourceId: source.id,
    selectedDatasetId: "",
    selectedEdgeEntityType: "",
    sourceName: source.name,
    sample,
    edgeProfiles: [],
    edgeDatasets: [],
  };
}

export function edgeProfileSelectionPatch(collector: DiscoveryCollector, profile: EdgeObservationProfile): SourceSelectionPatch {
  return {
    selectedEdgeEntityType: profile.entityType,
    sourceName: `${collector.name} · ${profile.entityType}`,
    sample: profileToCsv(profile),
  };
}

export function datasetProfileSelectionPatch(collector: DiscoveryCollector, dataset: DiscoveryDataset, profile: EdgeObservationProfile): SourceSelectionPatch {
  return {
    selectedDatasetId: dataset.id,
    selectedEdgeEntityType: profile.entityType,
    sourceName: `${collector.name} · ${profile.entityType}`,
    sample: profileToCsv(profile),
    edgeProfiles: dataset.profiles || [],
  };
}

export function collectorSchemaSelectionPatch(collector: DiscoveryCollector): SourceSelectionPatch {
  return {
    sourceName: collector.name,
    sample: edgeCollectorSample(collector),
    selectedDatasetId: "",
    selectedEdgeEntityType: "",
    edgeProfiles: [],
    edgeDatasets: [],
  };
}

