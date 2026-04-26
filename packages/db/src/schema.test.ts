import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONSTRAINTS, CSDM_NODE_LABELS, CSDM_REL_TYPES, SEED_DATA_CYPHER } from "./schema";
import { DEMO_CI_COUNTS, DEMO_CI_TOTAL, generateDemoCIs, generateDemoRelationships } from "./demoData";

describe("CONSTRAINTS", () => {
  it("contains at least one constraint", () => {
    expect(CONSTRAINTS.length).toBeGreaterThan(0);
  });

  it("each constraint starts with CREATE CONSTRAINT or CREATE INDEX", () => {
    for (const c of CONSTRAINTS) {
      expect(c).toMatch(/^CREATE (CONSTRAINT|INDEX)/);
    }
  });

  it("each constraint references ConfigurationItem", () => {
    for (const c of CONSTRAINTS) {
      expect(c).toContain("ConfigurationItem");
    }
  });

  it("each constraint uses IF NOT EXISTS", () => {
    for (const c of CONSTRAINTS) {
      expect(c).toContain("IF NOT EXISTS");
    }
  });
});

describe("CSDM_NODE_LABELS", () => {
  it("contains ConfigurationItem as the base label", () => {
    expect(CSDM_NODE_LABELS).toContain("ConfigurationItem");
  });

  it("contains all expected domain labels", () => {
    const expected = [
      "BusinessService",
      "ApplicationService",
      "TechnicalService",
      "Server",
      "Database",
      "Application",
      "NetworkGear",
      "User",
      "Group",
      "Location",
    ];
    for (const label of expected) {
      expect(CSDM_NODE_LABELS).toContain(label);
    }
  });

  it("has no duplicate labels", () => {
    const unique = new Set(CSDM_NODE_LABELS);
    expect(unique.size).toBe(CSDM_NODE_LABELS.length);
  });
});

describe("CSDM_REL_TYPES", () => {
  it("contains all expected relationship types", () => {
    const expected = ["PART_OF", "DEPENDS_ON", "HOSTED_ON", "MANAGED_BY", "OWNED_BY", "LOCATED_AT"];
    expect(CSDM_REL_TYPES).toEqual(expected);
  });

  it("has no duplicate types", () => {
    const unique = new Set(CSDM_REL_TYPES);
    expect(unique.size).toBe(CSDM_REL_TYPES.length);
  });
});

describe("SEED_DATA_CYPHER", () => {
  it("documents the generated seed path", () => {
    expect(SEED_DATA_CYPHER).toContain("demoData.ts");
    expect(SEED_DATA_CYPHER).toContain("5,000");
  });
});

describe("generated demo data", () => {
  it("generates exactly 5,000 CIs", () => {
    expect(generateDemoCIs()).toHaveLength(5000);
    expect(DEMO_CI_TOTAL).toBe(5000);
  });

  it("matches the class distribution contract", () => {
    const counts = generateDemoCIs().reduce<Record<string, number>>((acc, item) => {
      acc[item.className] = (acc[item.className] || 0) + 1;
      return acc;
    }, {});

    expect(counts).toEqual(DEMO_CI_COUNTS);
  });

  it("uses class-manager attribute names on generated CIs", () => {
    const items = generateDemoCIs();
    expect(items.find((item) => item.className === "Server")?.attributes).toHaveProperty("ipAddress");
    expect(items.find((item) => item.className === "Database")?.attributes).toHaveProperty("dbType");
    expect(items.find((item) => item.className === "BusinessService")?.attributes).toHaveProperty("serviceOwnerId");
    expect(items.find((item) => item.className === "Application")?.attributes).toHaveProperty("deploymentMethod");
  });

  it("generates only supported relationship types", () => {
    const relationshipTypes = new Set(generateDemoRelationships().map((rel) => rel.type));
    expect([...relationshipTypes].sort()).toEqual([...CSDM_REL_TYPES].sort());
  });
});

describe("Postgres demo operations seed", () => {
  const seedSql = readFileSync(join(__dirname, "../migrations/032_demo_itsm_itam_seed.sql"), "utf8");

  it("links every tier-one ITSM and ITAM application into the demo narrative", () => {
    for (const table of [
      "change_requests",
      "incidents",
      "knowledge_items",
      "prevention_records",
      "asset_records",
      "software_entitlements",
      "discovery_sources",
    ]) {
      expect(seedSql).toContain(table);
    }
  });

  it("uses stable CSDM demo CI IDs and seeded user IDs", () => {
    expect(seedSql).toContain("demo-applicationservice-0001");
    expect(seedSql).toContain("demo-database-0001");
    expect(seedSql).toContain("demo-server-0001");
    expect(seedSql).toContain("550e8400-e29b-41d4-a716-446655440001");
  });

  it("is safe to re-run by using fixed IDs and conflict handling", () => {
    const conflictHandlers = seedSql.match(/ON CONFLICT/g) || [];
    expect(conflictHandlers.length).toBeGreaterThanOrEqual(20);
    expect(seedSql).not.toContain("TRUNCATE");
    expect(seedSql).not.toContain("DELETE FROM");
  });
});
