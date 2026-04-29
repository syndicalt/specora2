"use client";

import { type Dispatch, type FormEvent, type SetStateAction } from "react";
import { ChevronRight, LogOut, Search, ShieldCheck, UserCog, UserPlus, Users } from "lucide-react";
import { FieldInput, FieldSelect, MiniMetric } from "./components";
import { appPermissionToResourceAction, formatDateTime, riskClass } from "./helpers";
import type { ManagedUser, ManagedUserDetail, RbacApp } from "./types";
import { passwordMeetsPolicy, passwordPolicyRequirements, type PasswordPolicy } from "@/lib/passwordPolicy";

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

type UsersPanelProps = {
  managedUsers: ManagedUser[];
  filteredManagedUsers: ManagedUser[];
  selectedUserId: string;
  setSelectedUserId: Dispatch<SetStateAction<string>>;
  selectedUserDetail: ManagedUserDetail | null;
  setSelectedUserDetail: Dispatch<SetStateAction<ManagedUserDetail | null>>;
  selectedManagedUser: ManagedUser | null;
  userSearch: string;
  setUserSearch: Dispatch<SetStateAction<string>>;
  userDraft: UserDraft;
  setUserDraft: Dispatch<SetStateAction<UserDraft>>;
  userEditDraft: UserEditDraft;
  setUserEditDraft: Dispatch<SetStateAction<UserEditDraft>>;
  allRoles: string[];
  rbacApps: RbacApp[];
  passwordPolicy: PasswordPolicy;
  saving: boolean;
  onCreateUser: (event: FormEvent) => void;
  onUpdateUser: () => void;
  onRevokeSessions: () => void;
  onExplainInRbac: (userId: string, role: string, appId: string) => void;
};

