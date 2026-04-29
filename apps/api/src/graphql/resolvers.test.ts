import { describe, it, expect, vi, beforeEach } from "vitest";
import neo4j from "neo4j-driver";
import { resolvers } from "./resolvers";
import { clearPermissionCache } from "../services/rbac";

beforeEach(() => {
  clearPermissionCache();
});

function mockNeo4jSession(records: any[] = [], secondRecords?: any[]) {
  const allRecords = secondRecords !== undefined ? [records, secondRecords] : [records];
  let callIndex = 0;
  return {
    run: vi.fn().mockImplementation(() => {
      const result = { records: allRecords[callIndex] ?? [] };
      callIndex++;
      return Promise.resolve(result);
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function mockContext(session: any, worker = {}, pg?: any) {
  const defaultPg = pg || mockPg([{ _: 1 }]);
  return {
    neo4j: { session: () => session },
    pg: defaultPg,
    user: { id: "550e8400-e29b-41d4-a716-446655440001", email: "alice@specora.dev", role: "admin" },
    worker,
  };
}



function makeNode(props: any) {
  return { properties: { attributes: "{}", ...props } };
}

function makeRecord(node: any, rel?: any, target?: any, source?: any) {
  const getters: any = { n: node, root: node, src: source || node, source: source || node, tgt: target || node, target: target || node };
  if (rel) getters.rel = rel;
  return {
    get: (key: string) => getters[key],
  };
}

describe("Query.ci", () => {
  it("returns a CI when found", async () => {
    const session = mockNeo4jSession([makeRecord(makeNode({ id: "bs-1", name: "Portal", class: "BusinessService" }))]);
    const result = await resolvers.Query.ci(null, { id: "bs-1" }, mockContext(session));
    expect(result).toMatchObject({ id: "bs-1", name: "Portal", class: "BusinessService", attributes: {} });
    expect(session.run).toHaveBeenCalledWith(
      expect.stringContaining("MATCH (n:ConfigurationItem {id: $id})"),
      { id: "bs-1" }
    );
  });

  it("returns null when not found", async () => {
    const session = mockNeo4jSession([]);
    const result = await resolvers.Query.ci(null, { id: "missing" }, mockContext(session));
    expect(result).toBeNull();
  });

  it("parses object attributes directly", async () => {
    const session = mockNeo4jSession([{
      get: () => ({ properties: { id: "1", name: "Test", class: "Server", attributes: { cpu: 4 } } }),
    }]);
    const result = await resolvers.Query.ci(null, { id: "1" }, mockContext(session));
    expect(result.attributes).toEqual({ cpu: 4 });
  });

  it("falls back to empty object when attributes is undefined", async () => {
    const session = mockNeo4jSession([{
      get: () => ({ properties: { id: "1", name: "Test", class: "Server", attributes: undefined } }),
    }]);
    const result = await resolvers.Query.ci(null, { id: "1" }, mockContext(session));
    expect(result.attributes).toEqual({});
  });

  it("projects typed Neo4j properties into attributes for GraphQL clients", async () => {
    const session = mockNeo4jSession([{
      get: () => ({
        properties: {
          id: "1",
          name: "nb-lenovo",
          class: "Computer",
          environment: "Production",
          attributes: { uuid: "device-uuid" },
          ipAddress: "10.74.214.87",
          serialNumber: "PF47W7CH",
        },
      }),
    }]);
    const result = await resolvers.Query.ci(null, { id: "1" }, mockContext(session));
    expect(result.attributes).toEqual({
      ipAddress: "10.74.214.87",
      serialNumber: "PF47W7CH",
      uuid: "device-uuid",
    });
  });
});

describe("Mutation.ingestCMDB", () => {
  it("uses empty payload when args.payload is undefined", async () => {
    const worker = {
      ingestCMDB: vi.fn().mockResolvedValue({ job_id: "job-123", status: "completed" }),
    };
    const result = await resolvers.Mutation.ingestCMDB(null, {}, mockContext(mockNeo4jSession(), worker));
    expect(result.jobId).toBe("job-123");
    expect(worker.ingestCMDB).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: Buffer.from("{}"),
      })
    );
  });
});

describe("Query.cis", () => {
  it("returns all CIs without filter", async () => {
    const session = mockNeo4jSession([
      makeRecord(makeNode({ id: "1", name: "A", class: "Server" })),
      makeRecord(makeNode({ id: "2", name: "B", class: "Database" })),
    ]);
    const result = await resolvers.Query.cis(null, {}, mockContext(session));
    expect(result).toHaveLength(2);
    expect(session.run).toHaveBeenCalledWith(
      expect.stringContaining("LIMIT $limit"),
      expect.objectContaining({ limit: expect.objectContaining({ low: 100, high: 0 }) })
    );
  });

  it("filters by class, environment, and name", async () => {
    const session = mockNeo4jSession([makeRecord(makeNode({ id: "1", name: "web-01", class: "Server", environment: "Prod" }))]);
    const result = await resolvers.Query.cis(null, { filter: { class: "Server", environment: "Prod", name: "web" } }, mockContext(session));
    expect(result).toHaveLength(1);
    expect(session.run).toHaveBeenCalledWith(
      expect.stringContaining("n.class = $class"),
      expect.objectContaining({ class: "Server", environment: "Prod", name: "web" })
    );
  });
});

describe("Query.ciClasses", () => {
  it("maps class metadata from Postgres", async () => {
    const pg = mockPg([{
      id: "class-1",
      name: "BusinessService",
      display_name: "Business Service",
      description: "Customer-facing service",
      parent_class: null,
      icon: "Briefcase",
      color: "#22c55e",
      is_system: true,
      created_by_app_id: "platform",
      created_at: "2026-01-01",
      updated_at: "2026-01-02",
    }]);

    const result = await resolvers.Query.ciClasses(null, {}, mockContext(mockNeo4jSession(), {}, pg));

    expect(result).toEqual([expect.objectContaining({
      name: "BusinessService",
      displayName: "Business Service",
      parentClass: null,
      isSystem: true,
      createdByAppId: "platform",
    })]);
  });

  it("rejects callers without CMDB read permission", async () => {
    const pg = mockPg([]);
    const context = {
      ...mockContext(mockNeo4jSession(), {}, pg),
      user: { id: "u-viewer", email: "viewer@specora.dev", role: "viewer" },
    };

    await expect(resolvers.Query.ciClasses(null, {}, context)).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" },
    });
  });
});

