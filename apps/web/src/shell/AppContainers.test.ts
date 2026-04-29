import { describe, expect, it } from "vitest";
import { filterRegistryByRole } from "./AppAccess";
import type { RegistryEntry } from "../sdk/types";

const baseApp = (id: string, permissions: string[]): RegistryEntry => ({
  id,
  name: id,
  description: id,
  icon: "Compass",
  version: "1.0.0",
  permissions,
  defaultMode: "canvas",
  installKey: `builtin_${id}`,
  source: "built-in",
  publisher: "Specora",
  installedAt: 0,
});

describe("filterRegistryByRole", () => {
  const registry = [
    baseApp("settings", ["read:profile", "write:profile"]),
    baseApp("customer-portal", ["customer-portal:read", "customer-portal:write"]),
    baseApp("arc", ["app:install", "app:uninstall"]),
    baseApp("service-map", ["read:cmdb", "read:relationships"]),
    baseApp("admin-console", ["rbac:read", "system-properties:read"]),
  ];

  it("shows only authenticated-baseline apps when the user has no platform role", () => {
    expect(filterRegistryByRole(registry, null).map((app) => app.id)).toEqual(["settings", "customer-portal"]);
  });

  it("does not treat unknown roles as unrestricted access", () => {
    expect(filterRegistryByRole(registry, "user").map((app) => app.id)).toEqual(["settings", "customer-portal"]);
  });

  it("limits Arc to platform administrators", () => {
    expect(filterRegistryByRole(registry, "viewer").map((app) => app.id)).not.toContain("arc");
    expect(filterRegistryByRole(registry, "admin").map((app) => app.id)).toContain("arc");
    expect(filterRegistryByRole(registry, "security_admin").map((app) => app.id)).toContain("arc");
  });

  it("validates launcher visibility for the release role matrix", () => {
    const expectedByRole: Array<[string | null, string[]]> = [
      [null, ["settings", "customer-portal"]],
      ["user", ["settings", "customer-portal"]],
      ["viewer", ["settings", "customer-portal", "service-map"]],
      ["operator", ["settings", "customer-portal", "service-map"]],
      ["admin", ["settings", "customer-portal", "arc", "service-map", "admin-console"]],
      ["security_admin", ["settings", "customer-portal", "arc", "service-map", "admin-console"]],
    ];

    for (const [role, expectedIds] of expectedByRole) {
      expect(filterRegistryByRole(registry, role).map((app) => app.id)).toEqual(expectedIds);
    }
  });
});
