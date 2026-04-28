import OpenAI from "openai";

export type SourceProfile = {
  sourceName: string;
  entityType?: string;
  recordCount?: number;
  columns: string[];
  sampleRows: Record<string, unknown>[];
  fieldStats?: Array<{ name: string; fillRate: number; distinctCount?: number; examples?: string[] }>;
  entityProfiles?: Array<{
    entityType: string;
    recordCount: number;
    columns: string[];
    sampleRows: Record<string, unknown>[];
    fieldStats?: Array<{ name: string; fillRate: number; distinctCount?: number; examples?: string[] }>;
  }>;
};

export type TargetClass = {
  name: string;
  displayName?: string;
  attributes?: Array<{ name: string; isMandatory?: boolean; isKeyAttribute?: boolean }>;
};

export type TransformProposal = {
  title: string;
  summary: string;
  confidence: number;
  sourceProfile: SourceProfile;
  classRoutes: Array<{ sourcePattern: string; targetClass: string; confidence: number; rationale: string }>;
  fieldMappings: Array<{ sourceField: string; targetClass: string; targetField: string; transform: string; confidence: number; rationale?: string; evidence?: string[]; alternatives?: string[] }>;
  relationshipRules: Array<{ fromClass: string; toClass: string; type: string; sourceField: string; confidence: number; rationale?: string; evidence?: string[] }>;
  reconciliationRules: Array<{ targetClass: string; matchKeys: string[]; strategy: "update" | "create_or_update" | "review" }>;
  assumptions: string[];
  risks: string[];
  aiGenerated: boolean;
};

export type PipelineDefinition = {
  sourceName?: string;
  sample?: { columns?: string[]; rows?: Record<string, unknown>[] };
  entityProfiles?: SourceProfile["entityProfiles"];
  proposal?: TransformProposal | null;
};

export type PipelinePreview = {
  summary: { rows: number; stagedRecords: number; relationshipCandidates: number; errors: number; warnings: number };
  records: Array<{
    row: number;
    action: "create" | "update" | "review";
    targetClass: string;
    name: string;
    environment?: string;
    attributes: Record<string, unknown>;
    matchKeys: string[];
    errors: string[];
    warnings: string[];
  }>;
  relationships: Array<{
    row: number;
    fromClass: string;
    toClass: string;
    type: string;
    sourceField: string;
    targetHint: string;
    confidence: number;
    status?: "unchecked" | "ready" | "will_create_target" | "missing_target";
    message?: string;
  }>;
};

export function stableDiscoveryCiId(targetClass: string, name: string, environment?: string) {
  const slug = [targetClass, environment || "global", name]
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 180);
  return `disc-${slug}`;
}

type AiConfig =
  | { provider: "provara"; url: string; key: string; tenantId?: string; model: string }
  | { provider: "openai"; key: string; model: string };

const AI_TIMEOUT_MS = Number(process.env.DISCOVERY_AI_TIMEOUT_MS || 3500);
const DEFAULT_DISCOVERY_OPENAI_MODEL = "gpt-4o";

const CANDIDATE_FIELDS = {
  name: ["name", "hostname", "host", "server", "application", "app_name", "service", "service_name", "database", "db_name"],
  environment: ["env", "environment", "stage", "tier"],
  ipAddress: ["ip", "ip_addr", "ip_address", "address"],
  serialNumber: ["serial", "serial_number", "asset_tag", "asset"],
  operatingSystem: ["os", "operating_system", "platform"],
  owner: ["owner", "owned_by", "business_owner", "support_group", "assignment_group"],
};

