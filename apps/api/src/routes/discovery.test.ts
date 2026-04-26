import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { discoveryRoutes } from "./discovery";

describe("discoveryRoutes", () => {
  async function buildApp(neo4jRun?: (sql: string, params?: any) => Promise<any>) {
    const app = Fastify();
    await app.register(multipart);
    const queuedResults: any[] = [];
    app.decorate("pg", {
      queuedResults,
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM app_permissions")) return { rows: [{ ok: 1 }] };
        if (queuedResults.length) return queuedResults.shift();
        return { rows: [{ id: "dj-1" }] };
      }),
    });
    app.decorate("neo4j", {
      session: vi.fn(() => ({
        run: vi.fn(async (sql: string, params?: any) => {
          if (neo4jRun) return neo4jRun(sql, params);
          if (sql.includes("RETURN count(n)")) return { records: [{ get: () => ({ toNumber: () => 0 }) }] };
          return { records: [{ get: () => ({ properties: { id: "disc-server-web01" } }) }] };
        }),
        close: vi.fn(async () => {}),
      })),
    });
    app.decorate("authenticate", async (request: any) => {
      request.user = { id: "u1", role: "admin" };
    });
    await app.register(discoveryRoutes);
    return app;
  }

  it("uploads a file and creates a discovery job", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/discovery/upload",
      headers: {
        "content-type": "multipart/form-data; boundary=----formdata-boundary",
      },
      payload: [
        "------formdata-boundary",
        'Content-Disposition: form-data; name="file"; filename="test.csv"',
        "Content-Type: text/csv",
        "",
        "id,name",
        "1,Test",
        "------formdata-boundary--",
      ].join("\r\n"),
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).status).toBe("pending");
  });

  it("returns 400 when no file is uploaded", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/discovery/upload",
      headers: {
        "content-type": "multipart/form-data; boundary=----formdata-boundary",
      },
      payload: `------formdata-boundary\r\nContent-Disposition: form-data; name="text"\r\n\r\nhello\r\n------formdata-boundary--`,
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe("No file uploaded");
  });

  it("lists discovery pipelines", async () => {
    const app = await buildApp();
    (app as any).pg.queuedResults.push({ rows: [{ id: "pipe-1", name: "AWS import", definition: { nodes: [] } }] });
    const response = await app.inject({ method: "GET", url: "/discovery/pipelines" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)[0].name).toBe("AWS import");
    expect(app.pg.query).toHaveBeenCalledWith(expect.stringContaining("FROM discovery_pipelines"));
  });

  it("creates discovery pipelines", async () => {
    const app = await buildApp();
    (app as any).pg.queuedResults.push({ rows: [{ id: "pipe-1", name: "CSV import", status: "draft", definition: { nodes: [] } }] });
    const response = await app.inject({
      method: "POST",
      url: "/discovery/pipelines",
      payload: { name: "CSV import", definition: { nodes: [] } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).id).toBe("pipe-1");
    expect(app.pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO discovery_pipelines"), [
      "CSV import",
      null,
      "draft",
      { nodes: [] },
    ]);
    expect(app.pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["discovery.pipeline_created", "DiscoveryPipeline", "pipe-1"]));
  });

  it("returns a discovery pipeline by id", async () => {
    const app = await buildApp();
    (app as any).pg.queuedResults.push({ rows: [{ id: "pipe-1", name: "CSV import", definition: { sourceName: "servers.csv" } }] });
    const response = await app.inject({ method: "GET", url: "/discovery/pipelines/pipe-1" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).definition.sourceName).toBe("servers.csv");
  });

  it("updates discovery pipelines", async () => {
    const app = await buildApp();
    (app as any).pg.queuedResults.push({ rows: [{ id: "pipe-1", name: "Updated", status: "draft", definition: { nodes: [] } }] });
    const response = await app.inject({
      method: "PUT",
      url: "/discovery/pipelines/pipe-1",
      payload: { name: "Updated", status: "draft", definition: { nodes: [] } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).name).toBe("Updated");
    expect(app.pg.query).toHaveBeenCalledWith(expect.stringContaining("UPDATE discovery_pipelines"), [
      "pipe-1",
      "Updated",
      null,
      "draft",
      { nodes: [] },
    ]);
  });

  it("publishes the current pipeline definition", async () => {
    const app = await buildApp();
    (app as any).pg.queuedResults.push({ rows: [{ id: "pipe-1", name: "Published", status: "published", version: 2, published_definition: { sample: {} } }] });

    const response = await app.inject({ method: "POST", url: "/discovery/pipelines/pipe-1/publish" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ id: "pipe-1", status: "published" });
    expect(app.pg.query).toHaveBeenCalledWith(expect.stringContaining("published_definition = definition"), ["pipe-1"]);
  });

  it("deletes discovery pipelines", async () => {
    const app = await buildApp();
    (app as any).pg.queuedResults.push({ rows: [{ id: "pipe-1" }] });

    const response = await app.inject({ method: "DELETE", url: "/discovery/pipelines/pipe-1" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ deleted: true });
    expect(app.pg.query).toHaveBeenCalledWith("DELETE FROM discovery_pipelines WHERE id = $1 RETURNING id", ["pipe-1"]);
    expect(app.pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["discovery.pipeline_deleted", "DiscoveryPipeline", "pipe-1"]));
  });

  it("reports when deleting a missing discovery pipeline is a no-op", async () => {
    const app = await buildApp();
    (app as any).pg.queuedResults.push({ rows: [] });

    const response = await app.inject({ method: "DELETE", url: "/discovery/pipelines/missing" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ deleted: false });
  });

  it("tests discovery source configuration and stores health", async () => {
    const app = await buildApp();
    (app as any).pg.queuedResults.push(
      { rows: [{ id: "source-1", type: "api", config: {} }] },
      { rows: [{ id: "source-1", name: "API", type: "api", last_status: "needs_configuration", last_error: "Source configuration is incomplete" }] }
    );

    const response = await app.inject({ method: "POST", url: "/discovery/sources/source-1/test" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ ok: false });
    expect(app.pg.query).toHaveBeenCalledWith(expect.stringContaining("last_tested_at = NOW()"), [
      "source-1",
      "needs_configuration",
      "Source configuration is incomplete",
    ]);
    expect(app.pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["discovery.source_tested", "DiscoverySource", "source-1"]));
  });

  it("reads and updates pipeline schedules", async () => {
    const app = await buildApp();
    (app as any).pg.queuedResults.push(
      { rows: [] },
      { rows: [{ pipeline_id: "pipe-1", enabled: true, interval: "daily", next_run_at: "2026-04-27T03:00:00.000Z", last_run_at: null }] }
    );

    const getRes = await app.inject({ method: "GET", url: "/discovery/pipelines/pipe-1/schedule" });
    expect(getRes.statusCode).toBe(200);
    expect(JSON.parse(getRes.body)).toMatchObject({ pipeline_id: "pipe-1", enabled: false, interval: "manual" });

    const putRes = await app.inject({
      method: "PUT",
      url: "/discovery/pipelines/pipe-1/schedule",
      payload: { enabled: true, interval: "daily", nextRunAt: "2026-04-27T03:00:00.000Z" },
    });
    expect(putRes.statusCode).toBe(200);
    expect(JSON.parse(putRes.body)).toMatchObject({ enabled: true, interval: "daily" });
    expect(app.pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO discovery_pipeline_schedules"), [
      "pipe-1",
      true,
      "daily",
      "2026-04-27T03:00:00.000Z",
    ]);
    expect(app.pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["discovery.schedule_updated", "DiscoveryPipeline", "pipe-1"]));
  });

  it("defaults enabled recurring schedules to the next interval when no next run is provided", async () => {
    const app = await buildApp();
    (app as any).pg.queuedResults.push({ rows: [{ pipeline_id: "pipe-1", enabled: true, interval: "hourly", next_run_at: "soon" }] });

    const response = await app.inject({
      method: "PUT",
      url: "/discovery/pipelines/pipe-1/schedule",
      payload: { enabled: true, interval: "hourly" },
    });

    expect(response.statusCode).toBe(200);
    expect(app.pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO discovery_pipeline_schedules"), [
      "pipe-1",
      true,
      "hourly",
      expect.any(String),
    ]);
  });

  it("previews unsaved pipeline definitions", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/discovery/pipelines/preview",
      payload: {
        targetClasses: [{ name: "Server" }],
        definition: {
          sample: { rows: [{ hostname: "WEB01", environment: "prod" }] },
          proposal: {
            classRoutes: [{ targetClass: "Server", sourcePattern: "columns", confidence: 0.8, rationale: "host" }],
            fieldMappings: [
              { sourceField: "hostname", targetClass: "Server", targetField: "name", transform: "trim_lowercase", confidence: 0.9 },
              { sourceField: "environment", targetClass: "Server", targetField: "environment", transform: "normalize_environment", confidence: 0.9 },
            ],
            relationshipRules: [],
            reconciliationRules: [{ targetClass: "Server", matchKeys: ["name"], strategy: "create_or_update" }],
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.summary.stagedRecords).toBe(1);
    expect(body.records[0]).toMatchObject({ name: "web01", environment: "Production" });
  });

  it("marks preview records as updates when reconciliation finds an existing CI", async () => {
    const app = await buildApp(async () => ({
      records: [{ get: (key: string) => key === "ciId" ? "disc-server-production-api01" : null }],
    }));
    const response = await app.inject({
      method: "POST",
      url: "/discovery/pipelines/preview",
      payload: {
        targetClasses: [{ name: "Server" }],
        definition: {
          sample: { rows: [{ hostname: "API01", environment: "prod" }] },
          proposal: {
            classRoutes: [{ targetClass: "Server", sourcePattern: "columns", confidence: 0.8, rationale: "host" }],
            fieldMappings: [
              { sourceField: "hostname", targetClass: "Server", targetField: "name", transform: "trim_lowercase", confidence: 0.9 },
              { sourceField: "environment", targetClass: "Server", targetField: "environment", transform: "normalize_environment", confidence: 0.9 },
            ],
            relationshipRules: [],
            reconciliationRules: [{ targetClass: "Server", matchKeys: ["name", "environment"], strategy: "create_or_update" }],
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).records[0]).toMatchObject({ name: "api01", environment: "Production", action: "update" });
  });

  it("surfaces missing relationship targets during preview", async () => {
    const app = await buildApp(async () => ({ records: [] }));
    const response = await app.inject({
      method: "POST",
      url: "/discovery/pipelines/preview",
      payload: {
        targetClasses: [{ name: "Server" }, { name: "Database" }],
        definition: {
          sample: { rows: [{ hostname: "WEB01", db_host: "sql01", environment: "prod" }] },
          proposal: {
            classRoutes: [{ targetClass: "Server", sourcePattern: "columns", confidence: 0.8, rationale: "host" }],
            fieldMappings: [
              { sourceField: "hostname", targetClass: "Server", targetField: "name", transform: "trim_lowercase", confidence: 0.9 },
              { sourceField: "environment", targetClass: "Server", targetField: "environment", transform: "normalize_environment", confidence: 0.9 },
            ],
            relationshipRules: [{ fromClass: "Server", toClass: "Database", type: "DEPENDS_ON", sourceField: "db_host", confidence: 0.8 }],
            reconciliationRules: [{ targetClass: "Server", matchKeys: ["name", "environment"], strategy: "create_or_update" }],
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.summary.warnings).toBe(1);
    expect(body.relationships[0]).toMatchObject({
      toClass: "Database",
      targetHint: "sql01",
      status: "missing_target",
      message: "Database sql01 does not exist",
    });
  });

  it("runs a saved pipeline by staging records and enqueueing worker processing", async () => {
    const app = await buildApp();
    const definition = {
      sample: { rows: [{ hostname: "WEB01", environment: "prod" }] },
      proposal: {
        classRoutes: [{ targetClass: "Server", sourcePattern: "columns", confidence: 0.8, rationale: "host" }],
        fieldMappings: [
          { sourceField: "hostname", targetClass: "Server", targetField: "name", transform: "trim_lowercase", confidence: 0.9 },
          { sourceField: "environment", targetClass: "Server", targetField: "environment", transform: "normalize_environment", confidence: 0.9 },
        ],
        relationshipRules: [],
        reconciliationRules: [{ targetClass: "Server", matchKeys: ["name"], strategy: "create_or_update" }],
      },
    };
    (app as any).pg.queuedResults.push(
      { rows: [{ id: "pipe-1", name: "Server import", definition }] },
      { rows: [{ id: "dj-1", status: "staged", stats: {}, created_at: "now", updated_at: "now" }] },
      { rows: [] },
      { rows: [{ id: "job-1", type: "discovery_pipeline", payload: {}, status: "pending", priority: 0, retries: 0, max_retries: 3, created_at: "now", updated_at: "now" }] }
    );

    const response = await app.inject({
      method: "POST",
      url: "/discovery/pipelines/pipe-1/run",
      payload: { targetClasses: [{ name: "Server" }] },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toMatchObject({ jobId: "dj-1", status: "staged" });
    expect(body.preview.stagedRecords).toBe(1);
    expect(app.pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO jobs"), [
      "discovery_pipeline",
      JSON.stringify({
        pipelineId: "pipe-1",
        discoveryJobId: "dj-1",
        preview: { rows: 1, stagedRecords: 1, relationshipCandidates: 0, errors: 0, warnings: 0 },
        source: "manual",
      }),
      0,
    ]);
    expect(app.pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["discovery.pipeline_run_staged", "DiscoveryJob", "dj-1"]));
  });

  it("rejects running a pipeline that cannot stage records", async () => {
    const app = await buildApp();
    (app as any).pg.queuedResults.push({ rows: [{ id: "pipe-1", name: "Empty", definition: { sample: { rows: [] }, proposal: null } }] });

    const response = await app.inject({
      method: "POST",
      url: "/discovery/pipelines/pipe-1/run",
      payload: { targetClasses: [{ name: "Server" }] },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe("Pipeline is not ready to run");
  });

  it("returns staged records for a discovery job", async () => {
    const app = await buildApp();
    (app as any).pg.queuedResults.push(
      { rows: [{ id: "dj-1", status: "staged", stats: {} }] },
      { rows: [{ id: "sr-1", row_number: 1, target_class: "Server", name: "web01", status: "staged" }] },
      { rows: [{ id: "rel-1", row_number: 1, rel_type: "HOSTED_ON", status: "staged" }] }
    );

    const response = await app.inject({ method: "GET", url: "/discovery/jobs/dj-1/staged" });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.records[0]).toMatchObject({ id: "sr-1", name: "web01" });
    expect(body.relationships[0]).toMatchObject({ rel_type: "HOSTED_ON" });
  });

  it("approves safe staged records", async () => {
    const app = await buildApp();
    (app as any).pg.queuedResults.push({ rows: [{ id: "sr-1" }, { id: "sr-2" }] });

    const response = await app.inject({ method: "POST", url: "/discovery/jobs/dj-1/staged/approve-safe" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ updated: 2 });
    expect(app.pg.query).toHaveBeenCalledWith(expect.stringContaining("jsonb_array_length(errors) = 0"), ["dj-1"]);
    expect(app.pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["discovery.staged_records_approved", "DiscoveryJob", "dj-1"]));
  });

  it("skips selected staged records", async () => {
    const app = await buildApp();
    (app as any).pg.queuedResults.push({ rows: [{ id: "sr-1" }] });

    const response = await app.inject({
      method: "POST",
      url: "/discovery/jobs/dj-1/staged/status",
      payload: { recordIds: ["11111111-1111-4111-8111-111111111111"], status: "skipped" },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ updated: 1 });
    expect(app.pg.query).toHaveBeenCalledWith(expect.stringContaining("AND id = ANY($2::uuid[])"), [
      "dj-1",
      ["11111111-1111-4111-8111-111111111111"],
      "skipped",
    ]);
  });

  it("commits staged records into Neo4j and reconciliation logs", async () => {
    const app = await buildApp();
    (app as any).pg.queuedResults.push(
      { rows: [{ id: "dj-1", status: "staged", stats: {} }] },
      { rows: [{ id: "sr-1", row_number: 1, action: "create", target_class: "Server", ci_id: "disc-server-web01", name: "web01", environment: "Production", attributes: { ipAddress: "10.0.0.1" }, match_keys: ["name"], errors: [], warnings: [], status: "staged" }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] }
    );

    const response = await app.inject({ method: "POST", url: "/discovery/jobs/dj-1/commit" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ blocked: false, created: 1, updated: 0 });
    expect((app as any).pg.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO reconciliation_logs"),
      expect.arrayContaining(["dj-1", "disc-server-web01", "create"])
    );
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["discovery.job_committed", "DiscoveryJob", "dj-1"]));
  });

  it("rejects commit when staged data has blocking issues", async () => {
    const app = await buildApp();
    (app as any).pg.queuedResults.push(
      { rows: [{ id: "dj-1", status: "staged", stats: {} }] },
      { rows: [{ id: "sr-1", status: "blocked" }] },
      { rows: [] }
    );

    const response = await app.inject({ method: "POST", url: "/discovery/jobs/dj-1/commit" });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body)).toMatchObject({ error: "Staged discovery has blocking issues", blockedRecords: 1 });
  });

  it("proposes an AI-assisted transform draft", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/discovery/ai/propose-transform",
      payload: {
        sourceName: "servers.csv",
        columns: ["hostname", "ip_addr", "environment"],
        sampleRows: [{ hostname: "web01", ip_addr: "10.0.0.1", environment: "prod" }],
        targetClasses: [{ name: "Server" }],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.classRoutes[0].targetClass).toBe("Server");
    expect(body.fieldMappings).toContainEqual(expect.objectContaining({ sourceField: "hostname", targetField: "name" }));
  });

  it("rejects transform proposals without columns", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/discovery/ai/propose-transform",
      payload: { sourceName: "empty.csv", columns: [] },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe("At least one source column is required");
  });

  it("returns a discovery job by id", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/discovery/jobs/dj-1",
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).id).toBe("dj-1");
  });

  it("returns 404 for missing job", async () => {
    const app = await buildApp();
    (app as any).pg.queuedResults.push({ rows: [] });
    const response = await app.inject({
      method: "GET",
      url: "/discovery/jobs/missing",
    });
    expect(response.statusCode).toBe(404);
  });
});
