import type { ShellAPI } from "@/sdk/types";
import { CLASSES_QUERY, DISCOVERY_QUERY } from "./queries";
import type {
  DiscoveryCollector,
  DiscoveryCredentialReference,
  DiscoveryJob,
  DiscoverySource,
  EdgeCollectorLifecycle,
  MappingProfile,
  PipelineRecord,
  TargetClass,
} from "./types";

type DiscoveryApi = Pick<ShellAPI, "query" | "fetch">;

export async function loadDiscoveryRecords(api: DiscoveryApi): Promise<{ sources: DiscoverySource[]; jobs: DiscoveryJob[] }> {
  const data = await api.query(DISCOVERY_QUERY);
  return {
    sources: (data.discoverySources || []) as DiscoverySource[],
    jobs: (data.discoveryJobs || []) as DiscoveryJob[],
  };
}

export async function loadDiscoveryClasses(api: DiscoveryApi): Promise<TargetClass[]> {
  const data = await api.query(CLASSES_QUERY);
  return (data.ciClasses || []) as TargetClass[];
}

export async function loadDiscoveryPipelines(api: DiscoveryApi): Promise<PipelineRecord[]> {
  const res = await api.fetch("/discovery/pipelines");
  if (!res.ok) throw new Error(`Pipeline request failed: ${res.status}`);
  return await res.json();
}

export async function loadMappingProfiles(api: DiscoveryApi): Promise<MappingProfile[]> {
  const res = await api.fetch("/discovery/mapping-profiles");
  if (!res.ok) throw new Error(`Mapping profile request failed: ${res.status}`);
  const data = await res.json();
  return data.profiles || [];
}

export async function loadCredentialReferences(api: DiscoveryApi): Promise<DiscoveryCredentialReference[]> {
  const res = await api.fetch("/discovery/credential-references");
  if (!res.ok) throw new Error(`Credential request failed: ${res.status}`);
  const data = await res.json();
  return data.credentials || [];
}

export async function loadCollectors(api: DiscoveryApi): Promise<DiscoveryCollector[]> {
  const res = await api.fetch("/discovery/collectors");
  if (!res.ok) throw new Error(`Collector request failed: ${res.status}`);
  const data = await res.json();
  return (data.collectors || []) as DiscoveryCollector[];
}

export async function loadCollectorLifecycle(api: DiscoveryApi, collectorId: string): Promise<EdgeCollectorLifecycle> {
  const res = await api.fetch(`/discovery/collectors/${collectorId}/jobs`);
  if (!res.ok) throw new Error(`Collector lifecycle request failed: ${res.status}`);
  return await res.json();
}

