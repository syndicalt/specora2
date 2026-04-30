import { GraphQLError } from "graphql";
import { checkPermission } from "./resolverSupport";

type QueryablePg = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
};

type DiscoveryResolverContext = {
  pg: QueryablePg;
  user?: unknown;
};

type DiscoverySourceConfig = Record<string, unknown> & {
  credentialRef?: string;
};

type DiscoverySourceRow = {
  id: string;
  name: string;
  type: string;
  config?: unknown;
  credential_ref?: string | null;
  last_tested_at?: string | Date | null;
  last_status?: string | null;
  last_error?: string | null;
  created_at?: string | Date;
  updated_at?: string | Date;
};

type DiscoveryJobRow = {
  id: string;
  source_id?: string | null;
  file_path?: string | null;
  status: string;
  stats?: unknown;
  created_at?: string | Date;
  updated_at?: string | Date;
};

type DiscoverySourceInput = {
  name: string;
  type: string;
  config?: DiscoverySourceConfig;
};

function credentialRefFromConfig(config?: DiscoverySourceConfig) {
  return typeof config?.credentialRef === "string" && config.credentialRef.trim()
    ? config.credentialRef.trim()
    : null;
}

function mapDiscoverySource(row: DiscoverySourceRow) {
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

function mapDiscoveryJob(row: DiscoveryJobRow) {
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
  async discoverySources(_parent: unknown, _args: Record<string, never>, context: DiscoveryResolverContext) {
    const result = await context.pg.query("SELECT id, name, type, config, credential_ref, last_tested_at, last_status, last_error, created_at, updated_at FROM discovery_sources ORDER BY created_at DESC");
    return (result.rows as DiscoverySourceRow[]).map(mapDiscoverySource);
  },

  async discoveryJobs(_parent: unknown, _args: Record<string, never>, context: DiscoveryResolverContext) {
    const result = await context.pg.query("SELECT id, source_id, file_path, status, stats, created_at, updated_at FROM discovery_jobs ORDER BY created_at DESC");
    return (result.rows as DiscoveryJobRow[]).map(mapDiscoveryJob);
  },

  async discoveryJob(_parent: unknown, args: { id: string }, context: DiscoveryResolverContext) {
    const result = await context.pg.query(
      "SELECT id, source_id, file_path, status, stats, created_at, updated_at FROM discovery_jobs WHERE id = $1",
      [args.id]
    );
    if (!result.rows.length) return null;
    return mapDiscoveryJob(result.rows[0] as DiscoveryJobRow);
  },
};

export const discoveryMutations = {
  async createDiscoverySource(_parent: unknown, args: DiscoverySourceInput, context: DiscoveryResolverContext) {
    await checkPermission(context, "discovery", "write");
    const result = await context.pg.query(
      "INSERT INTO discovery_sources (name, type, config, credential_ref) VALUES ($1, $2, $3, $4) RETURNING id, name, type, config, credential_ref, last_tested_at, last_status, last_error, created_at, updated_at",
      [args.name, args.type, JSON.stringify(args.config || {}), credentialRefFromConfig(args.config)]
    );
    return mapDiscoverySource(result.rows[0] as DiscoverySourceRow);
  },

  async updateDiscoverySource(_parent: unknown, args: { id: string } & DiscoverySourceInput, context: DiscoveryResolverContext) {
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
      [args.id, args.name, args.type, JSON.stringify(args.config || {}), credentialRefFromConfig(args.config)]
    );
    if (!result.rows.length) {
      throw new GraphQLError("Discovery source not found", { extensions: { code: "NOT_FOUND" } });
    }
    return mapDiscoverySource(result.rows[0] as DiscoverySourceRow);
  },

  async deleteDiscoverySource(_parent: unknown, args: { id: string }, context: DiscoveryResolverContext) {
    await checkPermission(context, "discovery", "write");
    await context.pg.query("DELETE FROM discovery_sources WHERE id = $1", [args.id]);
    return true;
  },
};
