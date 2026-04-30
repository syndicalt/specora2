import type { FastifyInstance } from "fastify";

type EvidenceFacts = Record<string, unknown>;

export type EvidenceRecord = {
  schema?: string;
  source?: { type?: string; id?: string };
  subject?: { type?: string; id?: string };
  observed_at?: string;
  facts?: EvidenceFacts;
  relationships?: unknown[];
  confidence?: number;
  metadata?: Record<string, unknown>;
  signature?: string;
  signing_key_id?: string;
};

type DiscoveryObservationRow = {
  entity_type: string;
  natural_key: string;
  observed_at?: string | Date | null;
  facts?: string | EvidenceFacts | null;
};

type CollectorProfileRow = {
  entity_type: string;
  natural_key: string;
  observed_at?: string | Date | null;
} & EvidenceFacts;

type CollectorProfile = {
  entityType: string;
  recordCount: number;
  columns: string[];
  sampleRows: CollectorProfileRow[];
  fieldStats: Array<{
    name: string;
    fillRate: number;
    distinctCount: number;
    examples: string[];
  }>;
  recentObservedAt: string | Date | null;
};

type EvidenceDocumentRow = {
  id: string;
  run_id?: string | null;
  created_at: string | Date;
};

type EvidenceDocument = {
  id: string;
  collector_id: string;
  run_id?: string | null;
  raw_text?: string | null;
};

type EvidenceIngestResult = {
  records: number;
  status: "invalid_evidence" | "parsed" | "empty";
  error?: string;
};

function isObservedTime(value: string | Date | null | undefined): value is string | Date {
  return Boolean(value);
}

function isByteArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255);
}

export function decodeUploadChunk(data: unknown): string {
  if (typeof data === "string") return Buffer.from(data, "base64").toString("utf8");
  if (isByteArray(data)) return Buffer.from(data).toString("utf8");
  return "";
}

function parseEvidenceRecords(rawText: string): { records: EvidenceRecord[]; error?: string } {
  const text = rawText.trim();
  if (!text) return { records: [] };
  const lines = text.includes("\n") ? text.split(/\r?\n/) : [text];
  const records: EvidenceRecord[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const record = JSON.parse(line) as EvidenceRecord;
      if (record.schema !== "specora.evidence.v1") return { records: [], error: `record ${index + 1} schema is not specora.evidence.v1` };
      if (!record.source?.type || !record.source?.id) return { records: [], error: `record ${index + 1} source is incomplete` };
      if (!record.subject?.type || !record.subject?.id) return { records: [], error: `record ${index + 1} subject is incomplete` };
      if (!record.observed_at || Number.isNaN(new Date(record.observed_at).getTime())) return { records: [], error: `record ${index + 1} observed_at is invalid` };
      if (!record.facts || !Object.keys(record.facts).length) return { records: [], error: `record ${index + 1} facts are required` };
      records.push(record);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown parse error";
      return { records: [], error: `record ${index + 1} is not valid JSON: ${message}` };
    }
  }
  return { records };
}

function entityTypeForEvidence(record: EvidenceRecord) {
  const subjectType = String(record.subject?.type || "").trim();
  if (subjectType && subjectType !== "host") return subjectType;
  const queryName = String(record.metadata?.query_name || "").trim();
  if (queryName === "packages") return "software_package";
  if (queryName === "services") return "service";
  if (queryName === "interfaces") return "network_interface";
  if (queryName === "listening_ports") return "listening_port";
  return subjectType || "unknown";
}

function naturalKeyForEvidence(record: EvidenceRecord) {
  const facts = record.facts || {};
  const entityType = entityTypeForEvidence(record);
  if (entityType === "host") return String(record.subject?.id || facts.hostname || facts.uuid || "unknown");
  return String(record.subject?.id || facts.id || facts.name || facts.address || facts.port || "unknown");
}

function parseFacts(value: DiscoveryObservationRow["facts"]): EvidenceFacts {
  if (typeof value === "string") return JSON.parse(value || "{}") as EvidenceFacts;
  return value || {};
}

function hostKeyFromRow(row: CollectorProfileRow) {
  const key = String(row.natural_key || row.hostname || row.uuid || row.name || "").trim();
  return key.includes(":") ? key.split(":")[0] : key;
}

