import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appLabel,
  contextChips,
  followUpPrompts,
  formatSessionTime,
  parseActions,
  parseSseChunk,
  resultCardForTool,
  sanitizeXml,
  toolLabel,
  updateWorkStep,
} from "./ChatOverlay.helpers";

describe("ChatOverlay helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses platform action tokens out of assistant text", () => {
    const parsed = parseActions("Open it [[action|open-cmdb-explorer|id=ci-1|Open CI]] now");

    expect(parsed.cleanText).toBe("Open it  now");
    expect(parsed.actions).toEqual([{ type: "open-cmdb-explorer", payload: "id=ci-1", label: "Open CI" }]);
  });

  it("formats app labels and visible context chips", () => {
    expect(appLabel("builtin_cmdb-explorer")).toBe("Cmdb Explorer");
    expect(toolLabel("incident-manager_create_incident")).toBe("Incident Manager Create Incident");
    expect(contextChips({ selectedCI: { id: "ci-1", name: "nb-lenovo", class: "Computer" } }, "service-map")).toEqual([
      { key: "activeApp", label: "Service Map", detail: "View" },
      { key: "selectedCI", label: "nb-lenovo", detail: "Computer" },
    ]);
  });

  it("builds contextual follow-up prompts", () => {
    const prompts = followUpPrompts({ selectedCI: { id: "ci-1" } }, "service-map");

    expect(prompts.map((prompt) => prompt.label)).toEqual(["Impact path", "Show relationships", "Explain health", "Summarize risks"]);
  });

  it("formats recent session timestamps", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T12:00:00Z"));

    expect(formatSessionTime("2026-04-28T11:59:30Z")).toBe("Just now");
    expect(formatSessionTime("2026-04-28T11:45:00Z")).toBe("15m ago");
    expect(formatSessionTime("2026-04-28T09:00:00Z")).toBe("3h ago");
  });

  it("removes tool XML from assistant output", () => {
    expect(sanitizeXml("Answer\n<function_calls>secret</function_calls>\n\n\nDone")).toBe("Answer\n\nDone");
  });

  it("updates work steps in place by id", () => {
    const steps = updateWorkStep([{ id: "assistant", label: "Asking assistant", status: "active" }], {
      id: "assistant",
      label: "Drafted response",
      status: "completed",
    });

    expect(steps).toEqual([{ id: "assistant", label: "Drafted response", status: "completed" }]);
    expect(updateWorkStep(steps, { id: "tool:get_ci_details", label: "Running Get Ci Details", status: "active" })).toEqual([
      { id: "assistant", label: "Drafted response", status: "completed" },
      { id: "tool:get_ci_details", label: "Running Get Ci Details", status: "active" },
    ]);
  });

  it("parses SSE chunks into stream events", () => {
    expect(parseSseChunk("event: token\ndata: {\"type\":\"token\",\"text\":\"hello\"}\n\n")).toEqual({ type: "token", text: "hello" });
    expect(parseSseChunk("event: token\n\n")).toBeNull();
    expect(parseSseChunk("data: not-json\n\n")).toBeNull();
  });

  it("builds CI result cards from tool results", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T12:00:00Z"));

    const card = resultCardForTool("get_ci_details", {
      id: "ci-1",
      name: "Billing API",
      class: "ApplicationService",
      environment: "Prod",
      relationships: [{ type: "HOSTED_ON", direction: "outgoing", target: { id: "ci-2", name: "web01" } }],
    });

    expect(card).toEqual({
      id: "ci:ci-1:1777377600000",
      type: "ci",
      ci: {
        id: "ci-1",
        name: "Billing API",
        class: "ApplicationService",
        environment: "Prod",
        relationships: [{ type: "HOSTED_ON", direction: "outgoing", target: { id: "ci-2", name: "web01" } }],
      },
    });
  });

  it("builds service-map result cards from tool results", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T12:00:00Z"));

    const card = resultCardForTool("get_service_map", {
      rootId: "ci-1",
      nodes: [{ id: "ci-1", name: "Billing API", class: "ApplicationService" }],
      edges: [{ type: "HOSTED_ON", sourceId: "ci-1", targetId: "ci-2" }],
    });

    expect(card).toEqual({
      id: "service-map:ci-1:1777377600000",
      type: "service-map",
      rootId: "ci-1",
      nodes: [{ id: "ci-1", name: "Billing API", class: "ApplicationService" }],
      edges: [{ type: "HOSTED_ON", sourceId: "ci-1", targetId: "ci-2" }],
    });
  });

  it("ignores unsupported or failed tool results", () => {
    expect(resultCardForTool("get_ci_details", { error: "not found" })).toBeNull();
    expect(resultCardForTool("unknown_tool", { id: "ci-1", name: "Billing API" })).toBeNull();
    expect(resultCardForTool("get_service_map", { rootId: "ci-1", nodes: [] })).toBeNull();
  });
});
