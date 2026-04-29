import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppLauncher } from "./AppLauncher";
import { ShellContext, initialShellState, type ShellContextValue } from "./AppContext";
import type { RegistryEntry } from "@/sdk/types";

function tokenForRole(role: string | null) {
  const payload = btoa(JSON.stringify({ role }));
  return `header.${payload}.signature`;
}

function app(id: string, name: string, permissions: string[]): RegistryEntry {
  return {
    id,
    name,
    description: `${name} description`,
    icon: "Compass",
    version: "1.0.0",
    permissions,
    defaultMode: "canvas",
    installKey: `builtin_${id}`,
    source: "built-in",
    publisher: "Specora",
    installedAt: 0,
  };
}

const registry = [
  app("service-map", "Service Map", ["read:cmdb", "read:relationships"]),
  app("customer-portal", "Customer Portal", ["customer-portal:read", "customer-portal:write"]),
  app("arc", "Specora Arc", ["app:install", "app:uninstall"]),
  app("settings", "Settings", ["read:profile", "write:profile"]),
];

function renderLauncher(role: string | null, overrides: Partial<ShellContextValue["state"]> = {}, inputRegistry = registry) {
  window.localStorage.setItem("specora_token", tokenForRole(role));
  const dispatch = vi.fn();
  const value: ShellContextValue = {
    state: { ...initialShellState, launcherOpen: true, ...overrides },
    dispatch,
    registry: inputRegistry,
    messageBus: { subscribe: vi.fn(() => vi.fn()), publish: vi.fn() },
    eventBus: { subscribe: vi.fn(() => vi.fn()), connected: false },
  };
  render(
    <ShellContext.Provider value={value}>
      <AppLauncher registry={inputRegistry} />
    </ShellContext.Provider>
  );
  return { dispatch };
}

describe("AppLauncher", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("shows authenticated baseline apps but hides Arc from a no-role user", () => {
    renderLauncher(null);

    expect(screen.getByText("Customer Portal")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.queryByText("Specora Arc")).toBeNull();
    expect(screen.queryByText("Service Map")).toBeNull();
    expect(screen.getByText("2 of 2 available")).toBeTruthy();
  });

  it("sorts visible apps alphabetically and filters by search", () => {
    renderLauncher("admin");

    const names = screen.getAllByTestId(/app-launcher-item-/).map((item) => item.textContent || "");
    expect(names).toEqual(["Customer Portal", "Service Map", "Settings", "Specora Arc"]);

    fireEvent.change(screen.getByPlaceholderText("Search applications"), { target: { value: "arc" } });

    expect(screen.getByText("Specora Arc")).toBeTruthy();
    expect(screen.queryByText("Customer Portal")).toBeNull();
    expect(screen.getByText("1 of 4 available")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Clear application search"));
    expect(screen.getByText("4 of 4 available")).toBeTruthy();
  });

  it("dispatches OPEN_APP with the selected registry entry", () => {
    const { dispatch } = renderLauncher("admin");

    fireEvent.click(screen.getByTestId("app-launcher-item-service-map"));

    expect(dispatch).toHaveBeenCalledWith({
      type: "OPEN_APP",
      id: "service-map",
      installKey: "builtin_service-map",
      mode: "canvas",
      permissions: ["read:cmdb", "read:relationships"],
    });
  });

  it("closes from backdrop and close button without opening an app", () => {
    const { dispatch } = renderLauncher("admin");

    fireEvent.click(screen.getByLabelText("Close app launcher"));
    expect(dispatch).toHaveBeenCalledWith({ type: "CLOSE_LAUNCHER" });

    fireEvent.click(screen.getByTestId("app-launcher").parentElement!);
    expect(dispatch).toHaveBeenCalledWith({ type: "CLOSE_LAUNCHER" });
  });

  it("renders empty and no-match states", () => {
    renderLauncher("admin", {}, []);
    expect(screen.getByText("No apps available")).toBeTruthy();
    expect(screen.getByText("Contact your administrator for access")).toBeTruthy();

    cleanup();
    renderLauncher("admin");
    fireEvent.change(screen.getByPlaceholderText("Search applications"), { target: { value: "nope" } });
    expect(screen.getByText("No matching apps")).toBeTruthy();
  });

  it("does not render while closed", () => {
    renderLauncher("admin", { launcherOpen: false });
    expect(screen.queryByTestId("app-launcher")).toBeNull();
  });
});
