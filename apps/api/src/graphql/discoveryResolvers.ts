import { GraphQLError } from "graphql";
import { checkPermission } from "./resolverSupport";

function mapDiscoverySource(row: any) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    config: row.config,
    credentialRef: row.credential_ref,
    lastTestedAt: row.last_tested_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDiscoveryJob(row: any) {
  return {
    id: row.id,
    sourceId: row.source_id,
    filePath: row.file_path,
    status: row.status,
    stats: row.stats,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const discoveryQueries = {
  async discoverySources(_parent: any, _args: any, context: any) {
    const result = await context.pg.query("SELECT id, name, type, config, credential_ref, last_tested_at, last_status, last_error, created_at, updated_at FROM discovery_sources ORDER BY created_at DESC");
    return result.rows.map(mapDiscoverySource);
  },

  async discoveryJobs(_parent: any, _args: any, context: any) {
    const result = await context.pg.query("SELECT id, source_id, file_path, status, stats, created_at, updated_at FROM discovery_jobs ORDER BY created_at DESC");
    return result.rows.map(mapDiscoveryJob);
  },

  async discoveryJob(_parent: any, args: { id: string }, context: any) {
    const result = await context.pg.query(
      "SELECT id, source_id, file_path, status, stats, created_at, updated_at FROM discovery_jobs WHERE id = $1",
      [args.id]
    );
    if (!result.rows.length) return null;
    return mapDiscoveryJob(result.rows[0]);
  },
};

export const discoveryMutations = {
  async createDiscoverySource(_parent: any, args: { name: string; type: string; config?: any }, context: any) {
    await checkPermission(context, "discovery", "write");
    const result = await context.pg.query(
      "INSERT INTO discovery_sources (name, type, config, credential_ref) VALUES ($1, $2, $3, $4) RETURNING id, name, type, config, credential_ref, last_tested_at, last_status, last_error, created_at, updated_at",
      [args.name, args.type, JSON.stringify(args.config || {}), args.config?.credentialRef || null]
    );
    return mapDiscoverySource(result.rows[0]);
  },

  async updateDiscoverySource(_parent: any, args: { id: string; name: string; type: string; config?: any }, context: any) {
    await checkPermission(context, "discovery", "write");
    const result = await context.pg.query(
      `UPDATE discovery_sources
       SET name = $2,
           type = $3,
           config = $4,
           credential_ref = $5,
           last_status = NULL,
           last_error = NULL,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, type, config, credential_ref, last_tested_at, last_status, last_error, created_at, updated_at`,
      [args.id, args.name, args.type, JSON.stringify(args.config || {}), args.config?.credentialRef || null]
    );
    if (!result.rows.length) {
      throw new GraphQLError("Discovery source not found", { extensions: { code: "NOT_FOUND" } });
    }
    return mapDiscoverySource(result.rows[0]);
  },

  async deleteDiscoverySource(_parent: any, args: { id: string }, context: any) {
    await checkPermission(context, "discovery", "write");
    await context.pg.query("DELETE FROM discovery_sources WHERE id = $1", [args.id]);
    return true;
  },
};
