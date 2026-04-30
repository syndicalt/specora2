import type { ShellAPI } from "@/sdk/types";
import { CLASSES_QUERY, DISCOVERY_QUERY } from "./queries";
import type {
  DiscoveryCollector,
  DiscoveryCredentialReference,
  DiscoveryDataset,
  DiscoveryJob,
  DiscoveryRollback,
  DiscoverySource,
  EdgeCollectorLifecycle,
  EdgeObservationProfile,
  MappingProfile,
  PipelineDefinition,
  PipelinePreview,
  PipelineRecord,
  PipelineSchedule,
  StagedDiscoveryJob,
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

export async function loadCollectorDatasets(api: DiscoveryApi, collectorId: string): Promise<DiscoveryDataset[]> {
  const res = await api.fetch(`/discovery/collectors/${collectorId}/datasets`);
  if (!res.ok) throw new Error(`Dataset request failed: ${res.status}`);
  const data = await res.json();
  return (data.datasets || []) as DiscoveryDataset[];
}

export async function loadCollectorProfiles(api: DiscoveryApi, collectorId: string): Promise<{ profiles: EdgeObservationProfile[]; totalObservations: number }> {
  const res = await api.fetch(`/discovery/collectors/${collectorId}/profile`);
  if (!res.ok) throw new Error(`Profile request failed: ${res.status}`);
  const data = await res.json();
  return {
    profiles: (data.profiles || []) as EdgeObservationProfile[],
    totalObservations: Number(data.totalObservations || 0),
  };
}

export async function createCollectorDataset(api: DiscoveryApi, collectorId: string): Promise<DiscoveryDataset> {
  const res = await api.fetch(`/discovery/collectors/${collectorId}/datasets`, { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Dataset could not be created");
  return data.dataset as DiscoveryDataset;
}

export async function loadPipelineSchedule(api: DiscoveryApi, pipelineId: string): Promise<PipelineSchedule> {
  const res = await api.fetch(`/discovery/pipelines/${pipelineId}/schedule`);
  if (!res.ok) throw new Error(`Schedule request failed: ${res.status}`);
  return await res.json();
}

export async function savePipelineSchedule(api: DiscoveryApi, pipelineId: string, schedule: PipelineSchedule): Promise<PipelineSchedule> {
  const res = await api.fetch(`/discovery/pipelines/${pipelineId}/schedule`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: schedule.enabled, interval: schedule.interval, nextRunAt: schedule.next_run_at || null }),
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

export async function publishDiscoveryPipeline(api: DiscoveryApi, pipelineId: string): Promise<PipelineRecord> {
  const res = await api.fetch(`/discovery/pipelines/${pipelineId}/publish`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

export async function previewDiscoveryPipeline(api: DiscoveryApi, definition: PipelineDefinition, targetClasses: TargetClass[]): Promise<PipelinePreview> {
  const res = await api.fetch("/discovery/pipelines/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ definition, targetClasses }),
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

export async function runDiscoveryPipeline(api: DiscoveryApi, pipelineId: string, targetClasses: TargetClass[]): Promise<{ jobId: string }> {
  const res = await api.fetch(`/discovery/pipelines/${pipelineId}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetClasses }),
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

export async function loadStagedDiscoveryJob(api: DiscoveryApi, jobId: string): Promise<StagedDiscoveryJob> {
  const res = await api.fetch(`/discovery/jobs/${jobId}/staged`);
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

export async function loadDiscoveryRollbacks(api: DiscoveryApi, jobId?: string): Promise<DiscoveryRollback[]> {
  const path = jobId ? `/discovery/jobs/${jobId}/rollback` : "/discovery/rollbacks";
  const res = await api.fetch(path);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.rollbacks || [];
}

export async function commitStagedDiscoveryJob(api: DiscoveryApi, jobId: string): Promise<{ created: number; updated: number }> {
  const res = await api.fetch(`/discovery/jobs/${jobId}/commit`, { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Commit failed");
  return data;
}

export async function discardStagedDiscoveryJob(api: DiscoveryApi, jobId: string): Promise<void> {
  const res = await api.fetch(`/discovery/jobs/${jobId}/staged`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Discard failed");
}

export async function applyDiscoveryRollback(api: DiscoveryApi, rollbackId: string): Promise<{ deleted: number; restored: number }> {
  const res = await api.fetch(`/discovery/rollbacks/${rollbackId}/apply`, { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Rollback failed");
  return data;
}

export async function approveSafeStagedRecords(api: DiscoveryApi, jobId: string): Promise<void> {
  const res = await api.fetch(`/discovery/jobs/${jobId}/staged/approve-safe`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
}

export async function skipStagedDiscoveryRecord(api: DiscoveryApi, jobId: string, recordId: string): Promise<void> {
  const res = await api.fetch(`/discovery/jobs/${jobId}/staged/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recordIds: [recordId], status: "skipped" }),
  });
  if (!res.ok) throw new Error(await res.text());
}
