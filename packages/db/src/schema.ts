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
// ===== LOCATIONS =====
MERGE (loc1:Location:ConfigurationItem {id: 'loc-1'})
  SET loc1.name = 'AWS us-east-1a', loc1.class = 'Location', loc1.environment = 'Production'
MERGE (loc2:Location:ConfigurationItem {id: 'loc-2'})
  SET loc2.name = 'AWS us-east-1b', loc2.class = 'Location', loc2.environment = 'Production'
MERGE (loc3:Location:ConfigurationItem {id: 'loc-3'})
  SET loc3.name = 'AWS us-east-1c', loc3.class = 'Location', loc3.environment = 'Production'
MERGE (loc4:Location:ConfigurationItem {id: 'loc-4'})
  SET loc4.name = 'On-Prem Data Center', loc4.class = 'Location', loc4.environment = 'Production'

// ===== GROUPS =====
MERGE (grp1:Group:ConfigurationItem {id: 'grp-1'})
  SET grp1.name = 'Platform Engineering', grp1.class = 'Group'
MERGE (grp2:Group:ConfigurationItem {id: 'grp-2'})
  SET grp2.name = 'Data Engineering', grp2.class = 'Group'
MERGE (grp3:Group:ConfigurationItem {id: 'grp-3'})
  SET grp3.name = 'Security Operations', grp3.class = 'Group'
MERGE (grp4:Group:ConfigurationItem {id: 'grp-4'})
  SET grp4.name = 'SRE', grp4.class = 'Group'
MERGE (grp5:Group:ConfigurationItem {id: 'grp-5'})
  SET grp5.name = 'Product Engineering', grp5.class = 'Group'

// ===== USERS =====
MERGE (usr1:User:ConfigurationItem {id: 'usr-1'})
  SET usr1.name = 'Alice Chen', usr1.class = 'User', usr1.email = 'alice@specora.dev',
      usr1.passwordHash = '$2b$10$UcP3YzFw1vKY32IG7Iov1./u9zaYsZShLVNbM81gAqiQvz7QRXjqO'
MERGE (usr2:User:ConfigurationItem {id: 'usr-2'})
  SET usr2.name = 'Bob Martinez', usr2.class = 'User', usr2.email = 'bob@specora.dev'
MERGE (usr3:User:ConfigurationItem {id: 'usr-3'})
  SET usr3.name = 'Carol Wu', usr3.class = 'User', usr3.email = 'carol@specora.dev'
MERGE (usr4:User:ConfigurationItem {id: 'usr-4'})
  SET usr4.name = 'David Park', usr4.class = 'User', usr4.email = 'david@specora.dev'
MERGE (usr5:User:ConfigurationItem {id: 'usr-5'})
  SET usr5.name = 'Eva Schmidt', usr5.class = 'User', usr5.email = 'eva@specora.dev'
MERGE (usr6:User:ConfigurationItem {id: 'usr-6'})
  SET usr6.name = 'Frank Okafor', usr6.class = 'User', usr6.email = 'frank@specora.dev'
MERGE (usr7:User:ConfigurationItem {id: 'usr-7'})
  SET usr7.name = 'Grace Li', usr7.class = 'User', usr7.email = 'grace@specora.dev'

// ===== BUSINESS SERVICES =====
MERGE (bs1:BusinessService:ConfigurationItem {id: 'bs-1'})
  SET bs1.name = 'Customer Portal', bs1.class = 'BusinessService', bs1.environment = 'Production'
MERGE (bs2:BusinessService:ConfigurationItem {id: 'bs-2'})
  SET bs2.name = 'Internal Analytics', bs2.class = 'BusinessService', bs2.environment = 'Production'
MERGE (bs3:BusinessService:ConfigurationItem {id: 'bs-3'})
  SET bs3.name = 'Billing & Payments', bs3.class = 'BusinessService', bs3.environment = 'Production'
MERGE (bs4:BusinessService:ConfigurationItem {id: 'bs-4'})
  SET bs4.name = 'Mobile App Platform', bs4.class = 'BusinessService', bs4.environment = 'Production'
MERGE (bs5:BusinessService:ConfigurationItem {id: 'bs-5'})
  SET bs5.name = 'Partner API Gateway', bs5.class = 'BusinessService', bs5.environment = 'Production'

// ===== APPLICATION SERVICES =====
MERGE (as1:ApplicationService:ConfigurationItem {id: 'as-1'})
  SET as1.name = 'Portal API', as1.class = 'ApplicationService', as1.environment = 'Production'
