"use client";

import { adminJson } from "./adminApi";

export type EdgeEnrollmentDraft = {
  name: string;
  site: string;
  labels: string;
  expiresInHours: string;
  maxUses: string;
};

export function parseEdgeLabels(value: string) {
  if (!value.trim()) return {};
  try {
    return JSON.parse(value);
  } catch {
    return Object.fromEntries(value.split(",").map((pair) => pair.trim()).filter(Boolean).map((pair) => {
      const [key, ...rest] = pair.split("=");
      return [key.trim(), rest.join("=").trim() || true];
    }));
  }
}

export async function createEdgeEnrollmentTokenRecord(draft: EdgeEnrollmentDraft): Promise<{ token: string }> {
  return adminJson<{ token: string }>("/api/admin/edge-enrollment/tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: draft.name,
      site: draft.site,
      labels: parseEdgeLabels(draft.labels),
      expiresInHours: Number(draft.expiresInHours || 24),
      maxUses: Number(draft.maxUses || 1),
    }),
  }, { token: "" });
}

export async function revokeEdgeEnrollmentTokenRecord(id: string): Promise<void> {
  await adminJson(`/api/admin/edge-enrollment/tokens/${id}/revoke`, { method: "POST" }, {});
}

export async function deleteEdgeCollectorRecord(id: string): Promise<void> {
  await adminJson(`/api/admin/edge-enrollment/collectors/${id}`, { method: "DELETE" }, {});
}
