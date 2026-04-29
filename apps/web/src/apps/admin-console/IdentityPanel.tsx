"use client";

import { type Dispatch, type FormEvent, type SetStateAction } from "react";
import { ChevronDown, ChevronRight, Clipboard, KeyRound, Loader2, Plus, Save, ShieldCheck, Trash2 } from "lucide-react";
import { FieldInput, FieldSelect } from "./components";
import { decodePermissionValue, encodePermissionValue } from "./helpers";
import type {
  CmdbGroupOption,
  IdentityGroup,
  IdentityGroupMembership,
  IdentityGroupPermission,
  RbacTarget,
  RbacUser,
  SsoConfig,
} from "./types";

export type NewSsoConfigDraft = {
  name: string;
  provider: "saml" | "oidc";
  status: "active" | "inactive";
  emailDomains: string;
  idpSsoUrl: string;
  idpEntityId: string;
  metadataUrl: string;
  metadataXml: string;
  issuerUrl: string;
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  clientId: string;
  clientSecretRef: string;
  scopes: string;
  enforceSso: boolean;
  jitEnabled: boolean;
  defaultRole: string;
};

type NewIdentityGroupDraft = {
  name: string;
  description: string;
  cmdbCiId: string;
};

type GroupGrantDraft = {
  resource: string;
  action: string;
};

type IdentityPanelProps = {
  ssoConfigs: SsoConfig[];
  newSsoConfig: NewSsoConfigDraft;
  setNewSsoConfig: Dispatch<SetStateAction<NewSsoConfigDraft>>;
  isSsoRegisterOpen: boolean;
  setIsSsoRegisterOpen: Dispatch<SetStateAction<boolean>>;
  identityGroups: IdentityGroup[];
  identityGroupMemberships: IdentityGroupMembership[];
  identityGroupPermissions: IdentityGroupPermission[];
  cmdbGroupOptions: CmdbGroupOption[];
  newIdentityGroup: NewIdentityGroupDraft;
  setNewIdentityGroup: Dispatch<SetStateAction<NewIdentityGroupDraft>>;
  groupMemberUserId: string;
  setGroupMemberUserId: Dispatch<SetStateAction<string>>;
  groupGrant: GroupGrantDraft;
  setGroupGrant: Dispatch<SetStateAction<GroupGrantDraft>>;
  rbacUsers: RbacUser[];
  rbacTargets: RbacTarget[];
  saving: boolean;
  onAddSso: (event: FormEvent) => void;
  onUpdateSso: (id: string, patch: Partial<SsoConfig>) => void;
  onDeleteSso: (id: string) => void;
  onReadSamlMetadataFile: (file?: File | null) => void;
  onCopyValue: (value: string) => void;
  onAddIdentityGroup: (event: FormEvent) => void;
  onDeleteIdentityGroup: (group: IdentityGroup, memberCount: number, grantCount: number) => void;
  onAddIdentityGroupMember: (groupId: string) => void;
  onAddIdentityGroupGrant: (groupId: string) => void;
};

