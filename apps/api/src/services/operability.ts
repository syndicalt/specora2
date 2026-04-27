import type { FastifyInstance } from "fastify";
import { getRedis, isRedisAvailable } from "./redis";

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

const REQUIRED_ENV = ["DATABASE_URL", "NEO4J_URI", "NEO4J_USER", "NEO4J_PASSWORD", "JWT_SECRET"];
const RECOMMENDED_ENV = ["WORKER_GRPC_HOST", "REDIS_URL", "PROVARA_URL", "PROVARA_API_KEY"];

async function timed<T>(name: string, fn: () => Promise<T>): Promise<RuntimeCheck> {
  const started = Date.now();
  try {
    await fn();
    return { name, status: "ok", latencyMs: Date.now() - started };
  } catch (err: any) {
    return { name, status: "fail", latencyMs: Date.now() - started, message: err?.message || "check failed" };
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

  checks.push({
    name: "worker",
    status: process.env.WORKER_GRPC_HOST ? "ok" : "warn",
    message: process.env.WORKER_GRPC_HOST ? `Configured at ${process.env.WORKER_GRPC_HOST}` : "WORKER_GRPC_HOST not configured",
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
