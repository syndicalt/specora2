import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { authFetch, getRefreshToken, getToken, getUserRole, logout, refreshAccessToken, removeToken, setAuthTokens, setToken } from "./auth";

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

  it("stores only provided token values", () => {
    setAuthTokens({ token: "access-only" });
    expect(getToken()).toBe("access-only");
    expect(getRefreshToken()).toBeNull();

    setAuthTokens({ refreshToken: "refresh-only" });
    expect(getToken()).toBe("access-only");
    expect(getRefreshToken()).toBe("refresh-only");
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

  it("returns original 401 when retry is disabled", async () => {
    setToken("old");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 401, ok: false }));

    const response = await authFetch("http://localhost:4000/api/test", {}, false);

    expect(response.status).toBe(401);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns successful responses without refreshing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, ok: true }));

    const response = await authFetch("http://localhost:4000/api/test", { headers: { "X-Test": "1" } });

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns original 401 when refresh cannot produce a token", async () => {
    setAuthTokens({ token: "old", refreshToken: "refresh-old" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ status: 401, ok: false })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: "", refreshToken: "refresh-new" }) });
    vi.stubGlobal("fetch", fetchMock);

    const response = await authFetch("http://localhost:4000/api/test");

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("clears tokens when refresh fails", async () => {
    setAuthTokens({ token: "old", refreshToken: "refresh-old" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    await expect(refreshAccessToken()).resolves.toBeNull();

    expect(getToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it("returns null when refresh token is missing", async () => {
    vi.stubGlobal("fetch", vi.fn());

    await expect(refreshAccessToken()).resolves.toBeNull();

    expect(fetch).not.toHaveBeenCalled();
  });

  it("logs out through the API and clears local tokens", async () => {
    setAuthTokens({ token: "old", refreshToken: "refresh-old" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    await logout();

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/auth/logout"), expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ refreshToken: "refresh-old" }),
    }));
    expect(getToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it("logs out locally when there is no refresh token", async () => {
    setToken("old");
    vi.stubGlobal("fetch", vi.fn());

    await logout();

    expect(fetch).not.toHaveBeenCalled();
    expect(getToken()).toBeNull();
  });

  it("clears local tokens even when logout request fails", async () => {
    setAuthTokens({ token: "old", refreshToken: "refresh-old" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(logout()).rejects.toThrow("offline");

    expect(getToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it("extracts the user role from a JWT", () => {
    const payload = btoa(JSON.stringify({ role: "admin" })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    setToken(`header.${payload}.signature`);

    expect(getUserRole()).toBe("admin");
  });

  it("returns null when the JWT has no role", () => {
    const payload = btoa(JSON.stringify({ sub: "user-1" })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    setToken(`header.${payload}.signature`);

    expect(getUserRole()).toBeNull();
  });

  it("returns null when no role token is stored", () => {
    expect(getUserRole()).toBeNull();
  });

  it("returns null for malformed role tokens", () => {
    setToken("not-a-jwt");

    expect(getUserRole()).toBeNull();
  });
});
