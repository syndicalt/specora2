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

  it("does not let duplicate host name or IP mappings overwrite durable host identity", () => {
    const proposal = buildDeterministicProposal(
      {
        sourceName: "edge host",
        columns: ["entity_type", "natural_key", "hostname", "name", "ipAddress", "ipAddresses"],
        sampleRows: [{
          entity_type: "host",
          natural_key: "nb-lenovo",
          hostname: "nb-lenovo",
          name: "Pop!_OS",
          ipAddress: "192.168.50.146",
          ipAddresses: "fe80::389b:a0ff:fe54:42e2%veth550dc8f",
        }],
      },
      [{ name: "Computer", attributes: [{ name: "ipAddress", isMandatory: true }] }, { name: "Server" }]
    );

    expect(proposal.fieldMappings).toContainEqual(expect.objectContaining({ sourceField: "hostname", targetField: "name" }));
    expect(proposal.fieldMappings).toContainEqual(expect.objectContaining({ sourceField: "name", targetField: "operatingSystem" }));
    expect(proposal.fieldMappings).toContainEqual(expect.objectContaining({ sourceField: "ipAddresses", targetField: "ipAddresses" }));

    const preview = previewPipeline({ sample: { rows: proposal.sourceProfile.sampleRows }, proposal }, [
      { name: "Computer", attributes: [{ name: "ipAddress", isMandatory: true }] },
    ]);

    expect(preview.records[0]).toMatchObject({
      targetClass: "Computer",
      name: "nb-lenovo",
      attributes: expect.objectContaining({
        ipAddress: "192.168.50.146",
        operatingSystem: "Pop!_OS",
        ipAddresses: "fe80::389b:a0ff:fe54:42e2%veth550dc8f",
      }),
    });
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
        columns: ["entity_type", "natural_key", "hostname", "name", "version", "physical_memory", "hardware_vendor", "hardware_model", "hardware_serial"],
        sampleRows: [{ entity_type: "host", natural_key: "nb-lenovo", hostname: "nb-lenovo", name: "Pop!_OS", version: "24.04 LTS", physical_memory: 17179869184, hardware_vendor: "Lenovo", hardware_model: "ThinkPad", hardware_serial: "SN123" }],
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
        columns: ["entity_type", "natural_key", "id", "sub_state", "active_state", "unit_file_state"],
        sampleRows: [{ entity_type: "service", natural_key: "nb-lenovo:docker.service", id: "docker.service", sub_state: "running", active_state: "active", unit_file_state: "enabled" }],
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
        services: expect.arrayContaining([expect.objectContaining({ name: "docker.service", state: "running", status: "active", startType: "enabled" })]),
        serialNumber: "SN123",
        manufacturer: "Lenovo",
        model: "ThinkPad",
        memoryGB: 16,
        healthSummary: expect.objectContaining({ totalServices: 1, runningServices: 1, failedServices: 0, enabledServices: 1, posture: "healthy" }),
      }),
    }));
    expect(preview.records).toContainEqual(expect.objectContaining({ targetClass: "ApplicationService", name: "docker.service" }));
    expect(preview.relationships).toContainEqual(expect.objectContaining({ fromClass: "ApplicationService", toClass: "Server", targetHint: "nb-lenovo" }));
    expect(preview.relationships).not.toContainEqual(expect.objectContaining({ toClass: "NetworkGear" }));
    expect(preview.relationships).not.toContainEqual(expect.objectContaining({ sourceField: "service.name", targetHint: "docker.service" }));
  });

  it("routes endpoint-like edge hosts to Computer when the class is available", () => {
    const entityProfiles = [
      {
        entityType: "host",
        recordCount: 1,
        columns: ["entity_type", "natural_key", "hostname", "name", "version", "ipAddress"],
        sampleRows: [{ entity_type: "host", natural_key: "nb-lenovo", hostname: "nb-lenovo", name: "Pop!_OS", version: "24.04 LTS", ipAddress: "192.168.50.146" }],
      },
      {
        entityType: "network_interface",
        recordCount: 1,
        columns: ["entity_type", "natural_key", "interface", "address"],
        sampleRows: [{ entity_type: "network_interface", natural_key: "nb-lenovo:wlp0s20f3:192.168.50.146", interface: "wlp0s20f3", address: "192.168.50.146" }],
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
      [{ name: "Computer", attributes: [{ name: "ipAddress", isMandatory: true }] }, { name: "Server", attributes: [{ name: "ipAddress", isMandatory: true }] }]
    );

    expect(proposal.classRoutes[0].targetClass).toBe("Computer");
    expect(proposal.classRoutes.map((route) => route.targetClass)).toEqual(["Computer"]);
    expect(proposal.reconciliationRules.map((rule) => rule.targetClass)).toEqual(["Computer"]);
    expect(proposal.relationshipRules).toHaveLength(0);
    expect(proposal.assumptions).toContain("Endpoint/workstation signals were present, so the host profile is routed to Computer instead of Server.");

    const preview = previewPipeline({ sample: { rows: entityProfiles[0].sampleRows }, entityProfiles, proposal }, [
      { name: "Computer", attributes: [{ name: "ipAddress", isMandatory: true }] },
      { name: "Server", attributes: [{ name: "ipAddress", isMandatory: true }] },
    ]);

    expect(preview.records).toContainEqual(expect.objectContaining({
      targetClass: "Computer",
      name: "nb-lenovo",
      attributes: expect.objectContaining({ ipAddress: "192.168.50.146", deviceType: "workstation" }),
    }));
    expect(preview.records).not.toContainEqual(expect.objectContaining({ targetClass: "Server", name: "nb-lenovo" }));
  });

  it("maps flattened edge host hardware facts into canonical computer attributes", () => {
    const row = {
      entity_type: "host",
      natural_key: "nb-lenovo",
      observed_at: "2026-04-28T14:52:15.923Z",
      uuid: "af6082bb-8d8d-11ed-80f3-e880883eb64b",
      cpu_type: "x86_64",
      hostname: "nb-lenovo",
      board_model: "LNVNB161216",
      board_serial: "PF47W7CH",
      board_vendor: "LENOVO",
      computer_name: "nb-lenovo",
      hardware_model: "Lenovo Slim 7 ProX 14IAH7",
      local_hostname: "nb-lenovo",
      hardware_serial: "PF47W7CH",
      hardware_vendor: "LENOVO",
      physical_memory: "33359740928",
      hardware_version: "82V1",
      name: "Pop!_OS",
      major: "24",
      minor: "4",
      patch: "0",
      version: "24.04 LTS",
      platform: "pop",
      ipAddress: "10.74.214.87",
      ipAddresses: "fe80::1,10.74.214.87",
    };
    const columns = Object.keys(row);
    const proposal = buildDeterministicProposal(
      { sourceName: "edge collector", entityType: "host", recordCount: 1, columns, sampleRows: [row] },
      [{ name: "Computer", attributes: [{ name: "ipAddress", isMandatory: true }] }, { name: "Server" }]
    );

    expect(proposal.fieldMappings).toContainEqual(expect.objectContaining({ sourceField: "hardware_model", targetField: "model" }));
    expect(proposal.fieldMappings).toContainEqual(expect.objectContaining({ sourceField: "hardware_vendor", targetField: "manufacturer" }));
    expect(proposal.fieldMappings).toContainEqual(expect.objectContaining({ sourceField: "ipAddress", targetField: "ipAddress" }));

    const preview = previewPipeline({ sample: { rows: [row] }, proposal }, [
      { name: "Computer", attributes: [{ name: "ipAddress", isMandatory: true }] },
      { name: "Server" },
    ]);
    expect(preview.records[0]).toMatchObject({
      targetClass: "Computer",
      name: "nb-lenovo",
      attributes: expect.objectContaining({
        ipAddress: "10.74.214.87",
        serialNumber: "PF47W7CH",
        manufacturer: "LENOVO",
        model: "Lenovo Slim 7 ProX 14IAH7",
        hardwareVersion: "82V1",
        memoryGB: 31.1,
        operatingSystem: "Pop!_OS",
      }),
    });
  });

  it("suppresses unsafe model-generated edge relationship rules", () => {
    const entityProfiles = [
      {
        entityType: "host",
        recordCount: 1,
        columns: ["entity_type", "natural_key", "hostname"],
        sampleRows: [{ entity_type: "host", natural_key: "nb-lenovo", hostname: "nb-lenovo" }],
      },
      {
        entityType: "network_interface",
        recordCount: 1,
        columns: ["entity_type", "natural_key", "interface", "address"],
        sampleRows: [{ entity_type: "network_interface", natural_key: "nb-lenovo:veth550dc8f", interface: "veth550dc8f", address: "fe80::389b:a0ff:fe54:42e2%veth550dc8f" }],
      },
    ];
    const proposal = {
      title: "AI edge draft",
      summary: "AI draft",
      confidence: 0.8,
      sourceProfile: { sourceName: "edge", entityType: "host", columns: entityProfiles[0].columns, sampleRows: entityProfiles[0].sampleRows, entityProfiles },
      classRoutes: [{ sourcePattern: "edge", targetClass: "Server", confidence: 0.9, rationale: "host" }],
      fieldMappings: [{ sourceField: "hostname", targetClass: "Server", targetField: "name", transform: "trim_lowercase", confidence: 0.9 }],
      relationshipRules: [
        { fromClass: "Server", toClass: "NetworkGear", type: "DEPENDS_ON", sourceField: "network_interface.address", confidence: 0.8 },
        { fromClass: "ApplicationService", toClass: "Server", type: "HOSTED_ON", sourceField: "service.name", confidence: 0.8 },
      ],
      reconciliationRules: [{ targetClass: "Server", matchKeys: ["name"], strategy: "create_or_update" as const }],
      assumptions: [],
      risks: [],
      aiGenerated: true,
    };

    const preview = previewPipeline({ sample: { rows: entityProfiles[0].sampleRows }, entityProfiles, proposal }, [{ name: "Server" }, { name: "NetworkGear" }, { name: "ApplicationService" }]);

    expect(preview.summary).toMatchObject({ stagedRecords: 1, relationshipCandidates: 0, warnings: 0 });
    expect(preview.records[0]).toMatchObject({
      targetClass: "Server",
      name: "nb-lenovo",
      attributes: expect.objectContaining({ ipAddress: "fe80::389b:a0ff:fe54:42e2%veth550dc8f" }),
    });
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

  it("keeps AI-generated endpoint edge drafts on Computer instead of Server", async () => {
    process.env = {
      ...originalEnv,
      PROVARA_URL: "https://provara.test/v1",
      PROVARA_API_KEY: "pk_test",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              title: "Edge draft",
              summary: "Bad server draft",
              confidence: 0.9,
              classRoutes: [{ sourcePattern: "*", targetClass: "Server", confidence: 0.9, rationale: "Host data" }],
              fieldMappings: [{ sourceField: "name", targetClass: "Server", targetField: "name", transform: "trim_lowercase", confidence: 0.8 }],
              relationshipRules: [{ fromClass: "ApplicationService", toClass: "Server", type: "HOSTED_ON", sourceField: "service.name", confidence: 0.8 }],
              reconciliationRules: [{ targetClass: "Server", matchKeys: ["name"], strategy: "create_or_update" }],
              assumptions: [],
              risks: [],
            }),
          },
        }],
      }),
    }));

    const entityProfiles = [
      {
        entityType: "host",
        recordCount: 1,
        columns: ["entity_type", "natural_key", "hostname", "name", "ipAddress"],
        sampleRows: [{ entity_type: "host", natural_key: "nb-lenovo", hostname: "nb-lenovo", name: "Pop!_OS", ipAddress: "192.168.50.146" }],
      },
      {
        entityType: "network_interface",
        recordCount: 1,
        columns: ["entity_type", "natural_key", "interface", "address"],
        sampleRows: [{ entity_type: "network_interface", natural_key: "nb-lenovo:wlp0s20f3:192.168.50.146", interface: "wlp0s20f3", address: "192.168.50.146" }],
      },
    ];
    const proposal = await proposeTransform(
      { sourceName: "edge", entityType: "host", columns: entityProfiles[0].columns, sampleRows: entityProfiles[0].sampleRows, entityProfiles },
      [{ name: "Computer" }, { name: "Server" }]
    );

    expect(proposal.classRoutes[0].targetClass).toBe("Computer");
    expect(proposal.classRoutes).toHaveLength(1);
    expect(proposal.fieldMappings[0].targetClass).toBe("Computer");
    expect(proposal.reconciliationRules[0].targetClass).toBe("Computer");
    expect(proposal.reconciliationRules).toHaveLength(1);
    expect(proposal.relationshipRules).toHaveLength(0);
  });
});
