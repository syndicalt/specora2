import { GraphQLError } from "graphql";
import { hasPermission } from "../services/rbac";

type QueryablePg = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
};

type EnvironmentChoiceRow = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  sort_order: number;
  is_production_like: boolean;
  created_at?: string | Date;
  updated_at?: string | Date;
};

type CiClassRow = {
  id: string;
  name: string;
  display_name?: string | null;
  parent_class?: string | null;
  is_system?: boolean;
  created_by_app_id?: string | null;
  created_at?: string | Date;
  updated_at?: string | Date;
  display_field?: string | null;
  secondary_display_fields?: string[] | null;
};

export type CiClassAttributeRow = {
  id: string;
  name: string;
  display_name?: string | null;
  attr_type?: string | null;
  is_mandatory?: boolean;
  is_health_required?: boolean;
  is_key_attribute?: boolean;
  default_value?: unknown;
  validation_regex?: string | null;
  enum_values?: string[] | null;
  depth?: number;
};

export type CiClassDefinition = CiClassRow & {
  displayName?: string | null;
  parentClass?: string | null;
  isSystem?: boolean;
  createdByAppId?: string | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  displayField?: string | null;
  secondaryDisplayFields: string[];
  attributes: CiClassAttributeRow[];
  inheritedAttributes: CiClassAttributeRow[];
  allAttributes: CiClassAttributeRow[];
};

export function boundedHopCount(value: number | undefined, fallback: number) {
  const hops = value ?? fallback;
  if (!Number.isInteger(hops) || hops < 1 || hops > 10) {
    throw new GraphQLError("maxHops must be an integer between 1 and 10", { extensions: { code: "BAD_USER_INPUT" } });
  }
  return hops;
}

export function mapEnvironmentChoice(row: EnvironmentChoiceRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    active: row.active,
    sortOrder: row.sort_order,
    isProductionLike: row.is_production_like,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type UserRow = {
  id: string;
  name?: string | null;
  email?: string | null;
  preferences?: Record<string, unknown> | null;
  role?: string | null;
  password_hash?: string | null;
  password_change_required?: boolean | null;
  oauth_accounts?: number | string | null;
};

export function mapUserRow(row: UserRow) {
  const passwordHash = String(row.password_hash || "");
  const federatedOnly = passwordHash.startsWith("oauth:") || passwordHash.startsWith("sso:");
  const oauthAccounts = Number(row.oauth_accounts || 0);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    preferences: row.preferences || {},
    role: row.role,
    authMethod: federatedOnly || oauthAccounts > 0 ? "sso" : "password",
    canChangePassword: Boolean(passwordHash) && !federatedOnly,
    passwordChangeRequired: Boolean(row.password_change_required) && Boolean(passwordHash) && !federatedOnly,
  };
}

export async function getClassDefinition(pg: QueryablePg, className: string): Promise<CiClassDefinition | null> {
  const classResult = await pg.query("SELECT * FROM ci_classes WHERE name = $1", [className]);
  if (!classResult.rows.length) return null;
  const cls = classResult.rows[0] as CiClassRow;

  const attrsResult = await pg.query(
    `WITH RECURSIVE class_tree AS (
       SELECT id, name, parent_class, 0 AS depth
       FROM ci_classes WHERE name = $1
       UNION ALL
       SELECT c.id, c.name, c.parent_class, ct.depth + 1
       FROM ci_classes c JOIN class_tree ct ON c.name = ct.parent_class
     )
     SELECT a.*, ct.depth
     FROM class_tree ct
     JOIN ci_class_attributes a ON a.class_id = ct.id
     ORDER BY ct.depth DESC, a.sort_order, a.name`,
    [className]
  );

  const attrRows = attrsResult.rows as CiClassAttributeRow[];
  const attrMap = new Map<string, CiClassAttributeRow>();
  for (const row of attrRows) {
    attrMap.set(row.name, row);
  }
  const attributes = Array.from(attrMap.values());

  const ownAttrs = attributes.filter((attr) => {
    const own = attrRows.find((row) => row.name === attr.name && row.depth === 0);
    return !!own;
  });
  const inheritedAttrs = attributes.filter((attr) => {
    const own = attrRows.find((row) => row.name === attr.name && row.depth === 0);
    return !own;
  });

  return {
    ...cls,
    displayName: cls.display_name,
    parentClass: cls.parent_class,
    isSystem: cls.is_system,
    createdByAppId: cls.created_by_app_id,
    createdAt: cls.created_at,
    updatedAt: cls.updated_at,
    displayField: cls.display_field,
    secondaryDisplayFields: cls.secondary_display_fields || [],
    attributes: ownAttrs,
    inheritedAttributes: inheritedAttrs,
    allAttributes: attributes,
  };
}