export function UsersPanel({
  managedUsers,
  filteredManagedUsers,
  selectedUserId,
  setSelectedUserId,
  selectedUserDetail,
  setSelectedUserDetail,
  selectedManagedUser,
  userSearch,
  setUserSearch,
  userDraft,
  setUserDraft,
  userEditDraft,
  setUserEditDraft,
  allRoles,
  rbacApps,
  passwordPolicy,
  saving,
  onCreateUser,
  onUpdateUser,
  onRevokeSessions,
  onExplainInRbac,
}: UsersPanelProps) {
  const detail = selectedUserDetail;
  const effectiveGrants = [
    ...(detail?.directGrants || []),
    ...(detail?.inheritedGrants || []),
  ].sort((a, b) => `${a.resource}:${a.action}`.localeCompare(`${b.resource}:${b.action}`));
  const effectiveGrantKeys = new Set(effectiveGrants.map((grant) => `${grant.resource}:${grant.action}`));
  const selectedUserRole = selectedManagedUser?.role || "";
  const selectedUserAppAccess = selectedManagedUser ? rbacApps.map((app) => {
    const requirements = app.permissions.map((permission) => appPermissionToResourceAction(permission)).filter(Boolean) as Array<{ resource: string; action: string }>;
    const missing = requirements.filter((requirement) => {
      if (selectedUserRole === "security_admin") return false;
      if (selectedUserRole === "admin" && requirement.resource !== "rbac") return false;
      return !effectiveGrantKeys.has(`${requirement.resource}:${requirement.action}`);
    });
    return {
      app,
      requirements,
      missing,
      allowed: missing.length === 0,
    };
  }).sort((a, b) => {
    if (a.allowed !== b.allowed) return a.allowed ? 1 : -1;
    return a.app.name.localeCompare(b.app.name, undefined, { sensitivity: "base" });
  }) : [];
  const selectedUserAllowedApps = selectedUserAppAccess.filter((entry) => entry.allowed).length;
  const passwordRequirements = passwordPolicyRequirements(userDraft.password, passwordPolicy);
  const passwordValid = passwordMeetsPolicy(userDraft.password, passwordPolicy);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-lg border border-gray-800 bg-gray-900">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 px-4 py-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-gray-100">
                <Users className="h-4 w-4 text-indigo-300" />
                Users
              </div>
              <div className="mt-1 text-xs text-gray-500">{managedUsers.length} accounts with session, group, and access posture</div>
            </div>
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-500" />
              <input
                value={userSearch}
                onChange={(event) => setUserSearch(event.target.value)}
                placeholder="Search users"
                className="w-full rounded-lg border border-gray-700 bg-gray-950 py-2 pl-9 pr-3 text-sm text-gray-200 outline-none focus:border-indigo-500"
              />
            </div>
          </div>
          <div className="max-h-[580px] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-gray-900 text-xs uppercase tracking-wide text-gray-500">
                <tr className="border-b border-gray-800">
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Risk</th>
                  <th className="px-4 py-3">Last login</th>
                </tr>
              </thead>
              <tbody>
                {filteredManagedUsers.map((user) => (
                  <tr
                    key={user.id}
                    onClick={() => {
                      setSelectedUserId(user.id);
                      setSelectedUserDetail(null);
                      setUserEditDraft({ name: user.name || "", role: user.role || "" });
                    }}
                    className={`cursor-pointer border-b border-gray-800/60 hover:bg-gray-800/50 ${selectedUserId === user.id ? "bg-indigo-500/10" : ""}`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-100">{user.name}</div>
                      <div className="text-xs text-gray-500">{user.email}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-indigo-200">{user.role}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-1 text-xs ${user.status === "active" ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : "border-gray-700 bg-gray-950 text-gray-400"}`}>
                        {user.status.replaceAll("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-gray-400">{user.highRiskGrants} critical grants</div>
                      <div className="text-xs text-gray-600">{user.groupCount} groups / {user.activeSessions} sessions</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDateTime(user.lastLoginAt)}</td>
                  </tr>
                ))}
                {!filteredManagedUsers.length && (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-500">No users match this search.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <form onSubmit={onCreateUser} className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-medium text-gray-100">
            <UserPlus className="h-4 w-4 text-emerald-300" />
            Invite platform user
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <FieldInput label="Name" value={userDraft.name} onChange={(value) => setUserDraft((current) => ({ ...current, name: value }))} placeholder="Avery Admin" autoComplete="off" />
            <FieldInput label="Email" value={userDraft.email} onChange={(value) => setUserDraft((current) => ({ ...current, email: value }))} placeholder="avery@example.com" type="email" autoComplete="off" />
            <FieldSelect label="Role" value={userDraft.role} onChange={(value) => setUserDraft((current) => ({ ...current, role: value }))} options={(allRoles.length ? allRoles : ["operator"]).map((role) => ({ value: role, label: role }))} />
            <FieldInput label="Temporary password" value={userDraft.password} onChange={(value) => setUserDraft((current) => ({ ...current, password: value }))} type="password" autoComplete="new-password" help="The user must change it on first login." />
          </div>
          <div className="mt-3 rounded-lg border border-gray-800 bg-gray-950 p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Temporary password requirements</div>
            <div className="mt-2 grid gap-1.5 text-xs">
              {passwordRequirements.map((requirement) => (
                <div key={requirement.id} className={requirement.met ? "text-emerald-300" : "text-gray-500"}>
                  {requirement.met ? "[x]" : "[ ]"} {requirement.label}
                </div>
              ))}
            </div>
          </div>
          <button type="submit" disabled={saving || !passwordValid} className="mt-4 flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
            <UserPlus className="h-4 w-4" />
            Create user
          </button>
        </form>
      </div>

      {selectedManagedUser && (
        <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
          <div className="space-y-4">
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-gray-100">{selectedManagedUser.name}</div>
                  <div className="text-sm text-gray-500">{selectedManagedUser.email}</div>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <span className="rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3 py-1 text-xs text-indigo-200">{selectedManagedUser.authMethod}</span>
                  {selectedManagedUser.passwordChangeRequired && <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-200">password change required</span>}
                </div>
              </div>
              <div className="grid gap-3">
                <FieldInput label="Display name" value={userEditDraft.name} onChange={(value) => setUserEditDraft((current) => ({ ...current, name: value }))} />
                <FieldSelect label="Role" value={userEditDraft.role} onChange={(value) => setUserEditDraft((current) => ({ ...current, role: value }))} options={(allRoles.length ? allRoles : [selectedManagedUser.role]).map((role) => ({ value: role, label: role }))} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={onUpdateUser} disabled={saving} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
                  <UserCog className="h-4 w-4" />
                  Save profile
                </button>
                <button type="button" onClick={onRevokeSessions} disabled={saving || selectedManagedUser.activeSessions === 0} className="flex items-center gap-2 rounded-lg border border-red-500/40 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-500/10 disabled:opacity-50">
                  <LogOut className="h-4 w-4" />
                  Revoke sessions
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
              <div className="mb-3 text-sm font-medium text-gray-100">Operational impact</div>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(detail?.impact || {}).map(([key, value]) => (
                  <MiniMetric key={key} label={key.replace(/([A-Z])/g, " $1")} value={value} />
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-gray-100">Application access</div>
                  <div className="mt-1 text-xs text-gray-500">
                    {selectedUserAllowedApps} of {selectedUserAppAccess.length} registered apps available
                  </div>
                </div>
                <ShieldCheck className="h-4 w-4 text-cyan-300" />
              </div>
              <div className="max-h-80 space-y-2 overflow-auto pr-1">
                {selectedUserAppAccess.map(({ app, requirements, missing, allowed }) => (
                  <div key={app.id} className={`rounded-lg border px-3 py-2 ${allowed ? "border-emerald-500/20 bg-emerald-500/5" : "border-gray-800 bg-gray-950"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-gray-100">{app.name}</div>
                        <div className="mt-1 text-xs text-gray-500">
                          {requirements.length} requirement{requirements.length === 1 ? "" : "s"}
                          {missing.length > 0 ? ` · missing ${missing.map((item) => `${item.resource}:${item.action}`).join(", ")}` : " · satisfied"}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${allowed ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : "border-red-400/30 bg-red-500/10 text-red-200"}`}>
                        {allowed ? "allowed" : "blocked"}
                      </span>
                    </div>
                    {!allowed && (
                      <button
                        type="button"
                        onClick={() => onExplainInRbac(selectedManagedUser.id, selectedManagedUser.role, app.id)}
                        className="mt-2 inline-flex items-center gap-2 rounded-md border border-cyan-500/30 px-2.5 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/10"
                      >
                        Explain in RBAC
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                {!selectedUserAppAccess.length && <div className="text-sm text-gray-500">No registered apps were returned for this admin view.</div>}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-100">
                <ShieldCheck className="h-4 w-4 text-indigo-300" />
                AI-style access rationale
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {(detail?.recommendations || []).map((item) => (
                  <div key={item.title} className={`rounded-lg border p-3 ${item.severity === "critical" ? "border-red-500/30 bg-red-500/10" : item.severity === "warning" ? "border-amber-500/30 bg-amber-500/10" : "border-sky-500/30 bg-sky-500/10"}`}>
                    <div className="text-sm font-medium text-gray-100">{item.title}</div>
                    <div className="mt-1 text-sm leading-5 text-gray-400">{item.rationale}</div>
                    <div className="mt-2 text-xs text-gray-500">{item.action}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
                <div className="mb-3 text-sm font-medium text-gray-100">Effective grants</div>
                <div className="max-h-80 space-y-2 overflow-auto pr-1">
                  {effectiveGrants.slice(0, 80).map((grant) => (
                    <div key={`${grant.source}-${grant.id}-${grant.resource}-${grant.action}`} className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-gray-200">{grant.resource}:{grant.action}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${riskClass(grant.risk)}`}>{grant.risk}</span>
                      </div>
                      <div className="mt-1 text-xs text-gray-600">{grant.source === "group" ? `Inherited from ${(grant as any).group_name}` : `Role ${selectedManagedUser.role}`}</div>
                    </div>
                  ))}
                  {!effectiveGrants.length && <div className="text-sm text-gray-500">No direct or inherited grants were found.</div>}
                </div>
              </div>

              <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
                <div className="mb-3 text-sm font-medium text-gray-100">Groups, sessions, and audit</div>
                <div className="space-y-4">
                  <div>
                    <div className="mb-2 text-xs uppercase tracking-wide text-gray-600">Groups</div>
                    <div className="flex flex-wrap gap-2">
                      {(detail?.inheritedGroups || []).map((group) => <span key={group.id} className="rounded-full border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-300">{group.name}</span>)}
                      {!detail?.inheritedGroups?.length && <span className="text-sm text-gray-500">No group memberships.</span>}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 text-xs uppercase tracking-wide text-gray-600">Sessions</div>
                    <div className="space-y-2">
                      {(detail?.sessions || []).slice(0, 4).map((session) => (
                        <div key={session.id} className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-xs text-gray-400">
                          <div className="flex justify-between gap-3">
                            <span>{session.active ? "Active" : "Inactive"} / {session.ipAddress || "unknown IP"}</span>
                            <span>{formatDateTime(session.lastUsedAt || session.createdAt)}</span>
                          </div>
                          <div className="mt-1 truncate text-gray-600">{session.userAgent || "Unknown user agent"}</div>
                        </div>
                      ))}
                      {!detail?.sessions?.length && <div className="text-sm text-gray-500">No sessions found.</div>}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 text-xs uppercase tracking-wide text-gray-600">Recent audit</div>
                    <div className="space-y-2">
                      {(detail?.auditEvents || []).slice(0, 4).map((event) => (
                        <div key={event.id} className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-xs">
                          <div className="text-gray-200">{event.action}</div>
                          <div className="mt-1 text-gray-600">{event.entityType} / {event.entityId} / {formatDateTime(event.createdAt)}</div>
                        </div>
                      ))}
                      {!detail?.auditEvents?.length && <div className="text-sm text-gray-500">No audit events found.</div>}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