const CLASS_HINTS: Record<string, string[]> = {
  Server: ["host", "hostname", "server", "ip", "os", "serial"],
  Database: ["database", "db", "schema", "instance"],
  ApplicationService: ["app", "application", "service_name"],
  BusinessService: ["business_service", "business", "capability"],
  NetworkGear: ["switch", "router", "network", "subnet", "vlan"],
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function scoreClass(columns: string[], className: string): number {
  const hints = CLASS_HINTS[className] || [className];
  return columns.reduce((score, column) => {
    const c = normalize(column);
    return score + hints.filter((hint) => c.includes(normalize(hint))).length;
  }, 0);
}

function bestTargetField(column: string): string {
  const normalized = normalize(column);
  for (const [target, aliases] of Object.entries(CANDIDATE_FIELDS)) {
    if (aliases.some((alias) => normalized === alias || normalized.includes(alias))) return target;
  }
  return normalized.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
}

function fallbackTargetField(column: string): string {
  return normalize(column).replace(/_([a-z])/g, (_, char) => char.toUpperCase());
}

function transformFor(sourceField: string, targetField: string): string {
  const source = normalize(sourceField);
  if (targetField === "environment") return "normalize_environment";
  if (targetField === "ipAddress") return "trim";
  if (source.includes("host") || targetField === "name") return "trim_lowercase";
  return "trim";
}

function sampleEvidence(profile: SourceProfile, sourceField: string): string[] {
  const values = profile.sampleRows
    .map((row) => row[sourceField])
    .filter((value) => value !== null && value !== undefined && String(value).trim())
    .slice(0, 3)
    .map((value) => String(value).trim());
  return values.length ? values : ["No non-empty sample values were present."];
}

function profileContext(profile: SourceProfile) {
  return (profile.entityProfiles || []).map((entity) => ({
    entityType: entity.entityType,
    recordCount: entity.recordCount,
    columns: entity.columns,
    keyFields: (entity.fieldStats || [])
      .filter((field) => ["natural_key", "hostname", "uuid", "address", "name", "version", "port", "interface"].includes(normalize(field.name)) || field.fillRate >= 0.8)
      .slice(0, 12),
    sampleRows: entity.sampleRows.slice(0, 5),
  }));
}

function fieldRationale(sourceField: string, targetField: string, transform: string) {
  const normalized = normalize(sourceField);
  const aliasMatch = Object.entries(CANDIDATE_FIELDS).find(([target, aliases]) =>
    target === targetField && aliases.some((alias) => normalized === alias || normalized.includes(alias))
  );
  if (aliasMatch) return `Mapped by ${targetField} alias match and ${transform} normalization.`;
  if (targetField === fallbackTargetField(sourceField)) return "Preserved source column as a custom attribute because no standard CSDM alias matched.";
  return `Mapped by source column similarity to ${targetField}.`;
}

function applyTransform(value: unknown, transform: string): unknown {
  const text = value == null ? "" : String(value).trim();
  if (transform === "trim_lowercase") return text.toLowerCase();
  if (transform === "normalize_environment") {
    const normalized = text.toLowerCase();
    if (["prod", "prd", "production"].includes(normalized)) return "Production";
    if (["dev", "development"].includes(normalized)) return "Development";
    if (["test", "tst", "qa"].includes(normalized)) return "Test";
    return text;
  }
  return text;
}

function rowValue(row: Record<string, unknown>, field: string): unknown {
  return row[field] ?? row[normalize(field)];
}

function compactValues(values: unknown[]) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function hostKey(row: Record<string, unknown>) {
  const key = String(row.natural_key || row.hostname || row.uuid || row.name || "").trim();
  return key.includes(":") ? key.split(":")[0] : key;
}

function relatedRows(rows: Record<string, unknown>[], key: string) {
  return rows.filter((row) => {
    const naturalKey = String(row.natural_key || "").trim();
    return naturalKey === key || naturalKey.startsWith(`${key}:`) || String(row.hostname || "").trim() === key;
  });
}

function preferredIp(rows: Record<string, unknown>[]) {
  const addresses = compactValues(rows.map((row) => row.address));
  return addresses.find((address) => !address.startsWith("127.") && address !== "::1" && address !== "0.0.0.0" && address !== "::") || addresses[0] || "";
}

function readProfileValue(
  hostRow: Record<string, unknown>,
  entityRows: Map<string, Record<string, unknown>[]>,
  sourceField: string,
) {
  if (!sourceField.includes(".")) return rowValue(hostRow, sourceField);
  const [entityType, field] = sourceField.split(".", 2);
  const candidates = relatedRows(entityRows.get(entityType) || [], hostKey(hostRow));
  return candidates.map((row) => rowValue(row, field)).find((value) => value !== null && value !== undefined && String(value).trim() !== "");
}

function previewEdgePipeline(definition: PipelineDefinition, targetClasses: TargetClass[], existingCiIds: Set<string>, proposal: TransformProposal): PipelinePreview {
  const entityProfiles = definition.entityProfiles || proposal.sourceProfile.entityProfiles || [];
  const entityRows = new Map(entityProfiles.map((profile) => [profile.entityType, profile.sampleRows || []]));
  const hostRows = entityRows.get("host")?.length ? entityRows.get("host") || [] : definition.sample?.rows || proposal.sourceProfile.sampleRows || [];
  const classMap = new Map(targetClasses.map((cls) => [cls.name, cls]));
  const records: PipelinePreview["records"] = [];
  const relationships: PipelinePreview["relationships"] = [];
  const targetClassNames = Array.from(new Set([
    ...proposal.classRoutes.map((route) => route.targetClass),
    ...proposal.fieldMappings.map((mapping) => mapping.targetClass),
  ])).filter(Boolean);

  hostRows.forEach((hostRow, rowIndex) => {
    const key = hostKey(hostRow) || `host-${rowIndex + 1}`;
    const networkRows = relatedRows(entityRows.get("network_interface") || [], key);
    const softwareRows = relatedRows(entityRows.get("software_package") || [], key);
    const serviceRows = relatedRows(entityRows.get("service") || [], key);
    const portRows = relatedRows(entityRows.get("listening_port") || [], key);

    for (const targetClass of targetClassNames) {
      const mappings = proposal.fieldMappings.filter((mapping) => mapping.targetClass === targetClass);
      if (!mappings.length && targetClass !== proposal.classRoutes[0]?.targetClass) continue;

      const attributes: Record<string, unknown> = {};
      let name = "";
      let environment: string | undefined;
      for (const mapping of mappings) {
        const value = applyTransform(readProfileValue(hostRow, entityRows, mapping.sourceField), mapping.transform);
        if (mapping.targetField === "name") name = String(value || "");
        else if (mapping.targetField === "environment") environment = String(value || "");
        else attributes[mapping.targetField] = value;
      }

      if (targetClass === "Server") {
        name = String(hostRow.hostname || hostRow.natural_key || name || key);
        attributes.os = attributes.os || hostRow.name || hostRow.platform;
        attributes.osVersion = attributes.osVersion || hostRow.version;
        attributes.cpuType = attributes.cpuType || hostRow.cpu_type;
        attributes.physicalMemory = attributes.physicalMemory || hostRow.physical_memory;
        const ip = preferredIp(networkRows);
        if (ip && !attributes.ipAddress) attributes.ipAddress = ip;
        const ipAddresses = compactValues(networkRows.map((row) => row.address));
        if (ipAddresses.length) attributes.ipAddresses = ipAddresses;
        if (networkRows.length) attributes.networkInterfaces = networkRows.map((row) => ({ interface: row.interface, address: row.address, mask: row.mask, type: row.type })).slice(0, 25);
        if (softwareRows.length) attributes.installedSoftware = softwareRows.map((row) => ({ name: row.name, version: row.version, source: row.source })).slice(0, 50);
        if (serviceRows.length) attributes.services = serviceRows.map((row) => ({ name: row.name, state: row.state, status: row.status, startType: row.start_type })).slice(0, 50);
        if (portRows.length) attributes.listeningPorts = portRows.map((row) => ({ port: row.port, protocol: row.protocol, address: row.address, pid: row.pid })).slice(0, 50);
      }

      const classDef = classMap.get(targetClass);
      const mandatory = (classDef?.attributes || []).filter((attr) => attr.isMandatory).map((attr) => attr.name);
      const missing = mandatory.filter((field) => field !== "name" && field !== "environment" && !attributes[field]);
      const rule = proposal.reconciliationRules.find((item) => item.targetClass === targetClass);
      const matchKeys = rule?.matchKeys || ["name"];
      const errors = [
        ...(!name ? ["Missing target name"] : []),
        ...missing.map((field) => `Missing mandatory field ${field}`),
      ];
      const warnings = matchKeys.some((matchKey) => matchKey === "name" ? !name : matchKey === "environment" ? !environment : !attributes[matchKey])
        ? ["One or more reconciliation keys are empty"]
        : [];

      records.push({
        row: rowIndex + 1,
        action: errors.length ? "review" : existingCiIds.has(stableDiscoveryCiId(targetClass, name || `${targetClass} row ${rowIndex + 1}`, environment)) ? "update" : "create",
        targetClass,
        name: name || `${targetClass} row ${rowIndex + 1}`,
        environment,
        attributes,
        matchKeys,
        errors,
        warnings,
      });
    }

    for (const serviceRow of serviceRows.slice(0, 25)) {
      if (!targetClasses.some((targetClass) => targetClass.name === "ApplicationService")) break;
      const serviceName = String(serviceRow.name || "").trim();
      if (!serviceName) continue;
      records.push({
        row: rowIndex + 1,
        action: existingCiIds.has(stableDiscoveryCiId("ApplicationService", serviceName)) ? "update" : "create",
        targetClass: "ApplicationService",
        name: serviceName,
        attributes: { state: serviceRow.state, status: serviceRow.status, startType: serviceRow.start_type, host: key },
        matchKeys: ["name"],
        errors: [],
        warnings: [],
      });
      relationships.push({ row: rowIndex + 1, fromClass: "ApplicationService", toClass: "Server", type: "HOSTED_ON", sourceField: "service.name", targetHint: key, confidence: 0.78, status: "unchecked" });
    }

    for (const rule of proposal.relationshipRules) {
      const targetHint = String(readProfileValue(hostRow, entityRows, rule.sourceField) || "").trim();
      relationships.push({
        row: rowIndex + 1,
        fromClass: rule.fromClass,
        toClass: rule.toClass,
        type: rule.type,
        sourceField: rule.sourceField,
        targetHint,
        confidence: rule.confidence,
        status: "unchecked",
      });
    }
  });

  const errors = records.reduce((total, record) => total + record.errors.length, 0);
  const warnings = records.reduce((total, record) => total + record.warnings.length, 0)
    + relationships.filter((relationship) => relationship.status === "missing_target").length;
  return {
    summary: { rows: hostRows.length, stagedRecords: records.length, relationshipCandidates: relationships.length, errors, warnings },
    records,
    relationships,
  };
}

export function previewPipeline(definition: PipelineDefinition, targetClasses: TargetClass[] = [], existingCiIds = new Set<string>()): PipelinePreview {
  const proposal = definition.proposal;
  const rows = definition.sample?.rows || proposal?.sourceProfile?.sampleRows || [];
  const classMap = new Map(targetClasses.map((cls) => [cls.name, cls]));
  const records: PipelinePreview["records"] = [];
  const relationships: PipelinePreview["relationships"] = [];
  if (!proposal) {
    return { summary: { rows: rows.length, stagedRecords: 0, relationshipCandidates: 0, errors: 1, warnings: 0 }, records, relationships };
  }
  if ((definition.entityProfiles || proposal.sourceProfile?.entityProfiles || []).length) {
    return previewEdgePipeline(definition, targetClasses, existingCiIds, proposal);
  }

  const targetClassNames = Array.from(new Set([
    ...proposal.classRoutes.map((route) => route.targetClass),
    ...proposal.fieldMappings.map((mapping) => mapping.targetClass),
  ])).filter(Boolean);

  rows.forEach((row, rowIndex) => {
    for (const targetClass of targetClassNames) {
      const mappings = proposal.fieldMappings.filter((mapping) => mapping.targetClass === targetClass);
      if (!mappings.length && targetClass !== proposal.classRoutes[0]?.targetClass) continue;

      const attributes: Record<string, unknown> = {};
      let name = "";
      let environment: string | undefined;
      for (const mapping of mappings) {
        const value = applyTransform(row[mapping.sourceField], mapping.transform);
        if (mapping.targetField === "name") name = String(value || "");
        else if (mapping.targetField === "environment") environment = String(value || "");
        else attributes[mapping.targetField] = value;
      }

      const classDef = classMap.get(targetClass);
      const mandatory = (classDef?.attributes || []).filter((attr) => attr.isMandatory).map((attr) => attr.name);
      const missing = mandatory.filter((field) => field !== "name" && field !== "environment" && !attributes[field]);
      const rule = proposal.reconciliationRules.find((item) => item.targetClass === targetClass);
      const matchKeys = rule?.matchKeys || ["name"];
      const errors = [
        ...(!name ? ["Missing target name"] : []),
        ...missing.map((field) => `Missing mandatory field ${field}`),
      ];
      const warnings = matchKeys.some((key) => key === "name" ? !name : key === "environment" ? !environment : !attributes[key])
        ? ["One or more reconciliation keys are empty"]
        : [];

      records.push({
        row: rowIndex + 1,
        action: errors.length ? "review" : existingCiIds.has(stableDiscoveryCiId(targetClass, name || `${targetClass} row ${rowIndex + 1}`, environment)) ? "update" : "create",
        targetClass,
        name: name || `${targetClass} row ${rowIndex + 1}`,
        environment,
        attributes,
        matchKeys,
        errors,
        warnings,
      });
    }

    for (const rule of proposal.relationshipRules) {
      const targetHint = String(row[rule.sourceField] || "").trim();
      relationships.push({
        row: rowIndex + 1,
        fromClass: rule.fromClass,
        toClass: rule.toClass,
        type: rule.type,
        sourceField: rule.sourceField,
        targetHint,
        confidence: rule.confidence,
        status: "unchecked",
      });
    }
  });

  const errors = records.reduce((total, record) => total + record.errors.length, 0);
  const warnings = records.reduce((total, record) => total + record.warnings.length, 0)
    + relationships.filter((relationship) => relationship.status === "missing_target").length;
  return {
    summary: { rows: rows.length, stagedRecords: records.length, relationshipCandidates: relationships.length, errors, warnings },
    records,
    relationships,
  };
}

export function buildDeterministicProposal(profile: SourceProfile, targetClasses: TargetClass[] = []): TransformProposal {
  const columns = profile.columns.filter(Boolean);
  const entityProfiles = profile.entityProfiles || [];
  const contextColumns = Array.from(new Set([
    ...columns,
    ...entityProfiles.flatMap((entity) => entity.columns.map((column) => `${entity.entityType}.${column}`)),
  ]));
  const classNames = targetClasses.length ? targetClasses.map((c) => c.name) : Object.keys(CLASS_HINTS);
  const ranked = classNames
    .map((name) => ({ name, score: scoreClass(contextColumns, name) }))
    .sort((a, b) => b.score - a.score);
  const selected = ranked.filter((r) => r.score > 0).slice(0, 3);
  const routes = selected.length ? selected : [{ name: classNames[0] || "ConfigurationItem", score: 1 }];
  const primaryClass = routes[0].name;

  const mappedNames = new Set<string>();
  const fieldMappings = columns.slice(0, 18).map((sourceField) => {
    const initialTargetField = bestTargetField(sourceField);
    const targetField = initialTargetField === "name" && mappedNames.has("name")
      ? fallbackTargetField(sourceField)
      : initialTargetField;
    mappedNames.add(targetField);
    return {
      sourceField,
      targetClass: primaryClass,
      targetField,
      transform: transformFor(sourceField, targetField),
      confidence: targetField === normalize(sourceField) ? 0.58 : 0.82,
      rationale: fieldRationale(sourceField, targetField, transformFor(sourceField, targetField)),
      evidence: sampleEvidence(profile, sourceField),
      alternatives: Array.from(new Set([fallbackTargetField(sourceField), normalize(sourceField), "name", "environment"].filter((field) => field && field !== targetField))).slice(0, 3),
    };
  });

  const relationshipRules = [];
  const normalizedColumns = columns.map(normalize);
  if (routes.some((r) => r.name === "ApplicationService") && routes.some((r) => r.name === "Server")) {
    relationshipRules.push({ fromClass: "ApplicationService", toClass: "Server", type: "HOSTED_ON", sourceField: "hostname", confidence: 0.72, rationale: "Application and host/server column signatures suggest a hosted-on dependency.", evidence: sampleEvidence(profile, "hostname") });
  }
  if (normalizedColumns.some((c) => c.includes("db"))) {
    const sourceField = columns.find((c) => normalize(c).includes("db")) || "db_host";
    relationshipRules.push({ fromClass: primaryClass, toClass: "Database", type: "DEPENDS_ON", sourceField, confidence: 0.66, rationale: "Database-like source field implies a dependency target that should be reconciled before commit.", evidence: sampleEvidence(profile, sourceField) });
  }
  if (normalizedColumns.some((c) => c.includes("owner") || c.includes("group"))) {
    const sourceField = columns.find((c) => normalize(c).includes("owner") || normalize(c).includes("group")) || "owner";
    relationshipRules.push({ fromClass: primaryClass, toClass: "Group", type: "OWNED_BY", sourceField, confidence: 0.62, rationale: "Owner or support-group field suggests an ownership relationship.", evidence: sampleEvidence(profile, sourceField) });
  }
  const hasHostProfile = entityProfiles.some((entity) => entity.entityType === "host");
  const networkProfile = entityProfiles.find((entity) => entity.entityType === "network_interface");
  const softwareProfile = entityProfiles.find((entity) => entity.entityType === "software_package");
  const serviceProfile = entityProfiles.find((entity) => entity.entityType === "service");
  const portProfile = entityProfiles.find((entity) => entity.entityType === "listening_port");
  if (profile.entityType === "host" && classNames.includes("NetworkGear") && networkProfile?.columns.some((column) => normalize(column) === "address")) {
    relationshipRules.push({
      fromClass: primaryClass,
      toClass: "NetworkGear",
      type: "DEPENDS_ON",
      sourceField: "network_interface.address",
      confidence: 0.56,
      rationale: "Edge collector includes network interface observations; IP addresses should enrich or relate to the host during reconciliation.",
      evidence: (networkProfile.sampleRows || []).map((row) => String(row.address || "")).filter(Boolean).slice(0, 3),
    });
  }
  if (hasHostProfile && softwareProfile && classNames.includes("SoftwareInstallation")) {
    relationshipRules.push({
      fromClass: "Server",
      toClass: "SoftwareInstallation",
      type: "HOSTED_ON",
      sourceField: "software_package.name",
      confidence: 0.58,
      rationale: "Edge collector includes installed package observations keyed to the host; pipeline execution should stage software inventory as child evidence.",
      evidence: (softwareProfile.sampleRows || []).map((row) => String(row.name || "")).filter(Boolean).slice(0, 3),
    });
  }
  if (hasHostProfile && classNames.includes("ApplicationService") && (serviceProfile || portProfile)) {
    relationshipRules.push({
      fromClass: "ApplicationService",
      toClass: "Server",
      type: "HOSTED_ON",
      sourceField: serviceProfile ? "service.name" : "listening_port.port",
      confidence: 0.55,
      rationale: "Edge collector includes running services or listening ports that should be evaluated as service endpoints hosted on the server.",
      evidence: ((serviceProfile || portProfile)?.sampleRows || []).map((row) => String(row.name || row.port || "")).filter(Boolean).slice(0, 3),
    });
  }

  const matchKeys = ["serialNumber", "name", "ipAddress"].filter((field) => fieldMappings.some((m) => m.targetField === field));
  return {
    title: `${profile.sourceName || "Source"} transform draft`,
    summary: `Drafted ${fieldMappings.length} mappings into ${routes.map((r) => r.name).join(", ")} with ${relationshipRules.length} relationship rules${profile.entityType ? ` from ${profile.recordCount || profile.sampleRows.length} ${profile.entityType} observations` : ""}${entityProfiles.length ? ` using ${entityProfiles.length} edge entity profiles` : ""}.`,
    confidence: Math.min(0.92, 0.55 + routes[0].score * 0.08 + matchKeys.length * 0.05),
    sourceProfile: { ...profile, columns },
    classRoutes: routes.map((r) => ({
      sourcePattern: r.score > 1 ? "column signatures" : "default route",
      targetClass: r.name,
      confidence: Math.min(0.9, 0.58 + r.score * 0.08),
      rationale: r.score > 0 ? `Matched ${r.score} source column hint${r.score === 1 ? "" : "s"}.` : "No strong class hints were found.",
    })),
    fieldMappings,
    relationshipRules,
    reconciliationRules: routes.map((r) => ({
      targetClass: r.name,
      matchKeys: matchKeys.length ? matchKeys : ["name"],
      strategy: matchKeys.length > 1 ? "create_or_update" : "review",
    })),
    assumptions: [
      profile.fieldStats?.length
        ? "The proposal uses edge observation profile field quality plus representative sample rows."
        : "The proposal is based on column names and sample rows, not a committed import.",
      ...(entityProfiles.length ? ["The edge source profile includes related entity samples so host mappings can account for interfaces, software, services, and ports."] : []),
      "Low-confidence relationship rules should be reviewed before execution.",
    ],
    risks: matchKeys.length ? [] : ["No durable reconciliation key was detected; imports may create duplicates."],
    aiGenerated: false,
  };
}

function getAiConfig(): AiConfig | null {
  if (process.env.PROVARA_URL && process.env.PROVARA_API_KEY) {
    return {
      provider: "provara",
      url: process.env.PROVARA_URL,
      key: process.env.PROVARA_API_KEY,
      tenantId: process.env.PROVARA_TENANT_ID,
      model: process.env.DISCOVERY_PROVARA_MODEL || process.env.PROVARA_MODEL || "provara-router",
    };
  }
  return process.env.OPENAI_API_KEY
    ? { provider: "openai", key: process.env.OPENAI_API_KEY, model: process.env.DISCOVERY_OPENAI_MODEL || process.env.OPENAI_MODEL || DEFAULT_DISCOVERY_OPENAI_MODEL }
    : null;
}

function parseProposal(content: string, fallback: TransformProposal): TransformProposal {
  const cleaned = content.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(cleaned);
  return {
    ...fallback,
    ...parsed,
    sourceProfile: fallback.sourceProfile,
    aiGenerated: true,
  };
}

export async function proposeTransform(profile: SourceProfile, targetClasses: TargetClass[] = []): Promise<TransformProposal> {
  const fallback = buildDeterministicProposal(profile, targetClasses);
  const config = getAiConfig();
  if (!config) return fallback;

  const messages = [
    {
      role: "system" as const,
      content: "You create safe CMDB discovery transform drafts. Return only JSON matching the provided shape. Do not invent target classes outside the supplied list.",
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        task: "Map this source into Specora CSDM-shaped CIs, transforms, reconciliation keys, and relationships.",
        allowedRelationshipTypes: ["PART_OF", "DEPENDS_ON", "HOSTED_ON", "MANAGED_BY", "OWNED_BY", "LOCATED_AT"],
        targetClasses,
        sourceProfile: profile,
        edgeEntityContext: profileContext(profile),
        requiredShape: fallback,
      }),
    },
  ];

  try {
    if (config.provider === "provara") {
      const baseUrl = config.url.replace(/\/?v1\/?$/, "");
      const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${config.key}` };
      if (config.tenantId) headers["X-Tenant-ID"] = config.tenantId;
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
        body: JSON.stringify({ model: config.model, messages, temperature: 0.15, requires_structured_output: true }),
      });
      if (!response.ok) return fallback;
      const data = await response.json() as any;
      return parseProposal(data.choices?.[0]?.message?.content || "", fallback);
    }

    const openai = new OpenAI({ apiKey: config.key });
    const completion = await openai.chat.completions.create({ model: config.model, messages, temperature: 0.15 }, { timeout: AI_TIMEOUT_MS });
    return parseProposal(completion.choices[0]?.message?.content || "", fallback);
  } catch {
    return fallback;
  }
}