export async function validateCIAgainstClass(pg: QueryablePg, className: string, ciData: Record<string, unknown>, mode: "create" | "update") {
  const def = await getClassDefinition(pg, className);
  if (!def) {
    throw new GraphQLError(`Unknown CI class: ${className}`, { extensions: { code: "BAD_USER_INPUT" } });
  }

  const attrs = (ciData.attributes || {}) as Record<string, unknown>;
  const allData = { ...ciData, ...attrs };

  for (const attr of def.allAttributes) {
    const val = allData[attr.name];

    if (mode === "create" && attr.is_mandatory && (val === undefined || val === null || val === "")) {
      throw new GraphQLError(
        `Missing mandatory attribute '${attr.display_name || attr.name}' for class ${className}`,
        { extensions: { code: "BAD_USER_INPUT" } }
      );
    }

    if (val !== undefined && val !== null && val !== "") {
      if (attr.attr_type === "number" && typeof val !== "number") {
        throw new GraphQLError(`Attribute '${attr.name}' must be a number`, { extensions: { code: "BAD_USER_INPUT" } });
      }
      if (attr.attr_type === "boolean" && typeof val !== "boolean") {
        throw new GraphQLError(`Attribute '${attr.name}' must be a boolean`, { extensions: { code: "BAD_USER_INPUT" } });
      }
      if (attr.attr_type === "enum" && attr.enum_values && !attr.enum_values.includes(String(val))) {
        throw new GraphQLError(
          `Attribute '${attr.name}' must be one of: ${attr.enum_values.join(", ")}`,
          { extensions: { code: "BAD_USER_INPUT" } }
        );
      }
      if (attr.attr_type === "date" && isNaN(Date.parse(String(val)))) {
        throw new GraphQLError(`Attribute '${attr.name}' must be a valid date`, { extensions: { code: "BAD_USER_INPUT" } });
      }
      if (attr.validation_regex && !new RegExp(attr.validation_regex).test(String(val))) {
        throw new GraphQLError(
          `Attribute '${attr.name}' failed validation: ${attr.validation_regex}`,
          { extensions: { code: "BAD_USER_INPUT" } }
        );
      }
    }
  }

  const defaults: Record<string, unknown> = {};
  for (const attr of def.allAttributes) {
    if (allData[attr.name] === undefined && attr.default_value !== null && attr.default_value !== undefined) {
      defaults[attr.name] = attr.default_value;
    }
  }

  return { def, defaults };
}

export async function checkPermission(context: { pg: QueryablePg; user?: unknown }, resource: string, action: string) {
  const user = context.user as { role?: string } | null;
  if (!user?.role) {
    throw new GraphQLError("Forbidden: not authenticated", { extensions: { code: "FORBIDDEN" } });
  }
  const allowed = await hasPermission(context.pg, { role: user.role, resource, action });
  if (!allowed) {
    throw new GraphQLError(`Forbidden: ${user.role} cannot ${action} ${resource}`, { extensions: { code: "FORBIDDEN" } });
  }
}
