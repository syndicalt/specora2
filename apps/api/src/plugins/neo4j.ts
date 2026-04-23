import fp from "fastify-plugin";
import neo4j, { Driver } from "neo4j-driver";

declare module "fastify" {
  interface FastifyInstance {
    neo4j: Driver;
  }
}

export const neo4jPlugin = fp(async (fastify) => {
  const driver = neo4j.driver(
    process.env.NEO4J_URI || "bolt://localhost:7687",
    neo4j.auth.basic(
      process.env.NEO4J_USER || "neo4j",
      process.env.NEO4J_PASSWORD || "specora"
    )
  );
  fastify.decorate("neo4j", driver);
  fastify.addHook("onClose", async () => {
    await driver.close();
  });
});