MERGE (as2:ApplicationService:ConfigurationItem {id: 'as-2'})
  SET as2.name = 'Auth Service', as2.class = 'ApplicationService', as2.environment = 'Production'
MERGE (as3:ApplicationService:ConfigurationItem {id: 'as-3'})
  SET as3.name = 'Analytics Pipeline', as3.class = 'ApplicationService', as3.environment = 'Production'
MERGE (as4:ApplicationService:ConfigurationItem {id: 'as-4'})
  SET as4.name = 'Billing Engine', as4.class = 'ApplicationService', as4.environment = 'Production'
MERGE (as5:ApplicationService:ConfigurationItem {id: 'as-5'})
  SET as5.name = 'Payment Processor', as5.class = 'ApplicationService', as5.environment = 'Production'
MERGE (as6:ApplicationService:ConfigurationItem {id: 'as-6'})
  SET as6.name = 'Mobile Backend', as6.class = 'ApplicationService', as6.environment = 'Production'
MERGE (as7:ApplicationService:ConfigurationItem {id: 'as-7'})
  SET as7.name = 'Partner API', as7.class = 'ApplicationService', as7.environment = 'Production'
MERGE (as8:ApplicationService:ConfigurationItem {id: 'as-8'})
  SET as8.name = 'Notification Service', as8.class = 'ApplicationService', as8.environment = 'Production'
MERGE (as9:ApplicationService:ConfigurationItem {id: 'as-9'})
  SET as9.name = 'Search Service', as9.class = 'ApplicationService', as9.environment = 'Production'
MERGE (as10:ApplicationService:ConfigurationItem {id: 'as-10'})
  SET as10.name = 'Report Generator', as10.class = 'ApplicationService', as10.environment = 'Production'

// ===== TECHNICAL SERVICES =====
MERGE (ts1:TechnicalService:ConfigurationItem {id: 'ts-1'})
  SET ts1.name = 'Load Balancer Tier', ts1.class = 'TechnicalService', ts1.environment = 'Production'
MERGE (ts2:TechnicalService:ConfigurationItem {id: 'ts-2'})
  SET ts2.name = 'Cache Cluster', ts2.class = 'TechnicalService', ts2.environment = 'Production'
MERGE (ts3:TechnicalService:ConfigurationItem {id: 'ts-3'})
  SET ts3.name = 'Message Queue', ts3.class = 'TechnicalService', ts3.environment = 'Production'
MERGE (ts4:TechnicalService:ConfigurationItem {id: 'ts-4'})
  SET ts4.name = 'Log Aggregation', ts4.class = 'TechnicalService', ts4.environment = 'Production'

// ===== APPLICATIONS =====
MERGE (app1:Application:ConfigurationItem {id: 'app-1'})
  SET app1.name = 'Portal Web App', app1.class = 'Application', app1.environment = 'Production'
MERGE (app2:Application:ConfigurationItem {id: 'app-2'})
  SET app2.name = 'Admin Dashboard', app2.class = 'Application', app2.environment = 'Production'
MERGE (app3:Application:ConfigurationItem {id: 'app-3'})
  SET app3.name = 'Analytics BI Tool', app3.class = 'Application', app3.environment = 'Production'
MERGE (app4:Application:ConfigurationItem {id: 'app-4'})
  SET app4.name = 'Mobile iOS App', app4.class = 'Application', app4.environment = 'Production'
MERGE (app5:Application:ConfigurationItem {id: 'app-5'})
  SET app5.name = 'Mobile Android App', app5.class = 'Application', app5.environment = 'Production'
MERGE (app6:Application:ConfigurationItem {id: 'app-6'})
  SET app6.name = 'Billing Portal', app6.class = 'Application', app6.environment = 'Production'

// ===== SERVERS =====
MERGE (srv1:Server:ConfigurationItem {id: 'srv-1'})
  SET srv1.name = 'web-prod-01', srv1.class = 'Server', srv1.environment = 'Production'
MERGE (srv2:Server:ConfigurationItem {id: 'srv-2'})
  SET srv2.name = 'web-prod-02', srv2.class = 'Server', srv2.environment = 'Production'
MERGE (srv3:Server:ConfigurationItem {id: 'srv-3'})
  SET srv3.name = 'app-prod-01', srv3.class = 'Server', srv3.environment = 'Production'
