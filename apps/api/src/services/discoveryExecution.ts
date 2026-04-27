import type { FastifyInstance } from "fastify";
import { previewPipeline, stableDiscoveryCiId, type PipelineDefinition, type PipelinePreview, type TargetClass } from "./discoveryTransform";

const ALLOWED_RELATIONSHIPS = new Set(["PART_OF", "DEPENDS_ON", "HOSTED_ON", "MANAGED_BY", "OWNED_BY", "LOCATED_AT"]);

type DiscoveryRollbackRecord = {
  stagedRecordId: string;
  ciId: string;
  action: string;
  targetClass: string;
  name: string;
  existedBefore: boolean;
  oldProperties: Record<string, unknown> | null;
  newProperties: Record<string, unknown>;
};

type DiscoveryRollbackRelationship = {
  stagedRelationshipId: string;
  sourceId: string;
  relType: string;
  toClass: string;
  targetHint: string;
};

function relType(type: string) {
  if (type === "RUNS_ON") return "HOSTED_ON";
  return ALLOWED_RELATIONSHIPS.has(type) ? type : null;
}

async function findExistingPreviewCiIds(fastify: FastifyInstance, preview: PipelinePreview) {
  const candidates = preview.records
    .filter((record) => !record.errors.length)
    .map((record) => ({
      ciId: stableDiscoveryCiId(record.targetClass, record.name, record.environment),
      targetClass: record.targetClass,
      name: record.name,
      environment: record.environment || null,
      attributes: record.attributes || {},
      matchKeys: record.matchKeys || [],
    }));
  if (!candidates.length) return new Set<string>();

  const session = fastify.neo4j.session();
  try {
    const result = await session.run(
      `UNWIND $candidates AS candidate
       MATCH (n:ConfigurationItem)
       WHERE n.id = candidate.ciId
          OR (
            n.class = candidate.targetClass
            AND size(candidate.matchKeys) > 0
            AND all(key IN candidate.matchKeys WHERE
              CASE key
                WHEN 'name' THEN toLower(coalesce(n.name, '')) = toLower(coalesce(candidate.name, ''))
                WHEN 'environment' THEN coalesce(n.environment, '') = coalesce(candidate.environment, '')
                ELSE toLower(coalesce(toString(n[key]), '')) = toLower(coalesce(toString(candidate.attributes[key]), ''))
              END
            )
          )
       RETURN DISTINCT candidate.ciId AS ciId`,
      { candidates }
    );
    return new Set(
      result.records
        .map((record: any) => record.get("ciId"))
        .filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
    );
  } finally {
    await session.close();
  }
}

function relationshipKey(relationship: PipelinePreview["relationships"][number], index: number) {
  return `${index}:${relationship.row}:${relationship.toClass}:${relationship.targetHint}`;
}

function plannedTargetExists(preview: PipelinePreview, relationship: PipelinePreview["relationships"][number]) {
  const targetHint = relationship.targetHint.toLowerCase();
  return preview.records.some((record) => (
    record.targetClass === relationship.toClass
    && !record.errors.length
    && (record.name.toLowerCase() === targetHint || stableDiscoveryCiId(record.targetClass, record.name, record.environment) === relationship.targetHint)
  ));
}

async function findExistingRelationshipTargets(fastify: FastifyInstance, preview: PipelinePreview) {
  const candidates = preview.relationships
    .map((relationship, index) => ({
      key: relationshipKey(relationship, index),
      toClass: relationship.toClass,
      targetHint: relationship.targetHint,
    }))
    .filter((candidate) => candidate.targetHint);
  if (!candidates.length) return new Set<string>();

  const session = fastify.neo4j.session();
  try {
    const result = await session.run(
      `UNWIND $candidates AS candidate
       MATCH (target:ConfigurationItem)
       WHERE target.class = candidate.toClass
         AND (toLower(coalesce(target.name, '')) = toLower(candidate.targetHint) OR target.id = candidate.targetHint)
       RETURN DISTINCT candidate.key AS key`,
      { candidates }
    );
    return new Set(
      result.records
        .map((record: any) => record.get("key"))
        .filter((key: unknown): key is string => typeof key === "string" && key.length > 0)
    );
  } finally {
    await session.close();
  }
}

