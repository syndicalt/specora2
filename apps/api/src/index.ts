import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { createYoga } from "graphql-yoga";
import { schema } from "./graphql/schema";
import { neo4jPlugin } from "./plugins/neo4j";
import { postgresPlugin } from "./plugins/postgres";
import { authPlugin } from "./plugins/jwt";
import { workerClient } from "./grpc/client";
import { chatRoutes } from "./routes/chat";
import { authRoutes } from "./routes/auth";
import { discoveryRoutes } from "./routes/discovery";
import { eventBusRoutes, emit } from "./services/eventBus";
import { appToolRoutes } from "./routes/appTools";
import { healthRoutes } from "./routes/health";
import { jobQueueRoutes } from "./routes/jobQueue";
import { adminRoutes } from "./routes/admin";
import { initializeAuditLog } from "./services/auditLog";
import { websocketRoutes } from "./services/websocket";

const fastify = Fastify({ logger: { transport: { target: "pino-pretty" } } });

declare module "fastify" {
  interface FastifyInstance {
    pathlight?: any;
  }
}

async function main() {
  await fastify.register(cors, { origin: true });
  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
    skipOnError: true,
  });
  await fastify.register(jwt, { secret: process.env.JWT_SECRET || "change-me" });
  await fastify.register(neo4jPlugin);
  await fastify.register(postgresPlugin);
  await fastify.register(multipart);
  await fastify.register(authPlugin);

  // Pathlight tracing (optional)
  const pathlightUrl = process.env.PATHLIGHT_URL;
  if (pathlightUrl) {
    try {
      const { Pathlight } = await import("@pathlight/sdk");
      const pathlight = new Pathlight({ baseUrl: pathlightUrl });
      fastify.decorate("pathlight", pathlight);
      fastify.log.info(`Pathlight tracing enabled: ${pathlightUrl}`);
    } catch (err: any) {
      fastify.log.warn(`Failed to initialize Pathlight: ${err.message}`);
    }
  }

  await fastify.register(require("@fastify/websocket"));
  await fastify.register(websocketRoutes);
  await fastify.register(chatRoutes);
  await fastify.register(authRoutes);
  await fastify.register(discoveryRoutes);
  await fastify.register(eventBusRoutes);
  await fastify.register(appToolRoutes);
  await fastify.register(healthRoutes);
  await fastify.register(jobQueueRoutes);
  await fastify.register(adminRoutes);

  initializeAuditLog(fastify);

  fastify.get("/health", async () => ({ status: "ok" }));

  const yoga = createYoga({
    schema,
    context: async ({ request }) => {
      let user = null;
      try {
        const auth = request.headers.get("authorization");
        const token = auth?.replace("Bearer ", "");
        if (token) user = await fastify.jwt.verify(token);
      } catch {}
      return { neo4j: fastify.neo4j, pg: fastify.pg, user, worker: workerClient, emit };
    },
  });

  fastify.route({
    url: "/graphql",
    method: ["POST", "GET", "OPTIONS"],
    onRequest: fastify.authenticate,
    handler: async (req, reply) => {
      const response = await yoga.handleNodeRequest(req, { req, reply } as any);
      response.headers.forEach((value, key) => reply.header(key, value));
      reply.status(response.status);
      reply.send(response.body);
      return reply;
    },
  });

  const port = Number(process.env.PORT || 4000);
  await fastify.listen({ port, host: "0.0.0.0" });
  fastify.log.info(`API running on http://0.0.0.0:${port}/graphql`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
