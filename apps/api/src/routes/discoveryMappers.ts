type DiscoveryMapperRow = Record<string, unknown>;

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value : [];
}

function stringValue(row: DiscoveryMapperRow, key: string, fallback = "") {
  const value = row[key];
  return typeof value === "string" ? value : fallback;
}

export function mappingProfileRow(row: DiscoveryMapperRow) {
  return {
    id: stringValue(row, "id"),
    name: stringValue(row, "name"),
    description: stringValue(row, "description"),
    sourceType: stringValue(row, "source_type"),
    targetClasses: arrayValue(row.target_classes),
    mapping: objectValue(row.mapping),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function collectorRow(row: DiscoveryMapperRow) {
  return {
    id: stringValue(row, "id"),
    name: stringValue(row, "name"),
    status: stringValue(row, "status"),
    site: stringValue(row, "site"),
    version: stringValue(row, "version"),
    labels: objectValue(row.labels),
    config: objectValue(row.config),
    lastHeartbeatAt: row.last_heartbeat_at || null,
    lastSeenIp: row.last_seen_ip || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function edgeDiscoveryJobRow(row: DiscoveryMapperRow) {
  return {
    id: stringValue(row, "id"),
    status: stringValue(row, "status"),
    capability: stringValue(row, "capability"),
    priority: Number(row.priority || 0),
    attempt: Number(row.attempt || 0),
    failureCode: row.failure_code || null,
    detail: row.detail || null,
    issuedAt: row.issued_at || null,
    expiresAt: row.expires_at || null,
    updatedAt: row.updated_at || null,
    createdAt: row.created_at || null,
  };
}

export function datasetRow(row: DiscoveryMapperRow) {
  return {
    id: stringValue(row, "id"),
    collectorId: row.collector_id,
    sourceType: stringValue(row, "source_type"),
    sourceId: row.source_id,
    name: stringValue(row, "name"),
    status: stringValue(row, "status"),
    observedStartAt: row.observed_start_at,
    observedEndAt: row.observed_end_at,
    documentIds: arrayValue(row.document_ids),
    runIds: arrayValue(row.run_ids),
    entityCounts: objectValue(row.entity_counts),
    profiles: arrayValue(row.profiles),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