function isLoopbackAddress(address: string) {
  return address === "::1" || address.startsWith("127.");
}

function addressScore(row: CollectorProfileRow) {
  const address = String(row.address || "").trim();
  const iface = String(row.interface || "").toLowerCase();
  if (!address || isLoopbackAddress(address)) return -1;
  let score = 0;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) score += 100;
  if (!address.toLowerCase().startsWith("fe80:")) score += 30;
  if (!/^(lo|docker|br-|veth|virbr)/.test(iface)) score += 50;
  if (/^(eth|en|wl|wlan)/.test(iface)) score += 25;
  return score;
}

function preferredAddress(rows: CollectorProfileRow[]) {
  return rows
    .map((row) => ({ row, score: addressScore(row) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score)[0]?.row.address;
}

function relatedInterfaceRows(rows: CollectorProfileRow[], hostKey: string) {
  return rows.filter((row) => {
    const naturalKey = String(row.natural_key || "").trim();
    return naturalKey === hostKey || naturalKey.startsWith(`${hostKey}:`) || String(row.hostname || "").trim() === hostKey;
  });
}

export function buildCollectorProfiles(rows: DiscoveryObservationRow[]): CollectorProfile[] {
  const groups = new Map<string, Map<string, CollectorProfileRow>>();
  for (const row of rows) {
    const facts = parseFacts(row.facts);
    const sampleRow = {
      entity_type: row.entity_type,
      natural_key: row.natural_key,
      observed_at: row.observed_at,
      ...facts,
    };
    const entityRows = groups.get(row.entity_type) || new Map<string, CollectorProfileRow>();
    const existing = entityRows.get(row.natural_key);
    entityRows.set(row.natural_key, existing ? { ...sampleRow, ...existing, observed_at: existing.observed_at || sampleRow.observed_at } : sampleRow);
    groups.set(row.entity_type, entityRows);
  }
  const hostRows = groups.get("host");
  const interfaceRows = Array.from(groups.get("network_interface")?.values() || []);
  if (hostRows?.size && interfaceRows.length) {
    for (const [key, hostRow] of hostRows.entries()) {
      const related = relatedInterfaceRows(interfaceRows, hostKeyFromRow(hostRow) || key);
      const ipAddress = preferredAddress(related);
      const ipAddresses = Array.from(new Set(related.map((row) => String(row.address || "").trim()).filter((address) => address && !isLoopbackAddress(address))));
      if (ipAddress) hostRow.ipAddress = String(ipAddress);
      if (ipAddresses.length) hostRow.ipAddresses = ipAddresses;
    }
  }
  const preferred = ["host", "software_package", "service", "network_interface", "listening_port"];
  return Array.from(groups.entries()).map(([entityType, rowMap]) => {
    const entityRows = Array.from(rowMap.values());
    const columns = Array.from(new Set(entityRows.flatMap((row) => Object.keys(row))));
    const fieldStats = columns.map((column) => {
      const values = entityRows
        .map((row) => row[column])
        .filter((value) => value !== null && value !== undefined && String(value).trim() !== "");
      const examples = Array.from(new Set(values.map((value) => String(value)).filter(Boolean))).slice(0, 5);
      return {
        name: column,
        fillRate: entityRows.length ? values.length / entityRows.length : 0,
        distinctCount: new Set(values.map((value) => String(value))).size,
        examples,
      };
    });
    return {
      entityType,
      recordCount: entityRows.length,
      columns,
      sampleRows: entityRows.slice(0, 25),
      fieldStats,
      recentObservedAt: entityRows[0]?.observed_at || null,
    };
  }).sort((a, b) => {
    const preferredDelta = preferred.indexOf(a.entityType) - preferred.indexOf(b.entityType);
    if (preferredDelta !== 0 && preferred.indexOf(a.entityType) !== -1 && preferred.indexOf(b.entityType) !== -1) return preferredDelta;
    if (preferred.indexOf(a.entityType) !== -1) return -1;
    if (preferred.indexOf(b.entityType) !== -1) return 1;
    return b.recordCount - a.recordCount || a.entityType.localeCompare(b.entityType);
  });
}

export async function createDiscoveryDatasetForCollector(fastify: FastifyInstance, collectorId: string, actorId?: string | null) {
  const documents = await fastify.pg.query(
    `SELECT id, run_id, created_at
     FROM edge_evidence_documents
     WHERE collector_id = $1 AND complete = TRUE AND verification_status = 'parsed'
     ORDER BY created_at DESC
     LIMIT 10`,
    [collectorId]
  );
  const documentRows = documents.rows as EvidenceDocumentRow[];
  const documentIds = documentRows.map((row) => row.id);
  if (!documentIds.length) return null;
  const observations = await fastify.pg.query(
    `SELECT entity_type, natural_key, observed_at, facts
     FROM discovery_observations
     WHERE collector_id = $1 AND document_id = ANY($2::uuid[])
     ORDER BY observed_at DESC, created_at DESC
     LIMIT 10000`,
    [collectorId, documentIds]
  );
  const observationRows = observations.rows as DiscoveryObservationRow[];
  const profiles = buildCollectorProfiles(observationRows);
  const entityCounts = Object.fromEntries(profiles.map((profile) => [profile.entityType, profile.recordCount]));
  const observedTimes = observationRows
    .map((row) => row.observed_at)
    .filter(isObservedTime)
    .map((value: string | Date) => new Date(value).toISOString())
    .sort();
  const latestDocument = documentRows[0];
  const name = `Edge dataset ${new Date(latestDocument.created_at).toISOString()}`;
  const result = await fastify.pg.query(
    `INSERT INTO discovery_datasets
       (collector_id, source_type, source_id, name, status, observed_start_at, observed_end_at, document_ids, run_ids, entity_counts, profiles, created_by)
     VALUES ($1, 'edge', $2, $3, 'ready', $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, collector_id, source_type, source_id, name, status, observed_start_at, observed_end_at,
               document_ids, run_ids, entity_counts, profiles, created_at, updated_at`,
    [
      collectorId,
      collectorId,
      name,
      observedTimes[0] || null,
      observedTimes[observedTimes.length - 1] || null,
      JSON.stringify(documentIds),
      JSON.stringify(Array.from(new Set(documentRows.map((row) => row.run_id).filter(Boolean)))),
      JSON.stringify(entityCounts),
      JSON.stringify(profiles),
      actorId || null,
    ]
  );
  return result.rows[0];
}

export async function ingestEvidenceDocument(fastify: FastifyInstance, document: EvidenceDocument): Promise<EvidenceIngestResult> {
  const parsed = parseEvidenceRecords(document.raw_text || "");
  if (parsed.error) {
    await fastify.pg.query(
      `UPDATE edge_evidence_documents
       SET verification_status = 'invalid_evidence', updated_at = NOW()
       WHERE id = $1`,
      [document.id]
    );
    return { records: 0, status: "invalid_evidence", error: parsed.error };
  }

  await fastify.pg.query("DELETE FROM discovery_observations WHERE document_id = $1", [document.id]);
  for (const record of parsed.records) {
    const entityType = entityTypeForEvidence(record);
    await fastify.pg.query(
      `INSERT INTO discovery_observations
         (collector_id, document_id, run_id, source_type, source_id, subject_type, subject_id, entity_type, natural_key, observed_at, facts, relationships, confidence, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        document.collector_id,
        document.id,
        document.run_id,
        record.source?.type,
        record.source?.id,
        record.subject?.type,
        record.subject?.id,
        entityType,
        naturalKeyForEvidence(record),
        record.observed_at,
        JSON.stringify(record.facts || {}),
        JSON.stringify(record.relationships || []),
        typeof record.confidence === "number" ? record.confidence : null,
        JSON.stringify(record.metadata || {}),
      ]
    );
  }

  await fastify.pg.query(
    `UPDATE edge_evidence_documents
     SET schema_version = $2,
         record_count = $3,
         verification_status = $4,
         signature = $5,
         signing_key_id = $6,
         updated_at = NOW()
     WHERE id = $1`,
    [
      document.id,
      parsed.records[0]?.schema || null,
      parsed.records.length,
      parsed.records.length ? "parsed" : "empty",
      parsed.records.find((record) => record.signature)?.signature || null,
      parsed.records.find((record) => record.signing_key_id)?.signing_key_id || null,
    ]
  );
  return { records: parsed.records.length, status: parsed.records.length ? "parsed" : "empty" };
}