describe("Query.serviceMap", () => {
  it("returns nodes and edges for a root CI", async () => {
    const root = makeNode({ id: "bs-1", name: "Portal", class: "BusinessService" });
    const related = makeNode({ id: "as-1", name: "API", class: "ApplicationService" });
    const rel = { type: "DEPENDS_ON", start: "bs-1", end: "as-1" };
    // First query returns root node, second query returns path records
    const session = mockNeo4jSession(
      [makeRecord(root)],
      [makeRecord(root, rel, related)]
    );
    const result = await resolvers.Query.serviceMap(null, { rootId: "bs-1" }, mockContext(session));
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].type).toBe("DEPENDS_ON");
  });

  it("deduplicates duplicate edges", async () => {
    const root = makeNode({ id: "bs-1", name: "Portal", class: "BusinessService" });
    const related = makeNode({ id: "as-1", name: "API", class: "ApplicationService" });
    const rel = { type: "DEPENDS_ON", start: "bs-1", end: "as-1" };
    const session = mockNeo4jSession(
      [makeRecord(root)],
      [makeRecord(root, rel, related), makeRecord(root, rel, related)]
    );
    const result = await resolvers.Query.serviceMap(null, { rootId: "bs-1" }, mockContext(session));
    expect(result.edges).toHaveLength(1);
  });

  it("rejects relationship filters outside the allowlist", async () => {
    const root = makeNode({ id: "bs-1", name: "Portal", class: "BusinessService" });
    const session = mockNeo4jSession([makeRecord(root)]);

    await expect(
      resolvers.Query.serviceMap(null, { rootId: "bs-1", relationshipFilter: ["DEPENDS_ON", "BAD_TYPE"] }, mockContext(session))
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });

    expect(session.run).toHaveBeenCalledTimes(1);
    expect(session.close).toHaveBeenCalled();
  });
});

describe("Query.neighbors", () => {
  it("returns only directly connected nodes with a safe relationship pattern", async () => {
    const root = makeNode({ id: "bs-1", name: "Portal", class: "BusinessService" });
    const related = makeNode({ id: "as-1", name: "API", class: "ApplicationService" });
    const rel = { type: "DEPENDS_ON", start: "bs-1", end: "as-1" };
    const session = mockNeo4jSession([makeRecord(root)], [makeRecord(root, rel, related)]);

    const result = await resolvers.Query.neighbors(null, { nodeId: "bs-1", types: ["DEPENDS_ON"], limit: 10 }, mockContext(session));

    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
    expect(session.run).toHaveBeenLastCalledWith(
      expect.stringContaining("-[:DEPENDS_ON*1]-"),
      expect.objectContaining({ limit: expect.objectContaining({ low: 10, high: 0 }) })
    );
  });

  it("rejects invalid relationship types before running the expansion query", async () => {
    const root = makeNode({ id: "bs-1", name: "Portal", class: "BusinessService" });
    const session = mockNeo4jSession([makeRecord(root)]);

    await expect(
      resolvers.Query.neighbors(null, { nodeId: "bs-1", types: ["MATCH (n) DETACH DELETE n"] }, mockContext(session))
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });

    expect(session.run).toHaveBeenCalledTimes(1);
    expect(session.close).toHaveBeenCalled();
  });
});

