import neo4j from "neo4j-driver";
import { createRequire } from "node:module";

const { Pool } = createRequire(import.meta.url)("pg") as {
  Pool: new (config: { connectionString: string }) => {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
    end: () => Promise<void>;
  };
};

const pg = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://specora:specora123@localhost:5432/specora",
});

const neo4jDriver = neo4j.driver(
  process.env.NEO4J_URI || "bolt://localhost:7687",
  neo4j.auth.basic(
    process.env.NEO4J_USER || "neo4j",
    process.env.NEO4J_PASSWORD || "specora123"
  )
);

interface CIClassDef {
  name: string;
  displayName: string;
  attributes: Array<{
    name: string;
    attrType: string;
    defaultValue: string | null;
    isMandatory: boolean;
  }>;
}

async function getClassDefs(): Promise<CIClassDef[]> {
  const classesResult = await pg.query(
    `SELECT id, name, display_name FROM ci_classes WHERE is_system = true ORDER BY name`
  );

  const defs: CIClassDef[] = [];
  for (const cls of classesResult.rows) {
    const attrsResult = await pg.query(
      `SELECT name, attr_type, default_value, is_mandatory
       FROM ci_class_attributes WHERE class_id = $1 ORDER BY sort_order`,
      [cls.id]
    );
    defs.push({
      name: cls.name,
      displayName: cls.display_name,
      attributes: attrsResult.rows.map((r: any) => ({
        name: r.name,
        attrType: r.attr_type,
        defaultValue: r.default_value,
        isMandatory: r.is_mandatory,
      })),
    });
  }
  return defs;
}

function generateCIProps(classDef: CIClassDef, ciName: string, overrides: Record<string, any> = {}): Record<string, any> {
  const props: Record<string, any> = {
    name: ciName,
    class: classDef.name,
  };

  for (const attr of classDef.attributes) {
    if (overrides[attr.name] !== undefined) {
      props[attr.name] = overrides[attr.name];
    } else if (attr.defaultValue) {
      props[attr.name] = attr.defaultValue;
    } else {
      // Generate sensible fake data based on type
      switch (attr.attrType) {
        case "string":
          if (attr.name === "os") props[attr.name] = "Linux";
          else if (attr.name === "osVersion") props[attr.name] = "22.04";
          else if (attr.name === "fqdn") props[attr.name] = `${ciName.toLowerCase().replace(/\s+/g, "-")}.specora.dev`;
          else if (attr.name === "serialNumber") props[attr.name] = `SN-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
          else if (attr.name === "assetTag") props[attr.name] = `AT-${Math.floor(Math.random() * 100000)}`;
          else if (attr.name === "version") props[attr.name] = `1.${Math.floor(Math.random() * 10)}.${Math.floor(Math.random() * 10)}`;
          else if (attr.name === "techStack") props[attr.name] = "Node.js / React";
          else if (attr.name === "repoUrl") props[attr.name] = `https://github.com/specora/${ciName.toLowerCase().replace(/\s+/g, "-")}`;
          else if (attr.name === "ipAddress") props[attr.name] = `10.0.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
          else if (attr.name === "endpointUrl") props[attr.name] = `https://${ciName.toLowerCase().replace(/\s+/g, "-")}.specora.dev`;
          else if (attr.name === "healthCheckUrl") props[attr.name] = `https://${ciName.toLowerCase().replace(/\s+/g, "-")}.specora.dev/health`;
          else if (attr.name === "macAddress") props[attr.name] = "02:00:00:00:00:00";
          else if (attr.name === "firmwareVersion") props[attr.name] = "1.0.0";
          else if (attr.name === "availabilityTarget") props[attr.name] = "99.9%";
          else if (attr.name === "supportHours") props[attr.name] = "24x7";
          else if (attr.name === "region") props[attr.name] = "us-east-1";
          else if (attr.name === "address") props[attr.name] = "123 Cloud Way";
          else if (attr.name === "city") props[attr.name] = "Ashburn";
          else if (attr.name === "country") props[attr.name] = "USA";
          else if (attr.name === "timezone") props[attr.name] = "America/New_York";
          else if (attr.name === "slaClass") props[attr.name] = "Gold";
          else if (attr.name === "email") props[attr.name] = `${ciName.toLowerCase().replace(/\s+/g, ".")}@specora.dev`;
          else if (attr.name === "phone") props[attr.name] = "+1-555-0100";
          else if (attr.name === "title") props[attr.name] = "Engineer";
          else if (attr.name === "groupEmail") props[attr.name] = `${ciName.toLowerCase().replace(/\s+/g, "-")}@specora.dev`;
          else props[attr.name] = "unknown";
          break;
        case "number":
          if (attr.name === "cpuCores") props[attr.name] = 4;
          else if (attr.name === "memoryGB") props[attr.name] = 16;
          else if (attr.name === "diskGB") props[attr.name] = 100;
          else if (attr.name === "port") props[attr.name] = 5432;
          else props[attr.name] = 0;
          break;
        case "enum":
          if (attr.name === "dbType") props[attr.name] = "PostgreSQL";
          else if (attr.name === "criticality") props[attr.name] = "3";
          else if (attr.name === "deploymentMethod") props[attr.name] = "docker";
          else if (attr.name === "serviceType") props[attr.name] = "load_balancer";
          else if (attr.name === "deviceType") props[attr.name] = "switch";
          else if (attr.name === "locationType") props[attr.name] = "datacenter";
          else if (attr.name === "groupType") props[attr.name] = "assignment";
          else props[attr.name] = "unknown";
          break;
        case "date":
          props[attr.name] = new Date().toISOString().split("T")[0];
          break;
        case "reference":
          props[attr.name] = null;
          break;
        default:
          props[attr.name] = null;
      }
    }
  }

  // Merge overrides
  return { ...props, ...overrides };
}

