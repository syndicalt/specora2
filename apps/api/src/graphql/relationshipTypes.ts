import { GraphQLError } from "graphql";

export const FALLBACK_RELATIONSHIP_TYPES = [
  "PART_OF",
  "DEPENDS_ON",
  "HOSTED_ON",
  "MANAGED_BY",
  "OWNED_BY",
  "LOCATED_AT",
] as const;

export const RELATIONSHIP_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{1,79}$/;

export type RelationshipTypeRow = {
  id: string;
  name: string;
  display_name: string;
  description?: string | null;
  color: string;
  active: boolean;
  directed: boolean;
  is_system: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export function mapRelationshipType(row: RelationshipTypeRow) {
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    description: row.description,
    color: row.color,
    active: row.active,
    directed: row.directed,
    isSystem: row.is_system,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function activeRelationshipTypeNames(pg: any): Promise<string[]> {
  try {
    const result = await pg.query("SELECT name FROM relationship_types WHERE active = true ORDER BY sort_order, display_name");
    const names = result.rows.map((row: any) => String(row.name)).filter((name: string) => RELATIONSHIP_TYPE_PATTERN.test(name));
    return names.length > 0 ? names : [...FALLBACK_RELATIONSHIP_TYPES];
  } catch {
    return [...FALLBACK_RELATIONSHIP_TYPES];
  }
}

export async function relationshipPattern(pg: any, types?: string[]) {
  const allowed = await activeRelationshipTypeNames(pg);
  const relTypes = types?.length ? types : allowed;
  const invalid = relTypes.filter((type) => !RELATIONSHIP_TYPE_PATTERN.test(type) || !allowed.includes(type));
  if (invalid.length) {
    throw new GraphQLError(`Invalid relationship type: ${invalid.join(", ")}`, { extensions: { code: "BAD_USER_INPUT" } });
  }
  return relTypes.join("|");
}

export async function assertRelationshipType(pg: any, type: string) {
  if (!RELATIONSHIP_TYPE_PATTERN.test(type)) {
    throw new GraphQLError(`Invalid relationship type: ${type}`, { extensions: { code: "BAD_USER_INPUT" } });
  }
  const allowed = await activeRelationshipTypeNames(pg);
  if (!allowed.includes(type)) {
    throw new GraphQLError(`Inactive or unknown relationship type: ${type}`, { extensions: { code: "BAD_USER_INPUT" } });
  }
}
