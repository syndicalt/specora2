import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { GenericContainer, Wait } from "testcontainers";
import neo4j from "neo4j-driver";
import { seed, isMainModule } from "./seed";

describe("isMainModule", () => {
  it("returns true when metaUrl matches argv1", () => {
    expect(isMainModule("file:///app/seed.ts", "/app/seed.ts")).toBe(true);
  });

  it("returns false when they differ", () => {
    expect(isMainModule("file:///app/seed.ts", "/app/other.ts")).toBe(false);
  });

  it("returns false when argv1 is undefined", () => {
    expect(isMainModule("file:///app/seed.ts", undefined)).toBe(false);
  });
});

describe("seed (with testcontainers)", () => {
  let container: Awaited<ReturnType<GenericContainer["start"]>>;
  let driver: neo4j.Driver;

  beforeAll(async () => {
    container = await new GenericContainer("neo4j:5.18-community")
      .withExposedPorts(7687)
      .withEnvironment({ NEO4J_AUTH: "neo4j/specora123" })
      .withWaitStrategy(Wait.forLogMessage("Started"))
      .start();

    const uri = `bolt://${container.getHost()}:${container.getMappedPort(7687)}`;
    driver = neo4j.driver(uri, neo4j.auth.basic("neo4j", "specora123"));
  }, 60000);

  afterAll(async () => {
    await driver.close();
    await container.stop();
  });

  it("seeds Neo4j with CSDMv5 data", async () => {
    await seed(driver);

    const session = driver.session();
    try {
      const result = await session.run("MATCH (n:ConfigurationItem) RETURN count(n) as total");
      expect(result.records[0].get("total").toNumber()).toBe(8);
    } finally {
      await session.close();
    }
  });

  it("is idempotent (running twice does not duplicate)", async () => {
    await seed(driver);
    await seed(driver);

    const session = driver.session();
    try {
      const result = await session.run("MATCH (n:ConfigurationItem) RETURN count(n) as total");
      expect(result.records[0].get("total").toNumber()).toBe(8);

      const relResult = await session.run("MATCH ()-[r]->() RETURN count(r) as total");
      expect(relResult.records[0].get("total").toNumber()).toBe(7);
    } finally {
      await session.close();
    }
  });

  it("creates the admin user with correct properties", async () => {
    await seed(driver);

    const session = driver.session();
    try {
      const result = await session.run(
        "MATCH (u:User:ConfigurationItem {id: 'usr-1'}) RETURN u.email as email, u.passwordHash as hash"
      );
      expect(result.records.length).toBe(1);
      expect(result.records[0].get("email")).toBe("alice@specora.dev");
      expect(result.records[0].get("hash")).toContain("$2b$10$");
    } finally {
      await session.close();
    }
  });
});


