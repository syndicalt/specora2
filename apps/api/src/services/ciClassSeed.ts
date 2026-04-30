import type { Pool } from "pg";

type BuiltInClassAttribute = {
  name: string;
  displayName: string;
  description?: string | null;
  attrType: string;
  isMandatory: boolean;
  isHealthRequired: boolean;
  isKeyAttribute: boolean;
  defaultValue?: string | null;
  validationRegex?: string | null;
  enumValues?: string[];
  referenceClass?: string;
  sortOrder: number;
};

type BuiltInClass = {
  name: string;
  displayName: string;
  description: string;
  parentClass: string | null;
  icon: string;
  color: string;
  attributes: BuiltInClassAttribute[];
};

const BUILT_IN_CLASSES: BuiltInClass[] = [
  {
    name: "Server",
    displayName: "Server / VM",
    description: "Physical or virtual compute resource",
    parentClass: null,
    icon: "Server",
    color: "#22c55e",
    attributes: [
      { name: "ipAddress", displayName: "IP Address", attrType: "string", isMandatory: true, isHealthRequired: false, isKeyAttribute: true, sortOrder: 1 },
      { name: "os", displayName: "Operating System", attrType: "string", isMandatory: false, isHealthRequired: true, isKeyAttribute: true, sortOrder: 2 },
      { name: "osVersion", displayName: "OS Version", attrType: "string", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, sortOrder: 3 },
      { name: "cpuCores", displayName: "CPU Cores", attrType: "number", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, sortOrder: 4 },
      { name: "memoryGB", displayName: "Memory (GB)", attrType: "number", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, sortOrder: 5 },
      { name: "diskGB", displayName: "Disk (GB)", attrType: "number", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, sortOrder: 6 },
      { name: "fqdn", displayName: "FQDN", attrType: "string", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, sortOrder: 7 },
      { name: "serialNumber", displayName: "Serial Number", attrType: "string", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, sortOrder: 8 },
      { name: "assetTag", displayName: "Asset Tag", attrType: "string", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, sortOrder: 9 },
    ],
  },
  {
    name: "Computer",
    displayName: "Computer",
    description: "End-user laptop, desktop, or workstation device",
    parentClass: null,
    icon: "Laptop",
    color: "#06b6d4",
    attributes: [
      { name: "ipAddress", displayName: "IP Address", attrType: "string", isMandatory: true, isHealthRequired: false, isKeyAttribute: true, sortOrder: 1 },
      { name: "os", displayName: "Operating System", attrType: "string", isMandatory: false, isHealthRequired: true, isKeyAttribute: true, sortOrder: 2 },
      { name: "osVersion", displayName: "OS Version", attrType: "string", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, sortOrder: 3 },
      { name: "deviceType", displayName: "Device Type", attrType: "enum", isMandatory: false, isHealthRequired: true, isKeyAttribute: true, enumValues: ["laptop", "desktop", "workstation", "tablet", "thin_client", "unknown"], sortOrder: 4 },
      { name: "assignedUser", displayName: "Assigned User", attrType: "reference", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, referenceClass: "User", sortOrder: 5 },
      { name: "serialNumber", displayName: "Serial Number", attrType: "string", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, sortOrder: 6 },
      { name: "assetTag", displayName: "Asset Tag", attrType: "string", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, sortOrder: 7 },
      { name: "memoryGB", displayName: "Memory (GB)", attrType: "number", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, sortOrder: 8 },
    ],
  },
  {
    name: "Database",
    displayName: "Database",
    description: "Database instance or cluster",
    parentClass: null,
    icon: "Database",
    color: "#14b8a6",
    attributes: [
      { name: "dbType", displayName: "Database Type", attrType: "enum", isMandatory: true, isHealthRequired: false, isKeyAttribute: true, enumValues: ["PostgreSQL", "MySQL", "MongoDB", "Redis", "Elasticsearch", "Oracle", "SQL Server"], sortOrder: 1 },
      { name: "version", displayName: "Version", attrType: "string", isMandatory: false, isHealthRequired: true, isKeyAttribute: true, sortOrder: 2 },
      { name: "port", displayName: "Port", attrType: "number", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, sortOrder: 3 },
      { name: "instanceName", displayName: "Instance Name", attrType: "string", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, sortOrder: 4 },
    ],
  },
  {
    name: "BusinessService",
    displayName: "Business Service",
    description: "Service delivered to business customers",
    parentClass: null,
    icon: "Globe",
    color: "#f59e0b",
    attributes: [
      { name: "serviceOwnerId", displayName: "Service Owner", attrType: "reference", isMandatory: true, isHealthRequired: false, isKeyAttribute: false, referenceClass: "User", sortOrder: 1 },
      { name: "criticality", displayName: "Criticality", attrType: "enum", isMandatory: false, isHealthRequired: true, isKeyAttribute: true, enumValues: ["1", "2", "3", "4", "5"], sortOrder: 2 },
      { name: "slaClass", displayName: "SLA Class", attrType: "string", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, sortOrder: 3 },
      { name: "retirementDate", displayName: "Retirement Date", attrType: "date", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, sortOrder: 4 },
    ],
  },
  {
    name: "Application",
    displayName: "Application",
    description: "End-user facing application",
    parentClass: null,
    icon: "Cpu",
    color: "#8b5cf6",
    attributes: [
      { name: "version", displayName: "Version", attrType: "string", isMandatory: true, isHealthRequired: false, isKeyAttribute: true, sortOrder: 1 },
      { name: "techStack", displayName: "Tech Stack", attrType: "string", isMandatory: false, isHealthRequired: true, isKeyAttribute: true, sortOrder: 2 },
      { name: "repoUrl", displayName: "Repository URL", attrType: "string", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, sortOrder: 3 },
      { name: "deploymentMethod", displayName: "Deployment Method", attrType: "enum", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, enumValues: ["docker", "kubernetes", "vm", "serverless", "static"], sortOrder: 4 },
    ],
  },
  {
    name: "ApplicationService",
    displayName: "Application Service",
    description: "Backend service or API",
    parentClass: null,
    icon: "Layers",
    color: "#6366f1",
    attributes: [
      { name: "availabilityTarget", displayName: "Availability Target", attrType: "string", isMandatory: false, isHealthRequired: true, isKeyAttribute: true, sortOrder: 1 },
      { name: "supportHours", displayName: "Support Hours", attrType: "string", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, sortOrder: 2 },
    ],
  },
  {
    name: "TechnicalService",
    displayName: "Technical Service",
    description: "Infrastructure or platform service",
    parentClass: null,
    icon: "Radio",
    color: "#0ea5e9",
    attributes: [
      { name: "serviceType", displayName: "Service Type", attrType: "enum", isMandatory: true, isHealthRequired: false, isKeyAttribute: true, enumValues: ["load_balancer", "cache", "queue", "dns", "cdn", "logging", "monitoring"], sortOrder: 1 },
      { name: "endpointUrl", displayName: "Endpoint URL", attrType: "string", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, sortOrder: 2 },
      { name: "healthCheckUrl", displayName: "Health Check URL", attrType: "string", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, sortOrder: 3 },
    ],
  },
  {
    name: "NetworkGear",
    displayName: "Network Gear",
    description: "Network infrastructure device",
    parentClass: null,
    icon: "Activity",
    color: "#f97316",
    attributes: [
      { name: "ipAddress", displayName: "IP Address", attrType: "string", isMandatory: true, isHealthRequired: false, isKeyAttribute: true, sortOrder: 1 },
      { name: "deviceType", displayName: "Device Type", attrType: "enum", isMandatory: false, isHealthRequired: true, isKeyAttribute: true, enumValues: ["switch", "router", "firewall", "load_balancer", "vpn_gateway", "appliance"], sortOrder: 2 },
      { name: "firmwareVersion", displayName: "Firmware Version", attrType: "string", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, sortOrder: 3 },
      { name: "macAddress", displayName: "MAC Address", attrType: "string", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, sortOrder: 4 },
    ],
  },
  {
    name: "User",
    displayName: "User",
    description: "ITSM user or employee",
    parentClass: null,
    icon: "Users",
    color: "#ec4899",
    attributes: [
      { name: "email", displayName: "Email", attrType: "string", isMandatory: true, isHealthRequired: false, isKeyAttribute: true, sortOrder: 1 },
      { name: "departmentId", displayName: "Department", attrType: "reference", isMandatory: false, isHealthRequired: true, isKeyAttribute: true, referenceClass: "Department", sortOrder: 2 },
      { name: "managerId", displayName: "Manager", attrType: "reference", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, referenceClass: "User", sortOrder: 3 },
      { name: "costCenterId", displayName: "Cost Center", attrType: "reference", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, referenceClass: "CostCenter", sortOrder: 4 },
      { name: "phone", displayName: "Phone", attrType: "string", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, sortOrder: 5 },
      { name: "title", displayName: "Title", attrType: "string", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, sortOrder: 6 },
    ],
  },
  {
    name: "Department",
    displayName: "Department",
    description: "Organizational department or function",
    parentClass: null,
    icon: "Building2",
    color: "#38bdf8",
    attributes: [
      { name: "departmentCode", displayName: "Department Code", attrType: "string", isMandatory: false, isHealthRequired: true, isKeyAttribute: true, sortOrder: 1 },
      { name: "managerId", displayName: "Manager", attrType: "reference", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, referenceClass: "User", sortOrder: 2 },
      { name: "parentDepartmentId", displayName: "Parent Department", attrType: "reference", isMandatory: false, isHealthRequired: false, isKeyAttribute: false, referenceClass: "Department", sortOrder: 3 },
      { name: "costCenterId", displayName: "Cost Center", attrType: "reference", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, referenceClass: "CostCenter", sortOrder: 4 },
    ],
  },
  {
    name: "CostCenter",
    displayName: "Cost Center",
    description: "Financial cost center used for ownership, chargeback, and reporting",
    parentClass: null,
    icon: "BadgeDollarSign",
    color: "#22c55e",
    attributes: [
      { name: "code", displayName: "Code", attrType: "string", isMandatory: true, isHealthRequired: false, isKeyAttribute: true, sortOrder: 1 },
      { name: "ownerId", displayName: "Owner", attrType: "reference", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, referenceClass: "User", sortOrder: 2 },
      { name: "departmentId", displayName: "Department", attrType: "reference", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, referenceClass: "Department", sortOrder: 3 },
      { name: "status", displayName: "Status", attrType: "enum", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, enumValues: ["active", "inactive"], sortOrder: 4 },
    ],
  },
  {
    name: "Group",
    displayName: "Group",
    description: "User group or team",
    parentClass: null,
    icon: "Shield",
    color: "#6b7280",
    attributes: [
      { name: "groupType", displayName: "Group Type", attrType: "enum", isMandatory: true, isHealthRequired: false, isKeyAttribute: true, enumValues: ["assignment", "approval", "notification", "security", "functional"], sortOrder: 1 },
      { name: "managerId", displayName: "Manager", attrType: "reference", isMandatory: false, isHealthRequired: true, isKeyAttribute: true, referenceClass: "User", sortOrder: 2 },
      { name: "email", displayName: "Group Email", attrType: "string", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, sortOrder: 3 },
    ],
  },
  {
    name: "Location",
    displayName: "Location",
    description: "Physical or cloud location",
    parentClass: null,
    icon: "MapPin",
    color: "#84cc16",
    attributes: [
      { name: "locationType", displayName: "Location Type", attrType: "enum", isMandatory: true, isHealthRequired: false, isKeyAttribute: true, enumValues: ["datacenter", "office", "cloud_region", "cloud_zone", "rack", "edge"], sortOrder: 1 },
      { name: "region", displayName: "Region", attrType: "string", isMandatory: false, isHealthRequired: true, isKeyAttribute: true, sortOrder: 2 },
      { name: "address", displayName: "Address", attrType: "string", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, sortOrder: 3 },
      { name: "city", displayName: "City", attrType: "string", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, sortOrder: 4 },
      { name: "country", displayName: "Country", attrType: "string", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, sortOrder: 5 },
      { name: "timezone", displayName: "Timezone", attrType: "string", isMandatory: false, isHealthRequired: true, isKeyAttribute: false, sortOrder: 6 },
    ],
  },
];

