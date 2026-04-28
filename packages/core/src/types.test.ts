import { describe, it, expect } from "vitest";
import {
  ConfigurationItemSchema,
  RelationshipSchema,
  CreateCIInputSchema,
  UpdateCIInputSchema,
  CreateRelationshipInputSchema,
} from "./types";

describe("ConfigurationItemSchema", () => {
  const valid = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    name: "web-01",
    class: "Server",
    environment: "Production",
    attributes: { cpu: 4 },
  };

  it("accepts a valid ConfigurationItem", () => {
    expect(ConfigurationItemSchema.parse(valid)).toEqual(valid);
  });

  it("rejects a missing id", () => {
    const { id, ...rest } = valid;
    expect(() => ConfigurationItemSchema.parse(rest)).toThrow(/Required/);
  });

  it("accepts non-empty external ids", () => {
    expect(ConfigurationItemSchema.parse({ ...valid, id: "external-ci-1" }).id).toBe("external-ci-1");
  });

  it("rejects an empty name", () => {
    expect(() => ConfigurationItemSchema.parse({ ...valid, name: "" })).toThrow(/min/);
  });

  it("rejects a missing class", () => {
    const { class: _, ...rest } = valid;
    expect(() => ConfigurationItemSchema.parse(rest)).toThrow(/Required/);
  });

  it("accepts missing optional fields", () => {
    const { environment, attributes, ...required } = valid;
    expect(ConfigurationItemSchema.parse(required)).toEqual(required);
  });
});

describe("RelationshipSchema", () => {
  const valid = {
    id: "550e8400-e29b-41d4-a716-446655440001",
    type: "DEPENDS_ON",
    sourceId: "550e8400-e29b-41d4-a716-446655440000",
    targetId: "550e8400-e29b-41d4-a716-446655440002",
    attributes: { weight: 1 },
  };

  it("accepts a valid Relationship", () => {
    expect(RelationshipSchema.parse(valid)).toEqual(valid);
  });

  it("accepts non-empty external ids for relationship endpoints", () => {
    expect(RelationshipSchema.parse({ ...valid, sourceId: "external-source" }).sourceId).toBe("external-source");
  });

  it("accepts missing attributes", () => {
    const { attributes, ...rest } = valid;
    expect(RelationshipSchema.parse(rest)).toEqual(rest);
  });
});

describe("CreateCIInputSchema", () => {
  const valid = {
    name: "db-01",
    class: "Database",
    environment: "Staging",
    attributes: { version: "16" },
  };

  it("accepts input without id", () => {
    expect(CreateCIInputSchema.parse(valid)).toEqual(valid);
  });

  it("accepts input with optional id", () => {
    const withId = { ...valid, id: "550e8400-e29b-41d4-a716-446655440000" };
    expect(CreateCIInputSchema.parse(withId)).toEqual(withId);
  });

  it("accepts an external optional id", () => {
    expect(CreateCIInputSchema.parse({ ...valid, id: "external-db-01" }).id).toBe("external-db-01");
  });
});

describe("UpdateCIInputSchema", () => {
  it("accepts partial updates", () => {
    expect(UpdateCIInputSchema.parse({ name: "new-name" })).toEqual({ name: "new-name" });
    expect(UpdateCIInputSchema.parse({ environment: "Dev" })).toEqual({ environment: "Dev" });
  });

  it("accepts empty object (no-op)", () => {
    expect(UpdateCIInputSchema.parse({})).toEqual({});
  });

  it("strips an invalid id field (id is not in schema)", () => {
    const result = UpdateCIInputSchema.parse({ id: "x" } as any);
    expect(result).not.toHaveProperty("id");
  });
});

describe("CreateRelationshipInputSchema", () => {
  const valid = {
    sourceId: "550e8400-e29b-41d4-a716-446655440000",
    targetId: "550e8400-e29b-41d4-a716-446655440001",
    type: "DEPENDS_ON",
  };

  it("accepts registry-safe relationship type names", () => {
    const types = ["PART_OF", "DEPENDS_ON", "HOSTED_ON", "MANAGED_BY", "OWNED_BY", "LOCATED_AT"] as const;
    for (const type of types) {
      expect(CreateRelationshipInputSchema.parse({ ...valid, type })).toEqual({ ...valid, type });
    }
    expect(CreateRelationshipInputSchema.parse({ ...valid, type: "CONNECTED_TO" })).toEqual({ ...valid, type: "CONNECTED_TO" });
  });

  it("rejects unsafe relationship type names", () => {
    expect(() =>
      CreateRelationshipInputSchema.parse({ ...valid, type: "bad-type" })
    ).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => CreateRelationshipInputSchema.parse({ type: "DEPENDS_ON" })).toThrow();
  });
});
