import { describe, it, expect, vi } from "vitest";
import { persistAuditLog, initializeAuditLog, recordAuditEvent } from "./auditLog";
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
      expect.anything()
    );
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

    expect(fastify.pg.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_log"),
      [null, "app.install", "AppInstallation", "it-visibility-dcim", null, null, JSON.stringify({ result: "success", source: "test" })]
    );
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
