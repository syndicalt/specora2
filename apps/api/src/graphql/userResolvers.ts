import { GraphQLError } from "graphql";
import bcrypt from "bcryptjs";
import { getPasswordPolicy, passwordPolicyMessage, validatePasswordAgainstPolicy } from "../services/passwordPolicy";
import { mapUserRow } from "./resolverSupport";

async function findUserByContext(pg: any, user: any) {
  let result = await pg.query(
    `SELECT u.id, u.name, u.email, u.preferences, u.role, u.password_hash, u.password_change_required,
            COUNT(oa.id)::int AS oauth_accounts
     FROM users u
     LEFT JOIN oauth_accounts oa ON oa.user_id = u.id
     WHERE u.id = $1
     GROUP BY u.id`,
    [user.id]
  );
  if (!result.rows.length && user?.email) {
    result = await pg.query(
      `SELECT u.id, u.name, u.email, u.preferences, u.role, u.password_hash, u.password_change_required,
              COUNT(oa.id)::int AS oauth_accounts
       FROM users u
       LEFT JOIN oauth_accounts oa ON oa.user_id = u.id
       WHERE u.email = $1
       GROUP BY u.id`,
      [user.email]
    );
  }
  return result.rows[0] || null;
}

export const userQueries = {
  async me(_parent: any, _args: any, context: any) {
    if (!context.user?.id) return null;
    const user = await findUserByContext(context.pg, context.user);
    return user ? mapUserRow(user) : null;
  },

  async passwordPolicy(_parent: any, _args: any, context: any) {
    return getPasswordPolicy(context.pg);
  },
};

export const userMutations = {
  async updatePreferences(_parent: any, args: { preferences: any }, context: any) {
    if (!context.user?.id) {
      throw new GraphQLError("Unauthorized", { extensions: { code: "UNAUTHORIZED" } });
    }
    let result = await context.pg.query(
      "UPDATE users SET preferences = COALESCE(preferences, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE id = $2 RETURNING id, name, email, preferences",
      [JSON.stringify(args.preferences), context.user.id]
    );
    if (!result.rows.length && context.user?.email) {
      result = await context.pg.query(
        "UPDATE users SET preferences = COALESCE(preferences, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE email = $2 RETURNING id, name, email, preferences",
        [JSON.stringify(args.preferences), context.user.email]
      );
    }
    if (!result.rows.length) {
      throw new GraphQLError("User not found", { extensions: { code: "NOT_FOUND" } });
    }
    return result.rows[0];
  },

  async updateProfile(_parent: any, args: { name: string }, context: any) {
    if (!context.user?.id) {
      throw new GraphQLError("Unauthorized", { extensions: { code: "UNAUTHORIZED" } });
    }
    const name = String(args.name || "").trim();
    if (name.length < 2 || name.length > 120) {
      throw new GraphQLError("Display name must be between 2 and 120 characters", { extensions: { code: "BAD_USER_INPUT" } });
    }
    let result = await context.pg.query(
      `WITH updated AS (
         UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING *
       )
       SELECT u.id, u.name, u.email, u.preferences, u.role, u.password_hash, u.password_change_required,
              COUNT(oa.id)::int AS oauth_accounts
       FROM updated u
       LEFT JOIN oauth_accounts oa ON oa.user_id = u.id
       GROUP BY u.id, u.name, u.email, u.preferences, u.role, u.password_hash, u.password_change_required`,
      [name, context.user.id]
    );
    if (!result.rows.length && context.user?.email) {
      result = await context.pg.query(
        `WITH updated AS (
           UPDATE users SET name = $1, updated_at = NOW() WHERE email = $2 RETURNING *
         )
         SELECT u.id, u.name, u.email, u.preferences, u.role, u.password_hash, u.password_change_required,
                COUNT(oa.id)::int AS oauth_accounts
         FROM updated u
         LEFT JOIN oauth_accounts oa ON oa.user_id = u.id
         GROUP BY u.id, u.name, u.email, u.preferences, u.role, u.password_hash, u.password_change_required`,
        [name, context.user.email]
      );
    }
    if (!result.rows.length) {
      throw new GraphQLError("User not found", { extensions: { code: "NOT_FOUND" } });
    }
    return mapUserRow(result.rows[0]);
  },

  async changePassword(_parent: any, args: { currentPassword: string; newPassword: string }, context: any) {
    if (!context.user?.id) {
      throw new GraphQLError("Unauthorized", { extensions: { code: "UNAUTHORIZED" } });
    }
    const currentPassword = String(args.currentPassword || "");
    const newPassword = String(args.newPassword || "");
    const policy = await getPasswordPolicy(context.pg);
    const policyCheck = validatePasswordAgainstPolicy(newPassword, policy);
    if (!policyCheck.valid) {
      throw new GraphQLError(policyCheck.failures[0] || passwordPolicyMessage(policy), { extensions: { code: "BAD_USER_INPUT", failures: policyCheck.failures } });
    }
    if (newPassword === currentPassword) {
      throw new GraphQLError("New password must be different from the current password", { extensions: { code: "BAD_USER_INPUT" } });
    }

    const user = await findUserByContext(context.pg, context.user);
    if (!user) throw new GraphQLError("User not found", { extensions: { code: "NOT_FOUND" } });
    const currentHash = String(user.password_hash || "");
    if (!currentHash || currentHash.startsWith("oauth:") || currentHash.startsWith("sso:")) {
      throw new GraphQLError("Password changes are only available for local password accounts", { extensions: { code: "FORBIDDEN" } });
    }
    const valid = await bcrypt.compare(currentPassword, currentHash);
    if (!valid) {
      throw new GraphQLError("Current password is incorrect", { extensions: { code: "BAD_USER_INPUT" } });
    }
    const nextHash = await bcrypt.hash(newPassword, 10);
    const result = await context.pg.query(
      `UPDATE users
       SET password_hash = $1,
           password_change_required = FALSE,
           password_changed_at = NOW(),
           updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, email, preferences, role, password_hash, password_change_required, 0::int AS oauth_accounts`,
      [nextHash, user.id]
    );
    return mapUserRow(result.rows[0]);
  },
};