async function enrichRelationshipTargets(fastify: FastifyInstance, preview: PipelinePreview): Promise<PipelinePreview> {
  const existingTargets = await findExistingRelationshipTargets(fastify, preview);
  const relationships = preview.relationships.map((relationship, index) => {
    if (!relationship.targetHint) {
      return { ...relationship, status: "missing_target" as const, message: `No target value was found in ${relationship.sourceField}` };
    }
    if (existingTargets.has(relationshipKey(relationship, index))) {
      return { ...relationship, status: "ready" as const, message: `${relationship.toClass} ${relationship.targetHint} exists` };
    }
    if (plannedTargetExists(preview, relationship)) {
      return { ...relationship, status: "will_create_target" as const, message: `${relationship.toClass} ${relationship.targetHint} will be created by this run` };
    }
    return { ...relationship, status: "missing_target" as const, message: `${relationship.toClass} ${relationship.targetHint} does not exist` };
  });
  const warnings = preview.records.reduce((total, record) => total + record.warnings.length, 0)
    + relationships.filter((relationship) => relationship.status === "missing_target").length;
  return { ...preview, relationships, summary: { ...preview.summary, warnings } };
}

export async function previewDiscoveryPipelineWithReconciliation(
  fastify: FastifyInstance,
  definition: PipelineDefinition,
  targetClasses: TargetClass[] = []
) {
  const preview = previewPipeline(definition, targetClasses);
  const existingCiIds = await findExistingPreviewCiIds(fastify, preview);
  const reconciledPreview = existingCiIds.size ? previewPipeline(definition, targetClasses, existingCiIds) : preview;
  return enrichRelationshipTargets(fastify, reconciledPreview);
}

export async function stageDiscoveryPipeline(
  fastify: FastifyInstance,
  input: { pipelineId: string; pipelineName: string; definition: PipelineDefinition; targetClasses: TargetClass[]; pipelineVersion?: number; triggerSource?: "manual" | "scheduled" }
) {
  const preview = await previewDiscoveryPipelineWithReconciliation(fastify, input.definition, input.targetClasses);
  if (preview.summary.errors > 0 || preview.summary.stagedRecords === 0) {
    return { ready: false as const, preview };
  }

  const jobResult = await fastify.pg.query(
    `INSERT INTO discovery_jobs (pipeline_id, pipeline_version, trigger_source, status, stats)
     VALUES ($1, $2, $3, 'staged', $4)
     RETURNING id, status, stats, created_at, updated_at`,
    [
      input.pipelineId,
      input.pipelineVersion || null,
      input.triggerSource || "manual",
      { pipelineId: input.pipelineId, pipelineName: input.pipelineName, pipelineVersion: input.pipelineVersion || null, preview: preview.summary },
    ]
  );
  const job = jobResult.rows[0];

  for (const record of preview.records) {
    const ciId = stableDiscoveryCiId(record.targetClass, record.name, record.environment);
    await fastify.pg.query(
      `INSERT INTO discovery_staged_records
       (discovery_job_id, row_number, action, target_class, ci_id, name, environment, attributes, match_keys, errors, warnings, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        job.id,
        record.row,
        record.action,
        record.targetClass,
        ciId,
        record.name,
        record.environment || null,
        JSON.stringify(record.attributes || {}),
        JSON.stringify(record.matchKeys || []),
        JSON.stringify(record.errors || []),
        JSON.stringify(record.warnings || []),
        record.errors.length ? "blocked" : "staged",
      ]
    );
  }

  for (const relationship of preview.relationships) {
    const normalizedType = relType(relationship.type);
    await fastify.pg.query(
      `INSERT INTO discovery_staged_relationships
       (discovery_job_id, row_number, from_class, to_class, rel_type, source_field, target_hint, confidence, status, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        job.id,
        relationship.row,
        relationship.fromClass,
        relationship.toClass,
        normalizedType || relationship.type,
        relationship.sourceField,
        relationship.targetHint || null,
        relationship.confidence,
        normalizedType && relationship.status !== "missing_target" ? "staged" : "blocked",
        normalizedType ? relationship.message || null : `Unsupported relationship type ${relationship.type}`,
      ]
    );
  }

  return { ready: true as const, job, preview };
}

