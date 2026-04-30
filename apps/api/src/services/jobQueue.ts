import type { FastifyInstance } from "fastify";

export interface Job {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: string;
  priority: number;
  retries: number;
  maxRetries: number;
  errorMessage?: string;
  workerId?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

const JOB_STATUSES = new Set(["pending", "running", "completed", "failed"]);

type JobRow = {
  id: string;
  type: string;
  payload: Record<string, unknown> | string | null;
  status: string;
  priority: number | string;
  retries: number | string;
  max_retries: number | string;
  error_message?: string | null;
  worker_id?: string | null;
  started_at?: string | Date | null;
  completed_at?: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type JobStatusRow = {
  status: string;
  count: string | number;
};

function objectPayload(value: JobRow["payload"]): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export async function enqueueJob(
  fastify: FastifyInstance,
  type: string,
  payload: Record<string, unknown>,
  priority: number = 0
): Promise<Job> {
  const result = await fastify.pg.query(
    `INSERT INTO jobs (type, payload, priority)
     VALUES ($1, $2, $3)
     RETURNING id, type, payload, status, priority, retries, max_retries, error_message, worker_id, started_at, completed_at, created_at, updated_at`,
    [type, JSON.stringify(payload), priority]
  );
  return rowToJob(result.rows[0] as JobRow);
}

export async function claimJob(fastify: FastifyInstance, workerId: string): Promise<Job | null> {
  const client = await fastify.pg.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT id, type, payload, status, priority, retries, max_retries, error_message, worker_id, started_at, completed_at, created_at, updated_at
       FROM jobs
       WHERE status = 'pending'
       ORDER BY priority DESC, created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1`
    );
    if (!result.rows.length) {
      await client.query("COMMIT");
      return null;
    }
    const job = result.rows[0] as JobRow;
    await client.query(
      `UPDATE jobs SET status = 'running', worker_id = $1, started_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [workerId, job.id]
    );
    await client.query("COMMIT");
    return rowToJob({ ...job, status: "running", worker_id: workerId });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function completeJob(fastify: FastifyInstance, jobId: string): Promise<void> {
  await fastify.pg.query(
    `UPDATE jobs SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [jobId]
  );
}

export async function failJob(fastify: FastifyInstance, jobId: string, errorMessage: string): Promise<void> {
  const result = await fastify.pg.query(
    `SELECT retries, max_retries FROM jobs WHERE id = $1`,
    [jobId]
  );
  if (!result.rows.length) return;
  const { retries, max_retries } = result.rows[0] as { retries: number; max_retries: number };
  const newRetries = retries + 1;
  const shouldRetry = newRetries < max_retries;
  await fastify.pg.query(
    `UPDATE jobs SET status = $1, retries = $2, error_message = $3, updated_at = NOW() WHERE id = $4`,
    [shouldRetry ? "pending" : "failed", newRetries, errorMessage, jobId]
  );
}

export async function getJobQueueSummary(fastify: FastifyInstance, staleAfterMinutes = 30) {
  const result = await fastify.pg.query(
    `SELECT status, COUNT(*)::int AS count
     FROM jobs
     GROUP BY status
     ORDER BY status`
  );
  const stale = await fastify.pg.query(
    `SELECT COUNT(*)::int AS count
     FROM jobs
     WHERE status = 'running'
       AND updated_at < NOW() - ($1::int * INTERVAL '1 minute')`,
    [staleAfterMinutes]
  );
  const dead = await fastify.pg.query(
    `SELECT COUNT(*)::int AS count
     FROM jobs
     WHERE status = 'failed'
       AND retries >= max_retries`
  );
  return {
    generatedAt: new Date().toISOString(),
    staleAfterMinutes,
    byStatus: Object.fromEntries((result.rows as JobStatusRow[]).map((row) => [row.status, row.count])),
    staleRunning: (stale.rows[0] as { count?: string | number } | undefined)?.count || 0,
    deadLetter: (dead.rows[0] as { count?: string | number } | undefined)?.count || 0,
  };
}

export async function listDeadLetterJobs(fastify: FastifyInstance, limit = 100): Promise<Job[]> {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const result = await fastify.pg.query(
    `SELECT id, type, payload, status, priority, retries, max_retries, error_message, worker_id, started_at, completed_at, created_at, updated_at
     FROM jobs
     WHERE status = 'failed' AND retries >= max_retries
     ORDER BY updated_at DESC
     LIMIT $1`,
    [safeLimit]
  );
  return (result.rows as JobRow[]).map(rowToJob);
}

export async function requeueStaleRunningJobs(fastify: FastifyInstance, staleAfterMinutes = 30, limit = 100) {
  const safeMinutes = Math.min(Math.max(Number(staleAfterMinutes) || 30, 1), 1440);
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const result = await fastify.pg.query(
    `WITH stale AS (
       SELECT id
       FROM jobs
       WHERE status = 'running'
         AND updated_at < NOW() - ($1::int * INTERVAL '1 minute')
       ORDER BY updated_at ASC
       LIMIT $2
     )
     UPDATE jobs j
     SET status = CASE WHEN j.retries + 1 >= j.max_retries THEN 'failed' ELSE 'pending' END,
         retries = j.retries + 1,
         worker_id = NULL,
         error_message = 'Requeued after stale running timeout',
         updated_at = NOW()
     FROM stale
     WHERE j.id = stale.id
     RETURNING j.id, j.type, j.payload, j.status, j.priority, j.retries, j.max_retries, j.error_message, j.worker_id, j.started_at, j.completed_at, j.created_at, j.updated_at`,
    [safeMinutes, safeLimit]
  );
  return {
    staleAfterMinutes: safeMinutes,
    jobs: (result.rows as JobRow[]).map(rowToJob),
  };
}

export async function getJobStatus(fastify: FastifyInstance, jobId: string): Promise<Job | null> {
  const result = await fastify.pg.query(
    `SELECT id, type, payload, status, priority, retries, max_retries, error_message, worker_id, started_at, completed_at, created_at, updated_at
     FROM jobs WHERE id = $1`,
    [jobId]
  );
  return result.rows.length ? rowToJob(result.rows[0] as JobRow) : null;
}

export async function listJobs(
  fastify: FastifyInstance,
  filters: { status?: string; type?: string; limit?: number } = {}
): Promise<Job[]> {
  let query = `SELECT id, type, payload, status, priority, retries, max_retries, error_message, worker_id, started_at, completed_at, created_at, updated_at FROM jobs WHERE 1=1`;
  const params: unknown[] = [];
  let idx = 1;
  if (filters.status && JOB_STATUSES.has(filters.status)) {
    query += ` AND status = $${idx++}`;
    params.push(filters.status);
  }
  if (filters.type) {
    query += ` AND type = $${idx++}`;
    params.push(filters.type);
  }
  query += ` ORDER BY created_at DESC LIMIT $${idx++}`;
  params.push(Math.min(Math.max(Number(filters.limit) || 100, 1), 500));
  const result = await fastify.pg.query(query, params);
  return (result.rows as JobRow[]).map(rowToJob);
}

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    type: row.type,
    payload: objectPayload(row.payload),
    status: row.status,
    priority: Number(row.priority),
    retries: Number(row.retries),
    maxRetries: Number(row.max_retries),
    errorMessage: row.error_message || undefined,
    workerId: row.worker_id || undefined,
    startedAt: row.started_at ? String(row.started_at) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
