"use client";

import { getToken } from "@/lib/auth";
import { getApiBase } from "@/lib/runtimeApi";

export const ADMIN_API_URL = getApiBase();

function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = getToken();
  return {
    ...(extra || {}),
    Authorization: `Bearer ${token || ""}`,
  };
}

export async function adminJson<T>(path: string, init: RequestInit = {}, fallback: T): Promise<T> {
  const response = await fetch(`${ADMIN_API_URL}${path}`, {
    ...init,
    headers: authHeaders(init.headers),
  });
  const data = await response.json().catch(() => fallback);
  if (!response.ok) {
    throw new Error((data as any)?.error || `Request failed: ${path}`);
  }
  return data as T;
}

export async function adminGraphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${ADMIN_API_URL}/graphql`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ query, variables }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.errors?.length) {
    throw new Error(data.errors?.[0]?.message || "GraphQL request failed");
  }
  return data.data as T;
}

export function adminAuthHeaders(extra?: HeadersInit): HeadersInit {
  return authHeaders(extra);
}
