import { FastifyInstance } from "fastify";

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
  return rowToJob(result.rows[0]);
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
    const job = result.rows[0];
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
  const { retries, max_retries } = result.rows[0];
  const newRetries = retries + 1;
  const shouldRetry = newRetries < max_retries;
  await fastify.pg.query(
    `UPDATE jobs SET status = $1, retries = $2, error_message = $3, updated_at = NOW() WHERE id = $4`,
    [shouldRetry ? "pending" : "failed", newRetries, errorMessage, jobId]
  );
}

export async function getJobStatus(fastify: FastifyInstance, jobId: string): Promise<Job | null> {
  const result = await fastify.pg.query(
    `SELECT id, type, payload, status, priority, retries, max_retries, error_message, worker_id, started_at, completed_at, created_at, updated_at
     FROM jobs WHERE id = $1`,
    [jobId]
  );
  return result.rows.length ? rowToJob(result.rows[0]) : null;
}

export async function listJobs(
  fastify: FastifyInstance,
  filters: { status?: string; type?: string; limit?: number } = {}
): Promise<Job[]> {
  let query = `SELECT id, type, payload, status, priority, retries, max_retries, error_message, worker_id, started_at, completed_at, created_at, updated_at FROM jobs WHERE 1=1`;
  const params: any[] = [];
  let idx = 1;
  if (filters.status) {
    query += ` AND status = $${idx++}`;
    params.push(filters.status);
  }
  if (filters.type) {
    query += ` AND type = $${idx++}`;
    params.push(filters.type);
  }
  query += ` ORDER BY created_at DESC LIMIT $${idx++}`;
  params.push(filters.limit || 100);
  const result = await fastify.pg.query(query, params);
  return result.rows.map(rowToJob);
}

function rowToJob(row: any): Job {
  return {
    id: row.id,
    type: row.type,
    payload: row.payload,
    status: row.status,
    priority: row.priority,
    retries: row.retries,
    maxRetries: row.max_retries,
    errorMessage: row.error_message,
    workerId: row.worker_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
