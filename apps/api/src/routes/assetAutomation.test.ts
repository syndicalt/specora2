import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assetAutomationRoutes } from "./assetAutomation";
import { clearPermissionCache } from "../services/rbac";

const executeTool = vi.fn();

vi.mock("@specora/sdk", () => ({
  executeTool: (...args: any[]) => executeTool(...args),
}));

function makePg(allowed = true) {
  return {
    query: vi.fn(async () => ({ rows: allowed ? [{ 1: 1 }] : [] })),
  };
}

async function buildApp(user = { id: "u1", role: "admin" }, allowed = true) {
  const app = Fastify();
  app.decorate("pg", makePg(allowed));
  app.decorate("authenticate", async (request: any) => {
    request.user = user;
  });
  await app.register(assetAutomationRoutes);
  return app;
}

describe("assetAutomationRoutes", () => {
  beforeEach(() => {
    clearPermissionCache();
    executeTool.mockReset();
  });

  it("ingests procurement orders", async () => {
    executeTool.mockResolvedValueOnce({ count: 1 });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/assets/procurement/orders",
      payload: { purchaseOrder: "PO-1", items: [{ name: "Laptop" }] },
    });
    expect(res.statusCode).toBe(200);
    expect(executeTool).toHaveBeenCalledWith("asset-command_ingest_procurement", expect.objectContaining({ purchaseOrder: "PO-1" }), expect.anything());
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["asset_automation.procurement_ingested", "ProcurementOrder", "PO-1"]));
  });

  it("ingests software contracts", async () => {
    executeTool.mockResolvedValueOnce({ contract: { id: "c1" }, entitlements: [] });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/assets/contracts",
      payload: { name: "Microsoft EA", vendor: "Microsoft" },
    });
    expect(res.statusCode).toBe(200);
    expect(executeTool).toHaveBeenCalledWith("asset-command_ingest_contract", expect.objectContaining({ name: "Microsoft EA" }), expect.anything());
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["asset_automation.contract_ingested", "AssetContract", "c1"]));
  });

  it("records mobile scan events", async () => {
    executeTool.mockResolvedValueOnce({ id: "scan-1" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/assets/scans",
      payload: { value: "ASSET-1", scanType: "barcode" },
    });
    expect(res.statusCode).toBe(200);
    expect(executeTool).toHaveBeenCalledWith("asset-command_record_scan", expect.objectContaining({ value: "ASSET-1" }), expect.anything());
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["asset_automation.scan_recorded", "AssetScan", "scan-1"]));
  });

  it("records software usage and runs SAM reconciliation", async () => {
    executeTool.mockResolvedValueOnce({ id: "usage-1" });
    const app = await buildApp();
    const usage = await app.inject({
      method: "POST",
      url: "/api/assets/software/usage",
      payload: { publisher: "Microsoft", product: "Visio" },
    });
    expect(usage.statusCode).toBe(200);
    expect(executeTool).toHaveBeenCalledWith("asset-command_record_software_usage", expect.objectContaining({ product: "Visio" }), expect.anything());

    executeTool.mockResolvedValueOnce({ exceptions: [] });
    const reconcile = await app.inject({
      method: "POST",
      url: "/api/assets/reconcile",
      payload: { publisher: "Microsoft" },
    });
    expect(reconcile.statusCode).toBe(200);
    expect(executeTool).toHaveBeenLastCalledWith("asset-command_reconcile_sam", expect.objectContaining({ publisher: "Microsoft" }), expect.anything());
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["asset_automation.software_usage_recorded", "SoftwareUsage", "usage-1"]));
    expect((app as any).pg.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.arrayContaining(["asset_automation.sam_reconciled", "SoftwareAssetPosition", "Microsoft"]));
  });
});
