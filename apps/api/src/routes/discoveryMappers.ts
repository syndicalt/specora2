export function mappingProfileRow(row: any) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    sourceType: row.source_type,
    targetClasses: typeof row.target_classes === "string" ? JSON.parse(row.target_classes || "[]") : row.target_classes || [],
    mapping: typeof row.mapping === "string" ? JSON.parse(row.mapping || "{}") : row.mapping || {},
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function collectorRow(row: any) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    site: row.site || "",
    version: row.version || "",
    labels: typeof row.labels === "string" ? JSON.parse(row.labels || "{}") : row.labels || {},
    config: typeof row.config === "string" ? JSON.parse(row.config || "{}") : row.config || {},
    lastHeartbeatAt: row.last_heartbeat_at || null,
    lastSeenIp: row.last_seen_ip || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function edgeDiscoveryJobRow(row: any) {
  return {
    id: row.id,
    status: row.status,
    capability: row.capability,
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

export function datasetRow(row: any) {
  return {
    id: row.id,
    collectorId: row.collector_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    name: row.name,
    status: row.status,
    observedStartAt: row.observed_start_at,
    observedEndAt: row.observed_end_at,
    documentIds: typeof row.document_ids === "string" ? JSON.parse(row.document_ids || "[]") : row.document_ids || [],
    runIds: typeof row.run_ids === "string" ? JSON.parse(row.run_ids || "[]") : row.run_ids || [],
    entityCounts: typeof row.entity_counts === "string" ? JSON.parse(row.entity_counts || "{}") : row.entity_counts || {},
    profiles: typeof row.profiles === "string" ? JSON.parse(row.profiles || "[]") : row.profiles || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
