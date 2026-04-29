"use client";

import { type Dispatch, type FormEvent, type SetStateAction } from "react";
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { FieldInput, FieldSelect, MiniMetric, ReadOnlyField } from "./components";
import { CREDENTIAL_PROVIDER_OPTIONS, CREDENTIAL_SCOPE_OPTIONS } from "./helpers";
import type { CredentialReference } from "./types";

export type CredentialDraft = {
  name: string;
  ref: string;
  provider: string;
  status: string;
  scope: string;
  secretValue: string;
  secretEnvKey: string;
  externalRef: string;
  description: string;
};

type CredentialsPanelProps = {
  credentials: CredentialReference[];
  newCredential: CredentialDraft;
  setNewCredential: Dispatch<SetStateAction<CredentialDraft>>;
  showCredentialSecret: boolean;
  setShowCredentialSecret: Dispatch<SetStateAction<boolean>>;
  generatedCredentialRef: string;
  canAddCredential: boolean;
  saving: boolean;
  onAdd: (event: FormEvent) => void;
  onUpdate: (id: string, patch: Partial<CredentialReference>) => void;
  onTest: (id: string) => void;
  onDelete: (id: string) => void;
};

export function CredentialsPanel({
  credentials,
  newCredential,
  setNewCredential,
  showCredentialSecret,
  setShowCredentialSecret,
  generatedCredentialRef,
  canAddCredential,
  saving,
  onAdd,
  onUpdate,
  onTest,
  onDelete,
}: CredentialsPanelProps) {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-medium text-gray-200">
              <KeyRound className="h-4 w-4 text-emerald-300" />
              Credential References
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-500">
              Register reusable refs for Discovery and integration clients while keeping secret values outside Specora.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-right text-sm">
            <MiniMetric label="Total" value={credentials.length} />
            <MiniMetric label="Active" value={credentials.filter((credential) => credential.status === "active").length} />
            <MiniMetric label="Healthy" value={credentials.filter((credential) => credential.lastStatus === "ok").length} />
          </div>
        </div>

        <form onSubmit={onAdd} className="mt-5 space-y-4" autoComplete="off">
          <div className="grid gap-4 xl:grid-cols-3">
            <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-gray-500">1. Usage</div>
              <div className="mt-3 space-y-3">
                <FieldInput
                  label="Display Name"
                  value={newCredential.name}
                  onChange={(value) => setNewCredential((current) => ({ ...current, name: value }))}
                  placeholder="Inventory API"
                  help="Human-readable label shown in Admin."
                  autoComplete="off"
                  inputName="credential-display-name"
                />
                <FieldSelect
                  label="Scope"
                  value={newCredential.scope}
                  onChange={(value) => setNewCredential((current) => ({ ...current, scope: value }))}
                  options={CREDENTIAL_SCOPE_OPTIONS}
                  help="Which product area is expected to use this credential."
                />
              </div>
            </div>

            <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-gray-500">2. App Reference</div>
              <div className="mt-3 space-y-3">
                <ReadOnlyField
                  label="Generated Credential Ref"
                  value={generatedCredentialRef || "Set a display name to generate a ref"}
                  muted={!generatedCredentialRef}
                  help="Stable URI that apps store on records. Specora builds it from provider, scope, and display name."
                />
                <FieldSelect
                  label="Status"
                  value={newCredential.status}
                  onChange={(value) => setNewCredential((current) => ({ ...current, status: value }))}
                  options={[
                    { value: "active", label: "Active" },
                    { value: "disabled", label: "Disabled" },
                  ]}
                  help="Disabled refs remain registered but fail availability checks."
                />
              </div>
            </div>

            <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-gray-500">3. Backing Secret</div>
              <div className="mt-3 space-y-3">
                <FieldSelect
                  label="Provider"
                  value={newCredential.provider}
                  onChange={(value) => setNewCredential((current) => ({ ...current, provider: value }))}
                  options={CREDENTIAL_PROVIDER_OPTIONS}
                  help="Managed secrets can be updated without restarting API. Env variables are for bootstrap or local development."
                />
                {newCredential.provider === "managed" && (
                  <FieldInput
                    label="Secret Value"
                    value={newCredential.secretValue}
                    onChange={(value) => setNewCredential((current) => ({ ...current, secretValue: value }))}
                    type={showCredentialSecret ? "text" : "password"}
                    placeholder="Paste API key or token"
                    help="Encrypted before storage and never returned by the API."
                    autoComplete="new-password"
                    inputName="credential-managed-secret"
                    trailing={
                      <button
                        type="button"
                        onClick={() => setShowCredentialSecret((visible) => !visible)}
                        className="rounded p-1 text-gray-500 hover:bg-gray-700 hover:text-gray-200"
                        title={showCredentialSecret ? "Mask secret value" : "Unmask secret value"}
                      >
                        {showCredentialSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    }
                  />
                )}
                {newCredential.provider === "env" && (
                  <FieldInput
                    label="Environment Key"
                    value={newCredential.secretEnvKey}
                    onChange={(value) => setNewCredential((current) => ({ ...current, secretEnvKey: value }))}
                    placeholder="DISCOVERY_TOKEN"
                    help="Name of the process environment variable that holds the secret."
                  />
                )}
                {newCredential.provider === "external" && (
                  <FieldInput
                    label="External Store Ref"
                    value={newCredential.externalRef}
                    onChange={(value) => setNewCredential((current) => ({ ...current, externalRef: value }))}
                    placeholder="vault/specora/discovery"
                    help="Path or identifier in an outside secret store. Specora records the pointer but does not ingest vault certificates yet."
                  />
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-950 px-4 py-3">
            <div className="text-xs leading-5 text-gray-500">
              Discovery stores the Credential Ref on a source. At test or run time, the provider determines where the secret is resolved.
            </div>
            <button
              type="submit"
              disabled={saving || !canAddCredential}
              className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add Reference
            </button>
          </div>
        </form>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Ref</th>
              <th className="px-4 py-3 font-medium">Provider</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Last Test</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {credentials.map((credential) => (
              <tr key={credential.id} className="border-b border-gray-800/50 last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-100">{credential.name}</div>
                  <div className="mt-1 text-xs text-gray-500">{credential.scope}</div>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-indigo-200">{credential.ref}</td>
                <td className="px-4 py-3 capitalize text-gray-300">{credential.provider}</td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => onUpdate(credential.id, { status: credential.status === "active" ? "disabled" : "active" })}
                    className={`rounded-md border px-2.5 py-1 text-xs ${credential.status === "active" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-gray-700 bg-gray-800 text-gray-400"}`}
                  >
                    {credential.status}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className={`text-xs ${credential.lastStatus === "ok" ? "text-emerald-300" : credential.lastStatus ? "text-amber-300" : "text-gray-500"}`}>
                    {credential.lastStatus || "untested"}
                  </div>
                  {credential.lastError && <div className="mt-1 max-w-xs truncate text-xs text-gray-500">{credential.lastError}</div>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => onTest(credential.id)} className="rounded-md border border-gray-700 p-2 text-gray-300 hover:bg-gray-800" title="Test">
                      <CheckCircle2 className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => onDelete(credential.id)} className="rounded-md border border-gray-700 p-2 text-gray-400 hover:bg-gray-800" title="Delete">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!credentials.length && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                  No credential references registered.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