MERGE (srv4:Server:ConfigurationItem {id: 'srv-4'})
  SET srv4.name = 'app-prod-02', srv4.class = 'Server', srv4.environment = 'Production'
MERGE (srv5:Server:ConfigurationItem {id: 'srv-5'})
  SET srv5.name = 'app-prod-03', srv5.class = 'Server', srv5.environment = 'Production'
MERGE (srv6:Server:ConfigurationItem {id: 'srv-6'})
  SET srv6.name = 'db-prod-01', srv6.class = 'Server', srv6.environment = 'Production'
MERGE (srv7:Server:ConfigurationItem {id: 'srv-7'})
  SET srv7.name = 'db-prod-02', srv7.class = 'Server', srv7.environment = 'Production'
MERGE (srv8:Server:ConfigurationItem {id: 'srv-8'})
  SET srv8.name = 'cache-prod-01', srv8.class = 'Server', srv8.environment = 'Production'
MERGE (srv9:Server:ConfigurationItem {id: 'srv-9'})
  SET srv9.name = 'mq-prod-01', srv9.class = 'Server', srv9.environment = 'Production'
MERGE (srv10:Server:ConfigurationItem {id: 'srv-10'})
  SET srv10.name = 'analytics-prod-01', srv10.class = 'Server', srv10.environment = 'Production'
MERGE (srv11:Server:ConfigurationItem {id: 'srv-11'})
  SET srv11.name = 'analytics-prod-02', srv11.class = 'Server', srv11.environment = 'Production'
MERGE (srv12:Server:ConfigurationItem {id: 'srv-12'})
  SET srv12.name = 'search-prod-01', srv12.class = 'Server', srv12.environment = 'Production'
MERGE (srv13:Server:ConfigurationItem {id: 'srv-13'})
  SET srv13.name = 'web-staging-01', srv13.class = 'Server', srv13.environment = 'Staging'
MERGE (srv14:Server:ConfigurationItem {id: 'srv-14'})
  SET srv14.name = 'app-staging-01', srv14.class = 'Server', srv14.environment = 'Staging'
MERGE (srv15:Server:ConfigurationItem {id: 'srv-15'})
  SET srv15.name = 'db-staging-01', srv15.class = 'Server', srv15.environment = 'Staging'

// ===== DATABASES =====
MERGE (db1:Database:ConfigurationItem {id: 'db-1'})
  SET db1.name = 'portal-postgres-primary', db1.class = 'Database', db1.environment = 'Production'
MERGE (db2:Database:ConfigurationItem {id: 'db-2'})
  SET db2.name = 'portal-postgres-replica', db2.class = 'Database', db2.environment = 'Production'
MERGE (db3:Database:ConfigurationItem {id: 'db-3'})
  SET db3.name = 'analytics-warehouse', db3.class = 'Database', db3.environment = 'Production'
MERGE (db4:Database:ConfigurationItem {id: 'db-4'})
  SET db4.name = 'billing-postgres', db4.class = 'Database', db4.environment = 'Production'
MERGE (db5:Database:ConfigurationItem {id: 'db-5'})
  SET db5.name = 'redis-cache', db5.class = 'Database', db5.environment = 'Production'
MERGE (db6:Database:ConfigurationItem {id: 'db-6'})
  SET db6.name = 'elasticsearch-search', db6.class = 'Database', db6.environment = 'Production'
MERGE (db7:Database:ConfigurationItem {id: 'db-7'})
  SET db7.name = 'staging-postgres', db7.class = 'Database', db7.environment = 'Staging'

// ===== NETWORK GEAR =====
MERGE (net1:NetworkGear:ConfigurationItem {id: 'net-1'})
  SET net1.name = 'Core Switch Alpha', net1.class = 'NetworkGear', net1.environment = 'Production'
MERGE (net2:NetworkGear:ConfigurationItem {id: 'net-2'})
  SET net2.name = 'Core Switch Beta', net2.class = 'NetworkGear', net2.environment = 'Production'
MERGE (net3:NetworkGear:ConfigurationItem {id: 'net-3'})
  SET net3.name = 'Firewall Primary', net3.class = 'NetworkGear', net3.environment = 'Production'
MERGE (net4:NetworkGear:ConfigurationItem {id: 'net-4'})
  SET net4.name = 'VPN Gateway', net4.class = 'NetworkGear', net4.environment = 'Production'

