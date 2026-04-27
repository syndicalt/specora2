import { FastifyInstance } from "fastify";
import { enqueueJob, listJobs, getJobStatus, getJobQueueSummary, listDeadLetterJobs, requeueStaleRunningJobs } from "../services/jobQueue";

export async function jobQueueRoutes(fastify: FastifyInstance) {
  fastify.post("/api/jobs", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { type, payload, priority } = request.body as any;
    if (!type || !payload) {
      return reply.status(400).send({ error: "type and payload required" });
    }
    const job = await enqueueJob(fastify, type, payload, priority || 0);
    return job;
  });

  fastify.get("/api/jobs/summary", { onRequest: [fastify.authenticate] }, async (request) => {
    const { staleAfterMinutes } = request.query as any;
    return getJobQueueSummary(fastify, staleAfterMinutes ? Number(staleAfterMinutes) : undefined);
  });

  fastify.get("/api/jobs/dead-letter", { onRequest: [fastify.authenticate] }, async (request) => {
    const { limit } = request.query as any;
    const jobs = await listDeadLetterJobs(fastify, limit ? Number(limit) : undefined);
    return { jobs };
  });

  fastify.post("/api/jobs/requeue-stale", { onRequest: [fastify.authenticate] }, async (request) => {
    const { staleAfterMinutes, limit } = request.body as any || {};
    return requeueStaleRunningJobs(fastify, staleAfterMinutes, limit);
  });

  fastify.get("/api/jobs", { onRequest: [fastify.authenticate] }, async (request, _reply) => {
    const { status, type, limit } = request.query as any;
    const jobs = await listJobs(fastify, { status, type, limit: limit ? Number(limit) : undefined });
    return { jobs };
  });

  fastify.get("/api/jobs/:id", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await getJobStatus(fastify, id);
    if (!job) {
      return reply.status(404).send({ error: "Job not found" });
    }
    return job;
  });
}
