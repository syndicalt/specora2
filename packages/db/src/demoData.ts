export type DemoCI = {
  id: string;
  name: string;
  className: string;
  environment: string;
  attributes: Record<string, unknown>;
  props: Record<string, unknown>;
};

export type DemoRelationship = {
  sourceId: string;
  targetId: string;
  type: "PART_OF" | "DEPENDS_ON" | "HOSTED_ON" | "MANAGED_BY" | "OWNED_BY" | "LOCATED_AT";
  attributes?: Record<string, unknown>;
};

export const DEMO_CI_COUNTS = {
  Location: 20,
  Group: 20,
  User: 60,
  BusinessService: 80,
  ApplicationService: 600,
  TechnicalService: 160,
  Application: 520,
  Database: 720,
  NetworkGear: 240,
  Server: 2580,
} as const;

export const DEMO_CI_TOTAL = Object.values(DEMO_CI_COUNTS).reduce((sum, count) => sum + count, 0);

const regions = ["us-east-1", "us-west-2", "eu-west-1", "ap-southeast-2"];
const domains = ["commerce", "identity", "payments", "analytics", "fulfillment", "support", "platform", "security"];
const osNames = ["Ubuntu Linux", "Red Hat Enterprise Linux", "Windows Server", "Amazon Linux"];
const dbTypes = ["PostgreSQL", "MySQL", "MongoDB", "Redis", "Elasticsearch", "Oracle", "SQL Server"];
const techStacks = ["Node.js/React", "Java/Spring", "Python/FastAPI", ".NET", "Go", "Kotlin"];
const serviceTypes = ["load_balancer", "cache", "queue", "dns", "cdn", "logging", "monitoring"];
const deviceTypes = ["switch", "router", "firewall", "load_balancer", "vpn_gateway", "appliance"];
const groupTypes = ["assignment", "approval", "notification", "security", "functional"];

function envFor(index: number): string {
  if (index % 20 === 0) return "Test";
  if (index % 7 === 0) return "Development";
  if (index % 5 === 0) return "Staging";
  return "Production";
}

function domainFor(index: number): string {
  return domains[(index - 1) % domains.length];
}

function pad(index: number, width = 4): string {
  return String(index).padStart(width, "0");
}

function ci(
  className: DemoCI["className"],
  index: number,
  name: string,
  attributes: Record<string, unknown>,
  environment = envFor(index)
): DemoCI {
  return {
    id: `demo-${className.toLowerCase()}-${pad(index)}`,
    name,
    className,
    environment,
    attributes,
    props: attributes,
  };
}