// ===== ORPHANED CIs (for testing) =====
MERGE (orph1:Server:ConfigurationItem {id: 'orph-1'})
  SET orph1.name = 'decommissioned-web-01', orph1.class = 'Server', orph1.environment = 'Decommissioned'
MERGE (orph2:Database:ConfigurationItem {id: 'orph-2'})
  SET orph2.name = 'legacy-mongodb', orph2.class = 'Database', orph2.environment = 'Decommissioned'
MERGE (orph3:Server:ConfigurationItem {id: 'orph-3'})
  SET orph3.name = 'test-lab-server', orph3.class = 'Server', orph3.environment = 'Development'

// ===== RELATIONSHIPS =====
// Business Service -> Application Service
MERGE (bs1)-[:DEPENDS_ON]->(as1)
MERGE (bs1)-[:DEPENDS_ON]->(as2)
MERGE (bs2)-[:DEPENDS_ON]->(as3)
MERGE (bs2)-[:DEPENDS_ON]->(as10)
MERGE (bs3)-[:DEPENDS_ON]->(as4)
MERGE (bs3)-[:DEPENDS_ON]->(as5)
MERGE (bs4)-[:DEPENDS_ON]->(as6)
MERGE (bs4)-[:DEPENDS_ON]->(as8)
MERGE (bs5)-[:DEPENDS_ON]->(as7)
MERGE (bs1)-[:DEPENDS_ON]->(as9)

// Application Service -> Application
MERGE (as1)-[:PART_OF]->(app1)
MERGE (as2)-[:PART_OF]->(app2)
MERGE (as3)-[:PART_OF]->(app3)
MERGE (as6)-[:PART_OF]->(app4)
MERGE (as6)-[:PART_OF]->(app5)
MERGE (as4)-[:PART_OF]->(app6)

// Application Service -> Application Service dependencies
MERGE (as1)-[:DEPENDS_ON]->(as2)
MERGE (as4)-[:DEPENDS_ON]->(as2)
MERGE (as6)-[:DEPENDS_ON]->(as2)
MERGE (as7)-[:DEPENDS_ON]->(as2)
MERGE (as3)-[:DEPENDS_ON]->(as9)
MERGE (as10)-[:DEPENDS_ON]->(as3)
MERGE (as8)-[:DEPENDS_ON]->(as3)
MERGE (as5)-[:DEPENDS_ON]->(as8)

// Application Service -> Database
MERGE (as1)-[:DEPENDS_ON]->(db1)
MERGE (as3)-[:DEPENDS_ON]->(db3)
MERGE (as4)-[:DEPENDS_ON]->(db4)
MERGE (as6)-[:DEPENDS_ON]->(db1)
MERGE (as9)-[:DEPENDS_ON]->(db6)
MERGE (as1)-[:DEPENDS_ON]->(db5)
MERGE (as6)-[:DEPENDS_ON]->(db5)
MERGE (as7)-[:DEPENDS_ON]->(db5)

// Application Service -> Technical Service
MERGE (as1)-[:HOSTED_ON]->(ts1)
MERGE (as4)-[:HOSTED_ON]->(ts1)
MERGE (as6)-[:HOSTED_ON]->(ts1)
MERGE (as7)-[:HOSTED_ON]->(ts1)
MERGE (as1)-[:DEPENDS_ON]->(ts2)
MERGE (as6)-[:DEPENDS_ON]->(ts2)
MERGE (as7)-[:DEPENDS_ON]->(ts2)
MERGE (as3)-[:DEPENDS_ON]->(ts3)
MERGE (as8)-[:DEPENDS_ON]->(ts3)
MERGE (as4)-[:DEPENDS_ON]->(ts4)
MERGE (as5)-[:DEPENDS_ON]->(ts4)

// Server -> Location
MERGE (srv1)-[:LOCATED_AT]->(loc1)
MERGE (srv2)-[:LOCATED_AT]->(loc2)
MERGE (srv3)-[:LOCATED_AT]->(loc1)
MERGE (srv4)-[:LOCATED_AT]->(loc2)
MERGE (srv5)-[:LOCATED_AT]->(loc3)
MERGE (srv6)-[:LOCATED_AT]->(loc1)
MERGE (srv7)-[:LOCATED_AT]->(loc2)
MERGE (srv8)-[:LOCATED_AT]->(loc3)
MERGE (srv9)-[:LOCATED_AT]->(loc1)
MERGE (srv10)-[:LOCATED_AT]->(loc2)
MERGE (srv11)-[:LOCATED_AT]->(loc3)
MERGE (srv12)-[:LOCATED_AT]->(loc1)
MERGE (srv13)-[:LOCATED_AT]->(loc4)
MERGE (srv14)-[:LOCATED_AT]->(loc4)
MERGE (srv15)-[:LOCATED_AT]->(loc4)

