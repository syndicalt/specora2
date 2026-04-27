import { describe, expect, it } from "vitest";
import { buildConfigAudit, buildWorkerHealth } from "./operability";

describe("operability config audit", () => {
  it("fails missing required production configuration", () => {
    const audit = buildConfigAudit({});

    expect(audit.status).toBe("fail");
    expect(audit.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "DATABASE_URL", status: "fail" }),
      expect.objectContaining({ key: "JWT_SECRET_STRENGTH", status: "fail" }),
    ]));
  });

  it("passes required configuration and warns on optional integrations", () => {
    const audit = buildConfigAudit({
      DATABASE_URL: "postgres://example",
      NEO4J_URI: "bolt://example",
      NEO4J_USER: "neo4j",
      NEO4J_PASSWORD: "secret",
      JWT_SECRET: "a-production-grade-secret-with-enough-length",
    });

    expect(audit.failures).toBe(0);
    expect(audit.status).toBe("warn");
    expect(audit.warnings).toBeGreaterThan(0);
  });

  it("combines worker ping, queue posture, and discovery job health", async () => {
    const fastify = {
      pg: {
        query: async (sql: string) => {
          if (sql.includes("FROM jobs") && sql.includes("GROUP BY status")) return { rows: [{ status: "pending", count: 2 }] };
          if (sql.includes("status = 'running'")) return { rows: [{ count: 1 }] };
          if (sql.includes("status = 'failed'")) return { rows: [{ count: 0 }] };
          if (sql.includes("FROM discovery_jobs")) return { rows: [{ status: "failed", count: 1 }] };
          return { rows: [] };
        },
      },
    } as any;

    const health = await buildWorkerHealth(fastify, {
      env: { WORKER_GRPC_HOST: "worker:50051" },
      ping: async () => ({ status: "ok" }),
    });

    expect(health.status).toBe("warn");
    expect(health.grpc).toMatchObject({ name: "worker.grpc", status: "ok" });
    expect(health.queue).toMatchObject({ staleRunning: 1, deadLetter: 0 });
    expect(health.discoveryJobs24h).toMatchObject({ failed: 1 });
  });
});
