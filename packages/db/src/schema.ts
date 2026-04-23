export const CONSTRAINTS = [
  `CREATE CONSTRAINT ci_id_unique IF NOT EXISTS FOR (n:ConfigurationItem) REQUIRE n.id IS UNIQUE`,
  `CREATE INDEX ci_name_index IF NOT EXISTS FOR (n:ConfigurationItem) ON (n.name)`,
  `CREATE INDEX ci_class_index IF NOT EXISTS FOR (n:ConfigurationItem) ON (n.class)`,
  `CREATE INDEX ci_env_index IF NOT EXISTS FOR (n:ConfigurationItem) ON (n.environment)`,
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
];

export const CSDM_REL_TYPES = [
  "PART_OF",
  "DEPENDS_ON",
  "HOSTED_ON",
  "MANAGED_BY",
  "OWNED_BY",
  "LOCATED_AT",
];

export const SEED_DATA_CYPHER = `
MERGE (bs:BusinessService:ConfigurationItem {id: 'bs-1'})
  SET bs.name = 'Customer Portal', bs.class = 'BusinessService', bs.environment = 'Production'
MERGE (as:ApplicationService:ConfigurationItem {id: 'as-1'})
  SET as.name = 'Portal API', as.class = 'ApplicationService', as.environment = 'Production'
MERGE (app:Application:ConfigurationItem {id: 'app-1'})
  SET app.name = 'Portal Frontend', app.class = 'Application', app.environment = 'Production'
MERGE (srv:Server:ConfigurationItem {id: 'srv-1'})
  SET srv.name = 'web-01', srv.class = 'Server', srv.environment = 'Production'
MERGE (db:Database:ConfigurationItem {id: 'db-1'})
  SET db.name = 'portal-db-01', db.class = 'Database', db.environment = 'Production'
MERGE (loc:Location:ConfigurationItem {id: 'loc-1'})
  SET loc.name = 'AWS us-east-1', loc.class = 'Location', loc.environment = 'Production'
MERGE (grp:Group:ConfigurationItem {id: 'grp-1'})
  SET grp.name = 'Platform Engineering', grp.class = 'Group'
MERGE (usr:User:ConfigurationItem {id: 'usr-1'})
  SET usr.name = 'Alice Admin', usr.class = 'User', usr.email = 'alice@specora.dev',
      usr.passwordHash = '$2b$10$ppj32iuxcyxlDlIMNdp54e.kbniM8PiPHwhBZyUStx/13TS4bHSky'

MERGE (bs)-[:DEPENDS_ON]->(as)
MERGE (as)-[:HOSTED_ON]->(srv)
MERGE (app)-[:PART_OF]->(as)
MERGE (as)-[:DEPENDS_ON]->(db)
MERGE (srv)-[:LOCATED_AT]->(loc)
MERGE (srv)-[:MANAGED_BY]->(grp)
MERGE (bs)-[:OWNED_BY]->(usr)
`;
