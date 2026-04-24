import neo4j from "neo4j-driver";

async function main() {
  const driver = neo4j.driver(
    "bolt://localhost:7687",
    neo4j.auth.basic("neo4j", "specora123")
  );
  const session = driver.session();
  try {
    const result = await session.run("MATCH (n:ConfigurationItem) RETURN count(n) as total");
    console.log("Nodes:", result.records[0].get("total").toNumber());
    const relResult = await session.run("MATCH ()-[r]->() RETURN count(r) as total");
    console.log("Relationships:", relResult.records[0].get("total").toNumber());
  } finally {
    await session.close();
    await driver.close();
  }
}

main();
