import { FastifyInstance } from "fastify";
import { enqueueJob, listJobs, getJobStatus } from "../services/jobQueue";

export async function jobQueueRoutes(fastify: FastifyInstance) {
  fastify.post("/api/jobs", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { type, payload, priority } = request.body as any;
    if (!type || !payload) {
      return reply.status(400).send({ error: "type and payload required" });
    }
    const job = await enqueueJob(fastify, type, payload, priority || 0);
    return job;
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
