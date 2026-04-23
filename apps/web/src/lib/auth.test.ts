import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getToken, setToken, removeToken } from "./auth";

describe("auth", () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getToken returns null when no token", () => {
    expect(getToken()).toBeNull();
  });

  it("setToken stores token in localStorage", () => {
    setToken("abc123");
    expect(getToken()).toBe("abc123");
  });

  it("removeToken clears token from localStorage", () => {
    setToken("abc123");
    removeToken();
    expect(getToken()).toBeNull();
  });
});
