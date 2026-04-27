import { describe, it, expect, vi, beforeEach } from "vitest";
import { hasPermission, requirePermission, requireAdmin, clearPermissionCache } from "./rbac";

describe("rbac", () => {
  beforeEach(() => {
    clearPermissionCache();
  });

  function mockPg(rows: any[] = []) {
    return {
      query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }),
    };
  }

  it("returns true when permission exists", async () => {
    const pg = mockPg([{ _: 1 }]);
    const result = await hasPermission(pg, { role: "admin", resource: "cmdb", action: "write" });
    expect(result).toBe(true);
  });

  it("returns false when permission missing", async () => {
    const pg = mockPg([]);
    const result = await hasPermission(pg, { role: "viewer", resource: "cmdb", action: "write" });
    expect(result).toBe(false);
  });

  it("allows permissions inherited from identity group memberships", async () => {
    const pg = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ _: 1 }], rowCount: 1 }),
    };
    const result = await hasPermission(pg, { role: "viewer", userId: "user-1", resource: "discovery", action: "write" });
    expect(result).toBe(true);
    expect(pg.query).toHaveBeenNthCalledWith(2, expect.stringContaining("identity_group_memberships"), ["user-1", "discovery", "write"]);
  });

  it("caches permission results", async () => {
    const pg = mockPg([{ _: 1 }]);
    await hasPermission(pg, { role: "operator", resource: "cmdb", action: "write" });
    await hasPermission(pg, { role: "operator", resource: "cmdb", action: "write" });
    expect(pg.query).toHaveBeenCalledTimes(1);
  });

  it("security_admin bypasses all permission checks", async () => {
    const pg = mockPg([]);
    const result = await hasPermission(pg, { role: "security_admin", resource: "change-manager", action: "write" });
    expect(result).toBe(true);
    expect(pg.query).not.toHaveBeenCalled();
  });

  it("admin bypasses all permission checks except rbac", async () => {
    const pg = mockPg([]);
    const cmdb = await hasPermission(pg, { role: "admin", resource: "cmdb", action: "write" });
    expect(cmdb).toBe(true);
    const rbac = await hasPermission(pg, { role: "admin", resource: "rbac", action: "write" });
    expect(rbac).toBe(false);
  });

  it("requirePermission allows when permitted", async () => {
    const pg = mockPg([{ _: 1 }]);
    const request = { user: { role: "admin" }, server: { pg } };
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() };
    await requirePermission("cmdb", "write")(request, reply);
    expect(reply.status).not.toHaveBeenCalled();
  });

  it("requirePermission rejects when not permitted", async () => {
    const pg = mockPg([]);
    const request = { user: { role: "viewer" }, server: { pg } };
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() };
    await requirePermission("cmdb", "write")(request, reply);
    expect(reply.status).toHaveBeenCalledWith(403);
  });

  it("requireAdmin allows admin", () => {
    const request = { user: { role: "admin" } };
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() };
    requireAdmin(request, reply);
    expect(reply.status).not.toHaveBeenCalled();
  });

  it("requireAdmin rejects non-admin", () => {
    const request = { user: { role: "viewer" } };
    const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() };
    requireAdmin(request, reply);
    expect(reply.status).toHaveBeenCalledWith(403);
  });
});