export function generateDemoCIs(): DemoCI[] {
  const items: DemoCI[] = [];

  for (let i = 1; i <= DEMO_CI_COUNTS.Location; i += 1) {
    const region = regions[(i - 1) % regions.length];
    items.push(ci("Location", i, `${region}-${i % 3 === 0 ? "edge" : "zone"}-${pad(i, 2)}`, {
      locationType: i % 3 === 0 ? "edge" : i % 2 === 0 ? "cloud_zone" : "cloud_region",
      region,
      address: `${100 + i} Platform Way`,
      city: ["Ashburn", "Portland", "Dublin", "Sydney"][i % 4],
      country: ["US", "US", "IE", "AU"][i % 4],
      timezone: ["America/New_York", "America/Los_Angeles", "Europe/Dublin", "Australia/Sydney"][i % 4],
    }, "Production"));
  }

  for (let i = 1; i <= DEMO_CI_COUNTS.Group; i += 1) {
    const domain = domainFor(i);
    items.push(ci("Group", i, `${domain} ${i % 2 === 0 ? "operations" : "engineering"}`, {
      groupType: groupTypes[(i - 1) % groupTypes.length],
      managerId: `demo-user-${pad(((i - 1) % DEMO_CI_COUNTS.User) + 1)}`,
      email: `${domain}-team-${i}@specora.dev`,
    }, "Production"));
  }

  for (let i = 1; i <= DEMO_CI_COUNTS.User; i += 1) {
    const domain = domainFor(i);
    const userId = i <= 7
      ? `550e8400-e29b-41d4-a716-44665544000${i}`
      : `demo-user-${pad(i)}`;
    items.push(ci("User", i, `${domain} owner ${pad(i, 2)}`, {
      email: `${domain}.owner.${pad(i, 2)}@specora.dev`,
      departmentId: `demo-group-${pad(((i - 1) % DEMO_CI_COUNTS.Group) + 1)}`,
      managerId: i === 1 ? null : `demo-user-${pad(((i - 2) % DEMO_CI_COUNTS.User) + 1)}`,
      costCenterId: `demo-group-${pad(((i + 4) % DEMO_CI_COUNTS.Group) + 1)}`,
      phone: `+1-555-01${pad(i, 2)}`,
      title: i % 5 === 0 ? "Service Owner" : "Application Owner",
      userId,
    }, "Production"));
  }

  for (let i = 1; i <= DEMO_CI_COUNTS.BusinessService; i += 1) {
    const domain = domainFor(i);
    items.push(ci("BusinessService", i, `${domain} business service ${pad(i, 3)}`, {
      serviceOwnerId: `demo-user-${pad(((i - 1) % DEMO_CI_COUNTS.User) + 1)}`,
      criticality: String((i % 5) + 1),
      slaClass: i % 4 === 0 ? "Platinum" : i % 3 === 0 ? "Gold" : "Silver",
      retirementDate: null,
      csdmDomain: "Service Consumption",
      serviceClassification: "Business Service",
    }));
  }

  for (let i = 1; i <= DEMO_CI_COUNTS.ApplicationService; i += 1) {
    const domain = domainFor(i);
    items.push(ci("ApplicationService", i, `${domain} service instance ${pad(i, 4)}`, {
      availabilityTarget: i % 4 === 0 ? "99.5" : i % 3 === 0 ? "99.9" : "99.95",
      supportHours: i % 5 === 0 ? "Business Hours" : "24x7",
      populationMethod: i % 6 === 0 ? "dynamic_ci_group" : "service_mapping",
      csdmDomain: "Service Delivery",
    }));
  }

  for (let i = 1; i <= DEMO_CI_COUNTS.TechnicalService; i += 1) {
    const type = serviceTypes[(i - 1) % serviceTypes.length];
    items.push(ci("TechnicalService", i, `${type.replace("_", " ")} technology service ${pad(i, 3)}`, {
      serviceType: type,
      endpointUrl: `https://${type}-${pad(i, 3)}.internal.specora.dev`,
      healthCheckUrl: `https://${type}-${pad(i, 3)}.internal.specora.dev/health`,
      csdmDomain: "Service Delivery",
      serviceClassification: "Technical Service",
    }));
  }

  for (let i = 1; i <= DEMO_CI_COUNTS.Application; i += 1) {
    const domain = domainFor(i);
    items.push(ci("Application", i, `${domain} application ${pad(i, 4)}`, {
      version: `${1 + (i % 6)}.${i % 12}.${i % 30}`,
      techStack: techStacks[(i - 1) % techStacks.length],
      repoUrl: `https://git.specora.dev/${domain}/application-${pad(i, 4)}`,
      deploymentMethod: i % 5 === 0 ? "serverless" : i % 3 === 0 ? "vm" : "kubernetes",
      csdmDomain: "Build & Integrate",
    }));
  }

  for (let i = 1; i <= DEMO_CI_COUNTS.Database; i += 1) {
    const dbType = dbTypes[(i - 1) % dbTypes.length];
    items.push(ci("Database", i, `${domainFor(i)}-${dbType.toLowerCase().replace(" ", "-")}-${pad(i, 4)}`, {
      dbType,
      version: dbType === "PostgreSQL" ? "16" : dbType === "Redis" ? "7" : "latest-supported",
      port: dbType === "PostgreSQL" ? 5432 : dbType === "Redis" ? 6379 : 9000 + (i % 500),
      instanceName: `inst-${pad(i, 4)}`,
      dataClassification: i % 8 === 0 ? "restricted" : i % 3 === 0 ? "confidential" : "internal",
    }));
  }

  for (let i = 1; i <= DEMO_CI_COUNTS.NetworkGear; i += 1) {
    const region = regions[(i - 1) % regions.length];
    items.push(ci("NetworkGear", i, `${region}-${deviceTypes[(i - 1) % deviceTypes.length]}-${pad(i, 4)}`, {
      ipAddress: `10.${(i % 200) + 20}.${Math.floor(i / 200) + 1}.${(i % 250) + 1}`,
      deviceType: deviceTypes[(i - 1) % deviceTypes.length],
      firmwareVersion: `v${10 + (i % 4)}.${i % 12}`,
      macAddress: `02:00:${pad(i % 99, 2)}:${pad((i * 3) % 99, 2)}:${pad((i * 7) % 99, 2)}:${pad((i * 11) % 99, 2)}`,
    }));
  }

  for (let i = 1; i <= DEMO_CI_COUNTS.Server; i += 1) {
    const env = envFor(i);
    const domain = domainFor(i);
    items.push(ci("Server", i, `${domain}-${env.toLowerCase()}-${pad(i, 4)}`, {
      ipAddress: `10.${(i % 200) + 40}.${Math.floor(i / 250) + 1}.${(i % 250) + 1}`,
      os: osNames[(i - 1) % osNames.length],
      osVersion: i % 2 === 0 ? "22.04" : "9.4",
      cpuCores: [2, 4, 8, 16, 32][i % 5],
      memoryGB: [8, 16, 32, 64, 128][i % 5],
      diskGB: [128, 256, 512, 1024, 2048][i % 5],
      fqdn: `${domain}-${env.toLowerCase()}-${pad(i, 4)}.corp.specora.dev`,
      serialNumber: `SN-${pad(i, 6)}`,
      assetTag: `AST-${pad(i, 6)}`,
    }, env));
  }

  return items;
}

