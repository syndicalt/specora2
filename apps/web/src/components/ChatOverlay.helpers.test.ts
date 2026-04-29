import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendCardToLatestAssistant,
  appLabel,
  contextChips,
  displayMessagesFromStored,
  followUpPrompts,
  formatSessionTime,
  parseActions,
  parseSseChunk,
  resultCardsFromStoredMessages,
  resultCardForTool,
  sanitizeXml,
  screenContextForApp,
  screenContextLines,
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

  it("builds accurate admin console screen context", () => {
    const context = screenContextForApp("admin-console", {});

    expect(context.appName).toBe("Admin Console");
    expect(context.purpose).toContain("Governance workspace");
    expect(context.primaryActions).toContain("Manage platform users and roles");
    expect(context.boundaries?.join(" ")).toContain("not the CMDB Explorer");
  });

  it("uses dynamic screen context from active apps", () => {
    const lines = screenContextLines("admin-console", {
      screenContext: {
        appId: "admin-console",
        appName: "Admin Console",
        screenName: "Edge Enrollment",
        purpose: "Issue enrollment tokens and review collectors.",
        primaryActions: ["Issue enrollment tokens", "Delete collector registrations"],
        state: { collectors: 2 },
      },
    });

    expect(lines).toEqual([
      "Active app/view: admin-console",
      "Screen: Admin Console - Edge Enrollment",
      "Screen purpose: Issue enrollment tokens and review collectors.",
      "Available screen actions: Issue enrollment tokens; Delete collector registrations",
      expect.stringContaining("Screen boundaries: It is not the CMDB Explorer"),
      "Screen state: collectors=2",
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

  it("filters stored messages to visible chat messages", () => {
    expect(displayMessagesFromStored([
      { id: "m1", role: "user", content: "Show me the map" },
      { id: "m2", role: "assistant", content: "Here it is" },
      { id: "m3", role: "tool", content: "{\"rootId\":\"ci-1\"}", tool_call_id: "call-1" },
    ])).toEqual([
      { role: "user", text: "Show me the map" },
      { role: "assistant", text: "Here it is" },
    ]);
  });

  it("rebuilds durable result cards from stored tool messages", () => {
    const messages = displayMessagesFromStored([
      {
        id: "m1",
        role: "assistant",
        content: "Here is the CI.",
        tool_calls: JSON.stringify([
          { id: "call-1", type: "function", function: { name: "get_ci_details", arguments: "{\"id\":\"ci-1\"}" } },
        ]),
      },
      {
        id: "m2",
        role: "tool",
        tool_call_id: "call-1",
        content: JSON.stringify({ id: "ci-1", name: "Billing API", class: "ApplicationService", relationships: [] }),
      },
    ]);

    expect(messages).toEqual([
      {
        role: "assistant",
        text: "Here is the CI.",
        cards: [
          {
            id: "ci:ci-1:m2",
            type: "ci",
            ci: {
              id: "ci-1",
              name: "Billing API",
              class: "ApplicationService",
              environment: undefined,
              relationships: [],
            },
          },
        ],
      },
    ]);
    expect(resultCardsFromStoredMessages([
      {
        id: "m1",
        role: "assistant",
        content: "Here is the CI.",
        tool_calls: JSON.stringify([
          { id: "call-1", type: "function", function: { name: "get_ci_details", arguments: "{\"id\":\"ci-1\"}" } },
        ]),
      },
      {
        id: "m2",
        role: "tool",
        tool_call_id: "call-1",
        content: JSON.stringify({ id: "ci-1", name: "Billing API", class: "ApplicationService", relationships: [] }),
      },
    ])).toHaveLength(1);
  });

  it("rebuilds durable result cards when tool calls are already parsed", () => {
    const messages = displayMessagesFromStored([
      {
        id: "m1",
        role: "assistant",
        content: "Here is the map.",
        tool_calls: [
          { id: "call-1", type: "function", function: { name: "get_service_map", arguments: "{\"rootId\":\"ci-1\"}" } },
        ],
      },
      {
        id: "m2",
        role: "tool",
        tool_call_id: "call-1",
        content: JSON.stringify({
          rootId: "ci-1",
          nodes: [{ id: "ci-1", name: "Billing API" }],
          edges: [{ sourceId: "ci-1", targetId: "ci-2", type: "DEPENDS_ON" }],
        }),
      },
    ]);

    expect(messages).toEqual([
      {
        role: "assistant",
        text: "Here is the map.",
        cards: [
          {
            id: "service-map:ci-1:m2",
            type: "service-map",
            rootId: "ci-1",
            nodes: [{ id: "ci-1", name: "Billing API" }],
            edges: [{ sourceId: "ci-1", targetId: "ci-2", type: "DEPENDS_ON" }],
          },
        ],
      },
    ]);
  });

  it("attaches live result cards to the latest assistant message", () => {
    const messages = appendCardToLatestAssistant([
      { role: "user", text: "Show CI" },
      { role: "assistant", text: "Looking it up" },
    ], {
      id: "ci:ci-1:live",
      type: "ci",
      ci: { id: "ci-1", name: "Billing API", relationships: [] },
    });

    expect(messages).toEqual([
      { role: "user", text: "Show CI" },
      {
        role: "assistant",
        text: "Looking it up",
        cards: [{ id: "ci:ci-1:live", type: "ci", ci: { id: "ci-1", name: "Billing API", relationships: [] } }],
      },
    ]);
  });
});
