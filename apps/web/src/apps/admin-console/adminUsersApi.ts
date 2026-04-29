"use client";

import { adminJson } from "./adminApi";
import type { ManagedUserDetail } from "./types";

type UserDraft = {
  email: string;
  name: string;
  role: string;
  password: string;
};

type UserEditDraft = {
  name: string;
  role: string;
};

export async function fetchManagedUserDetail(userId: string): Promise<ManagedUserDetail> {
  return adminJson<ManagedUserDetail>(`/api/admin/users/${userId}`, {}, {} as ManagedUserDetail);
}

export async function createManagedUserRecord(userDraft: UserDraft): Promise<{ user: { id: string } }> {
  return adminJson<{ user: { id: string } }>("/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(userDraft),
  }, { user: { id: "" } });
}

export async function updateManagedUserRecord(userId: string, userEditDraft: UserEditDraft): Promise<void> {
  await adminJson(`/api/admin/users/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(userEditDraft),
  }, {});
}

export async function revokeManagedUserSessionRecords(userId: string): Promise<void> {
  await adminJson(`/api/admin/users/${userId}/revoke-sessions`, {
    method: "POST",
  }, {});
}
