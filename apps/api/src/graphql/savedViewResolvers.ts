import { GraphQLError } from "graphql";
import { checkPermission } from "./resolverSupport";

type QueryablePg = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
};

type SavedViewContext = {
  pg: QueryablePg;
  user?: { id?: string; role?: string } | null;
};

type SavedViewRow = {
  id: string;
  name: string;
  root_id?: string | null;
  class_filter?: unknown[] | null;
  environment_filter?: unknown[] | null;
  relationship_filter?: unknown[] | null;
  camera_x?: number | null;
  camera_y?: number | null;
  camera_zoom?: number | null;
  created_at?: string | Date;
  updated_at?: string | Date;
};

type SaveViewArgs = {
  id?: string;
  name?: string;
  rootId?: string | null;
  classFilter?: string[];
  environmentFilter?: string[];
  relationshipFilter?: string[];
  cameraX?: number | null;
  cameraY?: number | null;
  cameraZoom?: number | null;
};

function mapSavedView(row: SavedViewRow) {
  return {
    id: row.id,
    name: row.name,
    rootId: row.root_id,
    classFilter: row.class_filter || [],
    environmentFilter: row.environment_filter || [],
    relationshipFilter: row.relationship_filter || [],
    cameraX: row.camera_x,
    cameraY: row.camera_y,
    cameraZoom: row.camera_zoom,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const savedViewQueries = {
  async savedViews(_parent: unknown, _args: Record<string, never>, context: SavedViewContext) {
    if (!context.user?.id) return [];
    try {
      const result = await context.pg.query(
        `SELECT id, name, root_id, class_filter, environment_filter, relationship_filter, camera_x, camera_y, camera_zoom, created_at, updated_at
         FROM saved_views WHERE user_id = $1 ORDER BY updated_at DESC`,
        [context.user.id]
      );
      return (result.rows as SavedViewRow[]).map(mapSavedView);
    } catch (err) {
      console.error("savedViews error:", err);
      throw err;
    }
  },

  async savedView(_parent: unknown, args: { id: string }, context: SavedViewContext) {
    if (!context.user?.id) return null;
    try {
      const result = await context.pg.query(
        `SELECT id, name, root_id, class_filter, environment_filter, relationship_filter, camera_x, camera_y, camera_zoom, created_at, updated_at
         FROM saved_views WHERE id = $1 AND user_id = $2`,
        [args.id, context.user.id]
      );
      if (!result.rows.length) return null;
      return mapSavedView(result.rows[0] as SavedViewRow);
    } catch (err) {
      console.error("savedView error:", err);
      throw err;
    }
  },
};

export const savedViewMutations = {
  async createSavedView(_parent: unknown, args: SaveViewArgs, context: SavedViewContext) {
    await checkPermission(context, "cmdb", "read");
    if (!context.user?.id) {
      throw new GraphQLError("Unauthorized", { extensions: { code: "UNAUTHORIZED" } });
    }
    try {
      const result = await context.pg.query(
        `INSERT INTO saved_views (user_id, name, root_id, class_filter, environment_filter, relationship_filter, camera_x, camera_y, camera_zoom)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, name, root_id, class_filter, environment_filter, relationship_filter, camera_x, camera_y, camera_zoom, created_at, updated_at`,
        [
          context.user.id, args.name, args.rootId,
          JSON.stringify(args.classFilter || []),
          JSON.stringify(args.environmentFilter || []),
          JSON.stringify(args.relationshipFilter || []),
          args.cameraX ?? null, args.cameraY ?? null, args.cameraZoom ?? null,
        ]
      );
      return mapSavedView(result.rows[0] as SavedViewRow);
    } catch (err) {
      console.error("createSavedView error:", err);
      throw err;
    }
  },

  async updateSavedView(_parent: unknown, args: SaveViewArgs & { id: string }, context: SavedViewContext) {
    await checkPermission(context, "cmdb", "read");
    if (!context.user?.id) {
      throw new GraphQLError("Unauthorized", { extensions: { code: "UNAUTHORIZED" } });
    }
    try {
      const updates: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (args.name !== undefined) { updates.push(`name = $${idx++}`); values.push(args.name); }
      if (args.rootId !== undefined) { updates.push(`root_id = $${idx++}`); values.push(args.rootId); }
      if (args.classFilter !== undefined) { updates.push(`class_filter = $${idx++}`); values.push(JSON.stringify(args.classFilter)); }
      if (args.environmentFilter !== undefined) { updates.push(`environment_filter = $${idx++}`); values.push(JSON.stringify(args.environmentFilter)); }
      if (args.relationshipFilter !== undefined) { updates.push(`relationship_filter = $${idx++}`); values.push(JSON.stringify(args.relationshipFilter)); }
      if (args.cameraX !== undefined) { updates.push(`camera_x = $${idx++}`); values.push(args.cameraX); }
      if (args.cameraY !== undefined) { updates.push(`camera_y = $${idx++}`); values.push(args.cameraY); }
      if (args.cameraZoom !== undefined) { updates.push(`camera_zoom = $${idx++}`); values.push(args.cameraZoom); }
      if (updates.length === 0) {
        throw new GraphQLError("No fields to update", { extensions: { code: "BAD_USER_INPUT" } });
      }
      updates.push("updated_at = NOW()");
      values.push(args.id, context.user.id);
      const result = await context.pg.query(
        `UPDATE saved_views SET ${updates.join(", ")} WHERE id = $${idx++} AND user_id = $${idx++}
         RETURNING id, name, root_id, class_filter, environment_filter, relationship_filter, camera_x, camera_y, camera_zoom, created_at, updated_at`,
        values
      );
      if (!result.rows.length) {
        throw new GraphQLError("View not found", { extensions: { code: "NOT_FOUND" } });
      }
      return mapSavedView(result.rows[0] as SavedViewRow);
    } catch (err) {
      console.error("updateSavedView error:", err);
      throw err;
    }
  },

  async deleteSavedView(_parent: unknown, args: { id: string }, context: SavedViewContext) {
    await checkPermission(context, "cmdb", "read");
    if (!context.user?.id) {
      throw new GraphQLError("Unauthorized", { extensions: { code: "UNAUTHORIZED" } });
    }
    const result = await context.pg.query(
      "DELETE FROM saved_views WHERE id = $1 AND user_id = $2 RETURNING id",
      [args.id, context.user.id]
    );
    return result.rows.length > 0;
  },
};
