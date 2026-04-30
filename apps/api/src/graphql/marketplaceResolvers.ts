import { GraphQLError } from "graphql";
import { checkPermission } from "./resolverSupport";

function mapMarketplaceApp(row: any) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    url: row.url,
    icon: row.icon,
    version: row.version,
    permissions: row.permissions,
    reactVersion: row.react_version ?? row.reactVersion,
    author: row.author,
    authorUrl: row.author_url ?? row.authorUrl,
    status: row.status,
    createdAt: row.created_at ?? row.createdAt,
  };
}

export const marketplaceQueries = {
  async marketplaceApps(_parent: any, args: { status?: string }, context: any) {
    const status = args.status || "approved";
    const result = await context.pg.query(
      "SELECT id, name, description, url, icon, version, permissions, react_version, author, author_url, status, created_at FROM marketplace_apps WHERE status = $1 ORDER BY name",
      [status]
    );
    return result.rows.map(mapMarketplaceApp);
  },

  async marketplaceApp(_parent: any, args: { id: string }, context: any) {
    const result = await context.pg.query(
      "SELECT id, name, description, url, icon, version, permissions, react_version, author, author_url, status, created_at FROM marketplace_apps WHERE id = $1",
      [args.id]
    );
    if (!result.rows.length) return null;
    return mapMarketplaceApp(result.rows[0]);
  },
};

export const marketplaceMutations = {
  async submitMarketplaceApp(_parent: any, args: { id: string; name: string; description?: string; url: string; icon?: string; version?: string; permissions?: string[]; reactVersion?: string; author: string; authorUrl?: string }, context: any) {
    await checkPermission(context, "app", "install");
    const result = await context.pg.query(
      `INSERT INTO marketplace_apps (id, name, description, url, icon, version, permissions, react_version, author, author_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         url = EXCLUDED.url,
         icon = EXCLUDED.icon,
         version = EXCLUDED.version,
         permissions = EXCLUDED.permissions,
         react_version = EXCLUDED.react_version,
         author = EXCLUDED.author,
         author_url = EXCLUDED.author_url,
         status = 'pending'
       RETURNING id, name, description, url, icon, version, permissions, react_version, author, author_url, status, created_at`,
      [args.id, args.name, args.description || null, args.url, args.icon || "Compass", args.version || "1.0.0", JSON.stringify(args.permissions || []), args.reactVersion || "^18.0.0", args.author, args.authorUrl || null]
    );
    return mapMarketplaceApp(result.rows[0]);
  },

  async approveMarketplaceApp(_parent: any, args: { id: string }, context: any) {
    await checkPermission(context, "app", "install");
    const result = await context.pg.query(
      `UPDATE marketplace_apps SET status = 'approved', reviewed_by = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, description, url, icon, version, permissions, react_version, author, author_url, status, created_at`,
      [context.user.id, args.id]
    );
    if (!result.rows.length) {
      throw new GraphQLError("App not found", { extensions: { code: "NOT_FOUND" } });
    }
    return mapMarketplaceApp(result.rows[0]);
  },

  async rejectMarketplaceApp(_parent: any, args: { id: string }, context: any) {
    await checkPermission(context, "app", "install");
    const result = await context.pg.query(
      `UPDATE marketplace_apps SET status = 'rejected', reviewed_by = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, description, url, icon, version, permissions, react_version, author, author_url, status, created_at`,
      [context.user.id, args.id]
    );
    if (!result.rows.length) {
      throw new GraphQLError("App not found", { extensions: { code: "NOT_FOUND" } });
    }
    return mapMarketplaceApp(result.rows[0]);
  },
};
