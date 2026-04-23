import { describe, it, expect } from "vitest";
import { CONSTRAINTS, CSDM_NODE_LABELS, CSDM_REL_TYPES, SEED_DATA_CYPHER } from "./schema";

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
  it("contains MERGE statements for nodes", () => {
    expect(SEED_DATA_CYPHER).toContain("MERGE (bs:BusinessService");
    expect(SEED_DATA_CYPHER).toContain("MERGE (usr:User");
  });

  it("contains MERGE statements for relationships", () => {
    expect(SEED_DATA_CYPHER).toContain("MERGE (bs)-[:DEPENDS_ON]->(as)");
    expect(SEED_DATA_CYPHER).toContain("MERGE (srv)-[:LOCATED_AT]->(loc)");
  });

  it("includes the seeded admin user with password hash", () => {
    expect(SEED_DATA_CYPHER).toContain("alice@specora.dev");
    expect(SEED_DATA_CYPHER).toContain("passwordHash");
  });
});
