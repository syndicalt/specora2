import { getApiBase } from "./runtimeApi";

const TOKEN_KEY = "specora_token";
const REFRESH_TOKEN_KEY = "specora_refresh_token";
const API_BASE = getApiBase();

type AuthTokens = {
  token?: string;
  refreshToken?: string;
};

let refreshPromise: Promise<string | null> | null = null;

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setToken(token: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
}

export function setAuthTokens(tokens: AuthTokens) {
  if (typeof window === "undefined") return;
  if (tokens.token) localStorage.setItem(TOKEN_KEY, tokens.token);
  if (tokens.refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
}

export function removeToken() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export async function logout() {
  const refreshToken = getRefreshToken();
  try {
    if (refreshToken) {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
    }
  } finally {
    removeToken();
  }
}

export async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return null;
    const response = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) {
      removeToken();
      return null;
    }
    const data = await response.json();
    setAuthTokens({ token: data.token, refreshToken: data.refreshToken });
    return data.token || null;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}, retry = true): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(input, { ...init, headers });
  if (response.status !== 401 || !retry) return response;

  const freshToken = await refreshAccessToken();
  if (!freshToken) return response;

  const retryHeaders = new Headers(init.headers);
  retryHeaders.set("Authorization", `Bearer ${freshToken}`);
  return fetch(input, { ...init, headers: retryHeaders });
}

export function getUserRole(): string | null {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    let base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const pad = 4 - (base64.length % 4);
    if (pad !== 4) base64 += "=".repeat(pad === 4 ? 0 : pad);
    const decoded = JSON.parse(atob(base64));
    return decoded.role || null;
  } catch {
    return null;
  }
}