export async function seedCIClasses(pg: Pool) {
  const client = await pg.connect();
  try {
    // Check if already seeded
    const existing = await client.query("SELECT COUNT(*) as count FROM ci_classes");
    if (parseInt(existing.rows[0].count, 10) > 0) {
      return;
    }

    for (const cls of BUILT_IN_CLASSES) {
      const classResult = await client.query(
        `INSERT INTO ci_classes (name, display_name, description, parent_class, icon, color, is_system)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         RETURNING id`,
        [cls.name, cls.displayName, cls.description, cls.parentClass, cls.icon, cls.color]
      );
      const classId = classResult.rows[0].id;

        for (const attr of cls.attributes) {
        await client.query(
          `INSERT INTO ci_class_attributes
           (class_id, name, display_name, description, attr_type, is_mandatory, is_health_required, is_key_attribute, default_value, validation_regex, enum_values, reference_class, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            classId, attr.name, attr.displayName, attr.description || null,
            attr.attrType, attr.isMandatory, attr.isHealthRequired,
            attr.isKeyAttribute, attr.defaultValue || null,
            attr.validationRegex || null, attr.enumValues || null,
            attr.referenceClass || null, attr.sortOrder,
          ]
        );
      }
    }

    console.log("CI classes seeded successfully");
  } catch (err) {
    console.error("Failed to seed CI classes:", err);
  } finally {
    client.release();
  }
}
