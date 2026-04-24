import { describe, it, expect, vi, beforeEach } from "vitest";
import neo4j from "neo4j-driver";
import { resolvers } from "./resolvers";

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
    const pg = mockPg([{ id: "src-1", name: "CSV", type: "file", config: "{}", createdAt: "2024-01-01" }]);
    const result = await resolvers.Mutation.createDiscoverySource(null, { name: "CSV", type: "file" }, mockContextWithPg(mockNeo4jSession(), pg));
    expect(result.name).toBe("CSV");
    expect(pg.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO discovery_sources"),
      expect.anything()
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
      expect.stringContaining("UPDATE users SET preferences"),
      [JSON.stringify({ dock: { order: ["service-map"] } }), "550e8400-e29b-41d4-a716-446655440001"]
    );
  });

  it("throws when not authenticated", async () => {
    await expect(
      resolvers.Mutation.updatePreferences(null, { preferences: {} }, { neo4j: { session: () => mockNeo4jSession() }, pg: mockPg(), user: null })
    ).rejects.toThrow("Unauthorized");
  });
});