// Server -> Database (hosting)
MERGE (db1)-[:HOSTED_ON]->(srv6)
MERGE (db2)-[:HOSTED_ON]->(srv7)
MERGE (db3)-[:HOSTED_ON]->(srv10)
MERGE (db4)-[:HOSTED_ON]->(srv6)
MERGE (db5)-[:HOSTED_ON]->(srv8)
MERGE (db6)-[:HOSTED_ON]->(srv12)
MERGE (db7)-[:HOSTED_ON]->(srv15)

// Server -> Network Gear
MERGE (srv1)-[:DEPENDS_ON]->(net1)
MERGE (srv2)-[:DEPENDS_ON]->(net2)
MERGE (srv3)-[:DEPENDS_ON]->(net1)
MERGE (srv4)-[:DEPENDS_ON]->(net2)
MERGE (net1)-[:DEPENDS_ON]->(net3)
MERGE (net2)-[:DEPENDS_ON]->(net3)
MERGE (net3)-[:DEPENDS_ON]->(net4)

// Ownership & Management
MERGE (bs1)-[:OWNED_BY]->(usr1)
MERGE (bs2)-[:OWNED_BY]->(usr2)
MERGE (bs3)-[:OWNED_BY]->(usr3)
MERGE (bs4)-[:OWNED_BY]->(usr4)
MERGE (bs5)-[:OWNED_BY]->(usr5)
MERGE (srv1)-[:MANAGED_BY]->(grp4)
MERGE (srv2)-[:MANAGED_BY]->(grp4)
MERGE (srv3)-[:MANAGED_BY]->(grp4)
MERGE (srv4)-[:MANAGED_BY]->(grp4)
MERGE (srv5)-[:MANAGED_BY]->(grp4)
MERGE (srv6)-[:MANAGED_BY]->(grp1)
MERGE (srv7)-[:MANAGED_BY]->(grp1)
MERGE (srv8)-[:MANAGED_BY]->(grp1)
MERGE (srv9)-[:MANAGED_BY]->(grp1)
MERGE (srv10)-[:MANAGED_BY]->(grp2)
MERGE (srv11)-[:MANAGED_BY]->(grp2)
MERGE (srv12)-[:MANAGED_BY]->(grp1)
MERGE (db1)-[:MANAGED_BY]->(grp1)
MERGE (db2)-[:MANAGED_BY]->(grp1)
MERGE (db3)-[:MANAGED_BY]->(grp2)
MERGE (db4)-[:MANAGED_BY]->(grp1)
MERGE (db5)-[:MANAGED_BY]->(grp1)
MERGE (db6)-[:MANAGED_BY]->(grp1)
MERGE (net1)-[:MANAGED_BY]->(grp3)
MERGE (net2)-[:MANAGED_BY]->(grp3)
MERGE (net3)-[:MANAGED_BY]->(grp3)
MERGE (net4)-[:MANAGED_BY]->(grp3)
MERGE (ts1)-[:MANAGED_BY]->(grp4)
MERGE (ts2)-[:MANAGED_BY]->(grp1)
MERGE (ts3)-[:MANAGED_BY]->(grp1)
MERGE (ts4)-[:MANAGED_BY]->(grp4)
MERGE (app1)-[:OWNED_BY]->(usr5)
MERGE (app2)-[:OWNED_BY]->(usr6)
MERGE (app3)-[:OWNED_BY]->(usr2)
MERGE (app4)-[:OWNED_BY]->(usr4)
MERGE (app5)-[:OWNED_BY]->(usr4)
MERGE (app6)-[:OWNED_BY]->(usr3)

// Group memberships
MERGE (usr1)-[:PART_OF]->(grp1)
MERGE (usr2)-[:PART_OF]->(grp2)
MERGE (usr3)-[:PART_OF]->(grp5)
MERGE (usr4)-[:PART_OF]->(grp5)
MERGE (usr5)-[:PART_OF]->(grp5)
MERGE (usr6)-[:PART_OF]->(grp3)
MERGE (usr7)-[:PART_OF]->(grp4)
`;
