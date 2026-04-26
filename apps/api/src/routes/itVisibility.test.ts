import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { itVisibilityRoutes } from "./itVisibility";

describe("itVisibilityRoutes", () => {
  async function buildApp(role = "admin", queryImpl?: (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number }>, connectImpl?: any) {
    const app = Fastify();
    app.decorate("authenticate", async (request: any) => {
      request.user = { id: "u1", role };
    });
    app.decorate("pg", {
      query: queryImpl ? vi.fn(queryImpl) : vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      connect: connectImpl,
    });
    await app.register(itVisibilityRoutes);
    return app;
  }

  it("returns the DCIM overview", async () => {
    const app = await buildApp("admin", async (sql: string) => {
      if (sql.includes("FROM dcim_sites")) {
        return { rows: [{ id: "site-1", name: "Dallas DC1", capacity_kw: 100, used_kw: 62 }], rowCount: 1 };
      }
      if (sql.includes("FROM dcim_racks")) {
        return {
          rows: [{
            id: "rack-1",
            name: "A12",
            room_name: "Hall A",
            site_name: "Dallas DC1",
            ru_total: 42,
            ru_used: 21,
            power_capacity_kw: 10,
            power_used_kw: 5,
            weight_capacity_kg: 1000,
            weight_used_kg: 400,
            risk_score: 20,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM dcim_assets")) {
        return { rows: [{ id: "asset-1", name: "checkout-app-01" }], rowCount: 1 };
      }
      if (sql.includes("FROM dcim_events")) {
        return { rows: [{ id: "event-1", severity: "critical", title: "PDU load high" }], rowCount: 1 };
      }
      if (sql.includes("FROM dcim_power_paths")) {
        return { rows: [{ rack_id: "rack-1", path_count: 2, capacity_kw: 10, load_kw: 5 }], rowCount: 1 };
      }
      if (sql.includes("FROM dcim_floorplans")) {
        return { rows: [{ id: "floor-1", name: "Hall A", width: 1200, height: 720, objects: [] }], rowCount: 1 };
      }
      if (sql.includes("FROM dcim_floorplan_connections")) {
        return { rows: [{ id: "conn-1", source_object_id: "power-1", target_object_id: "rack-obj-1", connection_type: "power" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await app.inject({ method: "GET", url: "/api/it-visibility/dcim/overview" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.package.premium).toBe(true);
    expect(body.summary.powerUtilization).toBe(62);
    expect(body.racks[0].ru_utilization).toBe(50);
    expect(body.floorplan.id).toBe("floor-1");
    expect(body.floorplan.connections[0].id).toBe("conn-1");
  });

  it("rejects event ingestion without operate permission", async () => {
    const app = await buildApp("viewer", async (sql: string) => {
      if (sql.includes("FROM app_permissions")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/it-visibility/dcim/events",
      payload: { source: "pdu", externalRef: "x", eventType: "power", title: "Load high" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("upserts external events for operators", async () => {
    const app = await buildApp("admin", async (sql: string) => {
      if (sql.includes("INSERT INTO dcim_events")) {
        return { rows: [{ id: "event-1", source: "pdu", external_ref: "x" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/it-visibility/dcim/events",
      payload: { source: "pdu", externalRef: "x", eventType: "power", title: "Load high" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).event.id).toBe("event-1");
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["dcim.event_recorded", "DcimEvent", "event-1"]));
  });

  it("plans rack placement candidates", async () => {
    const app = await buildApp("admin", async (sql: string) => {
      if (sql.includes("FROM dcim_racks")) {
        return {
          rows: [
            { id: "rack-1", name: "A12", room_name: "Hall A", site_name: "Dallas DC1", ru_total: 42, ru_used: 30, power_capacity_kw: 18, power_used_kw: 12, weight_capacity_kg: 1000, weight_used_kg: 500, risk_score: 20, redundancy: "A/B" },
            { id: "rack-2", name: "B07", room_name: "Hall A", site_name: "Dallas DC1", ru_total: 42, ru_used: 41, power_capacity_kw: 18, power_used_kw: 17.8, weight_capacity_kg: 1000, weight_used_kg: 900, risk_score: 80, redundancy: "N+1" },
          ],
          rowCount: 2,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/it-visibility/dcim/placement/plan",
      payload: { ruHeight: 2, powerKw: 1, weightKg: 50, redundancy: "A/B" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.recommendation.rack.id).toBe("rack-1");
    expect(body.candidates[1].viable).toBe(false);
  });

  it("creates rack assignments for deployment integrations", async () => {
    const queries: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes("SELECT * FROM dcim_racks")) {
          return { rows: [{ id: "rack-1", ru_total: 42, ru_used: 10, power_capacity_kw: 18, power_used_kw: 4 }], rowCount: 1 };
        }
        if (sql.includes("INSERT INTO dcim_assets")) {
          return { rows: [{ id: "asset-1", name: "pipeline-server-01", status: "planned" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const app = await buildApp("admin", undefined, vi.fn(async () => client));
    const res = await app.inject({
      method: "POST",
      url: "/api/it-visibility/dcim/rack-assignments",
      payload: { rackId: "rack-1", name: "pipeline-server-01", ruHeight: 2, powerDrawKw: 0.8 },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).asset.status).toBe("planned");
    expect(queries.some((sql) => sql.includes("UPDATE dcim_racks"))).toBe(true);
    expect(client.release).toHaveBeenCalled();
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["dcim.rack_assignment_created", "DcimAsset", "asset-1"]));
  });

  it("updates floorplan object positions", async () => {
    const app = await buildApp("admin", async (sql: string) => {
      if (sql.includes("UPDATE dcim_floorplan_objects")) {
        return { rows: [{ id: "obj-1", label: "A12", x: 240, y: 180, width: 140, rotation: 90 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = await app.inject({
      method: "PATCH",
      url: "/api/it-visibility/dcim/floorplans/floor-1/objects/obj-1",
      payload: { x: 240, y: 180, width: 140, rotation: 90 },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).object.x).toBe(240);
    expect(JSON.parse(res.payload).object.rotation).toBe(90);
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["dcim.floorplan_object_updated", "DcimFloorplanObject", "obj-1"]));
  });

  it("creates and deletes facility floorplan objects", async () => {
    const app = await buildApp("admin", async (sql: string) => {
      if (sql.includes("INSERT INTO dcim_floorplan_objects")) {
        return { rows: [{ id: "obj-1", object_type: "cooling", label: "CRAC-2" }], rowCount: 1 };
      }
      if (sql.includes("DELETE FROM dcim_floorplan_objects")) {
        return { rows: [{ id: "obj-1", object_type: "cooling", label: "CRAC-2" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const create = await app.inject({
      method: "POST",
      url: "/api/it-visibility/dcim/floorplans/floor-1/objects",
      payload: { objectType: "cooling", label: "CRAC-2", x: 120, y: 140 },
    });
    expect(create.statusCode).toBe(200);
    expect(JSON.parse(create.payload).object.object_type).toBe("cooling");

    const remove = await app.inject({
      method: "DELETE",
      url: "/api/it-visibility/dcim/floorplans/floor-1/objects/obj-1",
    });
    expect(remove.statusCode).toBe(200);
    expect(JSON.parse(remove.payload).object.id).toBe("obj-1");
  });

  it("creates racks with floorplan objects", async () => {
    const queries: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes("SELECT * FROM dcim_floorplans")) {
          return { rows: [{ id: "floor-1", room_id: "room-1" }], rowCount: 1 };
        }
        if (sql.includes("INSERT INTO dcim_racks")) {
          return { rows: [{ id: "rack-1", name: "C01", room_id: "room-1" }], rowCount: 1 };
        }
        if (sql.includes("INSERT INTO dcim_floorplan_objects")) {
          return { rows: [{ id: "obj-1", object_id: "rack-1", label: "C01" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const app = await buildApp("admin", undefined, vi.fn(async () => client));
    const res = await app.inject({
      method: "POST",
      url: "/api/it-visibility/dcim/racks",
      payload: { floorplanId: "floor-1", name: "C01", x: 320, y: 260 },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.rack.name).toBe("C01");
    expect(body.object.object_id).toBe("rack-1");
    expect(queries.some((sql) => sql.includes("INSERT INTO dcim_racks"))).toBe(true);
    expect(client.release).toHaveBeenCalled();
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["dcim.rack_created", "DcimRack", "rack-1"]));
  });

  it("creates floorplan connections for cabling", async () => {
    const app = await buildApp("admin", async (sql: string) => {
      if (sql.includes("INSERT INTO dcim_floorplan_connections")) {
        return { rows: [{ id: "conn-1", source_object_id: "obj-a", target_object_id: "obj-b", connection_type: "network" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/it-visibility/dcim/floorplans/floor-1/connections",
      payload: { sourceObjectId: "obj-a", targetObjectId: "obj-b", connectionType: "network", label: "uplink" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).connection.connection_type).toBe("network");
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["dcim.floorplan_connection_created", "DcimFloorplanConnection", "conn-1"]));
  });

  it("updates and deletes floorplan connections", async () => {
    const app = await buildApp("admin", async (sql: string) => {
      if (sql.includes("UPDATE dcim_floorplan_connections")) {
        return { rows: [{ id: "conn-1", label: "Fiber A", connection_type: "network", status: "warning" }], rowCount: 1 };
      }
      if (sql.includes("DELETE FROM dcim_floorplan_connections")) {
        return { rows: [{ id: "conn-1", label: "Fiber A" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const update = await app.inject({
      method: "PATCH",
      url: "/api/it-visibility/dcim/floorplans/floor-1/connections/conn-1",
      payload: { label: "Fiber A", status: "warning" },
    });
    expect(update.statusCode).toBe(200);
    expect(JSON.parse(update.payload).connection.status).toBe("warning");

    const remove = await app.inject({
      method: "DELETE",
      url: "/api/it-visibility/dcim/floorplans/floor-1/connections/conn-1",
    });
    expect(remove.statusCode).toBe(200);
    expect(JSON.parse(remove.payload).connection.id).toBe("conn-1");
  });

  it("updates rack attributes and synchronizes floorplan labels", async () => {
    const queries: string[] = [];
    const app = await buildApp("admin", async (sql: string) => {
      queries.push(sql);
      if (sql.includes("UPDATE dcim_racks")) {
        return { rows: [{ id: "rack-1", name: "C02", ru_total: 48 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = await app.inject({
      method: "PATCH",
      url: "/api/it-visibility/dcim/racks/rack-1",
      payload: { name: "C02", ruTotal: 48 },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).rack.name).toBe("C02");
    expect(queries.some((sql) => sql.includes("UPDATE dcim_floorplan_objects"))).toBe(true);
  });
});