export async function getStagedDiscoveryJob(fastify: FastifyInstance, jobId: string) {
  const [job, records, relationships] = await Promise.all([
    fastify.pg.query("SELECT id, status, stats, created_at, updated_at FROM discovery_jobs WHERE id = $1", [jobId]),
    fastify.pg.query(
      `SELECT id, row_number, action, target_class, ci_id, name, environment, attributes, match_keys, errors, warnings, status, committed_ci_id
       FROM discovery_staged_records WHERE discovery_job_id = $1 ORDER BY row_number, target_class, name`,
      [jobId]
    ),
    fastify.pg.query(
      `SELECT id, row_number, from_class, to_class, rel_type, source_field, target_hint, confidence, status, message
       FROM discovery_staged_relationships WHERE discovery_job_id = $1 ORDER BY row_number, rel_type`,
      [jobId]
    ),
  ]);
  if (!job.rows.length) return null;
  return { job: job.rows[0], records: records.rows, relationships: relationships.rows };
}

export async function updateStagedDiscoveryRecords(fastify: FastifyInstance, jobId: string, recordIds: string[], status: "approved" | "skipped") {
  if (!recordIds.length) return { updated: 0 };
  const result = await fastify.pg.query(
    `UPDATE discovery_staged_records
     SET status = $3, updated_at = NOW()
     WHERE discovery_job_id = $1
       AND id = ANY($2::uuid[])
       AND status IN ('staged', 'approved', 'skipped')
     RETURNING id`,
    [jobId, recordIds, status]
  );
  return { updated: result.rows.length };
}

export async function approveAllSafeStagedRecords(fastify: FastifyInstance, jobId: string) {
  const result = await fastify.pg.query(
    `UPDATE discovery_staged_records
     SET status = 'approved', updated_at = NOW()
     WHERE discovery_job_id = $1
       AND status = 'staged'
       AND jsonb_array_length(errors) = 0
     RETURNING id`,
    [jobId]
  );
  return { updated: result.rows.length };
}

