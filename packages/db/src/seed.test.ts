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

  it("seeds Neo4j with ~1000 CSDMv5 nodes", async () => {
    await seed(driver);

    const session = driver.session();
    try {
      const result = await session.run("MATCH (n:ConfigurationItem) RETURN count(n) as total");
      const count = result.records[0].get("total").toNumber();
      expect(count).toBeGreaterThanOrEqual(900);
      expect(count).toBeLessThanOrEqual(1100);
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
      const count = result.records[0].get("total").toNumber();
      expect(count).toBeGreaterThanOrEqual(900);
      expect(count).toBeLessThanOrEqual(1100);

      const relResult = await session.run("MATCH ()-[r]->() RETURN count(r) as total");
      expect(relResult.records[0].get("total").toNumber()).toBeGreaterThanOrEqual(100);
    } finally {
      await session.close();
    }
  });

  it("links Neo4j User CIs to Postgres via userId", async () => {
    await seed(driver);

    const session = driver.session();
    try {
      const result = await session.run(
        "MATCH (u:User:ConfigurationItem) RETURN u.userId as userId ORDER BY userId"
      );
      const userIds = result.records.map((r) => r.get("userId")).filter(Boolean);
      expect(userIds.length).toBe(7);
      expect(userIds[0]).toBe("550e8400-e29b-41d4-a716-446655440001");
    } finally {
      await session.close();
    }
  });

  it("does not store passwordHash in Neo4j User CIs", async () => {
    await seed(driver);

    const session = driver.session();
    try {
      const result = await session.run(
        "MATCH (u:User:ConfigurationItem) RETURN u.passwordHash as hash"
      );
      const hashes = result.records.map((r) => r.get("hash")).filter(Boolean);
      expect(hashes.length).toBe(0);
    } finally {
      await session.close();
    }
  });
});
