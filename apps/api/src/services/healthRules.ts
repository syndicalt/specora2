import { FastifyInstance } from "fastify";

export interface HealthRule {
  id: string;
  name: string;
  description: string;
  severity: "critical" | "warning" | "info";
  cypher: string;
}

export interface SuggestedFix {
  type: "create_relationship";
  description: string;
  sourceId: string;
  targetId?: string;
  targetClass?: string;
  relType: string;
}

export interface RuleViolation {
  ruleId: string;
  ruleName: string;
  severity: string;
  message: string;
  ciId: string;
  ciName: string;
  ciClass: string;
  suggestedFix?: SuggestedFix;
}

export const HARDCODED_RULES: HealthRule[] = [
  {
    id: "bs-missing-app",
    name: "BusinessService without ApplicationService",
    description: "Every BusinessService should have at least one ApplicationService as a child via PART_OF",
    severity: "critical",
    cypher: `
      MATCH (bs:BusinessService)
      WHERE NOT (bs)<-[:PART_OF]-(:ApplicationService)
      RETURN bs.id as ciId, bs.name as ciName, bs.class as ciClass
    `,
  },
  {
    id: "app-missing-tech",
    name: "ApplicationService without TechnicalService",
    description: "Every ApplicationService should have at least one TechnicalService dependency",
    severity: "warning",
    cypher: `
      MATCH (app:ApplicationService)
      WHERE NOT (app)-[:DEPENDS_ON]-(:TechnicalService)
      RETURN app.id as ciId, app.name as ciName, app.class as ciClass
    `,
  },
  {
    id: "db-not-hosted",
    name: "Database not hosted on Server",
    description: "Every Database should be HOSTED_ON a Server",
    severity: "critical",
    cypher: `
      MATCH (db:Database)
      WHERE NOT (db)-[:HOSTED_ON]->(:Server)
      RETURN db.id as ciId, db.name as ciName, db.class as ciClass
    `,
  },
  {
    id: "app-not-hosted",
    name: "Application not hosted on Server",
    description: "Every Application should be HOSTED_ON a Server",
    severity: "critical",
    cypher: `
      MATCH (app:Application)
      WHERE NOT (app)-[:HOSTED_ON]->(:Server)
      RETURN app.id as ciId, app.name as ciName, app.class as ciClass
    `,
  },
  {
    id: "server-unmanaged",
    name: "Server without management relationship",
    description: "Every Server should have a MANAGED_BY relationship to a User or Group",
    severity: "warning",
    cypher: `
      MATCH (s:Server)
      WHERE NOT (s)-[:MANAGED_BY]-(:User OR :Group)
      RETURN s.id as ciId, s.name as ciName, s.class as ciClass
    `,
  },
  {
    id: "bs-no-owner",
    name: "BusinessService without owner",
    description: "Every BusinessService should have an OWNED_BY relationship",
    severity: "warning",
    cypher: `
      MATCH (bs:BusinessService)
      WHERE NOT (bs)-[:OWNED_BY]-()
      RETURN bs.id as ciId, bs.name as ciName, bs.class as ciClass
    `,
  },
  {
    id: "orphaned-cis",
    name: "Orphaned Configuration Items",
    description: "CIs with zero relationships are isolated and likely incomplete",
    severity: "info",
    cypher: `
      MATCH (n:ConfigurationItem)
      WHERE NOT (n)-[:PART_OF|DEPENDS_ON|HOSTED_ON|MANAGED_BY|OWNED_BY|LOCATED_AT]-()
      RETURN n.id as ciId, n.name as ciName, n.class as ciClass
    `,
  },
  {
    id: "network-gear-no-location",
    name: "NetworkGear without location",
    description: "NetworkGear should have a LOCATED_AT relationship",
    severity: "info",
    cypher: `
      MATCH (ng:NetworkGear)
      WHERE NOT (ng)-[:LOCATED_AT]-(:Location)
      RETURN ng.id as ciId, ng.name as ciName, ng.class as ciClass
    `,
  },
];

