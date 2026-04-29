"use client";

import { type Dispatch, type FormEvent, type SetStateAction } from "react";
import { Clipboard, KeyRound, Radio, Trash2 } from "lucide-react";
import { FieldInput } from "./components";
import { formatDateTime } from "./helpers";
import type { EdgeCollector, EdgeEnrollmentToken, EdgeRuntimeConfig } from "./types";

export type EdgeEnrollmentDraft = {
  name: string;
  site: string;
  labels: string;
  expiresInHours: string;
  maxUses: string;
};

type EdgeEnrollmentPanelProps = {
  apiUrl: string;
  edgeEnrollmentDraft: EdgeEnrollmentDraft;
  setEdgeEnrollmentDraft: Dispatch<SetStateAction<EdgeEnrollmentDraft>>;
  issuedEnrollmentToken: string;
  edgeRuntimeConfig: EdgeRuntimeConfig | null;
  edgeEnrollmentTokens: EdgeEnrollmentToken[];
  edgeCollectors: EdgeCollector[];
  saving: boolean;
  onCreateToken: (event: FormEvent) => void;
  onCopyIssuedToken: () => void;
  onCopyRuntimeConfig: () => void;
  onRevokeToken: (id: string) => void;
  onDeleteCollector: (id: string, name: string) => void;
};

