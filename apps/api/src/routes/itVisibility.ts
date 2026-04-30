import type { FastifyInstance } from "fastify";
import { hasPermission } from "../services/rbac";
import { recordRouteAudit } from "./auditHelpers";

type AuthUser = { id?: string; role?: string };

type DcimSiteRow = {
  id: string;
  capacity_kw?: string | number | null;
  used_kw?: string | number | null;
};

type DcimRackRow = {
  id: string;
  ru_total?: string | number | null;
  ru_used?: string | number | null;
  power_capacity_kw?: string | number | null;
  power_used_kw?: string | number | null;
  weight_capacity_kg?: string | number | null;
  weight_used_kg?: string | number | null;
  risk_score?: string | number | null;
  redundancy?: string | null;
};

type DcimPowerRow = {
  rack_id: string;
  path_count?: string | number | null;
};

type DcimEventRow = {
  severity?: string | null;
};

type PlacementCandidate = {
  rack: DcimRackRow;
  score: number;
  viable: boolean;
  freeRu: number;
  powerAvailable: number;
  weightAvailable: number;
  violations: string[];
};

async function canUseItVisibility(fastify: FastifyInstance, user: AuthUser | null | undefined, action: "read" | "write" | "operate") {
  if (!user?.role) return false;
  if (user.role === "admin" || user.role === "security_admin") return true;
  return hasPermission(fastify.pg, { role: user.role, resource: "it-visibility", action });
}

function utilization(used: number, total: number) {
  if (!total) return 0;
  return Math.round((used / total) * 100);
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function jsonValue(value: unknown, fallback: Record<string, unknown> = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) return JSON.stringify(value);
  return JSON.stringify(fallback);
}

