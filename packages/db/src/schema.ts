export const CONSTRAINTS = [
  `CREATE CONSTRAINT ci_id_unique IF NOT EXISTS FOR (n:ConfigurationItem) REQUIRE n.id IS UNIQUE`,
  `CREATE INDEX ci_name_index IF NOT EXISTS FOR (n:ConfigurationItem) ON (n.name)`,
  `CREATE INDEX ci_class_index IF NOT EXISTS FOR (n:ConfigurationItem) ON (n.class)`,
  `CREATE INDEX ci_env_index IF NOT EXISTS FOR (n:ConfigurationItem) ON (n.environment)`,
  `CREATE FULLTEXT INDEX ci_text_index IF NOT EXISTS FOR (n:ConfigurationItem) ON EACH [n.name, n.class, n.environment]`,
];

export const CSDM_NODE_LABELS = [
  "ConfigurationItem",
  "BusinessService",
  "ApplicationService",
  "TechnicalService",
  "Server",
  "Database",
  "Application",
  "NetworkGear",
  "User",
  "Group",
  "Location",
] as const;

export const CSDM_REL_TYPES = [
  "PART_OF",
  "DEPENDS_ON",
  "HOSTED_ON",
  "MANAGED_BY",
  "OWNED_BY",
  "LOCATED_AT",
] as const;

export const SEED_DATA_CYPHER = `
// Demo CSDMv5 data is generated in demoData.ts and loaded in seed.ts.
// It targets 5,000 ConfigurationItem records across foundation,
// service, application, technology, and infrastructure classes.
`;
