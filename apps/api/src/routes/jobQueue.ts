import type { FastifyInstance } from "fastify";
import { enqueueJob, listJobs, getJobStatus, getJobQueueSummary, listDeadLetterJobs, requeueStaleRunningJobs } from "../services/jobQueue";
import { requirePermission } from "../services/rbac";

type JobCreateBody = {
  type?: string;
  payload?: Record<string, unknown>;
  priority?: number;
};

type JobSummaryQuery = {
  staleAfterMinutes?: string;
};

type JobListQuery = {
  status?: string;
  type?: string;
  limit?: string;
};

type RequeueBody = {
  staleAfterMinutes?: number;
  limit?: number;
};

export async function jobQueueRoutes(fastify: FastifyInstance) {
  const canReadJobs = requirePermission("system-properties", "read");
  const canWriteJobs = requirePermission("system-properties", "write");

  fastify.post("/api/jobs", { onRequest: [fastify.authenticate, canWriteJobs] }, async (request, reply) => {
    const { type, payload, priority } = request.body as JobCreateBody;
    if (!type || !payload) {
      return reply.status(400).send({ error: "type and payload required" });
    }
    const job = await enqueueJob(fastify, type, payload, priority || 0);
    return job;
  });

  fastify.get("/api/jobs/summary", { onRequest: [fastify.authenticate, canReadJobs] }, async (request) => {
    const { staleAfterMinutes } = request.query as JobSummaryQuery;
    return getJobQueueSummary(fastify, staleAfterMinutes ? Number(staleAfterMinutes) : undefined);
  });

  fastify.get("/api/jobs/dead-letter", { onRequest: [fastify.authenticate, canReadJobs] }, async (request) => {
    const { limit } = request.query as { limit?: string };
    const jobs = await listDeadLetterJobs(fastify, limit ? Number(limit) : undefined);
    return { jobs };
  });

  fastify.post("/api/jobs/requeue-stale", { onRequest: [fastify.authenticate, canWriteJobs] }, async (request) => {
    const { staleAfterMinutes, limit } = (request.body || {}) as RequeueBody;
    return requeueStaleRunningJobs(fastify, staleAfterMinutes, limit);
  });

  fastify.get("/api/jobs", { onRequest: [fastify.authenticate, canReadJobs] }, async (request, _reply) => {
    const { status, type, limit } = request.query as JobListQuery;
    const jobs = await listJobs(fastify, { status, type, limit: limit ? Number(limit) : undefined });
    return { jobs };
  });

  fastify.get("/api/jobs/:id", { onRequest: [fastify.authenticate, canReadJobs] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await getJobStatus(fastify, id);
    if (!job) {
      return reply.status(404).send({ error: "Job not found" });
    }
    return job;
  });
}
