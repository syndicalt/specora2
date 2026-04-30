const PROJECTED_ATTRIBUTE_RESERVED_KEYS = new Set([
  "id",
  "name",
  "class",
  "environment",
  "attributes",
  "dataQualityScore",
  "lastDiscoveredAt",
]);

export function parseNode(node: any) {
  const attrs = typeof node.attributes === "string" ? JSON.parse(node.attributes) : (node.attributes || {});
  const projectedAttrs = Object.fromEntries(
    Object.entries(node).filter(([key, value]) => !PROJECTED_ATTRIBUTE_RESERVED_KEYS.has(key) && value !== undefined && value !== null)
  );
  return { ...node, attributes: { ...attrs, ...projectedAttrs } };
}

function isNeo4jPropertyValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (["string", "number", "boolean"].includes(typeof value)) return true;
  return Array.isArray(value) && value.every((item) => item !== null && ["string", "number", "boolean"].includes(typeof item));
}

export function neo4jPropertyProps(attrs: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(attrs).filter(([, value]) => isNeo4jPropertyValue(value)));
}