export function EdgeEnrollmentPanel({
  apiUrl,
  edgeEnrollmentDraft,
  setEdgeEnrollmentDraft,
  issuedEnrollmentToken,
  edgeRuntimeConfig,
  edgeEnrollmentTokens,
  edgeCollectors,
  saving,
  onCreateToken,
  onCopyIssuedToken,
  onCopyRuntimeConfig,
  onRevokeToken,
  onDeleteCollector,
}: EdgeEnrollmentPanelProps) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <form onSubmit={onCreateToken} className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-medium text-gray-100">
            <Radio className="h-4 w-4 text-cyan-300" />
            Issue edge enrollment token
          </div>
          <div className="grid gap-3">
            <FieldInput label="Token name" value={edgeEnrollmentDraft.name} onChange={(value) => setEdgeEnrollmentDraft((current) => ({ ...current, name: value }))} placeholder="Austin edge enrollment" autoComplete="off" />
            <FieldInput label="Site" value={edgeEnrollmentDraft.site} onChange={(value) => setEdgeEnrollmentDraft((current) => ({ ...current, site: value }))} placeholder="Austin DC" autoComplete="off" />
            <FieldInput label="Labels" value={edgeEnrollmentDraft.labels} onChange={(value) => setEdgeEnrollmentDraft((current) => ({ ...current, labels: value }))} placeholder='{"zone":"prod"} or zone=prod,tier=edge' help="Labels are attached to the enrolled collector." />
            <div className="grid grid-cols-2 gap-3">
              <FieldInput label="Expires in hours" value={edgeEnrollmentDraft.expiresInHours} onChange={(value) => setEdgeEnrollmentDraft((current) => ({ ...current, expiresInHours: value }))} type="number" />
              <FieldInput label="Max uses" value={edgeEnrollmentDraft.maxUses} onChange={(value) => setEdgeEnrollmentDraft((current) => ({ ...current, maxUses: value }))} type="number" />
            </div>
          </div>
          <button type="submit" disabled={saving} className="mt-4 flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50">
            <Radio className="h-4 w-4" />
            Generate token
          </button>
        </form>

        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <div className="text-sm font-medium text-gray-100">specora-edge enrollment flow</div>
          <div className="mt-3 rounded-lg border border-gray-800 bg-gray-950 p-3 font-mono text-xs leading-6 text-gray-300">
            POST {apiUrl}/edge/enroll<br />
            {"{"}<br />
            &nbsp;&nbsp;"registration_token": "se_...",<br />
            &nbsp;&nbsp;"version": "dev",<br />
            &nbsp;&nbsp;"capabilities": ["collector.query.osquery"]<br />
            {"}"}
          </div>
          <div className="mt-3 text-sm leading-6 text-gray-500">
            The runtime exchange returns the tenant, relay, key, and policy identifiers specora-edge stores locally. Enrollment tokens are shown only once.
          </div>
          {issuedEnrollmentToken && (
            <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <div className="text-xs uppercase tracking-wide text-amber-200">Copy this token now</div>
              <div className="mt-2 flex items-stretch gap-2">
                <div className="min-w-0 flex-1 break-all rounded border border-amber-500/30 bg-gray-950 p-2 font-mono text-sm text-amber-100">{issuedEnrollmentToken}</div>
                <button
                  type="button"
                  onClick={onCopyIssuedToken}
                  className="flex shrink-0 items-center gap-2 rounded-lg border border-amber-400/40 px-3 py-2 text-sm font-medium text-amber-100 hover:bg-amber-500/10"
                >
                  <Clipboard className="h-4 w-4" />
                  Copy
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-800 px-4 py-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-gray-100">
              <KeyRound className="h-4 w-4 text-cyan-300" />
              Edge runtime configuration
            </div>
            <div className="mt-1 text-xs text-gray-500">Published for enrolled edge servers to fetch after registration. Operators still choose where these files are written locally.</div>
          </div>
          {edgeRuntimeConfig && (
            <button type="button" onClick={onCopyRuntimeConfig} className="flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-xs font-medium text-gray-200 hover:bg-gray-800">
              <Clipboard className="h-4 w-4" />
              Copy config
            </button>
          )}
        </div>
        {edgeRuntimeConfig ? (
          <div className="grid gap-4 p-4 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-3">
              <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                <div className="text-xs uppercase tracking-wide text-gray-500">Fetch endpoint</div>
                <div className="mt-2 break-all font-mono text-sm text-cyan-100">GET {apiUrl}/edge/runtime-config</div>
              </div>
              <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                <div className="text-xs uppercase tracking-wide text-gray-500">Public signing key</div>
                <div className="mt-2 break-all font-mono text-sm text-gray-200">{edgeRuntimeConfig.publicSigningKey || "Not configured"}</div>
                <div className="mt-2 text-xs text-gray-500">key_id: {edgeRuntimeConfig.runtimeConfig.key_id}</div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(edgeRuntimeConfig.runtimeConfig.readiness || {}).map(([key, value]) => (
                  <div key={key} className={`rounded-lg border p-3 ${value ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100" : "border-amber-400/30 bg-amber-500/10 text-amber-100"}`}>
                    <div className="text-xs font-medium">{value ? "Ready" : "Needs value"}</div>
                    <div className="mt-1 break-words text-xs text-current/80">{key.replaceAll("_", " ")}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">Keyring</div>
                <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all text-xs leading-5 text-gray-300">{JSON.stringify(edgeRuntimeConfig.runtimeConfig.keyring, null, 2)}</pre>
              </div>
              <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">Suggested paths</div>
                <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all text-xs leading-5 text-gray-300">{JSON.stringify(edgeRuntimeConfig.runtimeConfig.suggested_paths, null, 2)}</pre>
              </div>
              <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">Collector manifest</div>
                <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all text-xs leading-5 text-gray-300">{JSON.stringify(edgeRuntimeConfig.runtimeConfig.collector_manifest, null, 2)}</pre>
              </div>
              <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">Capability policy</div>
                <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all text-xs leading-5 text-gray-300">{JSON.stringify(edgeRuntimeConfig.runtimeConfig.capability_policy, null, 2)}</pre>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4 text-sm text-gray-500">Runtime configuration is unavailable. Confirm the platform job signing key is configured.</div>
        )}
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900">
        <div className="border-b border-gray-800 px-4 py-3">
          <div className="text-sm font-medium text-gray-100">Enrollment tokens</div>
          <div className="mt-1 text-xs text-gray-500">Hashed at rest, revocable, and tied to collectors after use.</div>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-950 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Prefix</th>
                <th className="px-4 py-3">Site</th>
                <th className="px-4 py-3">Uses</th>
                <th className="px-4 py-3">Collector</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {edgeEnrollmentTokens.map((token) => (
                <tr key={token.id} className="border-t border-gray-800/70">
                  <td className="px-4 py-3 text-gray-100">{token.name}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2 py-1 text-xs ${token.status === "active" ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : "border-gray-700 bg-gray-950 text-gray-400"}`}>{token.status}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">{token.tokenPrefix}...</td>
                  <td className="px-4 py-3 text-gray-400">{token.site || "-"}</td>
                  <td className="px-4 py-3 text-gray-400">{token.uses}/{token.maxUses}</td>
                  <td className="px-4 py-3 text-gray-400">{token.collectorName || token.collectorId || "-"}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDateTime(token.expiresAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {token.status === "active" && (
                      <button type="button" onClick={() => onRevokeToken(token.id)} className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/10">
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!edgeEnrollmentTokens.length && <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-500">No enrollment tokens have been issued.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900">
        <div className="border-b border-gray-800 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-100">
            <Radio className="h-4 w-4 text-cyan-300" />
            Enrolled edge servers
          </div>
          <div className="mt-1 text-xs text-gray-500">Collector posture, heartbeat freshness, source bindings, and network origin.</div>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-950 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Server</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Site</th>
                <th className="px-4 py-3">Version</th>
                <th className="px-4 py-3">Heartbeat</th>
                <th className="px-4 py-3">Sources</th>
                <th className="px-4 py-3">Last IP</th>
                <th className="px-4 py-3">Labels</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {edgeCollectors.map((collector) => (
                <tr key={collector.id} className="border-t border-gray-800/70">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-100">{collector.name}</div>
                    <div className="font-mono text-xs text-gray-600">{collector.id}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2 py-1 text-xs ${collector.status === "healthy" ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : collector.status === "degraded" ? "border-amber-400/30 bg-amber-500/10 text-amber-100" : "border-gray-700 bg-gray-950 text-gray-400"}`}>{collector.status}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{collector.site || "-"}</td>
                  <td className="px-4 py-3 text-gray-400">{collector.version || "-"}</td>
                  <td className="px-4 py-3">
                    <div className="text-gray-300">{collector.heartbeatAgeMinutes === null ? "Never" : `${collector.heartbeatAgeMinutes}m ago`}</div>
                    <div className="text-xs text-gray-600">{formatDateTime(collector.lastHeartbeatAt)}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{collector.sourceCount}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{collector.lastSeenIp || "-"}</td>
                  <td className="px-4 py-3">
                    <div className="max-w-xs truncate font-mono text-xs text-gray-500">{JSON.stringify(collector.labels || {})}</div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => onDeleteCollector(collector.id, collector.name)}
                      disabled={saving}
                      className="inline-flex items-center gap-2 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/10 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {!edgeCollectors.length && <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-gray-500">No edge servers have enrolled yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