describe("Query.dependencyPath", () => {
  it("returns null when no dependency path exists", async () => {
    const session = mockNeo4jSession([]);
    const result = await resolvers.Query.dependencyPath(null, { fromId: "a", toId: "b", maxHops: 3 }, mockContext(session));
    expect(result).toBeNull();
    expect(session.run).toHaveBeenCalledWith(expect.stringContaining("*1..3"), { fromId: "a", toId: "b" });
  });

  it("rejects out-of-range hop counts before running Cypher", async () => {
    const session = mockNeo4jSession([]);
    await expect(
      resolvers.Query.dependencyPath(null, { fromId: "a", toId: "b", maxHops: 99 }, mockContext(session))
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expect(session.run).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalled();
  });
});

describe("ConfigurationItem.relationships", () => {
  it("returns relationships with targets", async () => {
    const target = makeNode({ id: "as-1", name: "API", class: "ApplicationService" });
    const session = mockNeo4jSession([
      { get: (k: string) => k === "r" ? { type: "DEPENDS_ON", start: "bs-1", end: "as-1" } : target },
    ]);
    const result = await resolvers.ConfigurationItem.relationships({ id: "bs-1" }, {}, mockContext(session));
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("DEPENDS_ON");
    expect(result[0].target.id).toBe("as-1");
  });
});

describe("Relationship.target", () => {
  it("returns the target object", () => {
    const target = { id: "as-1", name: "API" };
    expect(resolvers.Relationship.target({ target }, {}, {})).toBe(target);
  });
});



describe("Mutation.createCI", () => {
  it("creates a CI with valid input", async () => {
    const session = mockNeo4jSession([makeRecord(makeNode({ id: "new-1", name: "Test", class: "Server" }))]);
    const result = await resolvers.Mutation.createCI(null, { input: { name: "Test", class: "Server" } }, mockContext(session));
    expect(result.name).toBe("Test");
    expect(session.run).toHaveBeenCalled();
  });

  it("applies class defaults to typed top-level properties and keeps extra attributes in JSON", async () => {
    const session = mockNeo4jSession([
      makeRecord(makeNode({
        id: "new-1",
        name: "Web",
        class: "Server",
        status: "operational",
        attributes: "{\"notes\":\"rack 1\"}",
      })),
    ]);
    const pg = mockPgSequence([
      { rows: [{ id: "class-1", name: "Server", parent_class: null }] },
      { rows: [
        { id: "attr-1", class_id: "class-1", name: "status", display_name: "Status", attr_type: "enum", is_mandatory: false, default_value: "operational", enum_values: ["operational"], sort_order: 1, depth: 0 },
      ] },
      { rows: [{ id: "class-1", name: "Server", parent_class: null }] },
      { rows: [
        { id: "attr-1", class_id: "class-1", name: "status", display_name: "Status", attr_type: "enum", is_mandatory: false, default_value: "operational", enum_values: ["operational"], sort_order: 1, depth: 0 },
      ] },
    ]);

    const result = await resolvers.Mutation.createCI(
      null,
      { input: { name: "Web", class: "Server", attributes: { notes: "rack 1" } } },
      mockContext(session, {}, pg)
    );

    expect(result.status).toBe("operational");
    expect(result.attributes).toEqual({ notes: "rack 1", status: "operational" });
    expect(session.run).toHaveBeenCalledWith(
      expect.stringContaining("SET n += $topLevelProps"),
      expect.objectContaining({
        topLevelProps: { status: "operational" },
        attributes: JSON.stringify({ notes: "rack 1" }),
      })
    );
  });

  it("rejects unknown classes before creating a Neo4j node", async () => {
    const session = mockNeo4jSession([]);
    const pg = mockPgSequence([{ rows: [] }]);

    await expect(
      resolvers.Mutation.createCI(null, { input: { name: "Mystery", class: "UnknownClass" } }, mockContext(session, {}, pg))
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expect(session.run).not.toHaveBeenCalled();
  });

  it("rejects missing mandatory class attributes", async () => {
    const session = mockNeo4jSession([]);
    const pg = mockPgSequence([
      { rows: [{ id: "class-1", name: "Server", parent_class: null }] },
      { rows: [
        { id: "attr-1", class_id: "class-1", name: "asset_tag", display_name: "Asset Tag", attr_type: "string", is_mandatory: true, default_value: null, sort_order: 1, depth: 0 },
      ] },
    ]);

    await expect(
      resolvers.Mutation.createCI(null, { input: { name: "Web", class: "Server" } }, mockContext(session, {}, pg))
    ).rejects.toThrow("Missing mandatory attribute 'Asset Tag'");
    expect(session.run).not.toHaveBeenCalled();
  });

  it("rejects invalid input", async () => {
    const session = mockNeo4jSession([]);
    try {
      await resolvers.Mutation.createCI(null, { input: { name: "" } }, mockContext(session));
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.extensions.code).toBe("BAD_USER_INPUT");
    }
  });
});

describe("Mutation.updateCI", () => {
  it("updates a CI name", async () => {
    const oldNode = makeNode({ id: "bs-1", name: "Portal", class: "BusinessService" });
    const updatedNode = makeNode({ id: "bs-1", name: "Updated", class: "BusinessService" });
    const session = mockNeo4jSession([makeRecord(oldNode)], [makeRecord(updatedNode)]);
    const result = await resolvers.Mutation.updateCI(null, { id: "bs-1", input: { name: "Updated" } }, mockContext(session));
    expect(result.name).toBe("Updated");
  });

  it("updates a CI class", async () => {
    const oldNode = makeNode({ id: "bs-1", name: "Portal", class: "BusinessService" });
    const updatedNode = makeNode({ id: "bs-1", name: "Portal", class: "ApplicationService" });
    const session = mockNeo4jSession([makeRecord(oldNode)], [makeRecord(updatedNode)]);
    const result = await resolvers.Mutation.updateCI(null, { id: "bs-1", input: { class: "ApplicationService" } }, mockContext(session));
    expect(result.class).toBe("ApplicationService");
  });

  it("updates a CI environment", async () => {
    const oldNode = makeNode({ id: "bs-1", name: "Portal", class: "BusinessService" });
    const updatedNode = makeNode({ id: "bs-1", name: "Portal", class: "BusinessService", environment: "Staging" });
    const session = mockNeo4jSession([makeRecord(oldNode)], [makeRecord(updatedNode)]);
    const result = await resolvers.Mutation.updateCI(null, { id: "bs-1", input: { environment: "Staging" } }, mockContext(session));
    expect(result.environment).toBe("Staging");
  });

  it("updates a CI attributes", async () => {
    const oldNode = makeNode({ id: "bs-1", name: "Portal", class: "BusinessService" });
    const updatedNode = makeNode({ id: "bs-1", name: "Portal", class: "BusinessService", attributes: "{\"version\":\"2\"}" });
    const session = mockNeo4jSession([makeRecord(oldNode)], [makeRecord(updatedNode)]);
    const result = await resolvers.Mutation.updateCI(null, { id: "bs-1", input: { attributes: { version: "2" } } }, mockContext(session));
    expect(result.attributes).toEqual({ version: "2" });
  });

  it("throws when CI not found", async () => {
    const session = mockNeo4jSession([]);
    await expect(
      resolvers.Mutation.updateCI(null, { id: "missing", input: { name: "X" } }, mockContext(session))
    ).rejects.toThrow("CI not found");
  });

  it("throws when no fields provided", async () => {
    const session = mockNeo4jSession([makeRecord(makeNode({ id: "bs-1", name: "Portal", class: "BusinessService" }))]);
    await expect(
      resolvers.Mutation.updateCI(null, { id: "bs-1", input: {} }, mockContext(session))
    ).rejects.toThrow("No fields to update");
  });

  it("rejects invalid input", async () => {
    const session = mockNeo4jSession([]);
    try {
      await resolvers.Mutation.updateCI(null, { id: "bs-1", input: { name: 123 } }, mockContext(session));
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.extensions.code).toBe("BAD_USER_INPUT");
    }
  });
});

describe("Mutation.deleteCI", () => {
  it("deletes a CI and returns true", async () => {
    const session = mockNeo4jSession([]);
    const result = await resolvers.Mutation.deleteCI(null, { id: "bs-1" }, mockContext(session));
    expect(result).toBe(true);
    expect(session.run).toHaveBeenCalledWith(
      expect.stringContaining("DETACH DELETE"),
      { id: "bs-1" }
    );
  });
});

describe("Mutation.createRelationship", () => {
  it("creates a valid relationship", async () => {
    const target = makeNode({ id: "as-1", name: "API", class: "ApplicationService" });
    const session = mockNeo4jSession([{ get: (k: string) => k === "r" ? { type: "DEPENDS_ON", start: "bs-1", end: "as-1" } : target }]);
    const result = await resolvers.Mutation.createRelationship(null, {
      input: { sourceId: "550e8400-e29b-41d4-a716-446655440000", targetId: "550e8400-e29b-41d4-a716-446655440001", type: "DEPENDS_ON" }
    }, mockContext(session));
    expect(result.type).toBe("DEPENDS_ON");
  });

  it("creates a relationship with an active custom relationship type", async () => {
    const target = makeNode({ id: "as-1", name: "API", class: "ApplicationService" });
    const session = mockNeo4jSession([{ get: (k: string) => k === "r" ? { type: "CONNECTED_TO", start: "bs-1", end: "as-1" } : target }]);
    const pg = mockPgSequence([
      { rows: [{ name: "CONNECTED_TO" }] },
    ]);

    const result = await resolvers.Mutation.createRelationship(null, {
      input: { sourceId: "550e8400-e29b-41d4-a716-446655440000", targetId: "550e8400-e29b-41d4-a716-446655440001", type: "CONNECTED_TO" }
    }, mockContext(session, {}, pg));

    expect(result.type).toBe("CONNECTED_TO");
    expect(session.run).toHaveBeenCalledWith(expect.stringContaining("[r:CONNECTED_TO]"), expect.anything());
  });

  it("rejects invalid relationship type", async () => {
    const session = mockNeo4jSession([]);
    try {
      await resolvers.Mutation.createRelationship(null, {
        input: { sourceId: "550e8400-e29b-41d4-a716-446655440000", targetId: "550e8400-e29b-41d4-a716-446655440001", type: "INVALID" }
      }, mockContext(session));
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.extensions.code).toBe("BAD_USER_INPUT");
    }
  });

  it("throws when source or target not found", async () => {
    const session = mockNeo4jSession([]);
    await expect(
      resolvers.Mutation.createRelationship(null, {
        input: { sourceId: "550e8400-e29b-41d4-a716-446655440000", targetId: "550e8400-e29b-41d4-a716-446655440001", type: "DEPENDS_ON" }
      }, mockContext(session))
    ).rejects.toThrow("Source or target not found");
  });
});

