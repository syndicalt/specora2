import neo4j from "neo4j-driver";
import { CONSTRAINTS, SEED_DATA_CYPHER } from "./schema";

export async function seed(driver?: neo4j.Driver) {
  const shouldClose = !driver;
  const d = driver || neo4j.driver(
    process.env.NEO4J_URI || "bolt://localhost:7687",
    neo4j.auth.basic(
      process.env.NEO4J_USER || "neo4j",
      process.env.NEO4J_PASSWORD || "specora123"
    )
  );
  const session = d.session();
  try {
    for (const c of CONSTRAINTS) {
      await session.run(c);
    }
    await session.run(SEED_DATA_CYPHER);
    console.log("Neo4j seed complete");
  } finally {
    await session.close();
    if (shouldClose) await d.close();
  }
}

export function isMainModule(metaUrl: string, argv1: string | undefined): boolean {
  return metaUrl === `file://${argv1}`;
}
