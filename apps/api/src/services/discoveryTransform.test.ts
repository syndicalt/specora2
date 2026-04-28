import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDeterministicProposal, previewPipeline, proposeTransform } from "./discoveryTransform";

const originalEnv = process.env;

afterEach(() => {
  process.env = originalEnv;
  vi.restoreAllMocks();
});

describe("buildDeterministicProposal", () => {
  it("routes host-shaped data to server with useful transforms", () => {
    const proposal = buildDeterministicProposal(
      {
        sourceName: "inventory.csv",
        columns: ["hostname", "ip_addr", "os", "environment", "business_owner"],
        sampleRows: [{ hostname: "APP01", ip_addr: "10.0.0.5", os: "Linux", environment: "Prod" }],
      },
      [{ name: "Server" }, { name: "ApplicationService" }, { name: "Group" }]
    );

    expect(proposal.aiGenerated).toBe(false);
    expect(proposal.classRoutes[0].targetClass).toBe("Server");
    expect(proposal.fieldMappings).toContainEqual(expect.objectContaining({
      sourceField: "hostname",
      targetField: "name",
      transform: "trim_lowercase",
      rationale: expect.stringContaining("name"),
      evidence: expect.arrayContaining(["APP01"]),
    }));
    expect(proposal.fieldMappings.find((mapping) => mapping.sourceField === "hostname")?.alternatives?.length).toBeGreaterThan(0);
    expect(proposal.reconciliationRules[0].matchKeys).toContain("name");
    expect(proposal.relationshipRules).toContainEqual(expect.objectContaining({
      toClass: "Group",
      type: "OWNED_BY",
      rationale: expect.stringContaining("Owner"),
      evidence: expect.any(Array),
    }));
  });

  it("detects database relationships from source columns", () => {
    const proposal = buildDeterministicProposal(
      {
        sourceName: "apps",
        columns: ["app_name", "db_host", "environment"],
        sampleRows: [{ app_name: "Billing", db_host: "sql01" }],
      },
      [{ name: "ApplicationService" }, { name: "Database" }]
    );

    expect(proposal.classRoutes.map((route) => route.targetClass)).toContain("ApplicationService");
    expect(proposal.relationshipRules).toContainEqual(expect.objectContaining({
      toClass: "Database",
      type: "DEPENDS_ON",
      sourceField: "db_host",
    }));
  });

  it("does not let relationship hint columns overwrite the primary CI name", () => {
    const proposal = buildDeterministicProposal(
      {
        sourceName: "server-app-inventory.csv",
        columns: ["hostname", "ip_addr", "os", "app_name", "db_host", "environment", "business_owner"],
        sampleRows: [{ hostname: "web01", ip_addr: "10.20.1.15", os: "Ubuntu", app_name: "Billing Portal", db_host: "sql01", environment: "Production", business_owner: "Finance Apps" }],
      },
      [{ name: "Server" }, { name: "Database" }, { name: "ApplicationService" }, { name: "Group" }]
    );

    const nameMappings = proposal.fieldMappings.filter((mapping) => mapping.targetClass === "Server" && mapping.targetField === "name");
    expect(nameMappings).toHaveLength(1);
    expect(nameMappings[0].sourceField).toBe("hostname");

    const preview = previewPipeline({ sample: { rows: proposal.sourceProfile.sampleRows }, proposal }, [{ name: "Server" }]);
    expect(preview.records.find((record) => record.targetClass === "Server")).toMatchObject({ name: "web01" });
    expect(preview.relationships).toContainEqual(expect.objectContaining({ sourceField: "db_host", targetHint: "sql01" }));
  });

  it("previews staged records and relationship candidates", () => {
    const proposal = buildDeterministicProposal(
      {
        sourceName: "apps",
        columns: ["hostname", "ip_addr", "environment", "business_owner"],
        sampleRows: [{ hostname: "WEB01", ip_addr: "10.0.0.1", environment: "prod", business_owner: "Platform" }],
      },
      [{ name: "Server", attributes: [{ name: "ipAddress", isMandatory: true }] }]
    );

    const preview = previewPipeline({
      sample: { rows: proposal.sourceProfile.sampleRows },
      proposal,
    }, [{ name: "Server", attributes: [{ name: "ipAddress", isMandatory: true }] }]);

    expect(preview.summary).toMatchObject({ rows: 1, stagedRecords: 1, relationshipCandidates: 1, errors: 0 });
    expect(preview.records[0]).toMatchObject({
      targetClass: "Server",
      name: "web01",
      environment: "Production",
      attributes: expect.objectContaining({ ipAddress: "10.0.0.1" }),
    });
    expect(preview.relationships[0]).toMatchObject({ type: "OWNED_BY", targetHint: "Platform" });
  });

  it("previews edge collector bundles as host records enriched with related observations", () => {
    const entityProfiles = [
      {
        entityType: "host",
        recordCount: 1,
        columns: ["entity_type", "natural_key", "hostname", "name", "version"],
        sampleRows: [{ entity_type: "host", natural_key: "nb-lenovo", hostname: "nb-lenovo", name: "Pop!_OS", version: "24.04 LTS" }],
      },
      {
        entityType: "network_interface",
        recordCount: 1,
        columns: ["entity_type", "natural_key", "interface", "address"],
        sampleRows: [{ entity_type: "network_interface", natural_key: "nb-lenovo:wlp0s20f3:10.0.0.22", interface: "wlp0s20f3", address: "10.0.0.22" }],
      },
      {
        entityType: "software_package",
        recordCount: 1,
        columns: ["entity_type", "natural_key", "name", "version"],
        sampleRows: [{ entity_type: "software_package", natural_key: "nb-lenovo:docker:24.0", name: "docker", version: "24.0" }],
      },
      {
        entityType: "service",
        recordCount: 1,
        columns: ["entity_type", "natural_key", "name", "state", "status"],
        sampleRows: [{ entity_type: "service", natural_key: "nb-lenovo:docker.service", name: "docker.service", state: "running", status: "active" }],
      },
    ];
    const proposal = buildDeterministicProposal(
      {
        sourceName: "edge collector",
        entityType: "host",
        recordCount: 1,
        columns: entityProfiles[0].columns,
        sampleRows: entityProfiles[0].sampleRows,
        entityProfiles,
      },
      [{ name: "Server", attributes: [{ name: "ipAddress", isMandatory: true }] }, { name: "ApplicationService" }]
    );

    const preview = previewPipeline({ sample: { rows: entityProfiles[0].sampleRows }, entityProfiles, proposal }, [
      { name: "Server", attributes: [{ name: "ipAddress", isMandatory: true }] },
      { name: "ApplicationService" },
    ]);

    expect(preview.summary.errors).toBe(0);
    expect(preview.records).toContainEqual(expect.objectContaining({
      targetClass: "Server",
      name: "nb-lenovo",
      attributes: expect.objectContaining({
        ipAddress: "10.0.0.22",
        installedSoftware: expect.arrayContaining([expect.objectContaining({ name: "docker" })]),
        services: expect.arrayContaining([expect.objectContaining({ name: "docker.service" })]),
      }),
    }));
    expect(preview.records).toContainEqual(expect.objectContaining({ targetClass: "ApplicationService", name: "docker.service" }));
    expect(preview.relationships).toContainEqual(expect.objectContaining({ fromClass: "ApplicationService", toClass: "Server", targetHint: "nb-lenovo" }));
  });

  it("flags preview records that are missing mandatory values", () => {
    const proposal = buildDeterministicProposal(
      {
        sourceName: "servers",
        columns: ["hostname"],
        sampleRows: [{ hostname: "web01" }],
      },
      [{ name: "Server", attributes: [{ name: "serialNumber", isMandatory: true }] }]
    );

    const preview = previewPipeline({ sample: { rows: proposal.sourceProfile.sampleRows }, proposal }, [
      { name: "Server", attributes: [{ name: "serialNumber", isMandatory: true }] },
    ]);

    expect(preview.summary.errors).toBe(1);
    expect(preview.records[0].errors).toContain("Missing mandatory field serialNumber");
  });

  it("routes Discovery AI through the configured Provara transform model", async () => {
    process.env = {
      ...originalEnv,
      PROVARA_URL: "https://provara.test/v1",
      PROVARA_API_KEY: "pk_test",
      DISCOVERY_PROVARA_MODEL: "provara-cmdb-transform",
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              title: "Inventory transform",
              summary: "Map inventory rows to servers",
              confidence: 0.91,
              classRoutes: [{ sourcePattern: "*", targetClass: "Server", confidence: 0.9, rationale: "Host columns detected" }],
              fieldMappings: [{ sourceField: "hostname", targetClass: "Server", targetField: "name", transform: "trim_lowercase", confidence: 0.95 }],
              relationshipRules: [],
              reconciliationRules: [{ targetClass: "Server", matchKeys: ["name"], strategy: "create_or_update" }],
              assumptions: [],
              risks: [],
            }),
          },
        }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const proposal = await proposeTransform(
      { sourceName: "inventory", columns: ["hostname"], sampleRows: [{ hostname: "web01" }] },
      [{ name: "Server" }]
    );

    expect(proposal.aiGenerated).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("https://provara.test/v1/chat/completions", expect.objectContaining({
      method: "POST",
    }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({
      model: "provara-cmdb-transform",
      requires_structured_output: true,
    });
  });
});
