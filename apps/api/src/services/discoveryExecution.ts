import type { FastifyInstance } from "fastify";
import { previewPipeline, type PipelineDefinition, type TargetClass } from "./discoveryTransform";

const ALLOWED_RELATIONSHIPS = new Set(["PART_OF", "DEPENDS_ON", "HOSTED_ON", "MANAGED_BY", "OWNED_BY", "LOCATED_AT"]);

function stableCiId(targetClass: string, name: string, environment?: string) {
  const slug = [targetClass, environment || "global", name]
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 180);
  return `disc-${slug}`;
}

function relType(type: string) {
  if (type === "RUNS_ON") return "HOSTED_ON";
  return ALLOWED_RELATIONSHIPS.has(type) ? type : null;
}

export async function stageDiscoveryPipeline(
  fastify: FastifyInstance,
  input: { pipelineId: string; pipelineName: string; definition: PipelineDefinition; targetClasses: TargetClass[]; pipelineVersion?: number; triggerSource?: "manual" | "scheduled" }
) {
  const preview = previewPipeline(input.definition, input.targetClasses);
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
    const ciId = stableCiId(record.targetClass, record.name, record.environment);
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
        normalizedType ? "staged" : "blocked",
        normalizedType ? null : `Unsupported relationship type ${relationship.type}`,
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

export async function commitStagedDiscoveryJob(fastify: FastifyInstance, jobId: string) {
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
  try {
    const commitRecords = staged.records.filter((record: any) => ["staged", "approved"].includes(record.status));
    for (const record of commitRecords) {
      const attrs = typeof record.attributes === "string" ? JSON.parse(record.attributes) : (record.attributes || {});
      const existing = await session.run("MATCH (n:ConfigurationItem {id: $id}) RETURN count(n) as count", { id: record.ci_id });
      const existed = (existing.records[0]?.get("count")?.toNumber?.() ?? Number(existing.records[0]?.get("count") || 0)) > 0;
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
      await session.run(
        `MATCH (source:ConfigurationItem {id: $sourceId})
         MATCH (target:ConfigurationItem)
         WHERE target.class = $toClass AND (target.name = $targetHint OR target.id = $targetHint)
         MERGE (source)-[r:${relationship.rel_type}]->(target)
         SET r.attributes = $attributes`,
        {
          sourceId: source.ci_id,
          toClass: relationship.to_class,
          targetHint: relationship.target_hint,
          attributes: JSON.stringify({ source: "discovery", discoveryJobId: jobId, confidence: Number(relationship.confidence || 0) }),
        }
      );
      relationships += 1;
      await fastify.pg.query(
        `UPDATE discovery_staged_relationships SET status = 'committed', updated_at = NOW() WHERE id = $1`,
        [relationship.id]
      );
    }

    const stats = { created, updated, relationships };
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
