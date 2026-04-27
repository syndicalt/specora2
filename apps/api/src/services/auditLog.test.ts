import { describe, it, expect, vi } from "vitest";
import { persistAuditLog, initializeAuditLog, recordAuditEvent, verifyAuditIntegrity } from "./auditLog";
import { emit } from "./eventBus";

describe("auditLog", () => {
  function mockFastify() {
    return {
      pg: {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      },
    } as any;
  }

  it("persists an audit entry", async () => {
    const fastify = mockFastify();
    await persistAuditLog(fastify, {
      action: "ci.created",
      entity_type: "ConfigurationItem",
      entity_id: "bs-1",
      new_values: { name: "Portal" },
    });
    expect(fastify.pg.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_log"),
      expect.arrayContaining(["ci.created", "ConfigurationItem", "bs-1"])
    );
    const insertCall = fastify.pg.query.mock.calls.find(([sql]: any[]) => sql.includes("INSERT INTO audit_log"));
    expect(insertCall?.[1][8]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("serializes audit writes with an advisory-lock transaction when a pool client is available", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    const fastify = {
      pg: {
        connect: vi.fn().mockResolvedValue(client),
        totalCount: 1,
      },
    } as any;

    await persistAuditLog(fastify, {
      action: "ci.created",
      entity_type: "ConfigurationItem",
      entity_id: "bs-1",
    });

    expect(client.query).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(client.query).toHaveBeenNthCalledWith(2, "SELECT pg_advisory_xact_lock(hashtext('specora.audit_log'))");
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.any(Array));
    expect(client.query).toHaveBeenLastCalledWith("COMMIT");
    expect(client.release).toHaveBeenCalled();
  });

  it("records canonical audit events and normalizes non-UUID actors", async () => {
    const fastify = mockFastify();
    await recordAuditEvent(fastify, {
      actorId: "u1",
      action: "app.install",
      entityType: "AppInstallation",
      entityId: "it-visibility-dcim",
      metadata: { source: "test" },
    });

    const insertCall = fastify.pg.query.mock.calls.find(([sql]: any[]) => sql.includes("INSERT INTO audit_log"));
    expect(insertCall?.[1]).toEqual(expect.arrayContaining([
      null,
      "app.install",
      "AppInstallation",
      "it-visibility-dcim",
      null,
      null,
      JSON.stringify({ result: "success", source: "test" }),
    ]));
  });

  it("verifies hash chained audit entries", async () => {
    const first = {
      id: "audit-1",
      actor_id: null,
      action: "ci.created",
      entity_type: "ConfigurationItem",
      entity_id: "ci-1",
      old_values: null,
      new_values: { name: "CI" },
      metadata: null,
      previous_hash: null,
      entry_hash: "",
      created_at: "2026-04-27T00:00:00.000Z",
    };
    const second = {
      id: "audit-2",
      actor_id: null,
      action: "ci.updated",
      entity_type: "ConfigurationItem",
      entity_id: "ci-1",
      old_values: { name: "CI" },
      new_values: { name: "CI2" },
      metadata: null,
      previous_hash: "",
      entry_hash: "",
      created_at: "2026-04-27T00:01:00.000Z",
    };
    const { expectedAuditHash } = await import("./auditLog");
    first.entry_hash = expectedAuditHash(first);
    second.previous_hash = first.entry_hash;
    second.entry_hash = expectedAuditHash(second);
    const pg = { query: vi.fn().mockResolvedValue({ rows: [first, second], rowCount: 2 }) };

    const result = await verifyAuditIntegrity(pg, 100);

    expect(result.verified).toBe(true);
    expect(result.checked).toBe(2);
    expect(result.headHash).toBe(second.entry_hash);
  });

  it("detects tampered audit chain entries", async () => {
    const pg = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          id: "audit-1",
          actor_id: null,
          action: "ci.created",
          entity_type: "ConfigurationItem",
          entity_id: "ci-1",
          old_values: null,
          new_values: { name: "Tampered" },
          metadata: null,
          previous_hash: "unexpected",
          entry_hash: "bad",
          created_at: "2026-04-27T00:00:00.000Z",
        }],
        rowCount: 1,
      }),
    };

    const result = await verifyAuditIntegrity(pg, 100);

    expect(result.verified).toBe(false);
    expect(result.failures.map((failure) => failure.reason)).toEqual(expect.arrayContaining(["previous_hash_mismatch", "entry_hash_mismatch"]));
  });

  it("initializes subscribers for all event types", () => {
    const fastify = mockFastify();
    initializeAuditLog(fastify);

    // Emit events and verify they trigger pg.query
    emit("ci.created", { ciId: "bs-1", name: "Portal" });
    emit("ci.updated", { ciId: "bs-1", oldValues: {}, newValues: {} });
    emit("ci.deleted", { ciId: "bs-1", oldValues: {} });
    emit("relationship.created", { sourceId: "a", targetId: "b", type: "DEPENDS_ON" });
    emit("relationship.updated", { sourceId: "a", targetId: "b", type: "DEPENDS_ON", oldValues: {}, newValues: {} });
    emit("relationship.deleted", { sourceId: "a", targetId: "b", type: "DEPENDS_ON", oldValues: {} });
    emit("discovery.completed", { jobId: "dj-1" });
  });
});
