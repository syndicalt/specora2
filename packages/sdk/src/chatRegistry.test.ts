import { describe, it, expect, vi } from "vitest";
import {
  registerTool,
  getToolsForSession,
  getToolDefinition,
  executeTool,
  unregisterAppTools,
} from "@specora/sdk";

describe("chatRegistry", () => {
  it("registers and retrieves tools", () => {
    registerTool("test-app", {
      name: "test_tool",
      description: "A test tool",
      parameters: { type: "object", properties: {} },
    }, async () => "result");

    const tools = getToolsForSession("user-1");
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some((t) => t.name === "test-app_test_tool")).toBe(true);
  });

  it("returns tool definition by name", () => {
    const def = getToolDefinition("test-app_test_tool");
    expect(def).toBeDefined();
    expect(def?.name).toBe("test-app_test_tool");
  });

  it("executes tool handler with context", async () => {
    const handler = vi.fn().mockResolvedValue({ success: true });
    registerTool("test-app", {
      name: "exec_tool",
      description: "Execute something",
      parameters: { type: "object", properties: { input: { type: "string" } } },
    }, handler);

    const result = await executeTool("test-app_exec_tool", { input: "hello" }, { userId: "123" });
    expect(handler).toHaveBeenCalledWith({ input: "hello" }, { userId: "123" });
    expect(result).toEqual({ success: true });
  });

  it("throws for unknown tool", async () => {
    await expect(executeTool("unknown_tool", {}, {})).rejects.toThrow("not found");
  });

  it("throws for duplicate registration", () => {
    expect(() => {
      registerTool("test-app", {
        name: "test_tool",
        description: "Duplicate",
        parameters: { type: "object", properties: {} },
      }, async () => "x");
    }).toThrow("already registered");
  });

  it("unregisters app tools", () => {
    unregisterAppTools("test-app");
    expect(getToolDefinition("test-app_test_tool")).toBeUndefined();
    expect(getToolDefinition("test-app_exec_tool")).toBeUndefined();
  });
});