async function seed() {
  console.log("Loading class definitions from PostgreSQL...");
  const classDefs = await getClassDefs();
  const classMap = new Map(classDefs.map((c) => [c.name, c]));

  console.log(`Found ${classDefs.length} system classes`);

  const session = neo4jDriver.session();
  try {
    // Clear existing non-system CIs (optional - careful!)
    // await session.run("MATCH (n:ConfigurationItem) WHERE n.id STARTS WITH 'seed-' DETACH DELETE n");

    // Seed Servers
    const serverDef = classMap.get("Server");
    if (serverDef) {
      for (let i = 1; i <= 5; i++) {
        const props = generateCIProps(serverDef, `web-prod-0${i}`, { environment: "Production" });
        await session.run(
          `MERGE (n:Server:ConfigurationItem {id: $id}) SET n += $props`,
          { id: `seed-srv-${i}`, props }
        );
      }
      console.log("Seeded 5 Servers");
    }

    // Seed Databases
    const dbDef = classMap.get("Database");
    if (dbDef) {
      const dbs = [
        { name: "portal-postgres", dbType: "PostgreSQL", port: 5432, version: "15.4" },
        { name: "redis-cache", dbType: "Redis", port: 6379, version: "7.2" },
        { name: "elasticsearch-search", dbType: "Elasticsearch", port: 9200, version: "8.11" },
      ];
      for (let i = 0; i < dbs.length; i++) {
        const props = generateCIProps(dbDef, dbs[i].name, { environment: "Production", ...dbs[i] });
        await session.run(
          `MERGE (n:Database:ConfigurationItem {id: $id}) SET n += $props`,
          { id: `seed-db-${i + 1}`, props }
        );
      }
      console.log("Seeded 3 Databases");
    }

    // Seed Business Services
    const bsDef = classMap.get("BusinessService");
    if (bsDef) {
      const bss = [
        { name: "Customer Portal", criticality: "5" },
        { name: "Billing & Payments", criticality: "5" },
        { name: "Internal Analytics", criticality: "2" },
      ];
      for (let i = 0; i < bss.length; i++) {
        const props = generateCIProps(bsDef, bss[i].name, { environment: "Production", ...bss[i] });
        await session.run(
          `MERGE (n:BusinessService:ConfigurationItem {id: $id}) SET n += $props`,
          { id: `seed-bs-${i + 1}`, props }
        );
      }
      console.log("Seeded 3 Business Services");
    }

    // Seed Applications
    const appDef = classMap.get("Application");
    if (appDef) {
      const apps = [
        { name: "Portal Web App", techStack: "React / Next.js", deploymentMethod: "docker" },
        { name: "Admin Dashboard", techStack: "Vue / Nuxt", deploymentMethod: "kubernetes" },
        { name: "Mobile iOS App", techStack: "Swift", deploymentMethod: "static" },
      ];
      for (let i = 0; i < apps.length; i++) {
        const props = generateCIProps(appDef, apps[i].name, { environment: "Production", ...apps[i] });
        await session.run(
          `MERGE (n:Application:ConfigurationItem {id: $id}) SET n += $props`,
          { id: `seed-app-${i + 1}`, props }
        );
      }
      console.log("Seeded 3 Applications");
    }

    // Seed Application Services
    const asDef = classMap.get("ApplicationService");
    if (asDef) {
      const svcs = [
        { name: "Portal API", availabilityTarget: "99.99%" },
        { name: "Auth Service", availabilityTarget: "99.999%" },
        { name: "Payment Processor", availabilityTarget: "99.99%" },
      ];
      for (let i = 0; i < svcs.length; i++) {
        const props = generateCIProps(asDef, svcs[i].name, { environment: "Production", ...svcs[i] });
        await session.run(
          `MERGE (n:ApplicationService:ConfigurationItem {id: $id}) SET n += $props`,
          { id: `seed-as-${i + 1}`, props }
        );
      }
      console.log("Seeded 3 Application Services");
    }

    // Seed Technical Services
    const tsDef = classMap.get("TechnicalService");
    if (tsDef) {
      const svcs = [
        { name: "Load Balancer Tier", serviceType: "load_balancer" },
        { name: "Cache Cluster", serviceType: "cache" },
        { name: "Log Aggregation", serviceType: "logging" },
      ];
      for (let i = 0; i < svcs.length; i++) {
        const props = generateCIProps(tsDef, svcs[i].name, { environment: "Production", ...svcs[i] });
        await session.run(
          `MERGE (n:TechnicalService:ConfigurationItem {id: $id}) SET n += $props`,
          { id: `seed-ts-${i + 1}`, props }
        );
      }
      console.log("Seeded 3 Technical Services");
    }

    // Seed Network Gear
    const netDef = classMap.get("NetworkGear");
    if (netDef) {
      const nets = [
        { name: "Core Switch Alpha", deviceType: "switch", ipAddress: "10.0.1.1" },
        { name: "Firewall Primary", deviceType: "firewall", ipAddress: "10.0.1.254" },
      ];
      for (let i = 0; i < nets.length; i++) {
        const props = generateCIProps(netDef, nets[i].name, { environment: "Production", ...nets[i] });
        await session.run(
          `MERGE (n:NetworkGear:ConfigurationItem {id: $id}) SET n += $props`,
          { id: `seed-net-${i + 1}`, props }
        );
      }
      console.log("Seeded 2 Network Gear");
    }

    // Seed Users
    const userDef = classMap.get("User");
    if (userDef) {
      const users = [
        { name: "Alice Chen", email: "alice@specora.dev", title: "Platform Engineer" },
        { name: "Bob Martinez", email: "bob@specora.dev", title: "SRE Lead" },
        { name: "Carol Wu", email: "carol@specora.dev", title: "Product Manager" },
      ];
      for (let i = 0; i < users.length; i++) {
        const props = generateCIProps(userDef, users[i].name, { ...users[i] });
        await session.run(
          `MERGE (n:User:ConfigurationItem {id: $id}) SET n += $props`,
          { id: `seed-usr-${i + 1}`, props }
        );
      }
      console.log("Seeded 3 Users");
    }

    // Seed Groups
    const groupDef = classMap.get("Group");
    if (groupDef) {
      const groups = [
        { name: "Platform Engineering", groupType: "assignment" },
        { name: "SRE", groupType: "assignment" },
        { name: "Security Operations", groupType: "security" },
      ];
      for (let i = 0; i < groups.length; i++) {
        const props = generateCIProps(groupDef, groups[i].name, { ...groups[i] });
        await session.run(
          `MERGE (n:Group:ConfigurationItem {id: $id}) SET n += $props`,
          { id: `seed-grp-${i + 1}`, props }
        );
      }
      console.log("Seeded 3 Groups");
    }

    // Seed Locations
    const locDef = classMap.get("Location");
    if (locDef) {
      const locs = [
        { name: "AWS us-east-1a", locationType: "cloud_zone", region: "us-east-1" },
        { name: "On-Prem Data Center", locationType: "datacenter", region: "us-west-2" },
      ];
      for (let i = 0; i < locs.length; i++) {
        const props = generateCIProps(locDef, locs[i].name, { ...locs[i] });
        await session.run(
          `MERGE (n:Location:ConfigurationItem {id: $id}) SET n += $props`,
          { id: `seed-loc-${i + 1}`, props }
        );
      }
      console.log("Seeded 2 Locations");
    }

    // Create relationships
    const rels = [
      // Business Service -> Application Service
      ["seed-bs-1", "DEPENDS_ON", "seed-as-1"],
      ["seed-bs-2", "DEPENDS_ON", "seed-as-3"],
      // Application Service -> Application
      ["seed-as-1", "PART_OF", "seed-app-1"],
      ["seed-as-2", "PART_OF", "seed-app-2"],
      // Application Service -> Database
      ["seed-as-1", "DEPENDS_ON", "seed-db-1"],
      ["seed-as-3", "DEPENDS_ON", "seed-db-2"],
      // Application Service -> Technical Service
      ["seed-as-1", "HOSTED_ON", "seed-ts-1"],
      ["seed-as-2", "HOSTED_ON", "seed-ts-2"],
      // Database -> Server
      ["seed-db-1", "HOSTED_ON", "seed-srv-1"],
      ["seed-db-2", "HOSTED_ON", "seed-srv-2"],
      // Server -> Location
      ["seed-srv-1", "LOCATED_AT", "seed-loc-1"],
      ["seed-srv-2", "LOCATED_AT", "seed-loc-1"],
      // User -> Group
      ["seed-usr-1", "PART_OF", "seed-grp-1"],
      ["seed-usr-2", "PART_OF", "seed-grp-2"],
      // Business Service -> User (owned_by)
      ["seed-bs-1", "OWNED_BY", "seed-usr-3"],
    ];

    for (const [sourceId, type, targetId] of rels) {
      await session.run(
        `MATCH (a:ConfigurationItem {id: $sourceId}), (b:ConfigurationItem {id: $targetId})
         MERGE (a)-[:${type}]->(b)`,
        { sourceId, targetId }
      );
    }
    console.log(`Created ${rels.length} relationships`);

    console.log("Seed complete!");
  } finally {
    await session.close();
    await pg.end();
    await neo4jDriver.close();
  }
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