export async function commitStagedDiscoveryJob(fastify: FastifyInstance, jobId: string, actorId?: string | null) {
  const staged = await getStagedDiscoveryJob(fastify, jobId);
  if (!staged) return null;
  const blockedRecords = staged.records.filter((record: any) => record.status === "blocked");
  const blockedRelationships = staged.relationships.filter((rel: any) => rel.status === "blocked");
  if (blockedRecords.length || blockedRelationships.length) {
    return { blocked: true, blockedRecords: blockedRecords.length, blockedRelationships: blockedRelationships.length };
  }

  const session = fastify.neo4j.session();
  let created = 0;
  let updated = 0;
  let relationships = 0;
  const rollbackRecords: DiscoveryRollbackRecord[] = [];
  const rollbackRelationships: DiscoveryRollbackRelationship[] = [];
  try {
    const commitRecords = staged.records.filter((record: any) => ["staged", "approved"].includes(record.status));
    for (const record of commitRecords) {
      const attrs = typeof record.attributes === "string" ? JSON.parse(record.attributes) : (record.attributes || {});
      const existing = await session.run("MATCH (n:ConfigurationItem {id: $id}) RETURN count(n) as count", { id: record.ci_id });
      const existed = (existing.records[0]?.get("count")?.toNumber?.() ?? Number(existing.records[0]?.get("count") || 0)) > 0;
      let oldProperties: Record<string, unknown> | null = null;
      if (existed) {
        const old = await session.run("MATCH (n:ConfigurationItem {id: $id}) RETURN properties(n) as props", { id: record.ci_id });
        oldProperties = old.records[0]?.get("props") || null;
      }
      const newProperties = {
        id: record.ci_id,
        name: record.name,
        class: record.target_class,
        environment: record.environment || null,
        attributes: JSON.stringify(attrs),
        ...attrs,
      };
      const result = await session.run(
        `MERGE (n:ConfigurationItem {id: $id})
         SET n.name = $name,
             n.class = $className,
             n.environment = $environment,
             n.attributes = $attributes,
             n += $attributesMap
         RETURN n`,
        {
          id: record.ci_id,
          name: record.name,
          className: record.target_class,
          environment: record.environment || null,
          attributes: JSON.stringify(attrs),
          attributesMap: attrs,
        }
      );
      result.records[0]?.get("n");
      if (!existed) created += 1;
      else updated += 1;
      rollbackRecords.push({
        stagedRecordId: record.id,
        ciId: record.ci_id,
        action: record.action,
        targetClass: record.target_class,
        name: record.name,
        existedBefore: existed,
        oldProperties,
        newProperties,
      });
      await fastify.pg.query(
        `UPDATE discovery_staged_records SET status = 'committed', committed_ci_id = $1, updated_at = NOW() WHERE id = $2`,
        [record.ci_id, record.id]
      );
      await fastify.pg.query(
        `INSERT INTO reconciliation_logs (discovery_job_id, ci_id, action, old_values, new_values)
         VALUES ($1, $2, $3, $4, $5)`,
        [jobId, record.ci_id, record.action, null, JSON.stringify({ name: record.name, class: record.target_class, environment: record.environment, attributes: attrs })]
      );
    }

    for (const relationship of staged.relationships.filter((rel: any) => ["staged", "approved"].includes(rel.status))) {
      const source = commitRecords.find((record: any) => record.row_number === relationship.row_number && record.target_class === relationship.from_class);
      if (!source || !relationship.target_hint) continue;
      const result = await session.run(
        `MATCH (source:ConfigurationItem {id: $sourceId})
         MATCH (target:ConfigurationItem)
         WHERE target.class = $toClass AND (target.name = $targetHint OR target.id = $targetHint)
         MERGE (source)-[r:${relationship.rel_type}]->(target)
         SET r.attributes = $attributes
         RETURN count(r) as count`,
        {
          sourceId: source.ci_id,
          toClass: relationship.to_class,
          targetHint: relationship.target_hint,
          attributes: JSON.stringify({ source: "discovery", discoveryJobId: jobId, confidence: Number(relationship.confidence || 0) }),
        }
      );
      const createdRelationship = (result.records[0]?.get("count")?.toNumber?.() ?? Number(result.records[0]?.get("count") || 0)) > 0;
      if (!createdRelationship) continue;
      relationships += 1;
      rollbackRelationships.push({
        stagedRelationshipId: relationship.id,
        sourceId: source.ci_id,
        relType: relationship.rel_type,
        toClass: relationship.to_class,
        targetHint: relationship.target_hint,
      });
      await fastify.pg.query(
        `UPDATE discovery_staged_relationships SET status = 'committed', updated_at = NOW() WHERE id = $1`,
        [relationship.id]
      );
    }

    const stats = { created, updated, relationships };
    if (rollbackRecords.length || rollbackRelationships.length) {
      await fastify.pg.query(
        `INSERT INTO discovery_rollbacks (discovery_job_id, summary, records, relationships, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [jobId, stats, JSON.stringify(rollbackRecords), JSON.stringify(rollbackRelationships), actorId || null]
      );
    }
    await fastify.pg.query("UPDATE discovery_jobs SET status = 'completed', stats = $1, updated_at = NOW() WHERE id = $2", [stats, jobId]);
    await fastify.pg.query(
      `UPDATE discovery_pipelines
       SET last_run_at = NOW(), updated_at = NOW()
       WHERE id = (SELECT pipeline_id FROM discovery_jobs WHERE id = $1)`,
      [jobId]
    );
    return { blocked: false, ...stats };
  } finally {
    await session.close();
  }
}

function parseJsonArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function listDiscoveryRollbacks(fastify: FastifyInstance, jobId?: string) {
  const params: unknown[] = [];
  let where = "";
  if (jobId) {
    params.push(jobId);
    where = "WHERE discovery_job_id = $1";
  }
  const result = await fastify.pg.query(
    `SELECT id, discovery_job_id, status, summary, created_by, applied_by, created_at, applied_at, updated_at
     FROM discovery_rollbacks
     ${where}
     ORDER BY created_at DESC
     LIMIT 50`,
    params
  );
  return result.rows;
}

export async function applyDiscoveryRollback(fastify: FastifyInstance, rollbackId: string, actorId?: string | null) {
  const result = await fastify.pg.query(
    `SELECT id, discovery_job_id, status, summary, records, relationships
     FROM discovery_rollbacks
     WHERE id = $1`,
    [rollbackId]
  );
  const rollback = result.rows[0];
  if (!rollback) return null;
  if (rollback.status === "applied") return { alreadyApplied: true as const, rollback };

  const records = parseJsonArray(rollback.records) as DiscoveryRollbackRecord[];
  const relationships = parseJsonArray(rollback.relationships) as DiscoveryRollbackRelationship[];
  const session = fastify.neo4j.session();
  let restored = 0;
  let deleted = 0;
  let deletedRelationships = 0;
  try {
    for (const relationship of relationships) {
      const type = relType(relationship.relType);
      if (!type) continue;
      const deletedResult = await session.run(
        `MATCH (source:ConfigurationItem {id: $sourceId})-[r:${type}]->(target:ConfigurationItem)
         WHERE target.class = $toClass AND (target.name = $targetHint OR target.id = $targetHint)
         WITH collect(r) AS rels, count(r) AS count
         FOREACH (rel IN rels | DELETE rel)
         RETURN count`,
        {
          sourceId: relationship.sourceId,
          toClass: relationship.toClass,
          targetHint: relationship.targetHint,
        }
      );
      deletedRelationships += deletedResult.records[0]?.get("count")?.toNumber?.() ?? Number(deletedResult.records[0]?.get("count") || 0);
    }

    for (const record of records.slice().reverse()) {
      if (record.existedBefore && record.oldProperties) {
        await session.run(
          `MATCH (n:ConfigurationItem {id: $id})
           SET n = $props
           RETURN n`,
          { id: record.ciId, props: record.oldProperties }
        );
        restored += 1;
      } else {
        const deletedResult = await session.run(
          `MATCH (n:ConfigurationItem {id: $id})
           WITH collect(n) AS nodes, count(n) AS count
           FOREACH (node IN nodes | DETACH DELETE node)
           RETURN count`,
          { id: record.ciId }
        );
        deleted += deletedResult.records[0]?.get("count")?.toNumber?.() ?? Number(deletedResult.records[0]?.get("count") || 0);
      }
    }

    const summary = { restored, deleted, deletedRelationships };
    const updated = await fastify.pg.query(
      `UPDATE discovery_rollbacks
       SET status = 'applied',
           applied_by = $2,
           applied_at = NOW(),
           updated_at = NOW(),
           summary = summary || $3::jsonb
       WHERE id = $1
       RETURNING id, discovery_job_id, status, summary, created_at, applied_at, updated_at`,
      [rollbackId, actorId || null, JSON.stringify({ rollback: summary })]
    );
    await fastify.pg.query(
      `UPDATE discovery_jobs
       SET status = 'rolled_back',
           stats = COALESCE(stats, '{}'::jsonb) || $2::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [rollback.discovery_job_id, JSON.stringify({ rollback: summary })]
    );
    return { alreadyApplied: false as const, rollback: updated.rows[0], ...summary };
  } finally {
    await session.close();
  }
}
