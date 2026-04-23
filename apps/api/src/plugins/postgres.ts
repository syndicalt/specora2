import fp from "fastify-plugin";
import { Pool, PoolClient } from "pg";

declare module "fastify" {
  interface FastifyInstance {
    pg: PoolClient;
  }
}

export const postgresPlugin = fp(async (fastify) => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://specora:specora@localhost:5432/specora",
  });
  const client = await pool.connect();
  fastify.decorate("pg", client);
  fastify.addHook("onClose", async () => {
    client.release();
    await pool.end();
  });
});
