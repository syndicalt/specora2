import { FastifyInstance } from "fastify";
import { chat } from "../services/chat";

export async function chatRoutes(fastify: FastifyInstance) {
  fastify.post("/api/chat", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const body = request.body as { messages: { role: "user" | "assistant"; content: string }[] };
    if (!body.messages || !Array.isArray(body.messages)) {
      return reply.status(400).send({ error: "messages array required" });
    }

    try {
      const response = await chat(body.messages, fastify);
      return { role: "assistant", content: response };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || "Chat failed" });
    }
  });
}
