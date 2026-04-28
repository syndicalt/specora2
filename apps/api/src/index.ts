import "dotenv/config";
import Fastify from "fastify";
import { readFileSync } from "fs";
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
import { appsRoutes } from "./routes/apps";
import { tableRoutes } from "./routes/tables";
import { dataFoundationRoutes } from "./routes/dataFoundations";
import { changeAutomationRoutes } from "./routes/changeAutomation";
import { incidentAutomationRoutes } from "./routes/incidentAutomation";
import { knowledgeAutomationRoutes } from "./routes/knowledgeAutomation";
import { preventionAutomationRoutes } from "./routes/preventionAutomation";
import { assetAutomationRoutes } from "./routes/assetAutomation";
import { itVisibilityRoutes } from "./routes/itVisibility";
import { reportingRoutes } from "./routes/reporting";
import { initializeAuditLog } from "./services/auditLog";
import { websocketRoutes } from "./services/websocket";
import { initializeEventBus } from "./services/eventBus";
import { seedCIClasses } from "./services/ciClassSeed";
import { registerAllAppTools } from "./services/appTools";
import { startDiscoveryScheduler } from "./services/discoveryScheduler";
import { buildReadiness } from "./services/operability";

function localHttpsOptions() {
  const keyPath = process.env.HTTPS_KEY_FILE || process.env.SSL_KEY_FILE;
  const certPath = process.env.HTTPS_CERT_FILE || process.env.SSL_CERT_FILE;
  if (!keyPath || !certPath) return undefined;
  return {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  };
}

const httpsOptions = localHttpsOptions();

const fastify: any = Fastify({
  logger: { transport: { target: "pino-pretty" } },
  https: httpsOptions,
} as any);

declare module "fastify" {
  interface FastifyInstance {
    pathlight?: any;
  }
}

async function main() {
  await fastify.register(cors, {
    origin: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  await fastify.register(rateLimit, {
    max: Number(process.env.RATE_LIMIT_MAX || 2000),
    timeWindow: "1 minute",
    skipOnError: false,
  });
  await fastify.register(jwt, { secret: process.env.JWT_SECRET || "change-me" });
  await fastify.register(neo4jPlugin);
  await fastify.register(postgresPlugin);

  // Seed built-in CI classes if empty
  await seedCIClasses(fastify.pg);

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

  // Initialize Redis-backed event bus for multi-instance scale
  initializeEventBus();

  // Explicit app tool registration (must happen before chatRoutes)
  registerAllAppTools();

  await fastify.register(chatRoutes);
  await fastify.register(authRoutes);
  await fastify.register(discoveryRoutes);
  await fastify.register(eventBusRoutes);
  await fastify.register(appToolRoutes);
  await fastify.register(healthRoutes);
  await fastify.register(jobQueueRoutes);
  await fastify.register(adminRoutes);
  await fastify.register(appsRoutes);
  await fastify.register(tableRoutes);
  await fastify.register(dataFoundationRoutes);
  await fastify.register(changeAutomationRoutes);
  await fastify.register(incidentAutomationRoutes);
  await fastify.register(knowledgeAutomationRoutes);
  await fastify.register(preventionAutomationRoutes);
  await fastify.register(assetAutomationRoutes);
  await fastify.register(itVisibilityRoutes);
  await fastify.register(reportingRoutes);

  initializeAuditLog(fastify);
  startDiscoveryScheduler(fastify);

  fastify.get("/health", async () => ({ status: "ok" }));
  fastify.get("/healthz", async () => ({ status: "ok" }));
  fastify.get("/ready", async (_request: any, reply: any) => {
    const readiness = await buildReadiness(fastify);
    if (readiness.status === "fail") return reply.status(503).send(readiness);
    return readiness;
  });

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
    handler: async (req: any, reply: any) => {
      const response = await yoga.handleNodeRequest(req, { req, reply } as any);
      response.headers.forEach((value, key) => reply.header(key, value));
      reply.status(response.status);
      reply.send(response.body);
      return reply;
    },
  });

  const port = Number(process.env.PORT || 4000);
  await fastify.listen({ port, host: "0.0.0.0" });
  const protocol = httpsOptions ? "https" : "http";
  fastify.log.info(`API running on ${protocol}://0.0.0.0:${port}/graphql`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
