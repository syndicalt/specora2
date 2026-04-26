import type { FastifyInstance } from "fastify";
import { enqueueJob } from "./jobQueue";
import { stageDiscoveryPipeline } from "./discoveryExecution";
import type { TargetClass } from "./discoveryTransform";

export type DiscoveryScheduleInterval = "manual" | "hourly" | "daily" | "weekly" | "monthly";

export type DiscoveryRunResult =
  | { ok: true; pipelineId: string; discoveryJobId: string; preview: Record<string, unknown> }
  | { ok: false; pipelineId: string; status: "not_found" | "not_ready" | "failed"; error: string; preview?: unknown };

type DueSchedule = {
  pipeline_id: string;
  interval: DiscoveryScheduleInterval;
  next_run_at: string | Date | null;
};

const INTERVALS = new Set<DiscoveryScheduleInterval>(["manual", "hourly", "daily", "weekly", "monthly"]);

export function normalizeScheduleInterval(value: unknown): DiscoveryScheduleInterval {
  return typeof value === "string" && INTERVALS.has(value as DiscoveryScheduleInterval)
    ? value as DiscoveryScheduleInterval
    : "manual";
}

export function nextDiscoveryRunAt(interval: DiscoveryScheduleInterval, from: Date = new Date()) {
  if (interval === "manual") return null;
  const next = new Date(from.getTime());
  if (interval === "hourly") next.setUTCHours(next.getUTCHours() + 1);
  if (interval === "daily") next.setUTCDate(next.getUTCDate() + 1);
  if (interval === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  if (interval === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

export async function runSavedDiscoveryPipeline(
  fastify: FastifyInstance,
  pipelineId: string,
  targetClasses: TargetClass[] = [],
  source: "manual" | "scheduled" = "manual"
): Promise<DiscoveryRunResult> {
  try {
    const pipelineResult = await fastify.pg.query(
      `SELECT id, name, version, definition, published_definition FROM discovery_pipelines WHERE id = $1`,
      [pipelineId]
    );
    if (!pipelineResult.rows.length) {
      return { ok: false, pipelineId, status: "not_found", error: "Pipeline not found" };
    }

    const pipelineRow = pipelineResult.rows[0];
    const definition = pipelineRow.published_definition || pipelineRow.definition || {};
    const staged = await stageDiscoveryPipeline(fastify, {
      pipelineId: pipelineRow.id,
      pipelineName: pipelineRow.name,
      definition,
      targetClasses,
      pipelineVersion: pipelineRow.version,
      triggerSource: source,
    });
    if (!staged.ready) {
      return { ok: false, pipelineId, status: "not_ready", error: "Pipeline is not ready to run", preview: staged.preview };
    }

    await enqueueJob(
      fastify,
      "discovery_pipeline",
      { pipelineId: pipelineRow.id, discoveryJobId: staged.job.id, preview: staged.preview.summary, source },
      source === "scheduled" ? 1 : 0
    );
    return { ok: true, pipelineId, discoveryJobId: staged.job.id, preview: staged.preview.summary };
  } catch (err: any) {
    return { ok: false, pipelineId, status: "failed", error: err?.message || "Discovery run failed" };
  }
}

export async function claimDueDiscoverySchedules(
  fastify: FastifyInstance,
  now: Date = new Date(),
  limit = 10
): Promise<DueSchedule[]> {
  const client = await fastify.pg.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT pipeline_id, interval, next_run_at
       FROM discovery_pipeline_schedules
       WHERE enabled = TRUE
         AND interval <> 'manual'
         AND next_run_at IS NOT NULL
         AND next_run_at <= $1
       ORDER BY next_run_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $2`,
      [now.toISOString(), limit]
    );

    for (const row of result.rows) {
      const interval = normalizeScheduleInterval(row.interval);
      await client.query(
        `UPDATE discovery_pipeline_schedules
         SET last_run_at = $2,
             next_run_at = $3,
             last_status = 'claimed',
             last_error = NULL,
             updated_at = NOW()
         WHERE pipeline_id = $1`,
        [row.pipeline_id, now.toISOString(), nextDiscoveryRunAt(interval, now)?.toISOString() || null]
      );
    }

    await client.query("COMMIT");
    return result.rows.map((row: any) => ({
      pipeline_id: row.pipeline_id,
      interval: normalizeScheduleInterval(row.interval),
      next_run_at: row.next_run_at,
    }));
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function recordDiscoveryScheduleResult(fastify: FastifyInstance, result: DiscoveryRunResult) {
  await fastify.pg.query(
    `UPDATE discovery_pipeline_schedules
     SET last_discovery_job_id = $2,
         last_status = $3,
         last_error = $4,
         updated_at = NOW()
     WHERE pipeline_id = $1`,
    [
      result.pipelineId,
      result.ok ? result.discoveryJobId : null,
      result.ok ? "queued" : result.status,
      result.ok ? null : result.error,
    ]
  );
}

export async function runDiscoverySchedulerCycle(fastify: FastifyInstance, now: Date = new Date(), limit = 10) {
  const due = await claimDueDiscoverySchedules(fastify, now, limit);
  const results: DiscoveryRunResult[] = [];
  for (const schedule of due) {
    const result = await runSavedDiscoveryPipeline(fastify, schedule.pipeline_id, [], "scheduled");
    await recordDiscoveryScheduleResult(fastify, result);
    results.push(result);
  }
  return results;
}

export function startDiscoveryScheduler(fastify: FastifyInstance, intervalMs = Number(process.env.DISCOVERY_SCHEDULER_INTERVAL_MS || 60_000)) {
  if (process.env.DISCOVERY_SCHEDULER_ENABLED === "false") return null;

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const results = await runDiscoverySchedulerCycle(fastify);
      if (results.length) fastify.log.info({ results }, "Discovery scheduler processed due pipelines");
    } catch (err: any) {
      fastify.log.error({ err }, "Discovery scheduler failed");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  fastify.addHook("onClose", async () => clearInterval(timer));
  void tick();
  return timer;
}
