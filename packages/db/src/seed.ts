import neo4j, { type Driver, type Session } from "neo4j-driver";
import { CONSTRAINTS } from "./schema";
import { generateDemoCIs, generateDemoRelationships, type DemoCI, type DemoRelationship } from "./demoData";

const BATCH_SIZE = 500;

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

async function seedNodes(session: Session, items: DemoCI[]) {
  const byClass = new Map<string, DemoCI[]>();
  for (const item of items) {
    if (!byClass.has(item.className)) byClass.set(item.className, []);
    byClass.get(item.className)?.push(item);
  }

  for (const [className, classItems] of byClass.entries()) {
    for (const batch of chunks(classItems, BATCH_SIZE)) {
      await session.run(
        `UNWIND $items AS row
         MERGE (n:${className}:ConfigurationItem {id: row.id})
         SET n.name = row.name,
             n.class = row.className,
             n.environment = row.environment,
             n.attributes = row.attributes,
             n += row.props`,
        {
          items: batch.map((item) => ({
            ...item,
            attributes: JSON.stringify(item.attributes),
          })),
        }
      );
    }
  }
}

async function seedRelationships(session: Session, relationships: DemoRelationship[]) {
  const byType = new Map<DemoRelationship["type"], DemoRelationship[]>();
  for (const rel of relationships) {
    if (!byType.has(rel.type)) byType.set(rel.type, []);
    byType.get(rel.type)?.push(rel);
  }

  for (const [type, rels] of byType.entries()) {
    for (const batch of chunks(rels, BATCH_SIZE)) {
      await session.run(
        `UNWIND $rels AS row
         MATCH (source:ConfigurationItem {id: row.sourceId})
         MATCH (target:ConfigurationItem {id: row.targetId})
         MERGE (source)-[r:${type}]->(target)
         SET r.attributes = row.attributes`,
        {
          rels: batch.map((rel) => ({
            ...rel,
            attributes: JSON.stringify(rel.attributes || {}),
          })),
        }
      );
    }
  }
}

export async function seed(driver?: Driver) {
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

  const items = generateDemoCIs();
  const relationships = generateDemoRelationships();

  const session2 = d.session();
  try {
    await session2.run("MATCH (n:ConfigurationItem) DETACH DELETE n");
    console.log("Existing ConfigurationItem data cleared");
  } finally {
    await session2.close();
  }

  const session3 = d.session();
  try {
    await seedNodes(session3, items);
    console.log(`Demo nodes seed complete (${items.length} CIs)`);
  } finally {
    await session3.close();
  }

  const session4 = d.session();
  try {
    await seedRelationships(session4, relationships);
    console.log(`Demo relationships seed complete (${relationships.length} relationships)`);
  } finally {
    await session4.close();
  }

  console.log("Neo4j seed complete");
  if (shouldClose) await d.close();
}

export function isMainModule(metaUrl: string, argv1: string | undefined): boolean {
  return metaUrl === `file://${argv1}`;
}
