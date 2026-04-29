import { afterEach, describe, expect, it, vi } from "vitest";
import { appLabel, contextChips, followUpPrompts, formatSessionTime, parseActions, sanitizeXml } from "./ChatOverlay.helpers";

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
});