describe("Relationship type registry resolvers", () => {
  it("returns relationship types from postgres", async () => {
    const pg = mockPgSequence([
      { rows: [{
        id: "rel-1",
        name: "CONNECTED_TO",
        display_name: "Connected To",
        description: "Network adjacency",
        color: "#38bdf8",
        active: true,
        directed: true,
        is_system: false,
        sort_order: 100,
        created_at: "2026-01-01",
        updated_at: "2026-01-02",
      }] },
    ]);

    const result = await resolvers.Query.relationshipTypes(null, { activeOnly: false }, mockContext(mockNeo4jSession(), {}, pg));

    expect(result).toEqual([expect.objectContaining({
      name: "CONNECTED_TO",
      displayName: "Connected To",
      color: "#38bdf8",
      isSystem: false,
    })]);
  });

  it("upserts custom relationship types with safe uppercase names", async () => {
    const pg = mockPgSequence([
      { rows: [{
        id: "rel-1",
        name: "CONNECTED_TO",
        display_name: "Connected To",
        description: null,
        color: "#6366f1",
        active: true,
        directed: true,
        is_system: false,
        sort_order: 100,
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      }] },
    ]);

    const result = await resolvers.Mutation.upsertRelationshipType(null, {
      input: { name: "connected to", displayName: "Connected To" },
    }, mockContext(mockNeo4jSession(), {}, pg));

    expect(result.name).toBe("CONNECTED_TO");
    expect(pg.query).toHaveBeenLastCalledWith(expect.stringContaining("INSERT INTO relationship_types"), expect.arrayContaining(["CONNECTED_TO", "Connected To"]));
  });

  it("prevents deleting system relationship types", async () => {
    const pg = mockPgSequence([
      { rows: [{ id: "rel-1", name: "DEPENDS_ON", is_system: true }] },
    ]);

    await expect(
      resolvers.Mutation.deleteRelationshipType(null, { id: "rel-1" }, mockContext(mockNeo4jSession(), {}, pg))
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });

  it("prevents deleting custom relationship types that are in use", async () => {
    const session = mockNeo4jSession([{ get: () => ({ toNumber: () => 2 }) }]);
    const pg = mockPgSequence([
      { rows: [{ id: "rel-1", name: "CONNECTED_TO", is_system: false }] },
    ]);

    await expect(
      resolvers.Mutation.deleteRelationshipType(null, { id: "rel-1" }, mockContext(session, {}, pg))
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
  });

  it("deletes unused custom relationship types", async () => {
    const session = mockNeo4jSession([{ get: () => ({ toNumber: () => 0 }) }]);
    const pg = mockPgSequence([
      { rows: [{ id: "rel-1", name: "CONNECTED_TO", is_system: false }] },
      { rows: [{ id: "rel-1" }] },
    ]);

    const result = await resolvers.Mutation.deleteRelationshipType(null, { id: "rel-1" }, mockContext(session, {}, pg));

    expect(result).toBe(true);
    expect(pg.query).toHaveBeenLastCalledWith("DELETE FROM relationship_types WHERE id = $1 RETURNING id", ["rel-1"]);
  });
});

describe("CI class registry mutations", () => {
  it("creates CI classes with display fields and attributes transactionally", async () => {
    const { pg, client } = mockPgConnectSequence([
      { rows: [] },
      { rows: [{ id: "parent-1" }] },
      { rows: [{
        id: "class-1",
        name: "NetworkAppliance",
        display_name: "Network Appliance",
        description: "Managed network device",
        parent_class: "ConfigurationItem",
        icon: "Router",
        color: "#38bdf8",
        display_field: "hostname",
        secondary_display_fields: ["ipAddress", "serialNumber"],
        is_system: false,
        created_by_app_id: "admin-console",
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      }] },
    ]);
    const emit = vi.fn();

    const result = await resolvers.Mutation.createCIClass(null, {
      input: {
        name: "NetworkAppliance",
        displayName: "Network Appliance",
        description: "Managed network device",
        parentClass: "ConfigurationItem",
        icon: "Router",
        color: "#38bdf8",
        displayField: "hostname",
        secondaryDisplayFields: ["ipAddress", "serialNumber"],
        attributes: [
          { name: "hostname", displayName: "Hostname", attrType: "string", isMandatory: true, isKeyAttribute: true, sortOrder: 1 },
          { name: "ipAddress", displayName: "IP Address", attrType: "string", sortOrder: 2 },
        ],
      },
    }, { ...mockContext(mockNeo4jSession(), {}, pg), appId: "admin-console", emit });

    expect(result).toMatchObject({
      id: "class-1",
      name: "NetworkAppliance",
      displayField: "hostname",
      secondaryDisplayFields: ["ipAddress", "serialNumber"],
      createdByAppId: "admin-console",
    });
    expect(client.query).toHaveBeenCalledWith("COMMIT");
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO ci_class_attributes"), expect.arrayContaining(["class-1", "hostname", "Hostname"]));
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO ci_class_attributes"), expect.arrayContaining(["class-1", "ipAddress", "IP Address"]));
    expect(emit).toHaveBeenCalledWith("ci_class.created", { className: "NetworkAppliance", createdByAppId: "admin-console" });
  });

  it("rolls back class creation for invalid names, duplicate classes, missing parents, and duplicate attributes", async () => {
    await expect(
      resolvers.Mutation.createCIClass(null, { input: { name: "bad name", displayName: "Bad" } }, mockContext(mockNeo4jSession()))
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });

    const duplicate = mockPgConnectSequence([{ rows: [{ id: "class-1" }] }]);
    await expect(
      resolvers.Mutation.createCIClass(null, { input: { name: "Server", displayName: "Server" } }, mockContext(mockNeo4jSession(), {}, duplicate.pg))
    ).rejects.toThrow("already exists");
    expect(duplicate.client.query).toHaveBeenCalledWith("ROLLBACK");

    const missingParent = mockPgConnectSequence([{ rows: [] }, { rows: [] }]);
    await expect(
      resolvers.Mutation.createCIClass(null, { input: { name: "ChildClass", displayName: "Child", parentClass: "Missing" } }, mockContext(mockNeo4jSession(), {}, missingParent.pg))
    ).rejects.toThrow("Parent class 'Missing' not found");
    expect(missingParent.client.query).toHaveBeenCalledWith("ROLLBACK");

    const duplicateAttrs = mockPgConnectSequence([
      { rows: [] },
      { rows: [{
        id: "class-1",
        name: "RouterClass",
        display_name: "Router Class",
        parent_class: null,
        display_field: "name",
        secondary_display_fields: [],
        is_system: false,
        created_by_app_id: null,
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      }] },
    ]);
    await expect(
      resolvers.Mutation.createCIClass(null, {
        input: {
          name: "RouterClass",
          displayName: "Router Class",
          attributes: [
            { name: "hostname", displayName: "Hostname", attrType: "string" },
            { name: "hostname", displayName: "Hostname duplicate", attrType: "string" },
          ],
        },
      }, mockContext(mockNeo4jSession(), {}, duplicateAttrs.pg))
    ).rejects.toThrow("Duplicate attribute name: hostname");
    expect(duplicateAttrs.client.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("updates CI classes while protecting system names and inheritance", async () => {
    const systemUpdate = mockPgConnectSequence([
      { rows: [{ id: "class-1", name: "Computer", parent_class: "ConfigurationItem", is_system: true }] },
    ]);

    await expect(
      resolvers.Mutation.updateCIClass(null, {
        id: "class-1",
        input: { name: "Laptop", displayName: "Laptop", parentClass: "ConfigurationItem" },
      }, mockContext(mockNeo4jSession(), {}, systemUpdate.pg))
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(systemUpdate.client.query).toHaveBeenCalledWith("ROLLBACK");

    const update = mockPgConnectSequence([
      { rows: [{ id: "class-2", name: "RouterClass", parent_class: null, is_system: false }] },
      { rows: [] },
      { rows: [{ id: "parent-1" }] },
      { rows: [{
        id: "class-2",
        name: "NetworkDevice",
        display_name: "Network Device",
        description: "Updated",
        parent_class: "ConfigurationItem",
        icon: "Router",
        color: "#22d3ee",
        display_field: "hostname",
        secondary_display_fields: ["ipAddress"],
        is_system: false,
        created_by_app_id: null,
        created_at: "2026-01-01",
        updated_at: "2026-01-02",
      }] },
    ]);
    const emit = vi.fn();
    const result = await resolvers.Mutation.updateCIClass(null, {
      id: "class-2",
      input: {
        name: "NetworkDevice",
        displayName: "Network Device",
        description: "Updated",
        parentClass: "ConfigurationItem",
        icon: "Router",
        color: "#22d3ee",
        displayField: "hostname",
        secondaryDisplayFields: ["ipAddress"],
        attributes: [{ name: "hostname", displayName: "Hostname", attrType: "string" }],
      },
    }, { ...mockContext(mockNeo4jSession(), {}, update.pg), emit });

    expect(result).toMatchObject({ name: "NetworkDevice", displayField: "hostname", secondaryDisplayFields: ["ipAddress"] });
    expect(update.client.query).toHaveBeenCalledWith("DELETE FROM ci_class_attributes WHERE class_id = $1", ["class-2"]);
    expect(update.client.query).toHaveBeenCalledWith("COMMIT");
    expect(emit).toHaveBeenCalledWith("ci_class.updated", { className: "NetworkDevice", createdByAppId: null });
  });

  it("deletes unused non-system CI classes and blocks unsafe deletes", async () => {
    const missing = mockPgConnectSequence([{ rows: [] }]);
    await expect(
      resolvers.Mutation.deleteCIClass(null, { id: "missing" }, mockContext(mockNeo4jSession(), {}, missing.pg))
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });

    const system = mockPgConnectSequence([{ rows: [{ id: "class-1", name: "Computer", is_system: true }] }]);
    await expect(
      resolvers.Mutation.deleteCIClass(null, { id: "class-1" }, mockContext(mockNeo4jSession(), {}, system.pg))
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });

    const usedSession = mockNeo4jSession([{ get: () => ({ toNumber: () => 3 }) }]);
    const used = mockPgConnectSequence([{ rows: [{ id: "class-2", name: "CustomApp", is_system: false }] }]);
    await expect(
      resolvers.Mutation.deleteCIClass(null, { id: "class-2" }, mockContext(usedSession, {}, used.pg))
    ).rejects.toThrow("3 CIs exist");
    expect(usedSession.close).toHaveBeenCalled();

    const deleteSession = mockNeo4jSession([{ get: () => ({ toNumber: () => 0 }) }]);
    const deletable = mockPgConnectSequence([{ rows: [{ id: "class-3", name: "TemporaryClass", is_system: false, created_by_app_id: "admin-console" }] }]);
    const emit = vi.fn();
    await expect(
      resolvers.Mutation.deleteCIClass(null, { id: "class-3" }, { ...mockContext(deleteSession, {}, deletable.pg), emit })
    ).resolves.toBe(true);
    expect(deletable.client.query).toHaveBeenCalledWith("DELETE FROM ci_classes WHERE id = $1", ["class-3"]);
    expect(deletable.client.query).toHaveBeenCalledWith("COMMIT");
    expect(emit).toHaveBeenCalledWith("ci_class.deleted", { className: "TemporaryClass", createdByAppId: "admin-console" });
  });
});

describe("CI environment choice resolvers", () => {
  it("maps and filters environment choices", async () => {
    const pg = mockPgSequence([{ rows: [{
      id: "env-1",
      code: "prod",
      name: "Production",
      active: true,
      sort_order: 10,
      is_production_like: true,
      created_at: "2026-01-01",
      updated_at: "2026-01-02",
    }] }]);

    const result = await resolvers.Query.ciEnvironmentChoices(null, { activeOnly: false }, mockContext(mockNeo4jSession(), {}, pg));

    expect(result).toEqual([expect.objectContaining({ code: "prod", name: "Production", sortOrder: 10, isProductionLike: true })]);
    expect(pg.query).toHaveBeenCalledWith(expect.stringContaining("FROM ci_environment_choices ORDER BY"));
  });

  it("upserts sanitized environment choices and rejects invalid input", async () => {
    const pg = mockPgSequence([{ rows: [{
      id: "env-1",
      code: "uat-env",
      name: "UAT Env",
      active: true,
      sort_order: 20,
      is_production_like: false,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
    }] }]);

    const result = await resolvers.Mutation.upsertCIEnvironmentChoice(null, {
      input: { code: " UAT Env! ", name: "UAT Env", active: true, sortOrder: 20 },
    }, mockContext(mockNeo4jSession(), {}, pg));

    expect(result).toMatchObject({ code: "uat-env", name: "UAT Env" });
    expect(pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO ci_environment_choices"), ["uat-env", "UAT Env", true, 20, false]);
    await expect(
      resolvers.Mutation.upsertCIEnvironmentChoice(null, { input: { code: "!!!", name: "" } }, mockContext(mockNeo4jSession(), {}, mockPg()))
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
  });

  it("deletes environment choices by id", async () => {
    await expect(
      resolvers.Mutation.deleteCIEnvironmentChoice(null, { id: "env-1" }, mockContext(mockNeo4jSession(), {}, mockPg([{ id: "env-1" }])))
    ).resolves.toBe(true);
    await expect(
      resolvers.Mutation.deleteCIEnvironmentChoice(null, { id: "missing" }, mockContext(mockNeo4jSession(), {}, mockPg([])))
    ).resolves.toBe(false);
  });
});

describe("Mutation.ingestCMDB", () => {
  it("queues ingestion via gRPC and returns jobId", async () => {
    const worker = {
      ingestCMDB: vi.fn().mockResolvedValue({ job_id: "job-123", status: "completed" }),
    };
    const result = await resolvers.Mutation.ingestCMDB(null, { payload: { items: [] } }, mockContext(mockNeo4jSession(), worker));
    expect(result.jobId).toBe("job-123");
    expect(result.status).toBe("completed");
    expect(worker.ingestCMDB).toHaveBeenCalled();
  });

  it("throws when gRPC fails", async () => {
    const worker = {
      ingestCMDB: vi.fn().mockRejectedValue(new Error("Worker unreachable")),
    };
    await expect(
      resolvers.Mutation.ingestCMDB(null, { payload: {} }, mockContext(mockNeo4jSession(), worker))
    ).rejects.toThrow("Failed to queue ingestion job");
  });
});

function mockPg(rows: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }),
  };
}

function mockPgSequence(results: any[]) {
  let idx = 0;
  return {
    query: vi.fn().mockImplementation(() => {
      const result = results[idx++] ?? { rows: [] };
      return Promise.resolve(result);
    }),
  };
}

function mockPgConnectSequence(results: any[]) {
  let idx = 0;
  const client = {
    query: vi.fn().mockImplementation((sql: string) => {
      const command = sql.trim().split(/\s+/)[0]?.toUpperCase();
      if (["BEGIN", "COMMIT", "ROLLBACK", "DELETE"].includes(command)) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      const result = results[idx++] ?? { rows: [], rowCount: 0 };
      return Promise.resolve(result);
    }),
    release: vi.fn(),
  };
  return {
    client,
    pg: {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      connect: vi.fn().mockResolvedValue(client),
    },
  };
}

function mockContextWithPg(session: any, pg: any, worker = {}) {
  return {
    neo4j: { session: () => session },
    pg,
    user: { id: "550e8400-e29b-41d4-a716-446655440001", email: "alice@specora.dev", role: "admin" },
    worker,
  };
}

describe("Query.discoverySources", () => {
  it("returns discovery sources from postgres", async () => {
    const pg = mockPg([{ id: "src-1", name: "AWS", type: "cloud", config: {}, createdAt: "2024-01-01" }]);
    const result = await resolvers.Query.discoverySources(null, {}, mockContextWithPg(mockNeo4jSession(), pg));
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("AWS");
  });
});

describe("Query.discoveryJobs", () => {
  it("returns discovery jobs from postgres", async () => {
    const pg = mockPg([{ id: "job-1", status: "pending" }]);
    const result = await resolvers.Query.discoveryJobs(null, {}, mockContextWithPg(mockNeo4jSession(), pg));
    expect(result).toHaveLength(1);
  });
});

describe("Query.discoveryJob", () => {
  it("returns a single discovery job by id", async () => {
    const pg = mockPg([{ id: "job-1", status: "completed" }]);
    const result = await resolvers.Query.discoveryJob(null, { id: "job-1" }, mockContextWithPg(mockNeo4jSession(), pg));
    expect(result.status).toBe("completed");
  });

  it("returns null when not found", async () => {
    const pg = mockPg([]);
    const result = await resolvers.Query.discoveryJob(null, { id: "missing" }, mockContextWithPg(mockNeo4jSession(), pg));
    expect(result).toBeNull();
  });
});

describe("Mutation.createDiscoverySource", () => {
  it("creates a discovery source", async () => {
    const pg = mockPg([{ id: "src-1", name: "Inventory API", type: "api", config: "{}", credential_ref: "none://discovery/public", created_at: "2024-01-01" }]);
    const result = await resolvers.Mutation.createDiscoverySource(null, { name: "Inventory API", type: "api", config: { credentialRef: "none://discovery/public" } }, mockContextWithPg(mockNeo4jSession(), pg));
    expect(result.name).toBe("Inventory API");
    expect(result.credentialRef).toBe("none://discovery/public");
    expect(result.createdAt).toBe("2024-01-01");
    expect(pg.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO discovery_sources"),
      ["Inventory API", "api", JSON.stringify({ credentialRef: "none://discovery/public" }), "none://discovery/public"]
    );
  });
});

describe("Mutation.updateDiscoverySource", () => {
  it("updates a discovery source and clears stale health status", async () => {
    const pg = mockPg([{ id: "src-1", name: "Inventory API", type: "api", config: { endpoint: "https://inventory.example/api" }, credential_ref: "vault://inventory", created_at: "2024-01-01", updated_at: "2024-01-02" }]);
    const result = await resolvers.Mutation.updateDiscoverySource(
      null,
      { id: "src-1", name: "Inventory API", type: "api", config: { endpoint: "https://inventory.example/api", credentialRef: "vault://inventory" } },
      mockContextWithPg(mockNeo4jSession(), pg)
    );

    expect(result.name).toBe("Inventory API");
    expect(result.credentialRef).toBe("vault://inventory");
    expect(pg.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE discovery_sources"),
      ["src-1", "Inventory API", "api", JSON.stringify({ endpoint: "https://inventory.example/api", credentialRef: "vault://inventory" }), "vault://inventory"]
    );
  });
});

describe("Mutation.deleteDiscoverySource", () => {
  it("deletes a discovery source", async () => {
    const pg = mockPg([{ _: 1 }]);
    const result = await resolvers.Mutation.deleteDiscoverySource(null, { id: "src-1" }, mockContextWithPg(mockNeo4jSession(), pg));
    expect(result).toBe(true);
  });
});

describe("ConfigurationItem.dataQualityScore", () => {
  it("returns the score when present", () => {
    expect(resolvers.ConfigurationItem.dataQualityScore({ dataQualityScore: 0.85 }, {}, {})).toBe(0.85);
  });

  it("returns null when absent", () => {
    expect(resolvers.ConfigurationItem.dataQualityScore({}, {}, {})).toBeNull();
  });
});

describe("ConfigurationItem.lastDiscoveredAt", () => {
  it("returns the timestamp when present", () => {
    expect(resolvers.ConfigurationItem.lastDiscoveredAt({ lastDiscoveredAt: "2024-01-01" }, {}, {})).toBe("2024-01-01");
  });

  it("returns null when absent", () => {
    expect(resolvers.ConfigurationItem.lastDiscoveredAt({}, {}, {})).toBeNull();
  });
});

describe("ConfigurationItem.health", () => {
  it("returns health scores for a CI", async () => {
    const session = mockNeo4jSession([{ get: (k: string) => k === "relCount" ? { toNumber: () => 2 } : null }]);
    const result = await resolvers.ConfigurationItem.health(
      { id: "ci-1", name: "Web", class: "Server", lastDiscoveredAt: "2024-01-01" },
      {},
      mockContextWithPg(session, mockPg())
    );
    expect(result.freshness).toBe(1.0);
    expect(result.completeness).toBe(1.0);
    expect(result.relationshipValidity).toBe(1.0);
    expect(result.overall).toBe(1.0);
  });

  it("returns lower freshness when not discovered", async () => {
    const session = mockNeo4jSession([{ get: (k: string) => k === "relCount" ? { toNumber: () => 0 } : null }]);
    const result = await resolvers.ConfigurationItem.health(
      { id: "ci-1", name: "Web", class: "Server" },
      {},
      mockContextWithPg(session, mockPg())
    );
    expect(result.freshness).toBe(0.0);
    expect(result.relationshipValidity).toBe(0.5);
  });
});

describe("Mutation.deleteRelationship", () => {
  it("deletes an existing relationship", async () => {
    const oldRel = { start: "s", end: "t", type: "DEPENDS_ON", properties: {} };
    const oldRecord = makeRecord(makeNode({ id: "src-1" }), oldRel, makeNode({ id: "tgt-1" }));
    const session = mockNeo4jSession([oldRecord], [{ get: (k: string) => k === "deleted" ? { toNumber: () => 1 } : null }]);
    const result = await resolvers.Mutation.deleteRelationship(
      null,
      { sourceId: "550e8400-e29b-41d4-a716-446655440000", targetId: "550e8400-e29b-41d4-a716-446655440001", type: "DEPENDS_ON" },
      mockContext(session)
    );
    expect(result).toBe(true);
    expect(session.run).toHaveBeenCalledWith(
      expect.stringContaining("DELETE r"),
      expect.objectContaining({ sourceId: "550e8400-e29b-41d4-a716-446655440000", targetId: "550e8400-e29b-41d4-a716-446655440001" })
    );
  });

  it("returns false when relationship not found", async () => {
    const session = mockNeo4jSession([], [{ get: (k: string) => k === "deleted" ? { toNumber: () => 0 } : null }]);
    const result = await resolvers.Mutation.deleteRelationship(
      null,
      { sourceId: "550e8400-e29b-41d4-a716-446655440000", targetId: "550e8400-e29b-41d4-a716-446655440001", type: "DEPENDS_ON" },
      mockContext(session)
    );
    expect(result).toBe(false);
  });
});

describe("Mutation.updateRelationship", () => {
  it("updates relationship type when newType is different", async () => {
    const oldRel = { start: "550e8400-e29b-41d4-a716-446655440000", end: "550e8400-e29b-41d4-a716-446655440001", type: "DEPENDS_ON", properties: {} };
    const newRel = { start: "550e8400-e29b-41d4-a716-446655440000", end: "550e8400-e29b-41d4-a716-446655440001", type: "HOSTED_ON", properties: {} };
    const oldRecord = makeRecord(makeNode({ id: "550e8400-e29b-41d4-a716-446655440000" }), oldRel, makeNode({ id: "550e8400-e29b-41d4-a716-446655440001", name: "Web-01", class: "Server" }));
    const newRecord = {
      get: (k: string) => {
        if (k === "r2") return newRel;
        if (k === "target") return makeNode({ id: "550e8400-e29b-41d4-a716-446655440001", name: "Web-01", class: "Server" });
        return null;
      },
    };
    const session = mockNeo4jSession([oldRecord], [newRecord]);
    const result = await resolvers.Mutation.updateRelationship(
      null,
      { sourceId: "550e8400-e29b-41d4-a716-446655440000", targetId: "550e8400-e29b-41d4-a716-446655440001", type: "DEPENDS_ON", newType: "HOSTED_ON" },
      mockContext(session)
    );
    expect(result.type).toBe("HOSTED_ON");
    expect(session.run).toHaveBeenCalledWith(
      expect.stringContaining("DELETE r"),
      expect.anything()
    );
  });

  it("updates attributes when type unchanged", async () => {
    const oldRel = { start: "550e8400-e29b-41d4-a716-446655440000", end: "550e8400-e29b-41d4-a716-446655440001", type: "DEPENDS_ON", properties: {} };
    const newRel = { start: "550e8400-e29b-41d4-a716-446655440000", end: "550e8400-e29b-41d4-a716-446655440001", type: "DEPENDS_ON", properties: { priority: "high" } };
    const oldRecord = makeRecord(makeNode({ id: "550e8400-e29b-41d4-a716-446655440000" }), oldRel, makeNode({ id: "550e8400-e29b-41d4-a716-446655440001", name: "Web-01", class: "Server" }));
    const newRecord = {
      get: (k: string) => {
        if (k === "r") return newRel;
        if (k === "target") return makeNode({ id: "550e8400-e29b-41d4-a716-446655440001", name: "Web-01", class: "Server" });
        return null;
      },
    };
    const session = mockNeo4jSession([oldRecord], [newRecord]);
    const result = await resolvers.Mutation.updateRelationship(
      null,
      { sourceId: "550e8400-e29b-41d4-a716-446655440000", targetId: "550e8400-e29b-41d4-a716-446655440001", type: "DEPENDS_ON", attributes: { priority: "high" } },
      mockContext(session)
    );
    expect(result.type).toBe("DEPENDS_ON");
    expect(session.run).toHaveBeenCalledWith(
      expect.stringContaining("SET r.attributes"),
      expect.anything()
    );
  });

  it("throws when relationship not found", async () => {
    const session = mockNeo4jSession([], []);
    await expect(
      resolvers.Mutation.updateRelationship(
        null,
        { sourceId: "550e8400-e29b-41d4-a716-446655440000", targetId: "550e8400-e29b-41d4-a716-446655440001", type: "DEPENDS_ON" },
        mockContext(session)
      )
    ).rejects.toThrow("Relationship not found");
  });
});

describe("Query.me", () => {
  it("returns user when authenticated", async () => {
    const pg = mockPg([{ id: "550e8400-e29b-41d4-a716-446655440001", name: "Alice", email: "alice@specora.dev", preferences: { theme: "dark" } }]);
    const result = await resolvers.Query.me(null, {}, mockContextWithPg(mockNeo4jSession(), pg));
    expect(result.id).toBe("550e8400-e29b-41d4-a716-446655440001");
    expect(result.name).toBe("Alice");
    expect(result.preferences).toEqual({ theme: "dark" });
  });

  it("returns null when not authenticated", async () => {
    const result = await resolvers.Query.me(null, {}, { neo4j: { session: () => mockNeo4jSession() }, pg: mockPg(), user: null });
    expect(result).toBeNull();
  });
});

describe("Mutation.updatePreferences", () => {
  it("updates user preferences", async () => {
    const pg = mockPg([{ id: "550e8400-e29b-41d4-a716-446655440001", name: "Alice", email: "alice@specora.dev", preferences: { dock: { order: ["service-map"] } } }]);
    const result = await resolvers.Mutation.updatePreferences(null, { preferences: { dock: { order: ["service-map"] } } }, mockContextWithPg(mockNeo4jSession(), pg));
    expect(result.preferences).toEqual({ dock: { order: ["service-map"] } });
    expect(pg.query).toHaveBeenCalledWith(
      expect.stringContaining("COALESCE(preferences, '{}'::jsonb) || $1::jsonb"),
      [JSON.stringify({ dock: { order: ["service-map"] } }), "550e8400-e29b-41d4-a716-446655440001"]
    );
  });

  it("throws when not authenticated", async () => {
    await expect(
      resolvers.Mutation.updatePreferences(null, { preferences: {} }, { neo4j: { session: () => mockNeo4jSession() }, pg: mockPg(), user: null })
    ).rejects.toThrow("Unauthorized");
  });
});

describe("Mutation.updateProfile", () => {
  it("updates the authenticated user's display name", async () => {
    const pg = mockPg([{ id: "550e8400-e29b-41d4-a716-446655440001", name: "Alice Specora", email: "alice@specora.dev", preferences: {}, role: "admin" }]);
    const result = await resolvers.Mutation.updateProfile(null, { name: " Alice Specora " }, mockContextWithPg(mockNeo4jSession(), pg));
    expect(result.name).toBe("Alice Specora");
    expect(pg.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE users SET name = $1"),
      ["Alice Specora", "550e8400-e29b-41d4-a716-446655440001"]
    );
  });

  it("rejects invalid display names", async () => {
    await expect(
      resolvers.Mutation.updateProfile(null, { name: "A" }, mockContextWithPg(mockNeo4jSession(), mockPg()))
    ).rejects.toThrow("Display name must be between 2 and 120 characters");
  });
});

describe("Saved view resolvers", () => {
  it("returns only the authenticated user's saved views", async () => {
    const pg = mockPg([{
      id: "view-1",
      name: "Critical Service",
      root_id: "bs-1",
      class_filter: ["BusinessService"],
      environment_filter: ["Production"],
      relationship_filter: ["DEPENDS_ON"],
      camera_x: 10,
      camera_y: 20,
      camera_zoom: 1.2,
      created_at: "2026-01-01",
      updated_at: "2026-01-02",
    }]);

    const result = await resolvers.Query.savedViews(null, {}, mockContextWithPg(mockNeo4jSession(), pg));

    expect(result).toEqual([expect.objectContaining({
      id: "view-1",
      rootId: "bs-1",
      classFilter: ["BusinessService"],
      cameraZoom: 1.2,
    })]);
    expect(pg.query).toHaveBeenCalledWith(expect.stringContaining("WHERE user_id = $1"), ["550e8400-e29b-41d4-a716-446655440001"]);
  });

  it("creates saved views with serialized filters and camera state", async () => {
    const pg = mockPg([{
      id: "view-1",
      name: "Critical Service",
      root_id: "bs-1",
      class_filter: ["Server"],
      environment_filter: ["Prod"],
      relationship_filter: ["HOSTED_ON"],
      camera_x: 1,
      camera_y: 2,
      camera_zoom: 0.75,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
    }]);

    const result = await resolvers.Mutation.createSavedView(null, {
      name: "Critical Service",
      rootId: "bs-1",
      classFilter: ["Server"],
      environmentFilter: ["Prod"],
      relationshipFilter: ["HOSTED_ON"],
      cameraX: 1,
      cameraY: 2,
      cameraZoom: 0.75,
    }, mockContextWithPg(mockNeo4jSession(), pg));

    expect(result.rootId).toBe("bs-1");
    expect(pg.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO saved_views"),
      [
        "550e8400-e29b-41d4-a716-446655440001",
        "Critical Service",
        "bs-1",
        JSON.stringify(["Server"]),
        JSON.stringify(["Prod"]),
        JSON.stringify(["HOSTED_ON"]),
        1,
        2,
        0.75,
      ]
    );
  });

  it("rejects empty saved view updates", async () => {
    await expect(
      resolvers.Mutation.updateSavedView(null, { id: "view-1" }, mockContextWithPg(mockNeo4jSession(), mockPg()))
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
  });

  it("returns false when deleting a missing saved view", async () => {
    const result = await resolvers.Mutation.deleteSavedView(null, { id: "missing" }, mockContextWithPg(mockNeo4jSession(), mockPg([])));
    expect(result).toBe(false);
  });
});
