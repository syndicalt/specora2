import type { FastifyInstance } from "fastify";
import { getRedis, isRedisAvailable } from "./redis";
import { workerClient } from "../grpc/client";
import { getJobQueueSummary } from "./jobQueue";

type CheckStatus = "ok" | "warn" | "fail";

type RuntimeCheck = {
  name: string;
  status: CheckStatus;
  latencyMs?: number;
  message?: string;
};

type ConfigCheck = {
  key: string;
  status: CheckStatus;
  message: string;
};

type WorkerHealthOptions = {
  ping?: () => Promise<{ status: string }>;
  env?: NodeJS.ProcessEnv;
};

type DiscoveryStatusRow = {
  status?: string | null;
  count?: string | number | null;
};

type QueueSummary = {
  deadLetter?: number;
  staleRunning?: number;
};

const REQUIRED_ENV = ["DATABASE_URL", "NEO4J_URI", "NEO4J_USER", "NEO4J_PASSWORD", "JWT_SECRET"];
const RECOMMENDED_ENV = ["WORKER_GRPC_HOST", "REDIS_URL", "PROVARA_URL", "PROVARA_API_KEY"];

async function timed<T>(name: string, fn: () => Promise<T>): Promise<RuntimeCheck> {
  const started = Date.now();
  try {
    await fn();
    return { name, status: "ok", latencyMs: Date.now() - started };
  } catch (err) {
    return { name, status: "fail", latencyMs: Date.now() - started, message: err instanceof Error && err.message ? err.message : "check failed" };
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function buildConfigAudit(env: NodeJS.ProcessEnv = process.env) {
  const checks: ConfigCheck[] = [];
  for (const key of REQUIRED_ENV) {
    checks.push({
      key,
      status: env[key] ? "ok" : "fail",
      message: env[key] ? "Configured" : "Required for production operation",
    });
  }
  for (const key of RECOMMENDED_ENV) {
    checks.push({
      key,
      status: env[key] ? "ok" : "warn",
      message: env[key] ? "Configured" : "Recommended for production resilience or feature completeness",
    });
  }
  if (!env.PROVARA_API_KEY && !env.OPENAI_API_KEY) {
    checks.push({ key: "LLM_PROVIDER", status: "warn", message: "No Provara or OpenAI key configured; AI workflows will be unavailable" });
  }
  if (!env.JWT_SECRET || env.JWT_SECRET === "change-me" || env.JWT_SECRET.length < 32) {
    checks.push({ key: "JWT_SECRET_STRENGTH", status: "fail", message: "JWT_SECRET must be unique and at least 32 characters in production" });
  }
  const failures = checks.filter((check) => check.status === "fail").length;
  const warnings = checks.filter((check) => check.status === "warn").length;
  return {
    status: failures ? "fail" : warnings ? "warn" : "ok",
    failures,
    warnings,
    checks,
  };
}

export async function buildWorkerHealth(fastify: FastifyInstance, options: WorkerHealthOptions = {}) {
  const env = options.env || process.env;
  const target = env.WORKER_GRPC_HOST || "";
  const ping = options.ping || (() => workerClient.runGraphMaintenance({ task: "health_check" }));
  const checkedAt = new Date().toISOString();

  const queue = await getJobQueueSummary(fastify, 30);
  const discovery = await fastify.pg.query(
    `SELECT status, COUNT(*)::int AS count
     FROM discovery_jobs
     WHERE created_at >= NOW() - INTERVAL '24 hours'
     GROUP BY status`
  );
  const discoveryJobs24h = Object.fromEntries((discovery.rows as DiscoveryStatusRow[]).map((row) => [row.status || "unknown", Number(row.count || 0)]));

  let grpc: RuntimeCheck;
  if (!target) {
    grpc = { name: "worker.grpc", status: "warn", message: "WORKER_GRPC_HOST not configured" };
  } else {
    grpc = await timed("worker.grpc", async () => {
      await withTimeout(ping(), 1_500, "Worker gRPC health check");
    });
    if (grpc.status === "ok") grpc.message = `Reachable at ${target}`;
  }

  const queueSummary = queue as QueueSummary;
  const deadLetter = Number(queueSummary.deadLetter || 0);
  const staleRunning = Number(queueSummary.staleRunning || 0);
  const failedDiscovery = Number(discoveryJobs24h.failed || 0);
  const status: CheckStatus = grpc.status === "fail" || deadLetter > 0 || staleRunning > 0 || failedDiscovery > 0
    ? "warn"
    : grpc.status;

  return {
    status,
    checkedAt,
    grpc,
    queue,
    discoveryJobs24h,
    signals: {
      deadLetter,
      staleRunning,
      failedDiscovery,
    },
  };
}

export async function buildReadiness(fastify: FastifyInstance) {
  const checks: RuntimeCheck[] = [];
  checks.push(await timed("postgres", async () => {
    await withTimeout(fastify.pg.query("SELECT 1"), 1_000, "PostgreSQL");
  }));
  checks.push(await timed("neo4j", async () => {
    const session = fastify.neo4j.session();
    try {
      await withTimeout(session.run("RETURN 1 AS ok"), 1_500, "Neo4j");
    } finally {
      await session.close();
    }
  }));

  const redis = getRedis();
  if (redis) {
    const redisCheck = await timed("redis", async () => {
      await withTimeout(redis.ping(), 750, "Redis");
    });
    checks.push(redisCheck.status === "fail" && !isRedisAvailable()
      ? { ...redisCheck, status: "warn", message: redisCheck.message || "Redis unavailable; falling back to local instance behavior" }
      : redisCheck);
  } else {
    checks.push({ name: "redis", status: "warn", message: "Redis client could not be initialized" });
  }

  const worker = await buildWorkerHealth(fastify);
  checks.push({
    name: "worker",
    status: worker.status,
    latencyMs: worker.grpc.latencyMs,
    message: worker.grpc.message || (worker.status === "ok" ? "Worker reachable and queues healthy" : "Worker or queue posture needs attention"),
  });
  checks.push({
    name: "llm",
    status: process.env.PROVARA_API_KEY || process.env.OPENAI_API_KEY ? "ok" : "warn",
    message: process.env.PROVARA_API_KEY ? "Provara configured" : process.env.OPENAI_API_KEY ? "OpenAI fallback configured" : "No LLM provider configured",
  });

  const failed = checks.filter((check) => check.status === "fail").length;
  const warnings = checks.filter((check) => check.status === "warn").length;
  return {
    status: failed ? "fail" : warnings ? "degraded" : "ok",
    checkedAt: new Date().toISOString(),
    checks,
  };
}
