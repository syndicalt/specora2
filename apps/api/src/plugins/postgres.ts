import fp from "fastify-plugin";
import { Pool } from "pg";

declare module "fastify" {
  interface FastifyInstance {
    pg: Pool;
  }
}

export const postgresPlugin = fp(async (fastify) => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://specora:specora123@localhost:5432/specora",
  });
  fastify.decorate("pg", pool);
  fastify.addHook("onClose", async () => {
    await pool.end();
  });
});
