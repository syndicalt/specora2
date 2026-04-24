import neo4j from "neo4j-driver";
import { CONSTRAINTS, SEED_DATA_CYPHER, SEED_SYNTHETIC_NODES_CYPHER, SEED_SYNTHETIC_RELS_CYPHER } from "./schema";

function splitCypher(cypher: string): string[] {
  return cypher
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function runBatches(session: neo4j.Session, cypher: string) {
  const statements = splitCypher(cypher);
  for (const stmt of statements) {
    await session.run(stmt);
  }
}

export async function seed(driver?: neo4j.Driver) {
  const shouldClose = !driver;
  const d = driver || neo4j.driver(
    process.env.NEO4J_URI || "bolt://localhost:7687",
    neo4j.auth.basic(
      process.env.NEO4J_USER || "neo4j",
      process.env.NEO4J_PASSWORD || "specora123"
    )
  );

  // Run constraints
  const session1 = d.session();
  try {
    for (const c of CONSTRAINTS) {
      await session1.run(c);
    }
  } finally {
    await session1.close();
  }

  // Run manual seed data
  const session2 = d.session();
  try {
    await session2.run(SEED_DATA_CYPHER);
    console.log("Manual seed complete");
  } finally {
    await session2.close();
  }

  // Run synthetic nodes in batches
  const session3 = d.session();
  try {
    await runBatches(session3, SEED_SYNTHETIC_NODES_CYPHER);
    console.log("Synthetic nodes seed complete");
  } finally {
    await session3.close();
  }

  // Run synthetic relationships in batches
  const session4 = d.session();
  try {
    await runBatches(session4, SEED_SYNTHETIC_RELS_CYPHER);
    console.log("Synthetic relationships seed complete");
  } finally {
    await session4.close();
  }

  console.log("Neo4j seed complete");
  if (shouldClose) await d.close();
}

export function isMainModule(metaUrl: string, argv1: string | undefined): boolean {
  return metaUrl === `file://${argv1}`;
}
