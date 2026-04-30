import { EDGE_HOST_SAMPLE, SAMPLE } from "./constants";
import type {
  DiscoveryCollector,
  DiscoveryDataset,
  DiscoveryJob,
  DiscoverySource,
  EdgeCollectorLifecycle,
  EdgeObservationProfile,
  PipelinePreview,
  SourceForm,
  StagedDiscoveryJob,
} from "./types";

export function parseCsv(text: string): { columns: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const columns = (lines[0] || "").split(",").map((column) => column.trim()).filter(Boolean);
  const rows = lines.slice(1, 11).map((line) => {
    const values = line.split(",");
    return Object.fromEntries(columns.map((column, index) => [column, values[index]?.trim() || ""]));
  });
  return { columns, rows };
}

export function rowsToCsv(columns: string[], rows: Record<string, unknown>[]): string {
  return [columns.join(","), ...rows.map((row) => columns.map((column) => String(row[column] ?? "")).join(","))].join("\n");
}

export function sourceFields(columns: string[], entityProfiles: EdgeObservationProfile[] = []) {
  return Array.from(new Set([
    ...columns,
    ...entityProfiles.flatMap((entity) => entity.columns.map((column) => `${entity.entityType}.${column}`)),
  ].filter(Boolean)));
}

export function edgeCollectorSample(collector: DiscoveryCollector | null): string {
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

export function profileToCsv(profile: EdgeObservationProfile): string {
  const columns = profile.columns.length ? profile.columns : Array.from(new Set(profile.sampleRows.flatMap((row) => Object.keys(row))));
  return rowsToCsv(columns, profile.sampleRows);
}

export function sourceConfigFromForm(form: SourceForm) {
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

export function normalizeSourceConfig(config?: Record<string, unknown> | string | null): Record<string, any> {
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

export function sourceFormFromSource(source: DiscoverySource): SourceForm {
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

export function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function discoveryJobSource(job: DiscoveryJob): string {
  return job.filePath || job.file_path || "No source file recorded";
}

export function discoveryJobTimestamp(job: DiscoveryJob): number {
  const raw = job.createdAt || job.created_at || job.updatedAt || job.updated_at;
  if (!raw) return 0;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function formatDiscoveryJobDate(job: DiscoveryJob): string {
  const timestamp = discoveryJobTimestamp(job);
  return timestamp ? new Date(timestamp).toLocaleString() : "No timestamp";
}

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberFrom(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function discoveryJobPreview(job: DiscoveryJob) {
  const stats = safeObject(job.stats);
  const preview = safeObject(stats.preview);
  return {
    pipelineName: typeof stats.pipelineName === "string" ? stats.pipelineName : "",
    pipelineVersion: numberFrom(stats.pipelineVersion),
    rows: numberFrom(preview.rows),
    stagedRecords: numberFrom(preview.stagedRecords),
    relationships: numberFrom(preview.relationshipCandidates),
    errors: numberFrom(preview.errors),
    warnings: numberFrom(preview.warnings),
  };
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "unknown";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : "unknown";
}

export function freshnessLabel(value?: string | null): string {
  if (!value) return "unknown freshness";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "unknown freshness";
  const diffMs = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m old`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h old`;
  return `${Math.floor(hours / 24)}d old`;
}

export function entityCountsLabel(counts: Record<string, number>): string {
  const entries = Object.entries(counts || {});
  return entries.length ? entries.map(([key, value]) => `${key}:${value}`).join(" ") : "no entities";
}

export function datasetWindowLabel(dataset: DiscoveryDataset): string {
  const start = formatDateTime(dataset.observedStartAt);
  const end = formatDateTime(dataset.observedEndAt);
  return start === end ? end : `${start} to ${end}`;
}

export function previewRecordDecision(record: PipelinePreview["records"][number]): string {
  if (record.errors.length) return `Blocked until ${record.errors[0].toLowerCase()}`;
  if (record.action === "update") return `Updates an existing ${record.targetClass} matched by ${record.matchKeys.join(", ") || "reconciliation rules"}.`;
  if (record.action === "create") return `Creates a new ${record.targetClass}; no existing CI matched ${record.matchKeys.join(", ") || "the current keys"}.`;
  if (record.action === "review") return `Needs review before ${record.targetClass} can be committed.`;
  return `${record.action} ${record.targetClass} using ${record.matchKeys.join(", ") || "configured keys"}.`;
}

function keyValueForRecord(key: string, record: { name?: string; environment?: string; attributes?: Record<string, unknown> }) {
  if (key === "name") return record.name || "";
  if (key === "environment") return record.environment || "";
  const value = record.attributes?.[key];
  return Array.isArray(value) ? value.join(", ") : String(value ?? "");
}

export function previewReconciliationTrace(record: PipelinePreview["records"][number]) {
  const keyChecks = record.matchKeys.map((key) => ({ key, value: keyValueForRecord(key, record), present: Boolean(String(keyValueForRecord(key, record)).trim()) }));
  const missingKeys = keyChecks.filter((item) => !item.present).map((item) => item.key);
  const reason = record.errors.length
    ? `Blocked because ${record.errors[0].toLowerCase()}.`
    : missingKeys.length
      ? `Needs review because ${missingKeys.join(", ")} ${missingKeys.length === 1 ? "is" : "are"} empty.`
      : record.action === "update"
        ? "Existing CI matched all configured reconciliation keys."
        : "No existing CI matched all configured reconciliation keys.";
  return { reason, keyChecks };
}

export function stagedRecordDecision(record: StagedDiscoveryJob["records"][number]): string {
  if (record.status === "committed") return `Committed to ${record.committed_ci_id || "the CMDB"}.`;
  if (record.status === "blocked") return `Blocked until ${(record.errors?.[0] || record.warnings?.[0] || "the listed issue").toLowerCase()}.`;
  if (record.status === "approved") return "Approved for commit.";
  if (record.status === "skipped") return "Skipped by a discovery admin.";
  if (record.action === "update") return "Staged to update an existing CI.";
  if (record.action === "create") return "Staged to create a new CI.";
  return "Staged for review before CMDB commit.";
}

export function stagedReconciliationTrace(record: StagedDiscoveryJob["records"][number]) {
  const matchKeys = record.match_keys || [];
  const keyChecks = matchKeys.map((key) => ({ key, value: keyValueForRecord(key, record), present: Boolean(String(keyValueForRecord(key, record)).trim()) }));
  const missingKeys = keyChecks.filter((item) => !item.present).map((item) => item.key);
  const reason = record.status === "blocked"
    ? `Blocked because ${(record.errors?.[0] || record.warnings?.[0] || "a reconciliation issue").toLowerCase()}.`
    : missingKeys.length
      ? `Needs review because ${missingKeys.join(", ")} ${missingKeys.length === 1 ? "is" : "are"} empty.`
      : record.action === "update"
        ? "Existing CI matched all configured reconciliation keys."
        : record.action === "create"
          ? "No existing CI matched all configured reconciliation keys."
          : "Reconciliation is based on the configured key values below.";
  return { reason, keyChecks };
}

export function relationshipStatusLabel(status?: PipelinePreview["relationships"][number]["status"] | string): string {
  switch (status) {
    case "ready":
      return "ready";
    case "will_create_target":
      return "creates target";
    case "missing_target":
      return "missing target";
    default:
      return "unchecked";
  }
}

export function relationshipStatusClass(status?: PipelinePreview["relationships"][number]["status"] | string): string {
  switch (status) {
    case "ready":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-200";
    case "will_create_target":
      return "border-cyan-500/25 bg-cyan-500/10 text-cyan-200";
    case "missing_target":
      return "border-amber-500/30 bg-amber-500/10 text-amber-100";
    default:
      return "border-gray-800 bg-gray-950 text-gray-300";
  }
}

export function lifecycleCount(lifecycle: EdgeCollectorLifecycle | undefined, status: string): number {
  return Number(lifecycle?.summary?.[status] || 0);
}

export function edgeJobAge(job: EdgeCollectorLifecycle["recentJobs"][number]): string {
  return freshnessLabel(job.updatedAt || job.createdAt);
}

