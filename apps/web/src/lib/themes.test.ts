import { describe, expect, it } from "vitest";
import { applyTheme, DEFAULT_THEME, isThemeId, THEME_OPTIONS } from "./themes";

describe("themes", () => {
  it("recognizes only registered theme ids", () => {
    expect(isThemeId("specora-dark")).toBe(true);
    expect(isThemeId("soft-light")).toBe(true);
    expect(isThemeId("unknown-theme")).toBe(false);
    expect(isThemeId(null)).toBe(false);
  });

  it("keeps theme ids unique", () => {
    const ids = THEME_OPTIONS.map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("applies valid themes to the document root", () => {
    const resolved = applyTheme("soft-light");

    expect(resolved).toBe("soft-light");
    expect(document.documentElement.dataset.theme).toBe("soft-light");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("falls back to the default theme for invalid values", () => {
    const resolved = applyTheme("invalid");

    expect(resolved).toBe(DEFAULT_THEME);
    expect(document.documentElement.dataset.theme).toBe(DEFAULT_THEME);
  });
});
