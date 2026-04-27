import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { authFetch, getRefreshToken, getToken, refreshAccessToken, removeToken, setAuthTokens, setToken } from "./auth";

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
    setAuthTokens({ refreshToken: "refresh123" });
    removeToken();
    expect(getToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it("stores access and refresh tokens together", () => {
    setAuthTokens({ token: "access123", refreshToken: "refresh123" });
    expect(getToken()).toBe("access123");
    expect(getRefreshToken()).toBe("refresh123");
  });

  it("refreshAccessToken rotates browser tokens", async () => {
    setAuthTokens({ token: "old", refreshToken: "refresh-old" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: "new", refreshToken: "refresh-new" }),
    }));

    await expect(refreshAccessToken()).resolves.toBe("new");

    expect(getToken()).toBe("new");
    expect(getRefreshToken()).toBe("refresh-new");
  });

  it("authFetch refreshes once on 401 and retries with fresh token", async () => {
    setAuthTokens({ token: "old", refreshToken: "refresh-old" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ status: 401, ok: false })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: "new", refreshToken: "refresh-new" }) })
      .mockResolvedValueOnce({ status: 200, ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const response = await authFetch("http://localhost:4000/api/test");

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((fetchMock.mock.calls[2][1].headers as Headers).get("Authorization")).toBe("Bearer new");
  });
});