export function generateDemoRelationships(): DemoRelationship[] {
  const rels: DemoRelationship[] = [];

  for (let i = 1; i <= DEMO_CI_COUNTS.User; i += 1) {
    rels.push({ sourceId: `demo-user-${pad(i)}`, targetId: `demo-group-${pad(((i - 1) % DEMO_CI_COUNTS.Group) + 1)}`, type: "PART_OF" });
  }

  for (let i = 1; i <= DEMO_CI_COUNTS.BusinessService; i += 1) {
    rels.push({ sourceId: `demo-businessservice-${pad(i)}`, targetId: `demo-user-${pad(((i - 1) % DEMO_CI_COUNTS.User) + 1)}`, type: "OWNED_BY" });
    for (let j = 0; j < 3; j += 1) {
      const appService = (((i - 1) * 3 + j) % DEMO_CI_COUNTS.ApplicationService) + 1;
      rels.push({ sourceId: `demo-businessservice-${pad(i)}`, targetId: `demo-applicationservice-${pad(appService)}`, type: "DEPENDS_ON" });
    }
  }

  for (let i = 1; i <= DEMO_CI_COUNTS.ApplicationService; i += 1) {
    rels.push({ sourceId: `demo-applicationservice-${pad(i)}`, targetId: `demo-application-${pad(((i - 1) % DEMO_CI_COUNTS.Application) + 1)}`, type: "PART_OF" });
    rels.push({ sourceId: `demo-applicationservice-${pad(i)}`, targetId: `demo-database-${pad(((i * 7) % DEMO_CI_COUNTS.Database) + 1)}`, type: "DEPENDS_ON" });
    rels.push({ sourceId: `demo-applicationservice-${pad(i)}`, targetId: `demo-technicalservice-${pad(((i - 1) % DEMO_CI_COUNTS.TechnicalService) + 1)}`, type: "HOSTED_ON" });
    if (i % 4 === 0) {
      rels.push({ sourceId: `demo-applicationservice-${pad(i)}`, targetId: `demo-applicationservice-${pad(((i + 13) % DEMO_CI_COUNTS.ApplicationService) + 1)}`, type: "DEPENDS_ON" });
    }
  }

  for (let i = 1; i <= DEMO_CI_COUNTS.Application; i += 1) {
    rels.push({ sourceId: `demo-application-${pad(i)}`, targetId: `demo-user-${pad(((i + 9) % DEMO_CI_COUNTS.User) + 1)}`, type: "OWNED_BY" });
    rels.push({ sourceId: `demo-application-${pad(i)}`, targetId: `demo-server-${pad(((i * 5) % DEMO_CI_COUNTS.Server) + 1)}`, type: "HOSTED_ON" });
  }

  for (let i = 1; i <= DEMO_CI_COUNTS.TechnicalService; i += 1) {
    rels.push({ sourceId: `demo-technicalservice-${pad(i)}`, targetId: `demo-group-${pad(((i + 3) % DEMO_CI_COUNTS.Group) + 1)}`, type: "MANAGED_BY" });
    rels.push({ sourceId: `demo-technicalservice-${pad(i)}`, targetId: `demo-networkgear-${pad(((i * 2) % DEMO_CI_COUNTS.NetworkGear) + 1)}`, type: "DEPENDS_ON" });
  }

  for (let i = 1; i <= DEMO_CI_COUNTS.Database; i += 1) {
    rels.push({ sourceId: `demo-database-${pad(i)}`, targetId: `demo-server-${pad(((i * 3) % DEMO_CI_COUNTS.Server) + 1)}`, type: "HOSTED_ON" });
    rels.push({ sourceId: `demo-database-${pad(i)}`, targetId: `demo-group-${pad(((i + 6) % DEMO_CI_COUNTS.Group) + 1)}`, type: "MANAGED_BY" });
  }

  for (let i = 1; i <= DEMO_CI_COUNTS.NetworkGear; i += 1) {
    rels.push({ sourceId: `demo-networkgear-${pad(i)}`, targetId: `demo-location-${pad(((i - 1) % DEMO_CI_COUNTS.Location) + 1)}`, type: "LOCATED_AT" });
    rels.push({ sourceId: `demo-networkgear-${pad(i)}`, targetId: `demo-group-${pad(((i + 8) % DEMO_CI_COUNTS.Group) + 1)}`, type: "MANAGED_BY" });
  }

  for (let i = 1; i <= DEMO_CI_COUNTS.Server; i += 1) {
    rels.push({ sourceId: `demo-server-${pad(i)}`, targetId: `demo-location-${pad(((i - 1) % DEMO_CI_COUNTS.Location) + 1)}`, type: "LOCATED_AT" });
    rels.push({ sourceId: `demo-server-${pad(i)}`, targetId: `demo-group-${pad(((i + 10) % DEMO_CI_COUNTS.Group) + 1)}`, type: "MANAGED_BY" });
    rels.push({ sourceId: `demo-server-${pad(i)}`, targetId: `demo-networkgear-${pad(((i * 11) % DEMO_CI_COUNTS.NetworkGear) + 1)}`, type: "DEPENDS_ON" });
  }

  return rels;
}
