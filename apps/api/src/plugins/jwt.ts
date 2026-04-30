import fp from "fastify-plugin";
import { FastifyReply, FastifyRequest } from "fastify";
import { isAccessSessionActive } from "../services/authSessions";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const authPlugin = fp(async (fastify) => {
  fastify.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const user = request.user;
      if (user.typ && user.typ !== "access" && user.type !== "ws-ticket") {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      if (user.typ === "access") {
        const active = await isAccessSessionActive(fastify, request.user.sid, request.user.id);
        if (!active) return reply.code(401).send({ error: "Unauthorized" });
      }
    } catch {
      reply.code(401).send({ error: "Unauthorized" });
    }
  });
});