export async function itVisibilityRoutes(fastify: FastifyInstance) {
  fastify.get("/api/it-visibility/dcim/overview", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user;
    if (!(await canUseItVisibility(fastify, user, "read"))) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    const [sites, racks, assets, events, power, floorplan] = await Promise.all([
      fastify.pg.query(`SELECT * FROM dcim_sites ORDER BY name`),
      fastify.pg.query(`
        SELECT r.*, room.name AS room_name, site.name AS site_name
        FROM dcim_racks r
        JOIN dcim_rooms room ON room.id = r.room_id
        JOIN dcim_sites site ON site.id = room.site_id
        ORDER BY site.name, room.name, r.row_label, r.position_label
      `),
      fastify.pg.query(`SELECT * FROM dcim_assets ORDER BY name`),
      fastify.pg.query(`
        SELECT e.*, site.name AS site_name, room.name AS room_name, rack.name AS rack_name
        FROM dcim_events e
        LEFT JOIN dcim_sites site ON site.id = e.site_id
        LEFT JOIN dcim_rooms room ON room.id = e.room_id
        LEFT JOIN dcim_racks rack ON rack.id = e.rack_id
        WHERE e.status <> 'closed'
        ORDER BY
          CASE e.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
          e.last_seen_at DESC
        LIMIT 25
      `),
      fastify.pg.query(`
        SELECT rack_id, COUNT(*)::int AS path_count, SUM(capacity_kw)::float AS capacity_kw, SUM(load_kw)::float AS load_kw
        FROM dcim_power_paths
        GROUP BY rack_id
      `),
      fastify.pg.query(`
        SELECT fp.*,
               COALESCE(json_agg(json_build_object(
                 'id', obj.id,
                 'object_type', obj.object_type,
                 'object_id', obj.object_id,
                 'label', obj.label,
                 'x', obj.x,
                 'y', obj.y,
                 'width', obj.width,
                 'height', obj.height,
                 'rotation', obj.rotation,
                 'layer', obj.layer,
                 'style', obj.style,
                 'metadata', obj.metadata
               ) ORDER BY obj.layer, obj.label) FILTER (WHERE obj.id IS NOT NULL), '[]') AS objects
        FROM dcim_floorplans fp
        LEFT JOIN dcim_floorplan_objects obj ON obj.floorplan_id = fp.id
        GROUP BY fp.id
        ORDER BY fp.name
        LIMIT 1
      `),
    ]);

    let floorplanRow = floorplan.rows[0] || null;
    if (floorplanRow) {
      const connections = await fastify.pg.query(
        `SELECT c.*,
                source.label AS source_label,
                target.label AS target_label
         FROM dcim_floorplan_connections c
         JOIN dcim_floorplan_objects source ON source.id = c.source_object_id
         JOIN dcim_floorplan_objects target ON target.id = c.target_object_id
         WHERE c.floorplan_id = $1
         ORDER BY c.connection_type, c.label`,
        [floorplanRow.id]
      );
      floorplanRow = { ...floorplanRow, connections: connections.rows };
    }

    const siteRows = sites.rows as DcimSiteRow[];
    const rackRows = racks.rows as DcimRackRow[];
    const eventRows = events.rows as DcimEventRow[];
    const powerByRack = new Map((power.rows as DcimPowerRow[]).map((row) => [row.rack_id, row]));
    const enrichedRacks = rackRows.map((rack) => {
      const powerRow = powerByRack.get(rack.id);
      const powerUsed = Number(rack.power_used_kw || 0);
      const powerCapacity = Number(rack.power_capacity_kw || 0);
      return {
        ...rack,
        ru_utilization: utilization(Number(rack.ru_used || 0), Number(rack.ru_total || 0)),
        power_utilization: utilization(powerUsed, powerCapacity),
        weight_utilization: utilization(Number(rack.weight_used_kg || 0), Number(rack.weight_capacity_kg || 0)),
        power_path_count: powerRow?.path_count || 0,
      };
    });

    const openCriticalEvents = eventRows.filter((event) => event.severity === "critical").length;
    const totalCapacityKw = siteRows.reduce((sum, site) => sum + Number(site.capacity_kw || 0), 0);
    const usedKw = siteRows.reduce((sum, site) => sum + Number(site.used_kw || 0), 0);
    const avgRisk = enrichedRacks.length
      ? Math.round(enrichedRacks.reduce((sum, rack) => sum + Number(rack.risk_score || 0), 0) / enrichedRacks.length)
      : 0;

    return {
      package: {
        id: "it-visibility",
        name: "IT Visibility",
        premium: true,
        entitlementMode: "placeholder",
        paymentReady: false,
      },
      summary: {
        sites: sites.rows.length,
        racks: racks.rows.length,
        assets: assets.rows.length,
        openEvents: events.rows.length,
        openCriticalEvents,
        totalCapacityKw,
        usedKw,
        powerUtilization: utilization(usedKw, totalCapacityKw),
        avgRisk,
      },
      sites: siteRows,
      racks: enrichedRacks,
      assets: assets.rows,
      events: eventRows,
      floorplan: floorplanRow,
    };
  });

  fastify.patch("/api/it-visibility/dcim/floorplans/:floorplanId/objects/:objectId", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user;
    if (!(await canUseItVisibility(fastify, user, "write"))) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const { floorplanId, objectId } = request.params as { floorplanId: string; objectId: string };
    const body = request.body as { label?: string; x?: number; y?: number; width?: number; height?: number; rotation?: number; style?: Record<string, unknown>; metadata?: Record<string, unknown> };
    const result = await fastify.pg.query(
      `UPDATE dcim_floorplan_objects
       SET label = COALESCE($3, label),
           x = COALESCE($4, x),
           y = COALESCE($5, y),
           width = COALESCE($6, width),
           height = COALESCE($7, height),
           rotation = COALESCE($8, rotation),
           style = COALESCE($9, style),
           metadata = COALESCE($10, metadata),
           updated_at = NOW()
       WHERE floorplan_id = $1 AND id = $2
       RETURNING *`,
      [
        floorplanId,
        objectId,
        body.label === undefined ? null : stringValue(body.label),
        body.x === undefined ? null : numberValue(body.x),
        body.y === undefined ? null : numberValue(body.y),
        body.width === undefined ? null : Math.max(20, numberValue(body.width)),
        body.height === undefined ? null : Math.max(20, numberValue(body.height)),
        body.rotation === undefined ? null : numberValue(body.rotation),
        body.style === undefined ? null : jsonValue(body.style),
        body.metadata === undefined ? null : jsonValue(body.metadata),
      ]
    );
    if (!result.rows.length) return reply.status(404).send({ error: "Floorplan object not found" });
    await recordRouteAudit(fastify, request, {
      action: "dcim.floorplan_object_updated",
      entityType: "DcimFloorplanObject",
      entityId: objectId,
      newValues: result.rows[0],
      metadata: { source: "api.it-visibility", surface: "dcim", floorplanId },
    });
    return { object: result.rows[0] };
  });

  fastify.post("/api/it-visibility/dcim/floorplans/:floorplanId/objects", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user;
    if (!(await canUseItVisibility(fastify, user, "write"))) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const { floorplanId } = request.params as { floorplanId: string };
    const body = request.body as {
      objectType?: string;
      label?: string;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      rotation?: number;
      layer?: string;
      style?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    };
    const objectType = stringValue(body.objectType, "marker");
    if (objectType === "rack") {
      return reply.status(400).send({ error: "Use the rack creation endpoint for rack objects" });
    }
    const label = stringValue(body.label, objectType.toUpperCase());
    const result = await fastify.pg.query(
      `INSERT INTO dcim_floorplan_objects (
         floorplan_id, object_type, object_id, label, x, y, width, height, rotation, layer, style, metadata
       )
       VALUES ($1, $2, gen_random_uuid(), $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        floorplanId,
        objectType,
        label,
        Math.max(0, numberValue(body.x, 80)),
        Math.max(0, numberValue(body.y, 80)),
        Math.max(20, numberValue(body.width, 140)),
        Math.max(20, numberValue(body.height, 90)),
        numberValue(body.rotation, 0),
        body.layer || objectType,
        jsonValue(body.style),
        jsonValue({ ...(body.metadata || {}), source: "dcim-floorplan", createdBy: user?.id || null }),
      ]
    );
    await recordRouteAudit(fastify, request, {
      action: "dcim.floorplan_object_created",
      entityType: "DcimFloorplanObject",
      entityId: result.rows[0].id,
      newValues: result.rows[0],
      metadata: { source: "api.it-visibility", surface: "dcim", floorplanId, objectType },
    });
    return { object: result.rows[0] };
  });

  fastify.delete("/api/it-visibility/dcim/floorplans/:floorplanId/objects/:objectId", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user;
    if (!(await canUseItVisibility(fastify, user, "write"))) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const { floorplanId, objectId } = request.params as { floorplanId: string; objectId: string };
    const result = await fastify.pg.query(
      `DELETE FROM dcim_floorplan_objects
       WHERE floorplan_id = $1 AND id = $2
       RETURNING *`,
      [floorplanId, objectId]
    );
    if (!result.rows.length) return reply.status(404).send({ error: "Floorplan object not found" });
    await recordRouteAudit(fastify, request, {
      action: "dcim.floorplan_object_deleted",
      entityType: "DcimFloorplanObject",
      entityId: objectId,
      oldValues: result.rows[0],
      metadata: { source: "api.it-visibility", surface: "dcim", floorplanId },
    });
    return { object: result.rows[0] };
  });

  fastify.post("/api/it-visibility/dcim/floorplans/:floorplanId/connections", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user;
    if (!(await canUseItVisibility(fastify, user, "write"))) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const { floorplanId } = request.params as { floorplanId: string };
    const body = request.body as {
      sourceObjectId?: string;
      targetObjectId?: string;
      connectionType?: string;
      label?: string;
      status?: string;
    };
    if (!body.sourceObjectId || !body.targetObjectId) {
      return reply.status(400).send({ error: "sourceObjectId and targetObjectId are required" });
    }
    if (body.sourceObjectId === body.targetObjectId) {
      return reply.status(400).send({ error: "sourceObjectId and targetObjectId must be different" });
    }
    const result = await fastify.pg.query(
      `INSERT INTO dcim_floorplan_connections (
         floorplan_id, source_object_id, target_object_id, connection_type, label, status, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (floorplan_id, source_object_id, target_object_id, connection_type) DO UPDATE SET
         label = EXCLUDED.label,
         status = EXCLUDED.status,
         updated_at = NOW()
       RETURNING *`,
      [
        floorplanId,
        body.sourceObjectId,
        body.targetObjectId,
        body.connectionType || "network",
        body.label || null,
        body.status || "operational",
        JSON.stringify({ source: "dcim-floorplan", createdBy: user?.id || null }),
      ]
    );
    await recordRouteAudit(fastify, request, {
      action: "dcim.floorplan_connection_created",
      entityType: "DcimFloorplanConnection",
      entityId: result.rows[0].id,
      newValues: result.rows[0],
      metadata: { source: "api.it-visibility", surface: "dcim", floorplanId, connectionType: body.connectionType || "network" },
    });
    return { connection: result.rows[0] };
  });

  fastify.patch("/api/it-visibility/dcim/floorplans/:floorplanId/connections/:connectionId", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user;
    if (!(await canUseItVisibility(fastify, user, "write"))) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const { floorplanId, connectionId } = request.params as { floorplanId: string; connectionId: string };
    const body = request.body as { connectionType?: string; label?: string | null; status?: string; metadata?: Record<string, unknown> };
    const result = await fastify.pg.query(
      `UPDATE dcim_floorplan_connections
       SET connection_type = COALESCE($3, connection_type),
           label = COALESCE($4, label),
           status = COALESCE($5, status),
           metadata = COALESCE($6, metadata),
           updated_at = NOW()
       WHERE floorplan_id = $1 AND id = $2
       RETURNING *`,
      [
        floorplanId,
        connectionId,
        body.connectionType === undefined ? null : stringValue(body.connectionType, "network"),
        body.label === undefined ? null : body.label,
        body.status === undefined ? null : stringValue(body.status, "operational"),
        body.metadata === undefined ? null : jsonValue(body.metadata),
      ]
    );
    if (!result.rows.length) return reply.status(404).send({ error: "Floorplan connection not found" });
    await recordRouteAudit(fastify, request, {
      action: "dcim.floorplan_connection_updated",
      entityType: "DcimFloorplanConnection",
      entityId: connectionId,
      newValues: result.rows[0],
      metadata: { source: "api.it-visibility", surface: "dcim", floorplanId },
    });
    return { connection: result.rows[0] };
  });

  fastify.delete("/api/it-visibility/dcim/floorplans/:floorplanId/connections/:connectionId", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user;
    if (!(await canUseItVisibility(fastify, user, "write"))) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const { floorplanId, connectionId } = request.params as { floorplanId: string; connectionId: string };
    const result = await fastify.pg.query(
      `DELETE FROM dcim_floorplan_connections
       WHERE floorplan_id = $1 AND id = $2
       RETURNING *`,
      [floorplanId, connectionId]
    );
    if (!result.rows.length) return reply.status(404).send({ error: "Floorplan connection not found" });
    await recordRouteAudit(fastify, request, {
      action: "dcim.floorplan_connection_deleted",
      entityType: "DcimFloorplanConnection",
      entityId: connectionId,
      oldValues: result.rows[0],
      metadata: { source: "api.it-visibility", surface: "dcim", floorplanId },
    });
    return { connection: result.rows[0] };
  });

  fastify.post("/api/it-visibility/dcim/racks", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user;
    if (!(await canUseItVisibility(fastify, user, "write"))) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const body = request.body as {
      floorplanId?: string;
      roomId?: string;
      name?: string;
      rowLabel?: string;
      positionLabel?: string;
      ruTotal?: number;
      powerCapacityKw?: number;
      weightCapacityKg?: number;
      redundancy?: string;
      status?: string;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    };
    if (!body.floorplanId || !body.name) {
      return reply.status(400).send({ error: "floorplanId and name are required" });
    }

    const client = await fastify.pg.connect();
    try {
      await client.query("BEGIN");
      const floorplanResult = await client.query(`SELECT * FROM dcim_floorplans WHERE id = $1`, [body.floorplanId]);
      const floorplan = floorplanResult.rows[0];
      if (!floorplan) {
        await client.query("ROLLBACK");
        return reply.status(404).send({ error: "Floorplan not found" });
      }
      const roomId = body.roomId || floorplan.room_id;
      const rackResult = await client.query(
        `INSERT INTO dcim_racks (
           room_id, name, row_label, position_label, ru_total, power_capacity_kw,
           weight_capacity_kg, redundancy, status, metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          roomId,
          stringValue(body.name),
          body.rowLabel || null,
          body.positionLabel || null,
          Math.max(1, Math.trunc(numberValue(body.ruTotal, 42))),
          Math.max(0, numberValue(body.powerCapacityKw, 18)),
          Math.max(0, numberValue(body.weightCapacityKg, 1200)),
          body.redundancy || "A/B",
          body.status || "operational",
          JSON.stringify({ source: "dcim-floorplan", createdBy: user?.id || null }),
        ]
      );
      const rack = rackResult.rows[0];
      const objectResult = await client.query(
        `INSERT INTO dcim_floorplan_objects (
           floorplan_id, object_type, object_id, label, x, y, width, height, layer, style
         )
         VALUES ($1, 'rack', $2, $3, $4, $5, $6, $7, 'rack', $8)
         RETURNING *`,
        [
          body.floorplanId,
          rack.id,
          rack.name,
          Math.max(0, numberValue(body.x, 80)),
          Math.max(0, numberValue(body.y, 80)),
          Math.max(40, numberValue(body.width, 120)),
          Math.max(40, numberValue(body.height, 180)),
          JSON.stringify({ fill: "#047857" }),
        ]
      );
      await client.query("COMMIT");
      await recordRouteAudit(fastify, request, {
        action: "dcim.rack_created",
        entityType: "DcimRack",
        entityId: rack.id,
        newValues: { rack, object: objectResult.rows[0] },
        metadata: { source: "api.it-visibility", surface: "dcim", floorplanId: body.floorplanId },
      });
      return { rack, object: objectResult.rows[0] };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  fastify.patch("/api/it-visibility/dcim/racks/:rackId", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user;
    if (!(await canUseItVisibility(fastify, user, "write"))) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const { rackId } = request.params as { rackId: string };
    const body = request.body as {
      name?: string;
      rowLabel?: string | null;
      positionLabel?: string | null;
      ruTotal?: number;
      powerCapacityKw?: number;
      weightCapacityKg?: number;
      redundancy?: string;
      status?: string;
      riskScore?: number;
    };
    const result = await fastify.pg.query(
      `UPDATE dcim_racks
       SET name = COALESCE($2, name),
           row_label = COALESCE($3, row_label),
           position_label = COALESCE($4, position_label),
           ru_total = COALESCE($5, ru_total),
           power_capacity_kw = COALESCE($6, power_capacity_kw),
           weight_capacity_kg = COALESCE($7, weight_capacity_kg),
           redundancy = COALESCE($8, redundancy),
           status = COALESCE($9, status),
           risk_score = COALESCE($10, risk_score),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        rackId,
        body.name === undefined ? null : stringValue(body.name),
        body.rowLabel === undefined ? null : body.rowLabel,
        body.positionLabel === undefined ? null : body.positionLabel,
        body.ruTotal === undefined ? null : Math.max(1, Math.trunc(numberValue(body.ruTotal, 42))),
        body.powerCapacityKw === undefined ? null : Math.max(0, numberValue(body.powerCapacityKw)),
        body.weightCapacityKg === undefined ? null : Math.max(0, numberValue(body.weightCapacityKg)),
        body.redundancy === undefined ? null : body.redundancy,
        body.status === undefined ? null : body.status,
        body.riskScore === undefined ? null : Math.max(0, Math.min(100, Math.trunc(numberValue(body.riskScore)))),
      ]
    );
    if (!result.rows.length) return reply.status(404).send({ error: "Rack not found" });
    if (body.name !== undefined) {
      await fastify.pg.query(
        `UPDATE dcim_floorplan_objects
         SET label = $2,
             updated_at = NOW()
         WHERE object_type = 'rack' AND object_id = $1`,
        [rackId, stringValue(body.name)]
      );
    }
    await recordRouteAudit(fastify, request, {
      action: "dcim.rack_updated",
      entityType: "DcimRack",
      entityId: rackId,
      newValues: result.rows[0],
      metadata: { source: "api.it-visibility", surface: "dcim" },
    });
    return { rack: result.rows[0] };
  });

  fastify.post("/api/it-visibility/dcim/placement/plan", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user;
    if (!(await canUseItVisibility(fastify, user, "read"))) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const body = request.body as {
      ruHeight?: number;
      powerKw?: number;
      weightKg?: number;
      redundancy?: string;
      siteId?: string;
    };
    const ruHeight = Math.max(1, Math.trunc(numberValue(body.ruHeight, 2)));
    const powerKw = Math.max(0, numberValue(body.powerKw, 0.8));
    const weightKg = Math.max(0, numberValue(body.weightKg, 35));
    const result = await fastify.pg.query(
      `SELECT r.*, room.name AS room_name, site.name AS site_name
       FROM dcim_racks r
       JOIN dcim_rooms room ON room.id = r.room_id
       JOIN dcim_sites site ON site.id = room.site_id
       WHERE ($1::uuid IS NULL OR site.id = $1::uuid)
       ORDER BY r.risk_score ASC, r.power_used_kw ASC, r.ru_used ASC`,
      [body.siteId || null]
    );
    const candidates = (result.rows as DcimRackRow[]).map((rack): PlacementCandidate => {
      const freeRu = numberValue(rack.ru_total) - numberValue(rack.ru_used);
      const powerAvailable = numberValue(rack.power_capacity_kw) - numberValue(rack.power_used_kw);
      const weightAvailable = numberValue(rack.weight_capacity_kg) - numberValue(rack.weight_used_kg);
      const violations = [
        freeRu < ruHeight ? `Needs ${ruHeight} RU, only ${freeRu} available` : null,
        powerAvailable < powerKw ? `Needs ${powerKw} kW, only ${powerAvailable.toFixed(2)} kW available` : null,
        weightAvailable < weightKg ? `Needs ${weightKg} kg, only ${weightAvailable.toFixed(1)} kg available` : null,
        body.redundancy && rack.redundancy !== body.redundancy ? `Requested ${body.redundancy} redundancy, rack is ${rack.redundancy}` : null,
      ].filter((violation): violation is string => Boolean(violation));
      const score = Math.max(0, 100 - numberValue(rack.risk_score) - utilization(numberValue(rack.power_used_kw) + powerKw, numberValue(rack.power_capacity_kw)));
      return {
        rack,
        score,
        viable: violations.length === 0,
        freeRu,
        powerAvailable,
        weightAvailable,
        violations,
      };
    }).sort((a, b) => Number(b.viable) - Number(a.viable) || b.score - a.score);

    return {
      request: { ruHeight, powerKw, weightKg, redundancy: body.redundancy || null },
      recommendation: candidates.find((candidate) => candidate.viable) || candidates[0] || null,
      candidates,
    };
  });

  fastify.post("/api/it-visibility/dcim/rack-assignments", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user;
    if (!(await canUseItVisibility(fastify, user, "operate"))) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const body = request.body as {
      rackId?: string;
      name?: string;
      ciId?: string;
      assetId?: string;
      assetType?: string;
      vendor?: string;
      model?: string;
      ruStart?: number;
      ruHeight?: number;
      powerDrawKw?: number;
      networkPorts?: number;
    };
    if (!body.rackId || !body.name) {
      return reply.status(400).send({ error: "rackId and name are required" });
    }
    const ruHeight = Math.max(1, Math.trunc(numberValue(body.ruHeight, 1)));
    const powerDrawKw = Math.max(0, numberValue(body.powerDrawKw, 0));
    const client = await fastify.pg.connect();
    try {
      await client.query("BEGIN");
      const rackResult = await client.query(`SELECT * FROM dcim_racks WHERE id = $1 FOR UPDATE`, [body.rackId]);
      const rack = rackResult.rows[0];
      if (!rack) {
        await client.query("ROLLBACK");
        return reply.status(404).send({ error: "Rack not found" });
      }
      const freeRu = numberValue(rack.ru_total) - numberValue(rack.ru_used);
      const powerAvailable = numberValue(rack.power_capacity_kw) - numberValue(rack.power_used_kw);
      if (freeRu < ruHeight) {
        await client.query("ROLLBACK");
        return reply.status(409).send({ error: `Rack has only ${freeRu} RU available` });
      }
      if (powerAvailable < powerDrawKw) {
        await client.query("ROLLBACK");
        return reply.status(409).send({ error: `Rack has only ${powerAvailable.toFixed(2)} kW available` });
      }
      const assetResult = await client.query(
        `INSERT INTO dcim_assets (rack_id, ci_id, asset_id, name, asset_type, vendor, model, ru_start, ru_height, power_draw_kw, network_ports, status, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'planned', $12)
         RETURNING *`,
        [
          body.rackId,
          body.ciId || null,
          body.assetId || null,
          body.name,
          body.assetType || "server",
          body.vendor || null,
          body.model || null,
          body.ruStart || null,
          ruHeight,
          powerDrawKw,
          Math.max(0, Math.trunc(numberValue(body.networkPorts, 0))),
          JSON.stringify({ source: "dcim-rack-assignment", requestedBy: user?.id || null }),
        ]
      );
      await client.query(
        `UPDATE dcim_racks
         SET ru_used = LEAST(ru_total, ru_used + $2),
             power_used_kw = power_used_kw + $3,
             updated_at = NOW()
         WHERE id = $1`,
        [body.rackId, ruHeight, powerDrawKw]
      );
      await client.query("COMMIT");
      await recordRouteAudit(fastify, request, {
        action: "dcim.rack_assignment_created",
        entityType: "DcimAsset",
        entityId: assetResult.rows[0].id,
        newValues: assetResult.rows[0],
        metadata: { source: "api.it-visibility", surface: "dcim", rackId: body.rackId },
      });
      return { asset: assetResult.rows[0] };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  fastify.post("/api/it-visibility/dcim/events", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user;
    if (!(await canUseItVisibility(fastify, user, "operate"))) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const body = request.body as {
      source?: string;
      externalRef?: string;
      severity?: string;
      eventType?: string;
      title?: string;
      description?: string;
      siteId?: string;
      roomId?: string;
      rackId?: string;
      assetId?: string;
    };
    if (!body.source || !body.externalRef || !body.eventType || !body.title) {
      return reply.status(400).send({ error: "source, externalRef, eventType, and title are required" });
    }
    const result = await fastify.pg.query(
      `INSERT INTO dcim_events (source, external_ref, severity, event_type, title, description, site_id, room_id, rack_id, asset_id, ai_summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (source, external_ref) DO UPDATE SET
         severity = EXCLUDED.severity,
         event_type = EXCLUDED.event_type,
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         status = 'open',
         last_seen_at = NOW(),
         updated_at = NOW()
       RETURNING *`,
      [
        body.source,
        body.externalRef,
        body.severity || "info",
        body.eventType,
        body.title,
        body.description || null,
        body.siteId || null,
        body.roomId || null,
        body.rackId || null,
        body.assetId || null,
        "Event accepted. AI correlation hooks will attach topology and impact context as the package matures.",
      ]
    );
    await recordRouteAudit(fastify, request, {
      action: "dcim.event_recorded",
      entityType: "DcimEvent",
      entityId: result.rows[0].id,
      newValues: result.rows[0],
      metadata: { source: "api.it-visibility", surface: "dcim", eventType: body.eventType, severity: body.severity || "info" },
    });
    return { event: result.rows[0] };
  });
}
