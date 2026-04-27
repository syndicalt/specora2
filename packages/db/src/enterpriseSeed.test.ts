import { describe, expect, it } from "vitest";
import { bindNumericParams, buildEnterpriseSeedConfig, SEEDED_TABLES } from "./enterpriseSeed";

describe("enterprise seed config", () => {
  it("defaults to the standard profile", () => {
    expect(buildEnterpriseSeedConfig({}).profile).toBe("standard");
  });

  it("supports smoke and explicit overrides", () => {
    const config = buildEnterpriseSeedConfig({
      ENTERPRISE_SEED_PROFILE: "smoke",
      ENTERPRISE_SEED_CORE_RECORDS: "42",
      ENTERPRISE_SEED_USERS: "9",
    });

    expect(config.profile).toBe("smoke");
    expect(config.coreRecords).toBe(42);
    expect(config.users).toBe(9);
  });

  it("documents every seed-owned public table except schema_migrations", () => {
    expect(SEEDED_TABLES).toContain("incidents");
    expect(SEEDED_TABLES).toContain("catalog_requests");
    expect(SEEDED_TABLES).toContain("dcim_floorplan_connections");
    expect(SEEDED_TABLES).toContain("record_numbers");
    expect(SEEDED_TABLES).not.toContain("schema_migrations" as any);
    expect(new Set(SEEDED_TABLES).size).toBe(SEEDED_TABLES.length);
  });

  it("binds only safe numeric SQL parameters", () => {
    expect(bindNumericParams("SELECT $1::int, $2::int", [10, 20])).toBe("SELECT 10::int, 20::int");
    expect(bindNumericParams("SELECT '$2b$10$hash', $1::int", [7])).toBe("SELECT '$2b$10$hash', 7::int");
    expect(() => bindNumericParams("SELECT $1::int", ["nope"])).toThrow("safe non-negative integer");
  });
});