export function IdentityPanel({
  ssoConfigs,
  newSsoConfig,
  setNewSsoConfig,
  isSsoRegisterOpen,
  setIsSsoRegisterOpen,
  identityGroups,
  identityGroupMemberships,
  identityGroupPermissions,
  cmdbGroupOptions,
  newIdentityGroup,
  setNewIdentityGroup,
  groupMemberUserId,
  setGroupMemberUserId,
  groupGrant,
  setGroupGrant,
  rbacUsers,
  rbacTargets,
  saving,
  onAddSso,
  onUpdateSso,
  onDeleteSso,
  onReadSamlMetadataFile,
  onCopyValue,
  onAddIdentityGroup,
  onDeleteIdentityGroup,
  onAddIdentityGroupMember,
  onAddIdentityGroupGrant,
}: IdentityPanelProps) {
  const cmdbGroupLabel = (id?: string | null) => {
    if (!id) return "";
    const option = cmdbGroupOptions.find((group) => group.id === id);
    return option ? `${option.name} (${option.id})` : `CMDB ${id}`;
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-medium text-gray-200">
              <KeyRound className="h-4 w-4 text-cyan-300" />
              Multi-provider SSO
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-500">
              Register one provider per IdP, tenant, or domain set. Login discovery uses the user's email domain to route to the matching active provider.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-2">
              <div className="text-lg font-semibold text-gray-100">{ssoConfigs.length}</div>
              <div className="text-gray-500">providers</div>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-2">
              <div className="text-lg font-semibold text-emerald-200">{ssoConfigs.filter((config) => config.status === "active").length}</div>
              <div className="text-gray-500">active</div>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-2">
              <div className="text-lg font-semibold text-amber-200">{ssoConfigs.filter((config) => config.enforceSso).length}</div>
              <div className="text-gray-500">enforced</div>
            </div>
          </div>
        </div>
      </div>

      <form onSubmit={onAddSso} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
        <button type="button" onClick={() => setIsSsoRegisterOpen((open) => !open)} className="flex w-full items-center justify-between gap-3 text-left">
          <span className="flex items-center gap-2 text-sm font-medium text-gray-300">
            <Plus className="h-4 w-4" /> Register Identity Provider
          </span>
          {isSsoRegisterOpen ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-500" />}
        </button>
        {isSsoRegisterOpen && (
          <div className="mt-4">
            <div className="mb-4 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3 text-sm text-cyan-100">
              <div className="font-medium">SAML service provider values are generated after saving the provider.</div>
              <div className="mt-1 text-cyan-200/70">Create the provider first, then copy the ACS URL and Entity ID from its card into the IdP configuration.</div>
            </div>
            <div className="grid gap-3 lg:grid-cols-4">
              <FieldInput label="Name" value={newSsoConfig.name} onChange={(value) => setNewSsoConfig((current) => ({ ...current, name: value }))} placeholder="Okta Workforce" />
              <FieldSelect
                label="Protocol"
                value={newSsoConfig.provider}
                onChange={(value) => setNewSsoConfig((current) => ({ ...current, provider: value as "saml" | "oidc" }))}
                options={[{ value: "saml", label: "SAML 2.0" }, { value: "oidc", label: "OpenID Connect" }]}
              />
              <FieldSelect
                label="Status"
                value={newSsoConfig.status}
                onChange={(value) => setNewSsoConfig((current) => ({ ...current, status: value as "active" | "inactive" }))}
                options={[{ value: "inactive", label: "Inactive" }, { value: "active", label: "Active" }]}
              />
              <FieldInput label="Domains" value={newSsoConfig.emailDomains} onChange={(value) => setNewSsoConfig((current) => ({ ...current, emailDomains: value }))} placeholder="example.com, corp.example" />
              {newSsoConfig.provider === "saml" ? (
                <>
                  <FieldInput label="IdP SSO URL" value={newSsoConfig.idpSsoUrl} onChange={(value) => setNewSsoConfig((current) => ({ ...current, idpSsoUrl: value }))} placeholder="https://idp.example/sso" />
                  <FieldInput label="IdP Entity ID" value={newSsoConfig.idpEntityId} onChange={(value) => setNewSsoConfig((current) => ({ ...current, idpEntityId: value }))} />
                  <FieldInput label="Metadata URL" value={newSsoConfig.metadataUrl} onChange={(value) => setNewSsoConfig((current) => ({ ...current, metadataUrl: value }))} />
                  <div>
                    <label className="mb-1 block text-xs text-gray-500">Metadata XML</label>
                    <input
                      type="file"
                      accept=".xml,text/xml,application/xml"
                      onChange={(event) => onReadSamlMetadataFile(event.target.files?.[0])}
                      className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-300 file:mr-3 file:rounded file:border-0 file:bg-gray-700 file:px-2 file:py-1 file:text-gray-200"
                    />
                  </div>
                  <div className="lg:col-span-4">
                    <label className="mb-1 block text-xs text-gray-500">Paste Metadata XML</label>
                    <textarea
                      value={newSsoConfig.metadataXml}
                      onChange={(event) => setNewSsoConfig((current) => ({ ...current, metadataXml: event.target.value }))}
                      placeholder="<EntityDescriptor ...>"
                      rows={4}
                      className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </>
              ) : (
                <>
                  <FieldInput label="Issuer URL" value={newSsoConfig.issuerUrl} onChange={(value) => setNewSsoConfig((current) => ({ ...current, issuerUrl: value }))} />
                  <FieldInput label="Authorization URL" value={newSsoConfig.authorizationUrl} onChange={(value) => setNewSsoConfig((current) => ({ ...current, authorizationUrl: value }))} />
                  <FieldInput label="Token URL" value={newSsoConfig.tokenUrl} onChange={(value) => setNewSsoConfig((current) => ({ ...current, tokenUrl: value }))} />
                  <FieldInput label="Userinfo URL" value={newSsoConfig.userinfoUrl} onChange={(value) => setNewSsoConfig((current) => ({ ...current, userinfoUrl: value }))} />
                  <FieldInput label="Client ID" value={newSsoConfig.clientId} onChange={(value) => setNewSsoConfig((current) => ({ ...current, clientId: value }))} />
                  <FieldInput label="Secret Ref" value={newSsoConfig.clientSecretRef} onChange={(value) => setNewSsoConfig((current) => ({ ...current, clientSecretRef: value }))} placeholder="secret://identity/okta" />
                  <FieldInput label="Scopes" value={newSsoConfig.scopes} onChange={(value) => setNewSsoConfig((current) => ({ ...current, scopes: value }))} />
                </>
              )}
              <FieldInput label="Default Role" value={newSsoConfig.defaultRole} onChange={(value) => setNewSsoConfig((current) => ({ ...current, defaultRole: value }))} />
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-4 text-sm text-gray-400">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={newSsoConfig.jitEnabled} onChange={(event) => setNewSsoConfig((current) => ({ ...current, jitEnabled: event.target.checked }))} className="h-4 w-4 accent-cyan-400" />
                  JIT users
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={newSsoConfig.enforceSso} onChange={(event) => setNewSsoConfig((current) => ({ ...current, enforceSso: event.target.checked }))} className="h-4 w-4 accent-cyan-400" />
                  Require SSO for domains
                </label>
              </div>
              <button type="submit" disabled={saving || !newSsoConfig.name || !newSsoConfig.emailDomains} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Add Provider
              </button>
            </div>
          </div>
        )}
      </form>

      <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-medium text-gray-300">
          <ShieldCheck className="h-4 w-4 text-indigo-300" /> Identity Groups
        </h3>
        <form onSubmit={onAddIdentityGroup} className="grid items-end gap-3 lg:grid-cols-[1fr_1fr_1fr_auto]">
          <FieldInput label="Group Name" value={newIdentityGroup.name} onChange={(value) => setNewIdentityGroup((current) => ({ ...current, name: value }))} placeholder="Network Operations" />
          <FieldInput label="Description" value={newIdentityGroup.description} onChange={(value) => setNewIdentityGroup((current) => ({ ...current, description: value }))} />
          <FieldSelect
            label="Linked CMDB Group"
            value={newIdentityGroup.cmdbCiId}
            onChange={(value) => setNewIdentityGroup((current) => ({ ...current, cmdbCiId: value }))}
            options={[
              { value: "", label: "Not linked" },
              ...cmdbGroupOptions.map((group) => ({ value: group.id, label: `${group.name} (${group.id})` })),
            ]}
          />
          <button type="submit" disabled={saving || !newIdentityGroup.name} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Add Group
          </button>
        </form>
        <div className="mt-4 grid gap-3">
          {identityGroups.map((group) => {
            const members = identityGroupMemberships.filter((member) => member.group_id === group.id);
            const grants = identityGroupPermissions.filter((grant) => grant.group_id === group.id);
            return (
              <div key={group.id} className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-gray-100">{group.name}</div>
                    <div className="mt-1 text-xs text-gray-500">{group.slug} · {group.source}{group.cmdb_ci_id ? ` · ${cmdbGroupLabel(group.cmdb_ci_id)}` : ""}</div>
                    {group.description && <div className="mt-2 text-sm text-gray-400">{group.description}</div>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded bg-gray-800 px-2 py-1 text-gray-300">{members.length} members</span>
                    <span className="rounded bg-gray-800 px-2 py-1 text-gray-300">{grants.length} grants</span>
                    <button
                      type="button"
                      onClick={() => onDeleteIdentityGroup(group, members.length, grants.length)}
                      disabled={saving}
                      className="flex items-center gap-1 rounded border border-red-500/30 px-2 py-1 text-red-200 hover:border-red-400 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </button>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <div>
                    <div className="mb-2 text-xs font-medium uppercase text-gray-500">Members</div>
                    <div className="space-y-1">
                      {members.map((member) => (
                        <div key={member.id} className="rounded bg-gray-900 px-2 py-1 text-sm text-gray-300">{member.user_name || member.user_email}</div>
                      ))}
                      {!members.length && <div className="text-sm text-gray-600">No members</div>}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <select value={groupMemberUserId} onChange={(event) => setGroupMemberUserId(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-200">
                        <option value="">Add user...</option>
                        {rbacUsers.map((user) => <option key={user.id} value={user.id}>{user.name || user.email}</option>)}
                      </select>
                      <button onClick={() => onAddIdentityGroupMember(group.id)} className="rounded border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:border-indigo-400">Add</button>
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 text-xs font-medium uppercase text-gray-500">Inherited Grants</div>
                    <div className="space-y-1">
                      {grants.map((grant) => (
                        <div key={grant.id} className="rounded bg-gray-900 px-2 py-1 text-sm text-gray-300">{grant.resource}:{grant.action}</div>
                      ))}
                      {!grants.length && <div className="text-sm text-gray-600">No grants</div>}
                    </div>
                    <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                      <select
                        value={groupGrant.resource && groupGrant.action ? encodePermissionValue(groupGrant.resource, groupGrant.action) : ""}
                        onChange={(event) => {
                          const [resource, action] = decodePermissionValue(event.target.value);
                          setGroupGrant({ resource, action });
                        }}
                        className="min-w-0 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-200"
                      >
                        <option value="">Grant permission...</option>
                        {rbacTargets.map((target) => (
                          <option key={`${target.resource}:${target.action}`} value={encodePermissionValue(target.resource, target.action)}>{target.label || target.resource}:{target.action}</option>
                        ))}
                      </select>
                      <button onClick={() => onAddIdentityGroupGrant(group.id)} className="rounded border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:border-indigo-400">Grant</button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {!identityGroups.length && <div className="rounded-lg border border-dashed border-gray-800 p-6 text-center text-sm text-gray-500">No identity groups are registered yet.</div>}
        </div>
      </div>

      <div className="grid gap-4">
        {ssoConfigs.map((config) => (
          <div key={config.id} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold text-gray-100">{config.name}</h3>
                  <span className="rounded border border-gray-700 bg-gray-950 px-2 py-0.5 text-xs uppercase text-gray-300">{config.provider}</span>
                  <span className={`rounded px-2 py-0.5 text-xs ${config.status === "active" ? "bg-emerald-500/10 text-emerald-300" : "bg-gray-800 text-gray-400"}`}>{config.status}</span>
                  {config.enforceSso && <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-200">SSO required</span>}
                </div>
                <div className="mt-2 text-sm text-gray-500">{config.emailDomains.join(", ")}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => onUpdateSso(config.id, { status: config.status === "active" ? "inactive" : "active" })} className="rounded border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:border-cyan-400">
                  {config.status === "active" ? "Disable" : "Activate"}
                </button>
                <button onClick={() => onUpdateSso(config.id, { enforceSso: !config.enforceSso })} className="rounded border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:border-cyan-400">
                  {config.enforceSso ? "Allow password" : "Require SSO"}
                </button>
                <button onClick={() => onDeleteSso(config.id)} className="rounded border border-red-500/30 px-3 py-1.5 text-sm text-red-200 hover:border-red-400">
                  Delete
                </button>
              </div>
            </div>
            <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
              <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                <div className="text-xs text-gray-500">Start URL</div>
                <div className="mt-1 truncate text-gray-300">{config.provider === "oidc" ? config.authorizationUrl || "-" : config.idpSsoUrl || "-"}</div>
              </div>
              <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                <div className="text-xs text-gray-500">Issuer / Entity</div>
                <div className="mt-1 truncate text-gray-300">{config.provider === "oidc" ? config.issuerUrl || "-" : config.idpEntityId || "-"}</div>
              </div>
              <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                <div className="text-xs text-gray-500">JIT / Role</div>
                <div className="mt-1 text-gray-300">{config.jitEnabled ? "JIT enabled" : "JIT disabled"} / {config.defaultRole}</div>
                {config.provider === "saml" && <div className="mt-1 text-xs text-gray-600">{config.metadataXmlPresent ? "Metadata XML stored" : "No metadata XML"}</div>}
              </div>
            </div>
            <div className="mt-3 grid gap-3">
              <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-gray-500">SP ACS URL</div>
                    <div className="mt-1 break-all text-gray-300">{config.spAcsUrl || "-"}</div>
                  </div>
                  <button type="button" onClick={() => onCopyValue(config.spAcsUrl)} className="flex shrink-0 items-center gap-2 rounded-md border border-cyan-500/40 px-3 py-1.5 text-xs text-cyan-100 hover:bg-cyan-500/10">
                    <Clipboard className="h-3.5 w-3.5" /> Copy
                  </button>
                </div>
              </div>
              <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-gray-500">SP Entity ID</div>
                    <div className="mt-1 break-all text-gray-300">{config.spEntityId || "-"}</div>
                  </div>
                  <button type="button" onClick={() => onCopyValue(config.spEntityId)} className="flex shrink-0 items-center gap-2 rounded-md border border-cyan-500/40 px-3 py-1.5 text-xs text-cyan-100 hover:bg-cyan-500/10">
                    <Clipboard className="h-3.5 w-3.5" /> Copy
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
        {!ssoConfigs.length && (
          <div className="rounded-xl border border-dashed border-gray-800 bg-gray-900 p-8 text-center text-sm text-gray-500">
            No identity providers are registered yet.
          </div>
        )}
      </div>
    </div>
  );
}