async function findFixTarget(
  session: any,
  ruleId: string,
  ciId: string,
  _ciClass: string
): Promise<SuggestedFix | undefined> {
  try {
    switch (ruleId) {
      case "bs-missing-app": {
        // Suggest finding an ApplicationService to link via PART_OF
        const result = await session.run(
          `MATCH (app:ApplicationService) RETURN app.id as id, app.name as name LIMIT 1`
        );
        if (result.records.length) {
          return {
            type: "create_relationship",
            description: `Link BusinessService to ApplicationService "${result.records[0].get("name")}" via PART_OF`,
            sourceId: result.records[0].get("id"),
            targetId: ciId,
            relType: "PART_OF",
          };
        }
        break;
      }
      case "app-missing-tech": {
        const result = await session.run(
          `MATCH (ts:TechnicalService) RETURN ts.id as id, ts.name as name LIMIT 1`
        );
        if (result.records.length) {
          return {
            type: "create_relationship",
            description: `Link ApplicationService to TechnicalService "${result.records[0].get("name")}" via DEPENDS_ON`,
            sourceId: ciId,
            targetId: result.records[0].get("id"),
            relType: "DEPENDS_ON",
          };
        }
        break;
      }
      case "db-not-hosted": {
        const result = await session.run(
          `MATCH (s:Server) RETURN s.id as id, s.name as name LIMIT 1`
        );
        if (result.records.length) {
          return {
            type: "create_relationship",
            description: `Host Database on Server "${result.records[0].get("name")}" via HOSTED_ON`,
            sourceId: ciId,
            targetId: result.records[0].get("id"),
            relType: "HOSTED_ON",
          };
        }
        break;
      }
      case "app-not-hosted": {
        const result = await session.run(
          `MATCH (s:Server) RETURN s.id as id, s.name as name LIMIT 1`
        );
        if (result.records.length) {
          return {
            type: "create_relationship",
            description: `Host Application on Server "${result.records[0].get("name")}" via HOSTED_ON`,
            sourceId: ciId,
            targetId: result.records[0].get("id"),
            relType: "HOSTED_ON",
          };
        }
        break;
      }
      case "server-unmanaged": {
        const result = await session.run(
          `MATCH (u:User) RETURN u.id as id, u.name as name LIMIT 1`
        );
        if (result.records.length) {
          return {
            type: "create_relationship",
            description: `Assign User "${result.records[0].get("name")}" as manager via MANAGED_BY`,
            sourceId: ciId,
            targetId: result.records[0].get("id"),
            relType: "MANAGED_BY",
          };
        }
        break;
      }
      case "bs-no-owner": {
        const result = await session.run(
          `MATCH (u:User) RETURN u.id as id, u.name as name LIMIT 1`
        );
        if (result.records.length) {
          return {
            type: "create_relationship",
            description: `Assign User "${result.records[0].get("name")}" as owner via OWNED_BY`,
            sourceId: ciId,
            targetId: result.records[0].get("id"),
            relType: "OWNED_BY",
          };
        }
        break;
      }
      case "network-gear-no-location": {
        const result = await session.run(
          `MATCH (loc:Location) RETURN loc.id as id, loc.name as name LIMIT 1`
        );
        if (result.records.length) {
          return {
            type: "create_relationship",
            description: `Place NetworkGear at Location "${result.records[0].get("name")}" via LOCATED_AT`,
            sourceId: ciId,
            targetId: result.records[0].get("id"),
            relType: "LOCATED_AT",
          };
        }
        break;
      }
    }
  } catch {
    // Silently skip if fix lookup fails
  }
  return undefined;
}

export async function runHardcodedRules(fastify: FastifyInstance): Promise<RuleViolation[]> {
  const violations: RuleViolation[] = [];
  const session = fastify.neo4j.session();

  try {
    for (const rule of HARDCODED_RULES) {
      try {
        const result = await session.run(rule.cypher);
        for (const record of result.records) {
          const ciId = record.get("ciId");
          const ciName = record.get("ciName");
          const ciClass = record.get("ciClass");
          const suggestedFix = await findFixTarget(session, rule.id, ciId, ciClass);
          violations.push({
            ruleId: rule.id,
            ruleName: rule.name,
            severity: rule.severity,
            message: rule.description,
            ciId,
            ciName,
            ciClass,
            suggestedFix,
          });
        }
      } catch (err: any) {
        fastify.log.warn({ ruleId: rule.id, error: err.message }, "Health rule query failed");
        // Continue with other rules if one fails
      }
    }
  } finally {
    await session.close();
  }

  return violations;
}
